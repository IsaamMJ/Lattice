#!/usr/bin/env node
// test/telemetry-sanitize.test.mjs — regression tests for #199 and #200.
//
// Background: `lattice report` filed #194–#198 with corrupted titles. Two
// independent defects in worker/lattice-telemetry.js produced them:
//
//   #199 Bug A — every non-ASCII character became U+FFFD. Root cause is the
//        request decode: the Windows client emits its JSON payload in the
//        shell ANSI codepage (CP1252, em dash = single byte 0x97) and the
//        Worker used `request.json()`, whose UTF-8 decoder maps every
//        un-decodable byte to U+FFFD. The character was gone before any
//        sanitiser ran, and the damage is permanent in the filed issue.
//   #199 Bug B — `sanitizeExcerpt` was applied to titles. Its path rule
//        (`/\/[A-Za-z0-9_./\\-]+/`) redacts a slash plus everything after it,
//        so "0/8 true positives" was stored as "0[path] true positives". The
//        same rule destroys 24/7, and/or, A/B, CI/CD, TypeScript/JS.
//   #200 — recurring fingerprints were filed as fresh issues (KV expires at
//        24h and the search was pinned to state:open), so every report read
//        "Occurrences: 1". The count now lives in the issue body.
//
// What is tested:
//   1. The exact #195 title round-trips through sanitizeTitle unharmed.
//   2. Ratios, dates and slashed prose survive; genuine paths are redacted.
//   3. The [sha] rule no longer eats dictionary words.
//   4. A CP1252-encoded payload decodes to real characters, not U+FFFD.
//   5. Code-point-safe truncation never manufactures a lone surrogate.
//   6. The occurrence marker round-trips (the #200 durable count).
//   7. The Worker source contains no literal control bytes (it used to read
//      as a binary file to git and grep).
//
// Run directly:  node test/telemetry-sanitize.test.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKER = join(ROOT, 'worker', 'lattice-telemetry.js');
const { __test__: T } = await import(`file://${WORKER}`);

let pass = 0;
let fail = 0;
const ok = (msg) => { console.log(`[telemetry-test]   PASS: ${msg}`); pass++; };
const bad = (msg) => { console.error(`[telemetry-test]   FAIL: ${msg}`); fail++; };
const eq = (label, actual, expected) => {
  if (actual === expected) ok(`${label} => ${JSON.stringify(actual)}`);
  else bad(`${label}\n      want: ${JSON.stringify(expected)}\n      got:  ${JSON.stringify(actual)}`);
};

const EM = '\u2014';   // — U+2014 EM DASH, the character mangled in #194–#198
const EN = '\u2013';   // – U+2013 EN DASH

// --- 1. The exact strings from #199 -------------------------------------
console.log('[telemetry-test] --- #199: exact reported strings ---');

const T195 = `missing-tenant-filter fires HIGH on primary-key writes ${EM} 0/8 true positives, including a correct CAS claim`;
eq('#195 title survives sanitizeTitle', T.sanitizeTitle(T195), T195);

const T194 = `audit-core --changed is FILE-scoped, not diff-scoped ${EM} one comment line surfaced 8 findings in untouched code`;
eq('#194 title survives', T.sanitizeTitle(T194), T194);

const T197 = `Lattice dirties the working tree every session ${EM} tracked-but-gitignored file, CLAUDE.md rewritten mid-session, bulk YAML churn`;
eq('#197 title survives', T.sanitizeTitle(T197), T197);

// The old behaviour, pinned so it cannot come back.
if (T.sanitizeTitle(T195).includes('[path]')) bad('#195 title still contains [path] (#199 Bug B regression)');
else ok('no [path] injected into #195 title');
if (T.sanitizeTitle(T195).includes('\uFFFD')) bad('#195 title contains U+FFFD (#199 Bug A regression)');
else ok('no U+FFFD in #195 title');

// sanitizeExcerpt is what USED to run on titles; assert it is genuinely a
// different function with the old greedy behaviour still intact for stderr.
eq('sanitizeExcerpt (excerpts only) is still greedy', T.sanitizeExcerpt('0/8 true positives'), '0[path] true positives');

// --- 2. Ratios, dates, slashed prose vs genuine paths -------------------
console.log('[telemetry-test] --- #199 Bug B: path detection ---');

for (const s of [
  '0/8 true positives',
  '24/7 polling loop is wrong',
  'A/B test harness returns stale buckets',
  'CI/CD pipeline drops the cache',
  'and/or handling in the filter parser',
  'TypeScript/JS interop breaks on re-export',
  'regression window 2026/08/21 to 2026/08/24',
  'throughput fell 3/4 after the migration',
  'client/server clock skew',
  'he said 1/2 of the runs failed',
  'regression between 2.1.3/2.2.0',
  'regression between v2.1.3/v2.2.0',
  'A/B/C rollout buckets are uneven',
  'AM/PM parsing is locale-dependent',
  'n/a shown for missing severity',
  'w/ --changed the scope is wrong',
]) {
  eq(`prose preserved: ${JSON.stringify(s)}`, T.sanitizeTitle(s), s);
}

const PATHS = [
  ['leaked posix path', 'crash in /home/alice/proj/src/index.ts on save', 'crash in [path] on save'],
  ['leaked drive path', 'cannot open C:\\Users\\bob\\proj\\.lattice\\state.yml', 'cannot open [path]'],
  ['leaked drive path, forward slashes', 'cannot open C:/Users/bob/proj', 'cannot open [path]'],
  ['dot-relative path', 'see ./src/audit/core.mjs for the rule', 'see [path] for the rule'],
  ['parent-relative path', 'reads ../secrets/prod.env at boot', 'reads [path] at boot'],
  ['home-relative path', 'writes ~/.lattice/state.json every tick', 'writes [path] every tick'],
  ['repo-relative file', 'scripts/lattice-core.mjs drops the flag', '[path] drops the flag'],
  ['three-segment path', 'src/components/Button leaks state', '[path] leaks state'],
  ['path with trailing comma', 'edit scripts/lattice-close.sh, then rerun', 'edit [path], then rerun'],
  ['path in backticks', 'run `./scripts/validate.sh` first', 'run `[path]` first'],
];
for (const [label, input, expected] of PATHS) eq(`redacted: ${label}`, T.sanitizeTitle(input), expected);

// A URL is not a filesystem path and must not be shredded into [path] soup.
eq('url left intact', T.sanitizeTitle('see https://example.com/a/b/c for detail'),
   'see https://example.com/a/b/c for detail');

// --- 3. [sha] rule no longer eats dictionary words ----------------------
console.log('[telemetry-test] --- #199: [sha] tightening ---');

for (const word of ['acceded', 'defaced', 'effaced', 'deface', 'facade', 'decade', 'beaded']) {
  eq(`dictionary word kept: ${word}`, T.sanitizeTitle(`the config ${word} silently`), `the config ${word} silently`);
}
eq('short sha with digit redacted', T.sanitizeTitle('broken since a1b2c3d'), 'broken since [sha]');
eq('12-char hex redacted', T.sanitizeTitle('broken since deadbeefcafe'), 'broken since [sha]');
eq('40-char sha redacted',
   T.sanitizeTitle('broken since 1f3d141a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e'),
   'broken since [sha]');
eq('6-char hex left alone (too short to be a sha)', T.sanitizeTitle('error c0ffee here'), 'error c0ffee here');

// --- 4. #199 Bug A at its real cause: the request decode ----------------
console.log('[telemetry-test] --- #199 Bug A: CP1252 request decode ---');

const jsonText = JSON.stringify({ title: `writes ${EM} 0/8 true`, note: `#194${EN}#198` });
const utf8Bytes = new TextEncoder().encode(jsonText);
eq('utf-8 payload decodes unchanged', T.decodePayloadBytes(utf8Bytes), jsonText);

// Re-encode the same JSON the way a CP1252 Windows shell would: em dash as the
// single byte 0x97, en dash as 0x96. This is byte-for-byte what produced the
// U+FFFD in #194–#198.
const cp1252Bytes = Uint8Array.from(
  [...jsonText].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x2014) return 0x97;
    if (cp === 0x2013) return 0x96;
    if (cp > 0x7f) throw new Error(`test fixture has an unmapped char: U+${cp.toString(16)}`);
    return cp;
  })
);

// This is the old behaviour — what request.json() did — shown for contrast.
const lossy = new TextDecoder('utf-8').decode(cp1252Bytes);
if (lossy.includes('\uFFFD')) ok('lossy UTF-8 decode of CP1252 bytes does produce U+FFFD (root cause confirmed)');
else bad('expected the lossy decode to produce U+FFFD; fixture is wrong');

const recovered = JSON.parse(T.decodePayloadBytes(cp1252Bytes));
eq('CP1252 em dash recovered', recovered.title, `writes ${EM} 0/8 true`);
eq('CP1252 en dash recovered', recovered.note, `#194${EN}#198`);
if (T.decodePayloadBytes(cp1252Bytes).includes('\uFFFD')) bad('U+FFFD survived the CP1252 fallback');
else ok('no U+FFFD anywhere in the decoded CP1252 payload');

// --- 5. Code-point-safe truncation --------------------------------------
console.log('[telemetry-test] --- #199: surrogate-safe truncation ---');

const emoji = 'x'.repeat(159) + '\u{1F4A5}';           // cap lands mid surrogate pair
const cut = T.truncateCodePoints(emoji, 160);
if (/[\uD800-\uDFFF]/.test(cut)) bad('truncateCodePoints left a lone surrogate');
else ok(`truncateCodePoints dropped the whole astral char (len ${cut.length})`);
if (JSON.parse(JSON.stringify(cut)).includes('\uFFFD')) bad('truncated string serialises to U+FFFD');
else ok('truncated string survives a JSON round-trip with no U+FFFD');
eq('emoji title kept when it fits', T.sanitizeTitle('boom \u{1F4A5} in close'), 'boom \u{1F4A5} in close');

// --- 6. End-to-end sanitize() of a manual_report payload ----------------
console.log('[telemetry-test] --- #199: end-to-end sanitize() ---');

const p = T.sanitize({
  version: '2.7.1',
  command: 'report',
  exit_code: 0,
  os: 'windows',
  msg_fingerprint: 'f8755fa61eca3f9f2b5deed883d48219fa49bead13d559eadb07cb52289e9154',
  kind: 'manual_report',
  category: 'bug',
  severity: 'MED',
  title: T195,
  body: 'body text',
  project: 'Lattice',
});
if (!p) bad('sanitize() rejected a well-formed manual_report payload');
else {
  eq('sanitize() preserves the title', p.title, T195);
  eq('manualIssueTitle prefix', T.manualIssueTitle(p), `[manual-report:bug] ${T195}`);
}

// --- 7. #200: durable occurrence marker ---------------------------------
console.log('[telemetry-test] --- #200: durable occurrence count ---');

const fresh = ['<!-- lattice-fp:abc123 -->', '<!-- lattice-occurrences:1 -->', '', '- **Occurrences:** 1'].join('\n');
eq('reads the marker', T.readOccurrences(fresh), 1);
const bumped = T.writeOccurrences(fresh, 4);
eq('writes the marker', T.readOccurrences(bumped), 4);
if (bumped.includes('- **Occurrences:** 4')) ok('rendered Occurrences line updated too');
else bad(`rendered Occurrences line not updated:\n${bumped}`);

// A pre-v2.3.2 issue body has no marker — the count must still be recovered
// from the rendered line, and the marker added on the way back out.
const legacy = ['<!-- lattice-fp:abc123 -->', '', '- **Occurrences:** 3'].join('\n');
eq('reads a legacy body', T.readOccurrences(legacy), 3);
eq('upgrades a legacy body', T.readOccurrences(T.writeOccurrences(legacy, 4)), 4);

// --- 7b. #200: dedup / reopen / read-back, against a stub GitHub --------
console.log('[telemetry-test] --- #200: dedup, reopen, read-back ---');

// Minimal in-memory GitHub + KV. Exercises the real dedupHandle/manualHandle
// control flow: search -> read issue -> patch count/state -> comment, or
// create -> read title back.
function stubGitHub({ issues = {}, searchHits = [] } = {}) {
  const calls = [];
  const kv = new Map();
  const env = {
    GITHUB_TOKEN: 't', GITHUB_OWNER: 'IsaamMJ', GITHUB_REPO: 'Lattice',
    DEDUP_WINDOW_HOURS: '24',
    DEDUP_KV: {
      async get(k, opts) {
        const v = kv.get(k);
        if (v === undefined) return null;
        return opts && opts.type === 'json' ? JSON.parse(v) : v;
      },
      async put(k, v) { kv.set(k, v); },
    },
  };
  let nextNumber = 900;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace('https://api.github.com', '');
    calls.push(`${method} ${path.split('?')[0]}`);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/search/issues')) return json({ items: searchHits });
    const m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path);
    if (m) {
      const n = Number(m[1]);
      if (method === 'PATCH') { Object.assign(issues[n], JSON.parse(init.body)); return json(issues[n]); }
      return json(issues[n]);
    }
    if (/\/issues\/\d+\/comments$/.test(path)) return json({ id: 1 });
    if (/\/issues$/.test(path) && method === 'POST') {
      const sent = JSON.parse(init.body);
      const n = nextNumber++;
      issues[n] = { number: n, state: 'open', ...sent };
      return json(issues[n]);
    }
    throw new Error(`unstubbed ${method} ${path}`);
  };
  return { env, issues, calls, kv };
}

const realFetch = globalThis.fetch;
const TP = {
  version: '2.7.1', command: 'close', exit_code: 2, os: 'windows',
  msg_fingerprint: 'f8755fa61eca3f9f2b5deed883d48219fa49bead13d559eadb07cb52289e9154',
  msg_excerpt: 'close: cannot resolve [path]', timestamp: '2026-08-24T00:00:00Z', kind: 'telemetry',
};

try {
  // (a) nothing anywhere -> create, then read the title back.
  {
    const g = stubGitHub();
    const r = await T.dedupHandle(g.env, TP);
    eq('new fingerprint creates an issue', r.action, 'created');
    eq('new issue starts at 1 occurrence', r.count, 1);
    if (g.calls.some((c) => c.startsWith('GET /repos/') )) ok('title is read back after filing (#199)');
    else bad(`no read-back GET after create: ${g.calls.join(' | ')}`);
    eq('read-back sees the title we sent', g.issues[r.issue_number].title, T.issueTitle(TP));
  }

  // (b) an OPEN issue already carries the fingerprint -> comment, count bumps
  //     from the issue body (not from KV, which is empty here).
  {
    const existing = { number: 184, state: 'open', title: 'x',
      body: '<!-- lattice-fp:' + TP.msg_fingerprint + ' -->\n<!-- lattice-occurrences:3 -->\n\n- **Occurrences:** 3' };
    const g = stubGitHub({ issues: { 184: existing }, searchHits: [{ number: 184, state: 'open' }] });
    const r = await T.dedupHandle(g.env, TP);
    eq('open match comments instead of filing', r.action, 'commented_via_search');
    eq('count comes from the issue body, not KV', r.count, 4);
    if (existing.body.includes('<!-- lattice-occurrences:4 -->')) ok('durable marker rewritten to 4');
    else bad(`marker not rewritten: ${existing.body}`);
    if (g.calls.some((c) => c === 'POST /repos/IsaamMJ/Lattice/issues')) bad('a duplicate issue was created (#200 regression)');
    else ok('no duplicate issue created');
  }

  // (c) the only match is CLOSED -> reopen that thread, do not re-file (#200).
  {
    const existing = { number: 192, state: 'closed', title: 'x',
      body: '<!-- lattice-fp:' + TP.msg_fingerprint + ' -->\n<!-- lattice-occurrences:1 -->' };
    const g = stubGitHub({ issues: { 192: existing }, searchHits: [{ number: 192, state: 'closed' }] });
    const r = await T.dedupHandle(g.env, TP);
    eq('closed match reopens', r.action, 'reopened');
    eq('reopened issue is state open', existing.state, 'open');
    eq('reopened issue counts up', r.count, 2);
    eq('reopened issue number is the original', r.issue_number, 192);
  }

  // (d) manual reports dedup on the same fingerprint (#200, previously absent).
  {
    const MP = { ...TP, kind: 'manual_report', category: 'bug', severity: 'MED',
      title: T195, body: 'b', project: 'lattice' };
    const g1 = stubGitHub();
    const first = await T.manualHandle(g1.env, MP);
    eq('first manual report is filed', first.action, 'created');
    const filed = g1.issues[first.issue_number];
    eq('filed manual title is uncorrupted', filed.title, `[manual-report:bug] ${T195}`);

    const g2 = stubGitHub({ issues: { [first.issue_number]: filed },
      searchHits: [{ number: first.issue_number, state: 'open' }] });
    const second = await T.manualHandle(g2.env, MP);
    eq('identical manual report is deduped', second.action, 'commented');
    eq('identical manual report bumps the count', second.count, 2);
  }

  // (e) read-back mismatch is reported, not swallowed.
  {
    const g = stubGitHub({ issues: { 500: { number: 500, state: 'open', title: 'writes � 0[path]' } } });
    const errs = [];
    const realErr = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    const v = await T.verifyStoredTitle(g.env, 500, 'writes — 0/8');
    console.error = realErr;
    if (v.ok === false && errs.some((e) => e.includes('title_readback_mismatch') && e.includes('U+FFFD')))
      ok('read-back mismatch logs the stored code points (#199)');
    else bad(`read-back mismatch not reported: ok=${v.ok} logs=${JSON.stringify(errs)}`);
  }
} finally {
  globalThis.fetch = realFetch;
}

// --- 8. The Worker source is text, not binary ---------------------------
console.log('[telemetry-test] --- #199: source is text ---');

const bytes = readFileSync(WORKER);
const offenders = [];
for (let i = 0; i < bytes.length; i++) {
  const b = bytes[i];
  if (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09) offenders.push(`0x${b.toString(16)}@${i}`);
}
if (offenders.length) bad(`worker source contains literal control bytes: ${offenders.slice(0, 5).join(', ')}`);
else ok('worker source contains no literal control bytes');

// --- Result -------------------------------------------------------------
console.log(`[telemetry-test] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
