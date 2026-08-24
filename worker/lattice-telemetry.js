// Lattice telemetry receiver — Cloudflare Worker
//
// Accepts sanitized error reports from `scripts/lattice` clients, dedupes by
// fingerprint within a 24h window, and either files a new GitHub Issue or
// comments "+1 occurrence" on an existing one.
//
// Deploy: see docs/telemetry-setup.md
//
// Configuration (Worker bindings):
//   GITHUB_TOKEN          (secret) — fine-grained PAT with `Issues: Read/Write`
//                                     on IsaamMJ/Lattice
//   GITHUB_OWNER          (env)    — "IsaamMJ"
//   GITHUB_REPO           (env)    — "Lattice"
//   ISSUE_LABELS          (env)    — "telemetry,auto-reported,bug"
//   DEDUP_WINDOW_HOURS    (env)    — "24"
//   DEDUP_KV              (kv ns)  — Workers KV namespace for dedup state
//
// Privacy: the Worker accepts ONLY whitelisted fields. Anything else is dropped
// silently. See docs/telemetry-protocol.md for the exact accepted schema.

const ACCEPTED_OS = new Set(["linux", "darwin", "windows"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/i;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ACCEPTED_KINDS = new Set(["telemetry", "manual_report"]);
const ACCEPTED_CATEGORIES = new Set(["bug", "enhancement", "ux", "docs", "perf", "security"]);
const ACCEPTED_SEVERITIES = new Set(["LOW", "MED", "HIGH"]);

// Strict whitelist. Anything not in this map is dropped. Returns null if
// payload is malformed beyond use.
function sanitize(input) {
  if (!input || typeof input !== "object") return null;

  const version = String(input.version || "").slice(0, 32);
  if (!VERSION_PATTERN.test(version)) return null;

  const command = String(input.command || "").slice(0, 32);
  if (!/^[a-z_-]+$/.test(command)) return null;

  const exit_code = Number.isInteger(input.exit_code) ? input.exit_code : null;
  if (exit_code === null || exit_code < 0 || exit_code > 255) return null;

  const os = String(input.os || "").toLowerCase().slice(0, 16);
  if (!ACCEPTED_OS.has(os)) return null;

  const msg_fingerprint = String(input.msg_fingerprint || "").slice(0, 64);
  if (!/^[a-f0-9]{32,64}$/.test(msg_fingerprint)) return null;

  // kind: defaults to "telemetry" for backward compat with v0.8.x clients.
  // v0.9.3+ clients may set "manual_report" for the `lattice report` channel.
  const kind = ACCEPTED_KINDS.has(input.kind) ? input.kind : "telemetry";

  // Optional fields — drop if not the right shape, don't reject the report
  const user_hash =
    typeof input.user_hash === "string" && /^[a-f0-9]{32,64}$/.test(input.user_hash)
      ? input.user_hash
      : null;
  const error_class =
    typeof input.error_class === "string"
      ? input.error_class.slice(0, 64).replace(/[^a-z0-9_-]/gi, "")
      : null;
  const msg_excerpt =
    typeof input.msg_excerpt === "string"
      ? sanitizeExcerpt(input.msg_excerpt)
      : null;
  const timestamp =
    typeof input.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(input.timestamp)
      ? input.timestamp.slice(0, 32)
      : new Date().toISOString();

  // Manual report fields (only used when kind === "manual_report").
  // Body is author-supplied and goes through the blunt path/sha redactors.
  // v2.3.2 (#199): the title does NOT -- it gets sanitizeTitle, which redacts
  // only tokens carrying genuine path evidence, because a title is prose and a
  // false redaction in it is permanent and publicly visible.
  const category = ACCEPTED_CATEGORIES.has(input.category) ? input.category : "bug";
  const severity = ACCEPTED_SEVERITIES.has(input.severity) ? input.severity : "MED";
  const title =
    typeof input.title === "string" ? sanitizeTitle(input.title) : null;
  const body =
    typeof input.body === "string"
      ? input.body
          .slice(0, 8000)
          .replace(/[A-Z]:\\[A-Za-z0-9_.\\-]+/g, "[path]")
          .replace(/\b[0-9a-f]{32,64}\b/g, "[sha]")
      : null;

  // v2.1.3 (Part A): accept project name for per-project labelling.
  // Sanitize to a label-safe form, cap at 40 chars.
  const project =
    typeof input.project === "string"
      ? input.project.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 40)
      : null;

  return {
    version,
    command,
    exit_code,
    os,
    msg_fingerprint,
    user_hash,
    error_class,
    msg_excerpt,
    timestamp,
    kind,
    category,
    severity,
    title,
    body,
    project,
  };
}

// v2.3.2 (#199): control-class written as an escaped range. It used to be two
// literal 0x00 / 0x1f bytes in the source, which made this file report as
// binary to git, grep, and every diff viewer.
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g;

// v2.3.2 (#199): a real SHA is either long or mixed. The old rule was
// /\b[0-9a-f]{7,40}\b/, which redacts any 7+ character word built from a-f --
// "acceded", "defaced", "effaced", "efface" -- and silently destroyed prose.
// Require >= 7 chars AND (>= 12 chars OR at least one digit): every real
// abbreviated SHA is long or carries a digit, no dictionary word is both.
const HEXISH = /\b[0-9a-f]{7,64}\b/g;

function redactShas(text) {
  return text.replace(HEXISH, (t) => (t.length >= 12 || /\d/.test(t) ? "[sha]" : t));
}

// v2.3.2 (#199): path detection for titles.
//
// A token is a genuine filesystem path only when it carries path evidence:
//   1. drive letter        C:\Users\bob\proj   C:/Users/bob
//   2. filesystem anchor   /home/u/x   ./x/y   ../x   ~/.lattice/state.json
//   3. >= 3 segments (at least one longer than a letter), or 2 segments where
//      one is filename-shaped (has . _ -)
// and never when every segment is a number or version (0/8, 24/7, 2026/08/21,
// 2.1.3/2.2.0) or an all-caps acronym (A/B, CI/CD, AM/PM). Prose such as
// and/or and TypeScript/JS carries none of that evidence and is left alone.
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const ANCHORED_PATH = /^(?:~|\.{1,2})?\/[A-Za-z0-9_.@+-]/;
// A ratio, date part, or version number: 0, 8, 24, 08, 2026, 2.1.3, v2.2.
const NUMERIC_SEGMENT = /^v?\d+(?:\.\d+)*$/;
// An acronym, not a directory name: A, B, CI, CD, AM, PM, JS.
const ACRONYM_SEGMENT = /^[A-Z]{1,3}$/;

function looksLikePath(token) {
  if (!token) return false;
  if (URL_SCHEME.test(token)) return false; // a URL is not a filesystem path
  if (DRIVE_PATH.test(token)) return true;
  if (ANCHORED_PATH.test(token)) return true;
  const segments = token.split(/[\\/]+/).filter(Boolean);
  if (segments.length < 2) return false;
  if (segments.every((s) => NUMERIC_SEGMENT.test(s))) return false; // 0/8, 2026/08/21
  if (segments.every((s) => ACRONYM_SEGMENT.test(s))) return false; // A/B, CI/CD
  // Three or more segments is path-shaped, but only if something in it is
  // longer than a single letter -- "A/B/C" is prose, "src/a/b" is a path.
  if (segments.length >= 3) return segments.some((s) => s.length > 1);
  return segments.some((s) => /[._-]/.test(s));
}

// Non-whitespace runs containing a separator are the only candidates. Matching
// whole tokens -- rather than the old rule's "a slash plus whatever follows" --
// is what stops "0/8" from being read as the path "/8".
const SLASHED_TOKEN = /\S*[\\/]\S*/g;
const LEADING_PUNCT = /^[([{<"'\u0060]+/;
const TRAILING_PUNCT = /[)\]}>"'\u0060.,;:!?]+$/;

function redactPaths(text) {
  return text.replace(SLASHED_TOKEN, (token) => {
    const lead = (LEADING_PUNCT.exec(token) || [""])[0];
    let core = token.slice(lead.length);
    const trail = (TRAILING_PUNCT.exec(core) || [""])[0];
    core = core.slice(0, core.length - trail.length);
    if (!core || !looksLikePath(core)) return token;
    return lead + "[path]" + trail;
  });
}

// v2.3.2 (#199): String.prototype.slice cuts on UTF-16 code units, so a cap
// landing between the halves of a surrogate pair (any emoji, any astral char)
// leaves a lone surrogate, which serialises to U+FFFD. Truncate on whole code
// points instead.
function truncateCodePoints(s, max) {
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

// Strip anything that could leak project state from the excerpt.
// Client is supposed to do this, but defense in depth.
//
// Excerpts are machine stderr, not prose, so the path rule here stays
// deliberately greedy: a stderr line leaks paths in shapes ("at /a/b:12",
// "cannot open /a/b") where over-redaction costs nothing. Titles do NOT go
// through this -- see sanitizeTitle.
function sanitizeExcerpt(raw) {
  return redactShas(
    String(raw)
      .slice(0, 400)
      .replace(/\/[A-Za-z0-9_./\\-]+/g, "[path]") // any /foo/bar style path
      .replace(/[A-Z]:\\[A-Za-z0-9_.\\-]+/g, "[path]") // Windows path
  )
    .replace(CONTROL_CHARS, " ")
    .trim();
}

// v2.3.2 (#199): titles get their own sanitiser.
//
// sanitizeExcerpt's path rule redacts a slash plus everything after it, which
// turned "0/8 true positives" into "0[path] true positives" in #195 and would
// equally destroy 24/7, and/or, A/B, CI/CD and TypeScript/JS. Bodies can afford
// that bluntness; a title is ~80 characters of prose and is the only text that
// shows in the issue list, in search, and in notifications, so a false
// redaction there is both unrecoverable and maximally visible.
const TITLE_MAX = 160;

function sanitizeTitle(raw) {
  const collapsed = String(raw).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return truncateCodePoints(redactShas(redactPaths(collapsed)), TITLE_MAX);
}

// v2.3.2 (#199): the em dash in every one of #194-#198 arrived as a single
// U+FFFD. The cause is here, not on the wire: the Windows `lattice report`
// client emits its JSON payload in the shell ANSI codepage (CP1252), where an
// em dash is the single byte 0x97, and `request.json()` decodes the body with a
// LOSSY UTF-8 decoder that maps every un-decodable byte to U+FFFD. By the time
// sanitize() saw the title the character was already gone, permanently.
//
// Fix the decode rather than patch downstream: try strict UTF-8 first, and only
// when the bytes are provably not UTF-8 fall back to CP1252, which is what the
// client actually sent. No lossy path is left. (Workers' TextDecoder implements
// utf-8 only, so the CP1252 table is inlined -- it differs from Latin-1 in the
// 0x80-0x9f C1 range and nowhere else.)
const CP1252_C1 = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function decodeCp1252(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_C1[b - 0x80] : b);
  }
  return out;
}

function decodePayloadBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeCp1252(bytes);
  }
}

// Non-ASCII code points of a string, for the title read-back log. Makes a
// U+FFFD in the stored title unmistakable in the Worker tail.
function codePointsOf(s) {
  if (typeof s !== "string") return null;
  return [...s]
    .filter((c) => c.codePointAt(0) > 0x7f)
    .map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase())
    .join(",");
}

function issueTitle(p) {
  // v2.3.2 (#199): truncate on code points, not UTF-16 units — slicing an
  // astral character in half leaves a lone surrogate that renders as U+FFFD.
  const head = p.msg_excerpt
    ? truncateCodePoints(p.msg_excerpt, 80)
    : `${p.command} exit ${p.exit_code}`;
  return `[telemetry] ${p.command}: ${head}`;
}

function issueBody(p, occurrence) {
  return [
    // v0.8.0-rc2: machine-readable fingerprint marker. Used by the race-safe
    // dedup search (`findIssueByFingerprint`) so a simultaneous second
    // Worker can find this issue before duplicating it.
    `<!-- lattice-fp:${p.msg_fingerprint} -->`,
    // v2.3.2 (#200): durable occurrence count. KV expires, this does not.
    `<!-- lattice-occurrences:${occurrence} -->`,
    "",
    "**Auto-reported by lattice-telemetry.**",
    "",
    `- **Version:** \`${p.version}\``,
    `- **Command:** \`lattice ${p.command}\``,
    `- **Exit code:** ${p.exit_code}`,
    `- **OS:** ${p.os}`,
    `- **First seen:** ${p.timestamp}`,
    `- **Occurrences:** ${occurrence}`,
    p.error_class ? `- **Class:** ${p.error_class}` : null,
    "",
    "### Error excerpt",
    "```",
    p.msg_excerpt || "(no excerpt provided)",
    "```",
    "",
    `### Fingerprint`,
    `\`${p.msg_fingerprint}\``,
    "",
    "---",
    "_To triage: reply `lattice: confirmed` to keep, `lattice: not-a-bug` to close, `lattice: dup-of #N` to consolidate._",
  ]
    .filter(Boolean)
    .join("\n");
}

function commentBody(p, occurrence, reopened) {
  return [
    reopened
      ? `**Reopened — this fingerprint came back after the issue was closed.**`
      : null,
    reopened ? "" : null,
    `**+1 occurrence** — total \`${occurrence}\`, last seen \`${p.timestamp}\`.`,
    "",
    p.msg_excerpt ? "Latest excerpt:" : null,
    p.msg_excerpt ? "```" : null,
    p.msg_excerpt || null,
    p.msg_excerpt ? "```" : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function githubFetch(env, path, init = {}) {
  const url = `https://api.github.com${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "lattice-telemetry-worker",
    "X-GitHub-Api-Version": "2022-11-28",
    // v2.3.2 (#199): declare the request encoding instead of letting fetch
    // fall back to text/plain. Every body we send is UTF-8 JSON; say so.
    "Content-Type": "application/json; charset=utf-8",
    ...(init.headers || {}),
  };
  return fetch(url, { ...init, headers });
}

async function createIssue(env, payload) {
  const labels = (env.ISSUE_LABELS || "telemetry,auto-reported,bug")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const body = JSON.stringify({
    title: issueTitle(payload),
    body: issueBody(payload, 1),
    labels,
  });
  const res = await githubFetch(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub create issue failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// v0.9.3: manual-report path — author-supplied title + body.
// Used by `lattice report <category> --title --body`. Different label set
// (manual-report) so the auto-triage flow can distinguish them at a glance.
// v2.3.2 (#200): this path now dedups by fingerprint too — see manualHandle.
// Filing the same observation twice bumps the count instead of opening a
// second issue, and re-filing after a close reopens the original thread.
// v2.1.3 (Part A): sanitize project name for use as a GH label.
// Labels can't contain certain chars; conservatively allow [a-z0-9._-].
function sanitizeProjectLabel(s) {
  if (!s || typeof s !== "string") return "";
  const clean = s.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return clean;
}

function manualReportLabels(env, payload) {
  // Severity → label (so the queue can prioritize visually)
  const sevLabel = `severity:${payload.severity.toLowerCase()}`;
  // Category is also a label
  const catLabel = `category:${payload.category}`;
  const labels = ["manual-report", catLabel, sevLabel];
  // v2.1.3 (Part A): tag with `project:<basename>` so `gh issue list --label project:X`
  // surfaces per-project bug pressure. Useful at the cross-project view in v2.2+.
  const projectLabel = sanitizeProjectLabel(payload.project);
  if (projectLabel) labels.push(`project:${projectLabel}`);
  return labels;
}

function manualIssueTitle(payload) {
  const t = payload.title || "(no title)";
  return `[manual-report:${payload.category}] ${t}`;
}

function manualIssueBody(payload) {
  return [
    `<!-- lattice-fp:${payload.msg_fingerprint} -->`,
    // v2.3.2 (#200): durable occurrence count, same as the telemetry body.
    "<!-- lattice-occurrences:1 -->",
    "",
    "**Manual report filed by `lattice report` (v0.9.3+).**",
    "",
    `- **Category:** ${payload.category}`,
    `- **Severity:** ${payload.severity}`,
    `- **Version:** \`${payload.version}\``,
    `- **OS:** ${payload.os}`,
    `- **Project:** \`${payload.project || "(unknown)"}\``,
    `- **Filed:** ${payload.timestamp}`,
    // v2.3.2 (#200): rendered mirror of the lattice-occurrences marker, kept in
    // sync by writeOccurrences when the same report is filed again.
    "- **Occurrences:** 1",
    "",
    "### Report",
    "",
    payload.body || "(no body provided)",
    "",
    "---",
    "_Filed via `lattice report` — author-supplied observation, not an auto-detected crash._",
    "_To triage: reply `lattice: confirmed` to keep, `lattice: not-a-bug` to close, `lattice: dup-of #N` to consolidate._",
  ].join("\n");
}

async function createManualIssue(env, payload) {
  const labels = manualReportLabels(env, payload);
  const body = JSON.stringify({
    title: manualIssueTitle(payload),
    body: manualIssueBody(payload),
    labels,
  });
  const res = await githubFetch(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub create manual issue failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

async function commentOnIssue(env, issueNumber, payload, occurrence, reopened) {
  const body = JSON.stringify({ body: commentBody(payload, occurrence, reopened) });
  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/comments`,
    { method: "POST", body }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub comment failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// v0.8.0-rc2: GitHub Search fallback for the dedup race.
// Workers KV is eventually consistent — two simultaneous requests can both
// read "no record" and both create issues (witnessed as #3/#4 in IsaamMJ/Lattice
// on 2026-05-14). GitHub Search is also eventually consistent (~seconds delay)
// but is the source-of-truth across all Worker instances. We use it as a backstop
// when KV says "no record" but the issue may have just been created.
//
// v2.3.2 (#200): search open AND closed. This was pinned to `state:open` and the
// KV window is 24h, so a fingerprint that recurred weeks later found nothing and
// filed a second issue — #184/#192 and #183/#186 are two pairs of byte-identical
// fingerprints filed as four issues, each stamped "Occurrences: 1". A recurrence
// belongs on the original thread; a recurrence after a close is a regression and
// must reopen that thread rather than start a new one.
async function findIssueByFingerprint(env, fingerprint, label) {
  const labelQuery = label ? `label:${label} ` : "";
  const q = encodeURIComponent(
    `repo:${env.GITHUB_OWNER}/${env.GITHUB_REPO} ${labelQuery}"lattice-fp:${fingerprint}" in:body`
  );
  const res = await githubFetch(env, `/search/issues?q=${q}&per_page=10&sort=created&order=asc`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;
  // Prefer an open thread; otherwise the oldest closed one, which is the
  // original report the regression should land back on.
  const hit = data.items.find((i) => i.state === "open") || data.items[0];
  return { number: hit.number, state: hit.state };
}

// Returns null rather than throwing on 404 / malformed response: every caller
// treats "cannot read the issue" as "do not touch the issue".
async function getIssue(env, issueNumber) {
  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`
  );
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function patchIssue(env, issueNumber, patch) {
  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub patch issue failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// v2.3.2 (#200): the occurrence count lives in the ISSUE BODY, not in KV.
// KV entries expire after DEDUP_WINDOW_HOURS, so a count kept there restarts at
// 1 on every recurrence outside the window — which is exactly why four issues
// that had each happened twice all read "Occurrences: 1". The body is the only
// store whose lifetime matches the thing being counted.
const OCCURRENCE_MARKER = /<!-- lattice-occurrences:(\d+) -->/;
const OCCURRENCE_LINE = /- \*\*Occurrences:\*\* \d+/;
const FINGERPRINT_MARKER = /<!-- lattice-fp:[0-9a-f]+ -->/;

function readOccurrences(body) {
  const marked = OCCURRENCE_MARKER.exec(body || "");
  if (marked) return parseInt(marked[1], 10) || 1;
  // Pre-v2.3.2 issues carry the count only in the rendered line.
  const rendered = /- \*\*Occurrences:\*\* (\d+)/.exec(body || "");
  return rendered ? parseInt(rendered[1], 10) || 1 : 1;
}

function writeOccurrences(body, count) {
  let out = String(body || "");
  const marker = `<!-- lattice-occurrences:${count} -->`;
  if (OCCURRENCE_MARKER.test(out)) {
    out = out.replace(OCCURRENCE_MARKER, marker);
  } else if (FINGERPRINT_MARKER.test(out)) {
    out = out.replace(FINGERPRINT_MARKER, (m) => `${m}\n${marker}`);
  } else {
    out = `${marker}\n${out}`;
  }
  if (OCCURRENCE_LINE.test(out)) {
    out = out.replace(OCCURRENCE_LINE, `- **Occurrences:** ${count}`);
  }
  return out;
}

// Record one more sighting on an existing thread: bump the durable count,
// reopen if the fingerprint came back after a close, then comment.
async function recordOccurrence(env, issueNumber, payload) {
  const issue = await getIssue(env, issueNumber);
  // If the issue can't be read back (deleted, transferred, token scope changed)
  // do NOT patch: writing a body we never read would wipe the whole report.
  // Comment only, with the same count=2 estimate the pre-v2.3.2 race path used.
  if (!issue) {
    await commentOnIssue(env, issueNumber, payload, 2, false);
    return { count: 2, reopened: false };
  }
  const wasClosed = issue.state === "closed";
  const count = readOccurrences(issue.body) + 1;
  const patch = { body: writeOccurrences(issue.body, count) };
  if (wasClosed) {
    patch.state = "open";
    patch.state_reason = "reopened";
  }
  await patchIssue(env, issueNumber, patch);
  await commentOnIssue(env, issueNumber, payload, count, wasClosed);
  return { count, reopened: wasClosed };
}

// v2.3.2 (#199): read the title back and log a structured warning when GitHub
// stored something other than what we sent. #194-#198 were all filed with a
// mangled title and nothing noticed for three months — this is the check that
// would have caught it on the first report anyone ever filed.
async function verifyStoredTitle(env, issueNumber, expected) {
  const issue = await getIssue(env, issueNumber);
  const stored = issue && typeof issue.title === "string" ? issue.title : null;
  if (stored === expected) return { ok: true, stored };
  console.error(
    "title_readback_mismatch:",
    JSON.stringify({
      issue: issueNumber,
      sent: expected,
      stored,
      sent_non_ascii: codePointsOf(expected),
      stored_non_ascii: codePointsOf(stored),
    })
  );
  return { ok: false, sent: expected, stored };
}

async function dedupHandle(env, payload) {
  // KV key is the fingerprint. Value is { issue_number, count, first_seen, last_seen }.
  // v2.3.2 (#200): KV is now a cache for the ISSUE NUMBER only — `count` is
  // mirrored for debugging but the authority is the issue body (see
  // readOccurrences), so an expired KV entry can no longer reset the count.
  const windowHours = Number(env.DEDUP_WINDOW_HOURS || 24);
  const ttl = Math.max(3600, windowHours * 3600);
  const key = `dedup:${payload.msg_fingerprint}`;

  const cached = await env.DEDUP_KV.get(key, { type: "json" });
  let issueNumber = cached && cached.issue_number ? cached.issue_number : null;
  let action = "commented";

  // KV miss: ask GitHub before creating. This is both the race-safety backstop
  // and, since v2.3.2, the long-window dedup — the search is the only store
  // that remembers a fingerprint from three months ago.
  if (!issueNumber) {
    const hit = await findIssueByFingerprint(env, payload.msg_fingerprint, "telemetry");
    if (hit) {
      issueNumber = hit.number;
      action = "commented_via_search";
    }
  }

  if (issueNumber) {
    const { count, reopened } = await recordOccurrence(env, issueNumber, payload);
    await env.DEDUP_KV.put(
      key,
      JSON.stringify({
        issue_number: issueNumber,
        count,
        first_seen: (cached && cached.first_seen) || payload.timestamp,
        last_seen: payload.timestamp,
      }),
      { expirationTtl: ttl }
    );
    return { action: reopened ? "reopened" : action, issue_number: issueNumber, count };
  }

  // Genuinely new. Create the issue and populate KV.
  const issue = await createIssue(env, payload);
  await env.DEDUP_KV.put(
    key,
    JSON.stringify({
      issue_number: issue.number,
      count: 1,
      first_seen: payload.timestamp,
      last_seen: payload.timestamp,
    }),
    { expirationTtl: ttl }
  );
  await verifyStoredTitle(env, issue.number, issueTitle(payload));
  return { action: "created", issue_number: issue.number, count: 1 };
}

// v2.3.2 (#199/#200): manual reports dedup on the same fingerprint machinery.
// The client already fingerprints a manual report by sha256("report:<title>")
// specifically so this could exist; until now the Worker ignored it and filing
// the same observation twice opened two issues.
async function manualHandle(env, payload) {
  const hit = await findIssueByFingerprint(env, payload.msg_fingerprint, "manual-report");
  if (hit) {
    const { count, reopened } = await recordOccurrence(env, hit.number, payload);
    return { action: reopened ? "reopened" : "commented", issue_number: hit.number, count };
  }
  const issue = await createManualIssue(env, payload);
  await verifyStoredTitle(env, issue.number, manualIssueTitle(payload));
  return { action: "created", issue_number: issue.number, count: 1 };
}

// v2.2.5 (#90): IP-based rate limiting. Without this, an attacker can spam
// 100k GH issues. Default: 30 requests per IP per hour, 5 manual_report per
// IP per day (manual reports are heavier — they always create an issue).
// Counters live in DEDUP_KV with TTL so they self-expire.
const RATE_LIMITS = {
  perIpPerHour: 30,
  manualReportPerIpPerDay: 5,
};

async function checkRateLimit(env, ip, kind) {
  // v2.3.1 (abuse-audit): fail CLOSED on missing IP or unbound KV. Previously
  // empty IP returned allowed=true, which an attacker can trigger by routing
  // through a proxy that strips CF-Connecting-IP.
  if (!ip) return { allowed: false, reason: "missing_client_ip", retryAfter: 60 };
  if (!env.DEDUP_KV) return { allowed: false, reason: "rate_limiter_misconfigured", retryAfter: 300 };
  const now = new Date();
  const hourKey = `rate:hour:${ip}:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
  const dayKey = `rate:day:manual:${ip}:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;

  const hourCountRaw = (await env.DEDUP_KV.get(hourKey)) || "0";
  const hourCount = parseInt(hourCountRaw, 10) || 0;
  if (hourCount >= RATE_LIMITS.perIpPerHour) {
    return { allowed: false, reason: "ip_hourly_limit", retryAfter: 3600 };
  }

  if (kind === "manual_report") {
    const dayCountRaw = (await env.DEDUP_KV.get(dayKey)) || "0";
    const dayCount = parseInt(dayCountRaw, 10) || 0;
    if (dayCount >= RATE_LIMITS.manualReportPerIpPerDay) {
      return { allowed: false, reason: "ip_daily_manual_limit", retryAfter: 86400 };
    }
    await env.DEDUP_KV.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 });
  }

  await env.DEDUP_KV.put(hourKey, String(hourCount + 1), { expirationTtl: 3600 });
  return { allowed: true };
}

export default {
  async fetch(request, env, ctx) {
    // v2.3.1 (cross-cutting audit): collect IP BEFORE health short-circuit
    // so /health requests count against the limit too. Otherwise an attacker
    // can DoS via /health (asymmetric cost) or burn victim's POST quota via
    // cross-origin GET.
    const clientIp = request.headers.get("CF-Connecting-IP") || "";

    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      if (env.DEDUP_KV && clientIp) {
        const rl = await checkRateLimit(env, clientIp, "health");
        if (!rl.allowed) {
          return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
            status: 429,
            headers: { "content-type": "application/json", "Retry-After": String(rl.retryAfter) },
          });
        }
      }
      return jsonResponse(200, { ok: true, service: "lattice-telemetry" });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "method_not_allowed" });
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.DEDUP_KV) {
      return jsonResponse(503, { ok: false, error: "worker_misconfigured" });
    }

    // v2.3.2 (#199): do NOT use request.json() — it decodes with a lossy UTF-8
    // decoder, which is where an em dash sent by a CP1252 Windows client became
    // a permanent U+FFFD in #194-#198. decodePayloadBytes is strict-then-CP1252.
    let body;
    try {
      const raw = new Uint8Array(await request.arrayBuffer());
      body = JSON.parse(decodePayloadBytes(raw));
    } catch {
      return jsonResponse(400, { ok: false, error: "invalid_json" });
    }

    const payload = sanitize(body);
    if (!payload) {
      return jsonResponse(400, { ok: false, error: "invalid_payload" });
    }

    // v2.2.5 (#90): rate-limit AFTER sanitize so we know `kind`, but before
    // any GH API call.
    const rl = await checkRateLimit(env, clientIp, payload.kind);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ ok: false, error: "rate_limited", reason: rl.reason }), {
        status: 429,
        headers: { "content-type": "application/json", "Retry-After": String(rl.retryAfter) },
      });
    }

    // v0.9.3 route by kind:
    //   - telemetry      → dedupHandle (existing, fingerprint-deduped)
    //   - manual_report  → manualHandle (author body, fingerprint-deduped since v2.3.2)
    // Always return 200-ish to the client so a Worker outage never surfaces
    // to a user's `lattice` invocation. Do the actual filing in waitUntil
    // so the response is fast.
    if (payload.kind === "manual_report") {
      ctx.waitUntil(
        manualHandle(env, payload).catch((err) => {
          console.error("manualHandle error:", err && err.message ? err.message : err);
        })
      );
    } else {
      ctx.waitUntil(
        dedupHandle(env, payload).catch((err) => {
          console.error("dedupHandle error:", err && err.message ? err.message : err);
        })
      );
    }

    return jsonResponse(202, { ok: true, accepted: true });
  },
};

// v2.3.2 (#199): named test surface. The Workers runtime only reads `default`;
// extra named exports are inert there, and this lets test/telemetry-sanitize.test.mjs
// exercise the sanitisers directly instead of re-implementing them.
export const __test__ = {
  sanitize,
  dedupHandle,
  manualHandle,
  findIssueByFingerprint,
  verifyStoredTitle,
  sanitizeTitle,
  sanitizeExcerpt,
  redactPaths,
  redactShas,
  looksLikePath,
  truncateCodePoints,
  decodePayloadBytes,
  decodeCp1252,
  readOccurrences,
  writeOccurrences,
  issueTitle,
  manualIssueTitle,
  codePointsOf,
};
