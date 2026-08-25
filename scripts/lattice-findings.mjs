#!/usr/bin/env node
/**
 * lattice-findings.mjs — the single canonical reader/counter for
 * .lattice/findings/open/ (v2.4.2, #181).
 *
 * WHY THIS EXISTS
 *   Issue #181: the SessionStart hook reported 61 open findings while the
 *   `lattice project-sync` CLAUDE.md block reported 51 for the same tree. Two
 *   independent implementations had drifted:
 *
 *     lattice-session-start.mjs      scripts/lattice (_lattice_project_md_block)
 *     ------------------------       ---------------------------------------
 *     recursive walk, any depth      globs open/<dim>/ two levels deep only
 *     /^tier:\s*(\w+)/ regex         yaml_field (quote-aware, block scalars)
 *     unknown/absent tier dropped    unknown/absent tier counted in total
 *     OK excluded from total         OK included in total
 *
 *   Nested findings existed only in the hook's number; quoted tiers and OK
 *   markers existed only in the block's number; a tierless file crashed the
 *   bash associative array outright (`bad array subscript`) and silently
 *   emptied the whole block. Every surface that counts findings must go
 *   through THIS module — one walk, one parser, one set of tier rules.
 *
 * PUBLIC API (import)
 *   collectOpenFindings(root)  → Finding[]   (one record per open .yml)
 *   countOpenFindings(root)    → Counts      (byTier / total / ok / unknown / …)
 *   topFindings(findings, n)   → Finding[]   (tier rank, then oldest sweep)
 *   tierSummary(byTier)        → "HIGH: 40, RISK: 5"
 *   activeDimensions(findings) → "auth, security"
 *   sanitizeTitle(s)           → prompt-injection-safe title
 *   readTopLevelFields(text, keys) → { key: value }
 *   TIER_ORDER / TIER_RANK / OPEN_SUBPATH
 *
 * CLI (one fork for shell callers)
 *   node lattice-findings.mjs [--root DIR] [--format kv|json] [--top N]
 *
 *   --format kv (default) writes TAB-separated records, safe to read with
 *   `while IFS=$'\t' read -r k v` — no eval, no quoting hazard:
 *
 *     total<TAB>59            actionable findings (everything except OK)
 *     ok<TAB>4                OK markers (checks that ran clean)
 *     unknown<TAB>0           open findings with a missing/unreadable tier
 *     deferred<TAB>2          subset of total carrying `status: deferred`
 *     high_priority<TAB>45    CRITICAL + BLOCKER + HIGH + RISK
 *     files<TAB>63            .yml files seen under findings/open
 *     tier.HIGH<TAB>40        one record per non-empty tier bucket
 *     tier_summary<TAB>HIGH: 40, RISK: 5, MEDIUM: 14
 *     dimensions<TAB>security
 *     top<TAB>HIGH — slug (2025-01-02)     repeated, at most --top records
 *
 * SAFETY
 *   Pure fs reads. No child processes. Per-directory and per-file try/catch so
 *   one unreadable entry cannot zero the whole count (the old outer try/catch
 *   in the hook aborted the entire walk). Hard 5s timeout in CLI mode.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tier vocabulary, most severe first. OK is deliberately NOT in this list:
// an OK marker proves a check ran cleanly, it is not a finding to address.
export const TIER_ORDER = ['CRITICAL', 'BLOCKER', 'HIGH', 'RISK', 'DRIFT', 'MEDIUM', 'WATCH', 'LOW'];
export const TIER_RANK = Object.fromEntries(TIER_ORDER.map((t, i) => [t, i + 1]));
export const OK_TIER = 'OK';
export const UNKNOWN_TIER = 'UNKNOWN';
export const OPEN_SUBPATH = ['.lattice', 'findings', 'open'];

// Tiers that mean "look at this before you start writing code today".
export const HIGH_PRIORITY_TIERS = ['CRITICAL', 'BLOCKER', 'HIGH', 'RISK'];

/**
 * Read top-level YAML scalars in ONE pass.
 *
 * Semantics are deliberately identical to scripts/lattice-yaml.mjs readField()
 * — that helper backs bash `yaml_field`, so matching it is what keeps the two
 * surfaces in agreement (#181):
 *   - key must be at column 0 (top-level); indented keys belong to nested maps
 *   - `key: |` / `key: >` block scalars are joined from indented continuations
 *   - a matched pair of surrounding quotes is stripped
 *   - CR (CRLF files) is stripped
 *   - first occurrence wins
 *
 * Beyond yaml_field it also drops an unquoted trailing ` # comment`, which is
 * plain-scalar YAML semantics — without it `tier: HIGH  # flaky` parsed as the
 * literal tier "HIGH  # flaky" in bash and as "HIGH" in the hook: drift again.
 */
export function readTopLevelFields(text, keys) {
  const out = {};
  if (typeof text !== 'string') return out;
  const want = new Set(keys);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && want.size > 0; i++) {
    const line = lines[i].replace(/\r$/, '');
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!want.has(key)) continue;
    want.delete(key);
    let inline = m[2].replace(/^\s+/, '');

    // Block scalar: `|`, `|-`, `|+`, `>`, `>-`, `>+`
    const block = inline.match(/^([|>])([+\-]?)\s*$/);
    if (block) {
      const folded = block[1] === '>';
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        const c = lines[j].replace(/\r$/, '');
        if (c === '') { buf.push(''); continue; }
        if (!/^\s/.test(c)) break;
        buf.push(c.replace(/^\s{2}/, '').replace(/^\s+/, ''));
      }
      while (buf.length && buf[buf.length - 1] === '') buf.pop();
      out[key] = folded ? buf.join(' ') : buf.join('\n');
      continue;
    }

    // Inline scalar. Strip a matched quote pair; otherwise treat ` #` as a
    // comment and trim trailing whitespace.
    if (inline.length >= 2 && inline.startsWith('"') && inline.endsWith('"')) {
      out[key] = inline.slice(1, -1);
    } else if (inline.length >= 2 && inline.startsWith("'") && inline.endsWith("'")) {
      out[key] = inline.slice(1, -1);
    } else {
      out[key] = inline.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    }
  }
  return out;
}

/**
 * Normalise whatever sat after `tier:` into the canonical vocabulary.
 * Anything unrecognised (absent, typo'd, unparseable) becomes UNKNOWN rather
 * than being dropped — a finding you cannot classify is still a finding, and
 * silently discarding it is how the hook lost the quoted-tier records in #181.
 */
export function normalizeTier(raw) {
  if (raw == null) return UNKNOWN_TIER;
  const t = String(raw).trim().toUpperCase();
  if (t === OK_TIER) return OK_TIER;
  return TIER_RANK[t] ? t : UNKNOWN_TIER;
}

// v2.3.1 (cross-cutting audit) / #169: titles reach Claude Code's
// additionalContext and the CLAUDE.md block verbatim, so a hostile title can
// try to drive the session. Strip control chars and bidi overrides, neutralise
// quote/backtick breakout, cap the length. Lives here so every surface that
// renders a title gets the same defense.
export function sanitizeTitle(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[‪-‮⁦-⁩]/g, ' ')
    .replace(/["`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Walk .lattice/findings/open/ to ANY depth and return one record per .yml.
 *
 * Depth matters: findings are filed under dimension/ and, since v2.x,
 * dimension/subsystem/ subdirectories. The bash globs stopped at two levels
 * and silently under-counted every nested finding — half of #181's 10-finding
 * gap. Recursion is the canonical rule; both surfaces now inherit it.
 */
export function collectOpenFindings(root = process.cwd()) {
  const openDir = join(root, ...OPEN_SUBPATH);
  const findings = [];
  if (!existsSync(openDir)) return findings;

  const seen = new Set();
  try { seen.add(realpathSync(openDir)); } catch { seen.add(resolve(openDir)); }
  const walk = (dir) => {
    // Per-directory guard: an unreadable subdirectory must cost us that
    // subtree, not the entire count.
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      // Symlinked FILES are resolved (a finding filed through a link is still
      // that one finding); symlinked DIRECTORIES are deliberately not
      // followed. A link inside findings/open pointing back at
      // .lattice/findings would otherwise drag findings/closed into the open
      // count — a wrong number is worse than a missed exotic layout. The
      // realpath guard below still stops any loop that does exist.
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try { isFile = statSync(p).isFile(); } catch { continue; }
      }
      if (e.isDirectory()) {
        let real;
        try { real = realpathSync(p); } catch { continue; }
        if (seen.has(real)) continue;
        seen.add(real);
        walk(p);
        continue;
      }
      if (!isFile || !e.name.endsWith('.yml')) continue;
      let realFile;
      try { realFile = realpathSync(p); } catch { realFile = resolve(p); }
      if (seen.has(realFile)) continue;
      seen.add(realFile);
      let text;
      try { text = readFileSync(p, 'utf8'); } catch { continue; }
      const f = readTopLevelFields(text, ['tier', 'title', 'sweep_date', 'dimension', 'status', 'defer_until', 'id']);
      const slug = e.name.replace(/\.yml$/, '');
      const tier = normalizeTier(f.tier);
      findings.push({
        path: p,
        relPath: p.slice(openDir.length + 1).split(sep).join('/'),
        slug,
        id: f.id || slug,
        tier,
        rawTier: f.tier == null ? '' : String(f.tier).trim(),
        title: sanitizeTitle(f.title || slug),
        sweepDate: f.sweep_date ? String(f.sweep_date).trim() : '0000-00-00',
        dimension: f.dimension ? String(f.dimension).trim() : '',
        status: f.status ? String(f.status).trim().toLowerCase() : '',
        deferUntil: f.defer_until ? String(f.defer_until).trim() : '',
        // OK markers prove a check ran; they are not work to do.
        actionable: tier !== OK_TIER,
      });
    }
  };
  walk(openDir);
  findings.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return findings;
}

/**
 * The one number. `total` is the actionable open count — every finding under
 * findings/open except OK markers, INCLUDING ones whose tier we could not
 * parse (they surface as `unknown` so a caller can flag the data problem
 * instead of quietly losing the record).
 */
export function countOpenFindings(rootOrFindings = process.cwd()) {
  const findings = Array.isArray(rootOrFindings) ? rootOrFindings : collectOpenFindings(rootOrFindings);
  const byTier = {};
  for (const t of TIER_ORDER) byTier[t] = 0;
  byTier[OK_TIER] = 0;
  byTier[UNKNOWN_TIER] = 0;
  let deferred = 0;
  for (const f of findings) {
    byTier[f.tier] = (byTier[f.tier] || 0) + 1;
    if (f.actionable && f.status === 'deferred') deferred++;
  }
  const ok = byTier[OK_TIER];
  const unknown = byTier[UNKNOWN_TIER];
  const total = findings.length - ok;
  const highPriority = HIGH_PRIORITY_TIERS.reduce((a, t) => a + byTier[t], 0);
  return { byTier, total, ok, unknown, deferred, highPriority, files: findings.length, findings };
}

/** "HIGH: 40, RISK: 5, MEDIUM: 14" — severity order, empty buckets omitted. */
export function tierSummary(byTier, { includeUnknown = true } = {}) {
  const parts = [];
  for (const t of TIER_ORDER) {
    if (byTier[t] > 0) parts.push(`${t}: ${byTier[t]}`);
  }
  if (includeUnknown && byTier[UNKNOWN_TIER] > 0) parts.push(`${UNKNOWN_TIER}: ${byTier[UNKNOWN_TIER]}`);
  return parts.join(', ');
}

/** Tier rank first, then oldest sweep_date. OK markers never appear. */
export function topFindings(rootOrFindings, n = 3) {
  const findings = Array.isArray(rootOrFindings) ? rootOrFindings : collectOpenFindings(rootOrFindings);
  return findings
    .filter((f) => f.actionable)
    .slice()
    .sort((a, b) => (TIER_RANK[a.tier] || 99) - (TIER_RANK[b.tier] || 99)
      || a.sweepDate.localeCompare(b.sweepDate)
      || a.slug.localeCompare(b.slug))
    .slice(0, n);
}

/** Comma-joined sorted unique dimension values across open findings. */
export function activeDimensions(rootOrFindings) {
  const findings = Array.isArray(rootOrFindings) ? rootOrFindings : collectOpenFindings(rootOrFindings);
  const set = new Set();
  for (const f of findings) if (f.dimension) set.add(f.dimension);
  return [...set].sort().join(', ');
}

// ---------------------------------------------------------------------------
// CLI — so shell callers get the same numbers in a single fork.
// ---------------------------------------------------------------------------
// Symlink-safe: ESM resolves import.meta.url through realpath but argv[1] is
// left as typed, so a plain resolve() comparison reports "not main" whenever
// the script is invoked through a symlink (~/.claude/lattice/scripts/... is
// commonly one). Compare realpaths on both sides, and go through
// fileURLToPath so Windows drive letters survive.
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = fileURLToPath(import.meta.url);
    const invoked = process.argv[1];
    if (resolve(invoked) === resolve(self)) return true;
    return realpathSync(invoked) === realpathSync(self);
  } catch {
    return false;
  }
})();

if (isMain) {
  const HARD = setTimeout(() => process.exit(0), 5000);
  HARD.unref();

  let root = process.cwd();
  let format = 'kv';
  let top = 3;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { root = argv[++i]; }
    else if (argv[i] === '--format' && argv[i + 1]) { format = argv[++i]; }
    else if (argv[i] === '--top' && argv[i + 1]) { top = Math.max(0, parseInt(argv[++i], 10) || 0); }
    else if (argv[i] === '--json') { format = 'json'; }
    else if (argv[i] === '-h' || argv[i] === '--help') {
      process.stdout.write('usage: lattice-findings.mjs [--root DIR] [--format kv|json] [--top N]\n');
      process.exit(0);
    }
  }

  const c = countOpenFindings(root);
  const t3 = topFindings(c.findings, top);

  if (format === 'json') {
    process.stdout.write(JSON.stringify({
      total: c.total, ok: c.ok, unknown: c.unknown, deferred: c.deferred,
      highPriority: c.highPriority, files: c.files, byTier: c.byTier,
      tierSummary: tierSummary(c.byTier), dimensions: activeDimensions(c.findings),
      top: t3.map((f) => ({ tier: f.tier, slug: f.slug, title: f.title, sweepDate: f.sweepDate })),
    }) + '\n');
  } else {
    // TAB-separated; values are already control-char-free, so a shell
    // `while IFS=$'\t' read -r k v` loop parses this without eval.
    const rec = (k, v) => process.stdout.write(`${k}\t${String(v).replace(/[\t\n\r]/g, ' ')}\n`);
    rec('total', c.total);
    rec('ok', c.ok);
    rec('unknown', c.unknown);
    rec('deferred', c.deferred);
    rec('high_priority', c.highPriority);
    rec('files', c.files);
    for (const tier of [...TIER_ORDER, OK_TIER, UNKNOWN_TIER]) {
      if (c.byTier[tier] > 0) rec(`tier.${tier}`, c.byTier[tier]);
    }
    rec('tier_summary', tierSummary(c.byTier));
    rec('dimensions', activeDimensions(c.findings));
    for (const f of t3) rec('top', `${f.tier} — ${f.slug} (${f.sweepDate})`);
  }

  clearTimeout(HARD);
  process.exit(0);
}
