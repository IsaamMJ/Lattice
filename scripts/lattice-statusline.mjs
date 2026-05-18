#!/usr/bin/env node
/**
 * lattice-statusline.mjs — Claude Code statusLine entry point (v0.9.15+)
 *
 * Replaces the bash cmd_statusline on Windows + Git Bash where the per-tick
 * bash startup cost (1-3s on Windows) compounded with subprocess forks to
 * cause 12+ orphan bash.exe processes, 29% CPU, 77% RAM, 3 forced restarts.
 *
 * This script:
 *   - Starts in ~50-150ms (vs 1-3s for bash)
 *   - Spawns ZERO child processes in the hot path (pure Node fs reads)
 *   - Reads stdin with a 300ms timeout (never hangs on missing EOF)
 *   - Lock + cache prevent concurrent renders piling up
 *   - Always exits 0; any error → cached output or silent skip
 *
 * Wire into ~/.claude/settings.json:
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node C:/Users/Jahir/.claude/lattice/scripts/lattice-statusline.mjs"
 *   }
 *
 * Env opt-outs:
 *   LATTICE_STATUSLINE_DISABLE=1   instant no-op
 *   LATTICE_STATUSLINE_NOCOLOR=1   strip ANSI
 */

import { readFileSync, writeFileSync, statSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join, sep, basename } from 'path';
import { homedir, tmpdir, userInfo } from 'os';

// ---- Emergency kill switch ----
if (process.env.LATTICE_STATUSLINE_DISABLE === '1') process.exit(0);

const NOCOLOR = process.env.LATTICE_STATUSLINE_NOCOLOR === '1';

// ---- ANSI palette (OMC style) ----
const C = NOCOLOR
  ? { GREEN: '', YELLOW: '', RED: '', DIM: '', BOLD: '', RESET: '' }
  : {
      GREEN: '\x1b[32m',
      YELLOW: '\x1b[33m',
      RED: '\x1b[31m',
      DIM: '\x1b[2m',
      BOLD: '\x1b[1m',
      RESET: '\x1b[0m',
    };
const SEP = `${C.DIM} | ${C.RESET}`;

// ---- Lock + cache (orphan prevention) ----
const USER = (() => { try { return userInfo().username || 'default'; } catch { return 'default'; } })();
const LOCK_FILE = join(tmpdir(), `lattice-statusline.${USER}.lock`);
const CACHE_FILE = join(tmpdir(), `lattice-statusline.${USER}.cache`);
const NOW = Math.floor(Date.now() / 1000);

function emitCache() {
  try {
    if (existsSync(CACHE_FILE)) process.stdout.write(readFileSync(CACHE_FILE, 'utf8'));
  } catch {}
  process.exit(0);
}

// If a fresh lock from a live PID exists, serve cache and exit.
try {
  if (existsSync(LOCK_FILE)) {
    const raw = readFileSync(LOCK_FILE, 'utf8').trim();
    const [lockPid, lockTs] = raw.split(':').map(Number);
    const lockAge = NOW - (lockTs || 0);
    if (lockAge < 5 && lockPid > 0) {
      // Check if PID alive (Node: process.kill(pid, 0) throws if not)
      try {
        process.kill(lockPid, 0);
        // Alive → another render in flight, serve cache
        emitCache();
      } catch {
        // Dead → break stale lock
        try { unlinkSync(LOCK_FILE); } catch {}
      }
    } else {
      // Lock too old → break it
      try { unlinkSync(LOCK_FILE); } catch {}
    }
  }
} catch {}

// Serve cache if it's <2s old — even without lock contention, this drops
// tick load roughly in half (alternate ticks serve cache).
try {
  if (existsSync(CACHE_FILE)) {
    const cacheMtime = Math.floor(statSync(CACHE_FILE).mtimeMs / 1000);
    if (NOW - cacheMtime < 2) emitCache();
  }
} catch {}

// Acquire lock. Cleanup on any exit.
try { writeFileSync(LOCK_FILE, `${process.pid}:${NOW}`, 'utf8'); } catch {}
process.on('exit', () => { try { unlinkSync(LOCK_FILE); } catch {} });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Hard timeout — if anything below hangs (shouldn't, but defensive), kill self.
const HARD_TIMEOUT = setTimeout(() => {
  try { unlinkSync(LOCK_FILE); } catch {}
  emitCache();
}, 1500);
HARD_TIMEOUT.unref();

// ---- Read Claude Code stdin (non-blocking, 300ms timeout) ----
async function readStdin(timeoutMs) {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => resolve(data), timeoutMs);
    t.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

// ---- Pure-Node helpers (no subprocess) ----
function readGitBranch(cwd) {
  try {
    const headPath = join(cwd, '.git', 'HEAD');
    if (!existsSync(headPath)) return '';
    const head = readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref:')) return head.replace(/^ref:\s*refs\/heads\//, '');
    return head.slice(0, 7); // detached HEAD
  } catch {
    return '';
  }
}

function countFindings(cwd) {
  // Single pass over .lattice/findings/open/ — read each YAML and look for
  // `tier: CRITICAL` / `tier: HIGH`. No subprocess, no glob; just readdir.
  const out = { crit: 0, high: 0 };
  const root = join(cwd, '.lattice', 'findings', 'open');
  if (!existsSync(root)) return out;
  try {
    const walk = (dir) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.yml')) {
          try {
            const content = readFileSync(p, 'utf8');
            if (/^tier:\s*CRITICAL(\s|$)/m.test(content)) out.crit++;
            else if (/^tier:\s*HIGH(\s|$)/m.test(content)) out.high++;
          } catch {}
        }
      }
    };
    walk(root);
  } catch {}
  return out;
}

function todaySessionEventCount(cwd) {
  try {
    const d = new Date();
    const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const p = join(cwd, '.lattice', 'sessions', `${day}.jsonl`);
    if (!existsSync(p)) return 0;
    const content = readFileSync(p, 'utf8');
    return content.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function readLatticeMode(cwd) {
  try {
    const p = join(cwd, '.lattice', 'config.yml');
    if (!existsSync(p)) return 'classic';
    const c = readFileSync(p, 'utf8');
    const m = c.match(/^mode:\s*(\w+)/m);
    return m ? m[1] : 'classic';
  } catch {
    return 'classic';
  }
}

function shortenCwd(cwd) {
  const home = homedir();
  let s = cwd;
  if (s.startsWith(home)) s = '~' + s.slice(home.length);
  // Normalize separators
  s = s.replace(/\\/g, '/');
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 2) return s;
  return (s.startsWith('~') ? '~/.../' : '.../') + parts.slice(-2).join('/');
}

function sevColor(pct) {
  if (pct >= 90) return C.RED;
  if (pct >= 70) return C.YELLOW;
  return C.GREEN;
}

function renderBar(pct, width) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;
  const color = sevColor(p);
  return `[${color}${'█'.repeat(filled)}${C.DIM}${'░'.repeat(empty)}${C.RESET}]${color}${p}%${C.RESET}`;
}

// formatResetTime — v0.9.17: turn a unix-epoch number OR ISO-8601 string into
// a compact "time remaining" label like "1h32m", "2d4h", "45m", "20s".
// Returns '' for invalid / past / null input so callers can skip-or-render.
//
// Format ladder:
//   < 60s    → "Ns"     (e.g. "45s")
//   < 60min  → "Nm"     (e.g. "32m")
//   < 24h    → "NhMm"   (e.g. "1h32m") — Mm dropped if 0
//   ≥ 24h    → "NdHh"   (e.g. "2d4h")  — Hh dropped if 0
function formatResetTime(resetsAt) {
  if (resetsAt == null) return '';
  let resetMs;
  if (typeof resetsAt === 'number') {
    // Heuristic: unix-seconds if < year 3000 in seconds, else ms.
    resetMs = resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
  } else if (typeof resetsAt === 'string') {
    const parsed = Date.parse(resetsAt);
    if (isNaN(parsed)) return '';
    resetMs = parsed;
  } else {
    return '';
  }
  const deltaMs = resetMs - Date.now();
  if (deltaMs <= 0) return ''; // already reset — no useful label
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const mm = min - hr * 60;
    return mm > 0 ? `${hr}h${mm}m` : `${hr}h`;
  }
  const day = Math.floor(hr / 24);
  const hh = hr - day * 24;
  return hh > 0 ? `${day}d${hh}h` : `${day}d`;
}

function extractField(json, path) {
  // Cheap dotted-path JSON lookup. Doesn't parse — uses regex on the original
  // string to avoid JSON.parse failures on partial input.
  try { return path.reduce((o, k) => (o == null ? null : o[k]), JSON.parse(json)); }
  catch { return null; }
}

// ---- Main ----
(async () => {
  try {
    const raw = await readStdin(300);
    let cwdFromStdin = '';
    let model = '';
    let ctxPct = null;
    let fhPct = null;
    let wkPct = null;
    let fhReset = null;  // v0.9.17: reset-time-remaining for 5h limit
    let wkReset = null;  // v0.9.17: reset-time-remaining for weekly limit
    if (raw) {
      try {
        const j = JSON.parse(raw);
        cwdFromStdin = j?.cwd || '';
        model = j?.model?.display_name || '';
        ctxPct = j?.context_window?.used_percentage ?? null;
        fhPct = j?.rate_limits?.five_hour?.used_percentage ?? null;
        wkPct = j?.rate_limits?.seven_day?.used_percentage ?? null;
        fhReset = j?.rate_limits?.five_hour?.resets_at ?? null;
        wkReset = j?.rate_limits?.seven_day?.resets_at ?? null;
      } catch {
        // Partial/garbage JSON — silently ignore, render what we can
      }
    }

    const cwd = cwdFromStdin && existsSync(cwdFromStdin) ? cwdFromStdin : process.cwd();
    const branch = readGitBranch(cwd);
    const findings = countFindings(cwd);
    const events = todaySessionEventCount(cwd);
    const mode = readLatticeMode(cwd);
    const cwdShort = shortenCwd(cwd);

    // ---- LINE 1: model · cwd · branch ----
    const l1 = [];
    if (model) l1.push(`${C.BOLD}${model}${C.RESET}`);
    if (cwdShort) l1.push(`${C.DIM}${cwdShort}${C.RESET}`);
    if (branch) l1.push(`${C.DIM}⎇${C.RESET} ${branch}`);

    // ---- LINE 2: [Lattice] · 5h · wk · ctx · findings · friction · mode ----
    // v0.9.17: append reset-time-remaining "(1h32m)" after each rate-limit bar
    //          when Claude Code's stdin provides resets_at.
    const l2 = [`${C.DIM}[${C.RESET}${C.BOLD}Lattice${C.RESET}${C.DIM}]${C.RESET}`];
    if (fhPct != null) {
      const r = formatResetTime(fhReset);
      const tail = r ? `${C.DIM}(${r})${C.RESET}` : '';
      l2.push(`5h:${renderBar(fhPct, 8)}${tail}`);
    }
    if (wkPct != null) {
      const r = formatResetTime(wkReset);
      const tail = r ? `${C.DIM}(${r})${C.RESET}` : '';
      l2.push(`${C.DIM}wk:${C.RESET}${renderBar(wkPct, 8)}${tail}`);
    }
    if (ctxPct != null) l2.push(`Ctx:${renderBar(ctxPct, 10)}`);
    if (findings.crit > 0 || findings.high > 0) {
      const parts = [];
      if (findings.crit > 0) parts.push(`${C.RED}CRIT:${findings.crit}${C.RESET}`);
      if (findings.high > 0) parts.push(`${C.YELLOW}HIGH:${findings.high}${C.RESET}`);
      l2.push(parts.join(' '));
    }
    if (events > 10) l2.push(`${C.YELLOW}${events} events${C.RESET}`);
    if (mode === 'substrate' || mode === 'hybrid') l2.push(`${C.DIM}${mode}${C.RESET}`);

    const out = (l1.length ? l1.join(SEP) + '\n' : '') + l2.join(SEP);

    // Write cache (atomic via temp+rename)
    try {
      writeFileSync(`${CACHE_FILE}.tmp`, out + '\n', 'utf8');
      // Node has no rename-replace on Windows when target exists with same name?
      // Actually fs.renameSync works on Windows. Use it.
      const { renameSync } = await import('fs');
      renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
    } catch {}

    process.stdout.write(out + '\n');
    clearTimeout(HARD_TIMEOUT);
    process.exit(0);
  } catch (err) {
    // Catastrophic — fall back to cache or silent
    emitCache();
  }
})();
