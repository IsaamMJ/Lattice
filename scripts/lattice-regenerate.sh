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
#   - Writes the rendered checklist between <!-- lattice:checklist:start --> and <!-- lattice:checklist:end -->
#   - Inserts the markers at end of CLAUDE.md if missing
#   - Never touches anything outside the markers
#
# Requires: node (any v18+) — uses fs + js-yaml-free YAML parsing for the simple subset Lattice emits.

set -euo pipefail

CLAUDE_MD="./CLAUDE.md"
DAYS_CLOSED=7

while [ "$#" -gt 0 ]; do
  case "$1" in
    --claude-md)  CLAUDE_MD="$2"; shift 2 ;;
    --days-closed) DAYS_CLOSED="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

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

// Minimal YAML parser for the flat-key-value + scalar subset Lattice emits.
// Does NOT support flow-style or anchors — Lattice findings never use them.
function parseYaml(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let key = null;
  let block = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (block !== null) {
      if (/^\s+/.test(line) || line === '') {
        block.value += (block.value ? '\n' : '') + line.replace(/^  /, '');
        continue;
      } else {
        out[block.key] = block.value;
        block = null;
      }
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
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

const open = openFiles.map(f => ({ path: f, ...parseYaml(fs.readFileSync(f, 'utf8')) }));
const closed = closedFiles.map(f => ({ path: f, ...parseYaml(fs.readFileSync(f, 'utf8')) }));

// Filter recently closed
const now = Date.now();
const cutoff = now - daysClosed * 86400 * 1000;
const recentlyClosed = closed.filter(f => {
  if (!f.closed_at) return false;
  return new Date(f.closed_at).getTime() >= cutoff;
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
    body += `- [ ] \`${f.module || '?'}\` / \`${f.rule || '?'}\` — \`${f.file || '?'}:${f.line || '?'}\` — fix: ${f.fix || '?'} — [yml](${rel})\n`;
  }
  body += `\n`;
}

if (recentlyClosed.length > 0) {
  body += `## Recently closed (last ${daysClosed} days, ${recentlyClosed.length})\n\n`;
  for (const f of recentlyClosed.sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))) {
    body += `- [x] \`${f.module || '?'}\` / \`${f.rule || '?'}\` — closed in ${f.closed_by_commit || '?'}${f.closed_by_pr ? ' (PR ' + f.closed_by_pr + ')' : ''}\n`;
  }
  body += `\n`;
}

body += `${END}\n`;

let claude = '';
if (fs.existsSync(claudeMdPath)) claude = fs.readFileSync(claudeMdPath, 'utf8');

if (claude.includes(START) && claude.includes(END)) {
  const startIdx = claude.indexOf(START);
  const endIdx = claude.indexOf(END) + END.length;
  claude = claude.slice(0, startIdx) + body + claude.slice(endIdx);
} else {
  if (claude.length > 0 && !claude.endsWith('\n')) claude += '\n';
  claude += '\n' + body;
}

fs.writeFileSync(claudeMdPath, claude);
console.log(`[lattice-regenerate] wrote ${open.length} open + ${recentlyClosed.length} recently-closed findings to ${claudeMdPath}`);
NODE
