#!/usr/bin/env bash
# lattice-regenerate — regenerate the CLAUDE.md checklist block from YAML findings.
#
# Usage:
#   bash scripts/lattice-regenerate.sh [--claude-md <path>] [--days-closed <n>]
#
# Defaults:
#   --claude-md   ./CLAUDE.md
#   --days-closed 7         (how many days of closed findings to include)
#
# Behavior:
#   - Reads .lattice/findings/open/*/*.yml — the source of truth
#   - Reads .lattice/findings/closed/*/*.yml filtered by --days-closed
#   - Validates each YAML has required fields (rule, file, line) — fails fast on malformed
#   - Escapes field values before Markdown injection (no corruption from backticks/pipes/brackets)
#   - Requires exactly one start + one end marker (no destructive replace on duplicate markers)
#   - Try-catch around CLAUDE.md write — friendly error on EACCES/EPERM
#   - Inserts markers at end of CLAUDE.md if missing
#   - Never touches anything outside the markers

set -euo pipefail

CLAUDE_MD="./CLAUDE.md"
DAYS_CLOSED=7

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
    *) echo "[lattice-regenerate] error: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Validate --days-closed is a non-negative integer (no silent NaN downstream)
if ! [[ "${DAYS_CLOSED}" =~ ^[0-9]+$ ]]; then
  echo "[lattice-regenerate] error: --days-closed must be a non-negative integer (got: ${DAYS_CLOSED})" >&2
  exit 2
fi

if [ ! -d ".lattice/findings" ]; then
  echo "[lattice-regenerate] no .lattice/findings/ — nothing to regenerate" >&2
  exit 0
fi

node --input-type=module - "$CLAUDE_MD" "$DAYS_CLOSED" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const claudeMdPath = process.argv[2];
const daysClosed = parseInt(process.argv[3], 10);

const START = '<!-- lattice:checklist:start -->';
const END = '<!-- lattice:checklist:end -->';

// Escape Markdown special chars in field values so finding data can't corrupt CLAUDE.md.
function escapeMd(value) {
  return String(value ?? '?')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, ' ');
}

// Minimal YAML parser for the flat-key-value + scalar subset Lattice emits.
// Throws on malformed input — caller wraps in try/catch and reports per-file.
function parseYaml(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let block = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');
    if (block !== null) {
      if (/^\s+/.test(line) || line === '') {
        block.value += (block.value ? '\n' : '') + line.replace(/^  /, '');
        continue;
      }
      out[block.key] = block.value;
      block = null;
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) {
      throw new Error(`malformed YAML at line ${i + 1}: ${JSON.stringify(line)}`);
    }
    const [, k, v] = m;
    if (v === '|' || v === '>') {
      block = { key: k, value: '' };
      continue;
    }
    out[k] = v.replace(/^["']|["']$/g, '');
  }
  if (block) out[block.key] = block.value;
  return out;
}

function validateFinding(parsed, filePath) {
  for (const required of ['rule', 'file', 'line']) {
    if (parsed[required] === undefined || parsed[required] === '') {
      throw new Error(`missing required field '${required}' in ${filePath}`);
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

const openFiles = readDirRecursive('.lattice/findings/open');
const closedFiles = readDirRecursive('.lattice/findings/closed');

function loadAll(files, requireFields) {
  const loaded = [];
  for (const f of files) {
    try {
      const parsed = parseYaml(fs.readFileSync(f, 'utf8'));
      if (requireFields) validateFinding(parsed, f);
      loaded.push({ path: f, ...parsed });
    } catch (e) {
      console.error(`[lattice-regenerate] error parsing ${f}: ${e.message}`);
      process.exit(1);
    }
  }
  return loaded;
}

const open = loadAll(openFiles, true);
const closed = loadAll(closedFiles, false);

// Filter recently closed: must have valid closed_at, not in the future, and within the window
const now = Date.now();
const cutoff = now - daysClosed * 86400 * 1000;
const recentlyClosed = closed.filter(f => {
  if (!f.closed_at) return false;
  const ts = new Date(f.closed_at).getTime();
  return Number.isFinite(ts) && ts <= now && ts >= cutoff;
});

// Group open by tier
const TIER_ORDER = ['CRITICAL', 'BLOCKER', 'HIGH', 'RISK', 'DRIFT', 'MEDIUM', 'WATCH', 'LOW', 'INTENTIONAL', 'UNVERIFIABLE', 'OK'];
const groups = Object.fromEntries(TIER_ORDER.map(t => [t, []]));
for (const f of open) {
  const t = (f.tier || 'OK').toUpperCase();
  if (!groups[t]) groups[t] = [];
  groups[t].push(f);
}

const ts = new Date().toISOString();
let body = '';
body += `${START}\n`;
body += `<!-- Generated ${ts} — DO NOT EDIT BY HAND -->\n`;
body += `<!-- Source of truth: .lattice/findings/open/ — to close, run scripts/lattice-close.sh -->\n\n`;
body += `## Open findings (${open.length} total)\n\n`;

for (const tier of TIER_ORDER) {
  const items = groups[tier];
  if (!items || items.length === 0) continue;
  body += `### ${tier} (${items.length})\n`;
  for (const f of items.sort((a, b) => (a.module || '').localeCompare(b.module || ''))) {
    const rel = f.path.replace(/\\/g, '/');
    body += `- [ ] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — \`${escapeMd(f.file)}:${escapeMd(f.line)}\` — fix: ${escapeMd(f.fix)} — [yml](${escapeMd(rel)})\n`;
  }
  body += `\n`;
}

if (recentlyClosed.length > 0) {
  body += `## Recently closed (last ${daysClosed} days, ${recentlyClosed.length})\n\n`;
  for (const f of recentlyClosed.sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))) {
    body += `- [x] \`${escapeMd(f.module)}\` / \`${escapeMd(f.rule)}\` — closed in ${escapeMd(f.closed_by_commit)}${f.closed_by_pr ? ' (PR ' + escapeMd(f.closed_by_pr) + ')' : ''}\n`;
  }
  body += `\n`;
}

body += `${END}\n`;

let claude = '';
if (fs.existsSync(claudeMdPath)) claude = fs.readFileSync(claudeMdPath, 'utf8');

// Count markers — require exactly one of each (or zero of both for first install).
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

if (startIdxs.length === 0 && endIdxs.length === 0) {
  if (claude.length > 0 && !claude.endsWith('\n')) claude += '\n';
  claude += '\n' + body;
} else if (startIdxs.length !== 1 || endIdxs.length !== 1) {
  console.error(`[lattice-regenerate] error: CLAUDE.md has malformed checklist markers (found ${startIdxs.length} start, ${endIdxs.length} end; expected exactly 1 of each)`);
  process.exit(1);
} else {
  const startIdx = startIdxs[0];
  const endIdx = endIdxs[0] + END.length;
  if (startIdx > endIdx) {
    console.error('[lattice-regenerate] error: CLAUDE.md checklist markers are out of order (end before start)');
    process.exit(1);
  }
  claude = claude.slice(0, startIdx) + body + claude.slice(endIdx);
}

try {
  fs.writeFileSync(claudeMdPath, claude);
} catch (e) {
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    console.error(`[lattice-regenerate] error: ${claudeMdPath} is not writable (${e.code}). Check file permissions.`);
  } else {
    console.error(`[lattice-regenerate] error writing ${claudeMdPath}: ${e.message}`);
  }
  process.exit(1);
}

console.log(`[lattice-regenerate] wrote ${open.length} open + ${recentlyClosed.length} recently-closed findings to ${claudeMdPath}`);
NODE
