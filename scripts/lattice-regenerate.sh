#!/usr/bin/env bash
# lattice-regenerate — regenerate the CLAUDE.md checklist block from YAML findings.
#
# Usage:
#   bash scripts/lattice-regenerate.sh [--claude-md <path>] [--days-closed <n>] [--check]
#
# Defaults:
#   --claude-md   ./CLAUDE.md
#   --days-closed 7         (how many days of closed findings to include)
#   --check       (v0.6.3) dry-run: regenerate to memory, diff against current CLAUDE.md
#                 markered block, exit 1 if different. Used by CI to enforce
#                 "regen is the only path" — manual edits to the section can't land.
#
# Exit codes (v0.6.6):
#   0  clean — markered block matches (or was inserted on first run)
#   1  drift detected (--check only): regen would change the markered block
#   2  fatal — parse error, schema violation, or malformed CLAUDE.md markers
#      (always non-zero, regardless of --check). Distinguishes "needs sync"
#      from "broken finding YAML, human attention required" for CI gates.
#
# Behavior:
#   - Reads .lattice/findings/open/*/*.yml — the source of truth
#   - Reads .lattice/findings/closed/*/*.yml filtered by --days-closed
#   - Groups open findings by `status:` field (v0.6.3): open, in_progress, deferred, wont_fix
#   - Within "open", groups by tier (CRITICAL/BLOCKER/HIGH/RISK/...)
#   - Validates each YAML has required fields (rule, file, line) — fails fast on malformed
#   - Escapes field values before Markdown injection
#   - Requires exactly one start + one end marker (no destructive replace on duplicates)
#   - Inserts markers at end of CLAUDE.md if missing
#   - Never touches anything outside the markers

set -euo pipefail

CLAUDE_MD="./CLAUDE.md"
DAYS_CLOSED=7
CHECK_MODE=0
VALIDATE_MODE=0

require_value_for() {
  local flag="$1" next="$2"
  if [ -z "${next}" ] || [[ "${next}" == --* ]]; then
    echo "[lattice-regenerate] error: ${flag} requires a value" >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --claude-md)
      require_value_for "--claude-md" "${2:-}"
      CLAUDE_MD="$2"; shift 2 ;;
    --days-closed)
      require_value_for "--days-closed" "${2:-}"
      DAYS_CLOSED="$2"; shift 2 ;;
    --check)
      CHECK_MODE=1; shift ;;
    --validate-only)
      # v0.6.6.3: walk every YAML, collect ALL errors, exit 2 if any. Does not
      # write CLAUDE.md and does not fail-fast like --check does.
      VALIDATE_MODE=1; shift ;;
    *) echo "[lattice-regenerate] error: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "${DAYS_CLOSED}" =~ ^[0-9]+$ ]]; then
  echo "[lattice-regenerate] error: --days-closed must be a non-negative integer (got: ${DAYS_CLOSED})" >&2
  exit 2
fi

if [ ! -d ".lattice/findings" ]; then
  echo "[lattice-regenerate] no .lattice/findings/ — nothing to regenerate" >&2
  exit 0
fi

node --input-type=module - "$CLAUDE_MD" "$DAYS_CLOSED" "$CHECK_MODE" "$VALIDATE_MODE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const claudeMdPath = process.argv[2];
const daysClosed = parseInt(process.argv[3], 10);
const checkMode = process.argv[4] === '1';
const validateMode = process.argv[5] === '1';

const START = '<!-- lattice:checklist:start -->';
const END = '<!-- lattice:checklist:end -->';

function escapeMd(value) {
  return String(value ?? '?')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, ' ');
}

// Minimal YAML parser for the flat-key-value + block-scalar + list (inline + block) subset Lattice emits.
function parseYaml(text) {
  // v0.6.6.3: strip leading UTF-8 BOM (﻿). Windows PowerShell 5.1's
  // Set-Content -Encoding UTF8 prepends one — without this strip, the very
  // first key-value regex match fails and cascades into "everything broken".
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  const out = {};
  const lines = text.split(/\r?\n/);
  let block = null;
  let blockList = null;  // v0.6.4: collect "  - item" lines after a "key:" with empty value

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');

    // Handle continuation of a block scalar (|, >)
    if (block !== null) {
      if (/^\s+/.test(line) || line === '') {
        block.value += (block.value ? '\n' : '') + line.replace(/^  /, '');
        continue;
      }
      out[block.key] = block.value;
      block = null;
    }

    // Handle continuation of a block list (key: \n  - item)
    if (blockList !== null) {
      const itemMatch = line.match(/^\s+-\s*(.*)$/);
      if (itemMatch) {
        blockList.items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
      // List ended — commit it and fall through to handle this line normally
      out[blockList.key] = blockList.items;
      blockList = null;
    }

    if (line.startsWith('#') || line.trim() === '') continue;
    // v0.6.6.3: tolerate leading `---` document separator (and trailing `...`).
    // Standard YAML headers; agent-generated files often include them.
    if (line.trim() === '---' || line.trim() === '...') continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) {
      // v0.6.6.3: better error hint for line-1 failures, the most common cause.
      let hint = '';
      if (i === 0) {
        if (/[﻿]/.test(line)) {
          hint = ' (looks like a UTF-8 BOM — write the file as UTF-8 *without* BOM; PowerShell users: use [System.IO.File]::WriteAllText with UTF8Encoding($false))';
        } else {
          hint = ' (line-1 errors are usually a BOM, an unescaped tab, or non-key-value content)';
        }
      }
      throw new Error(`malformed YAML at line ${i + 1}: ${JSON.stringify(line)}${hint}`);
    }
    const [, k, v] = m;
    if (v === '|' || v === '>') {
      block = { key: k, value: '' };
      continue;
    }
    // Inline list: [a, b, c]
    const listMatch = v.match(/^\[\s*(.*?)\s*\]$/);
    if (listMatch) {
      const inner = listMatch[1].trim();
      out[k] = inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    // v0.6.4: empty value may be the start of a block-list (next non-blank line starts with "  - ").
    // Peek ahead one non-blank line; if it's a list item, start collecting.
    if (v === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && /^\s+-\s/.test(lines[j])) {
        blockList = { key: k, items: [] };
        continue;
      }
    }
    out[k] = v.replace(/^["']|["']$/g, '');
  }
  if (block) out[block.key] = block.value;
  if (blockList) out[blockList.key] = blockList.items;
  return out;
}

// v0.6.5.1: expand allowlist to cover legitimate auditor categorizations
// surfaced by jiive Lumi audits (configuration, quality, product). No
// per-dimension required-field enforcement for these three yet — they
// behave like `audit` and `coverage` (free-form, evidence in title/fix).
const VALID_DIMENSIONS = new Set([
  'audit', 'scale', 'security', 'flow', 'coverage',
  'configuration', 'quality', 'product',
]);

// v0.6.4.1: dimension+tier specific required fields. Mirrors docs/finding-schema.md.
const DIMENSION_TIER_REQUIRED = {
  security: {
    CRITICAL: ['owasp', 'exploitability', 'blast_radius', 'attack_scenario', 'secure_code_example'],
    HIGH:     ['owasp', 'exploitability', 'blast_radius', 'attack_scenario', 'secure_code_example'],
  },
  scale: {
    BLOCKER: ['failure_mode'],
    RISK:    ['failure_mode'],
  },
  audit: {
    INTENTIONAL: ['intentional_citation'],
  },
  flow: {
    CRITICAL: ['impact'],
    HIGH:     ['impact'],
  },
};

function validateFinding(parsed, filePath, kind = 'open') {
  // Open findings need full evidence; closed findings need at least identity + lifecycle.
  const required = kind === 'open'
    ? ['rule', 'file', 'line', 'module', 'tier', 'dimension']
    : ['rule', 'module', 'closed_by_commit'];
  for (const k of required) {
    if (parsed[k] === undefined || parsed[k] === '') {
      throw new Error(`missing required field '${k}' in ${filePath}`);
    }
  }
  if (kind === 'open') {
    // v0.6.3.1: line must be a positive integer (rendered as src/x.ts:<line>)
    const lineStr = String(parsed.line);
    if (!/^\d+$/.test(lineStr) || parseInt(lineStr, 10) < 1) {
      throw new Error(`invalid 'line' in ${filePath}: must be a positive integer (got ${JSON.stringify(parsed.line)})`);
    }

    // v0.6.4.1: dimension must be in the allowed enum
    const dim = String(parsed.dimension).toLowerCase();
    if (!VALID_DIMENSIONS.has(dim)) {
      throw new Error(`invalid 'dimension' in ${filePath}: '${parsed.dimension}' (allowed: ${[...VALID_DIMENSIONS].join('|')})`);
    }

    // v0.6.4.1: dimension+tier specific required fields
    const tier = String(parsed.tier).toUpperCase();
    const dimRules = DIMENSION_TIER_REQUIRED[dim];
    if (dimRules && dimRules[tier]) {
      for (const k of dimRules[tier]) {
        if (parsed[k] === undefined || parsed[k] === '') {
          throw new Error(`missing required field '${k}' in ${filePath} (dimension=${dim}, tier=${tier} requires it per docs/finding-schema.md)`);
        }
      }
    }
  }
}

function readDirRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.yml')) out.push(full);
  }
  return out;
}

// v0.6.6.3: errors collected here when validateMode is on. Otherwise we
// fail-fast like before (process.exit(2)).
const validateErrors = [];

function loadAll(files, kind /* 'open' | 'closed' */) {
  const loaded = [];
  for (const f of files) {
    try {
      const parsed = parseYaml(fs.readFileSync(f, 'utf8'));
      // v0.6.6.1: auto-derive closed_by_commit from path for legacy closed
      // YAMLs that pre-date the field. Path is .lattice/findings/closed/<sha>/<slug>.yml
      // — the <sha> sits in the parent dir's basename. Lenient migration:
      // populate the field implicitly so validation passes and rendering works.
      if (kind === 'closed' && (parsed.closed_by_commit === undefined || parsed.closed_by_commit === '')) {
        const parent = path.basename(path.dirname(f));
        if (/^[0-9a-f]{7,40}$/i.test(parent)) {
          parsed.closed_by_commit = parent;
        }
      }
      validateFinding(parsed, f, kind);
      loaded.push({ path: f, ...parsed });
    } catch (e) {
      if (validateMode) {
        validateErrors.push({ path: f, message: e.message });
        continue;  // collect, don't fail-fast
      }
      console.error(`[lattice-regenerate] error parsing ${f}: ${e.message}`);
      process.exit(2);  // v0.6.6: fatal — distinguish from drift (exit 1)
    }
  }
  return loaded;
}

const openFiles = readDirRecursive('.lattice/findings/open');
const closedFiles = readDirRecursive('.lattice/findings/closed');
const open = loadAll(openFiles, 'open');
const closed = loadAll(closedFiles, 'closed');

// v0.6.6.3: validate-only mode reports per-file status and exits without
// touching CLAUDE.md. Used by `lattice validate` for diagnostic scans.
if (validateMode) {
  const totalFiles = openFiles.length + closedFiles.length;
  const okCount = totalFiles - validateErrors.length;
  console.log(`[lattice-validate] scanned ${totalFiles} file(s) (${openFiles.length} open, ${closedFiles.length} closed)`);
  console.log(`[lattice-validate]   ${okCount} ok, ${validateErrors.length} error(s)`);
  if (validateErrors.length > 0) {
    console.log('');
    for (const e of validateErrors) {
      console.error(`  FAIL  ${e.path}`);
      console.error(`        ${e.message}`);
    }
    process.exit(2);
  }
  process.exit(0);
}

// v0.6.3: partition open findings by status field. Default = 'open'.
const VALID_STATUS = ['open', 'in_progress', 'deferred', 'wont_fix'];
const byStatus = { open: [], in_progress: [], deferred: [], wont_fix: [] };
for (const f of open) {
  const s = (f.status || 'open').toLowerCase();
  if (!VALID_STATUS.includes(s)) {
    console.error(`[lattice-regenerate] error: invalid status '${f.status}' in ${f.path} (allowed: ${VALID_STATUS.join('|')})`);
    process.exit(2);  // v0.6.6: fatal schema violation
  }
  byStatus[s].push(f);
}

const now = Date.now();
const cutoff = now - daysClosed * 86400 * 1000;
const recentlyClosed = closed.filter(f => {
  if (!f.closed_at) return false;
  const ts = new Date(f.closed_at).getTime();
  return Number.isFinite(ts) && ts <= now && ts >= cutoff;
});

const TIER_ORDER = ['CRITICAL', 'BLOCKER', 'HIGH', 'RISK', 'DRIFT', 'MEDIUM', 'WATCH', 'LOW', 'INTENTIONAL', 'UNVERIFIABLE', 'OK'];

function groupByTier(items) {
  const groups = Object.fromEntries(TIER_ORDER.map(t => [t, []]));
  for (const f of items) {
    const t = (f.tier || 'OK').toUpperCase();
    if (!groups[t]) groups[t] = [];
    groups[t].push(f);
  }
  return groups;
}

function renderFindingLine(f) {
  const rel = f.path.replace(/\\/g, '/');
  return `- [ ] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — \`${escapeMd(f.file)}:${escapeMd(f.line)}\` — fix: ${escapeMd(f.fix)} — [yml](${escapeMd(rel)})`;
}

function renderInProgressLine(f) {
  const rel = f.path.replace(/\\/g, '/');
  let line = `- [~] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — \`${escapeMd(f.file)}:${escapeMd(f.line)}\``;
  if (f.partial_commits && Array.isArray(f.partial_commits) && f.partial_commits.length > 0) {
    line += ` — partial in ${f.partial_commits.map(c => '`' + escapeMd(c) + '`').join(', ')}`;
  }
  if (f.remaining) {
    line += ` — remaining: ${escapeMd(f.remaining)}`;
  }
  line += ` — [yml](${escapeMd(rel)})`;
  return line;
}

function renderSimpleLine(f) {
  const rel = f.path.replace(/\\/g, '/');
  return `- [ ] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — \`${escapeMd(f.file)}:${escapeMd(f.line)}\` — [yml](${escapeMd(rel)})`;
}

const ts = new Date().toISOString();
let body = '';
body += `${START}\n`;
body += `<!-- Generated ${ts} — DO NOT EDIT BY HAND -->\n`;
body += `<!-- Source of truth: .lattice/findings/open/ — to triage, run \`lattice help\` (CLI installed via Lattice's install.sh) -->\n\n`;

// --- Open (actionable) ---
const openItems = byStatus.open;
body += `## Open findings (${openItems.length} actionable)\n\n`;
const openGroups = groupByTier(openItems);
for (const tier of TIER_ORDER) {
  const items = openGroups[tier];
  if (!items || items.length === 0) continue;
  body += `### ${tier} (${items.length})\n`;
  for (const f of items.sort((a, b) => (a.module || '').localeCompare(b.module || ''))) {
    body += renderFindingLine(f) + '\n';
  }
  body += '\n';
}

// --- In progress (partial fixes) ---
if (byStatus.in_progress.length > 0) {
  body += `## In progress (${byStatus.in_progress.length})\n\n`;
  body += `_Partial fixes landed — these are still open concerns._\n\n`;
  for (const f of byStatus.in_progress.sort((a, b) => (a.module || '').localeCompare(b.module || ''))) {
    body += renderInProgressLine(f) + '\n';
  }
  body += '\n';
}

// --- Deferred ---
if (byStatus.deferred.length > 0) {
  body += `## Deferred (${byStatus.deferred.length})\n\n`;
  body += `_Acknowledged risks, deliberately not fixing now._\n\n`;
  for (const f of byStatus.deferred.sort((a, b) => (a.module || '').localeCompare(b.module || ''))) {
    body += renderSimpleLine(f) + '\n';
  }
  body += '\n';
}

// --- Won't fix ---
if (byStatus.wont_fix.length > 0) {
  body += `## Won't fix (${byStatus.wont_fix.length})\n\n`;
  body += `_Intentionally not fixing. Rationale in the YAML \`notes:\` field._\n\n`;
  for (const f of byStatus.wont_fix.sort((a, b) => (a.module || '').localeCompare(b.module || ''))) {
    body += renderSimpleLine(f) + '\n';
  }
  body += '\n';
}

// --- Recently closed ---
if (recentlyClosed.length > 0) {
  body += `## Recently closed (last ${daysClosed} days, ${recentlyClosed.length})\n\n`;
  for (const f of recentlyClosed.sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))) {
    body += `- [x] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — closed in \`${escapeMd(f.closed_by_commit)}\`${f.closed_by_pr ? ' (PR ' + escapeMd(f.closed_by_pr) + ')' : ''}\n`;
  }
  body += '\n';
}

body += `${END}`;  // no trailing newline — caller adds one only on first install

let claude = '';
if (fs.existsSync(claudeMdPath)) claude = fs.readFileSync(claudeMdPath, 'utf8');

function indexesOf(haystack, needle) {
  const idxs = [];
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    idxs.push(i);
    from = i + needle.length;
  }
  return idxs;
}
const startIdxs = indexesOf(claude, START);
const endIdxs = indexesOf(claude, END);

let newClaude;
if (startIdxs.length === 0 && endIdxs.length === 0) {
  newClaude = claude;
  if (newClaude.length > 0 && !newClaude.endsWith('\n')) newClaude += '\n';
  newClaude += '\n' + body + '\n';
} else if (startIdxs.length !== 1 || endIdxs.length !== 1) {
  console.error(`[lattice-regenerate] error: CLAUDE.md has malformed checklist markers (found ${startIdxs.length} start, ${endIdxs.length} end; expected exactly 1 of each)`);
  process.exit(2);  // v0.6.6: fatal — broken markers
} else {
  const startIdx = startIdxs[0];
  const endIdx = endIdxs[0] + END.length;
  if (startIdx > endIdx) {
    console.error('[lattice-regenerate] error: CLAUDE.md checklist markers are out of order (end before start)');
    process.exit(2);  // v0.6.6: fatal — broken markers
  }
  newClaude = claude.slice(0, startIdx) + body + claude.slice(endIdx);
}

if (checkMode) {
  // Compare timestamp-stripped versions so the "Generated <ts>" line never causes false drift.
  // Strip the entire generated-at comment line from both sides.
  const stripTs = s => s.replace(/<!-- Generated [^\n]*?-->\n/g, '');
  if (stripTs(newClaude) === stripTs(claude)) {
    console.log(`[lattice-regenerate] check OK — CLAUDE.md is in sync (${open.length} open, ${recentlyClosed.length} recently closed)`);
    process.exit(0);
  } else {
    console.error(`[lattice-regenerate] DRIFT: ${claudeMdPath} markered block does not match what regen would produce.`);
    console.error(`  Run: bash scripts/lattice-regenerate.sh   # then commit the result`);
    process.exit(1);
  }
}

try {
  fs.writeFileSync(claudeMdPath, newClaude);
} catch (e) {
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    console.error(`[lattice-regenerate] error: ${claudeMdPath} is not writable (${e.code}). Check file permissions.`);
  } else {
    console.error(`[lattice-regenerate] error writing ${claudeMdPath}: ${e.message}`);
  }
  process.exit(2);  // v0.6.6: fatal — couldn't write output
}

const summary = [
  `${open.length} open`,
  byStatus.in_progress.length > 0 ? `${byStatus.in_progress.length} in_progress` : null,
  byStatus.deferred.length > 0 ? `${byStatus.deferred.length} deferred` : null,
  byStatus.wont_fix.length > 0 ? `${byStatus.wont_fix.length} wont_fix` : null,
  `${recentlyClosed.length} recently-closed`,
].filter(Boolean).join(', ');
console.log(`[lattice-regenerate] wrote ${summary} to ${claudeMdPath}`);
NODE
