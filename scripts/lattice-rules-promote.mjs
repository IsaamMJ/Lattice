#!/usr/bin/env node
// lattice rules promote — the self-tuning loop (#124, closes epic #115).
//
// Reads every registered project's findings (open + closed) and clusters them
// into canonical rule families. For each family it computes occurrence, the
// number of distinct repos it appears in, and a fixed-rate from the closed
// findings (a class people actually FIX is worth a deterministic check; a class
// that's mostly false-positive/wont-fix is not). It then recommends which
// not-yet-deterministic families have EARNED promotion to a `core/*` scanner —
// so Lattice tunes its own rule pack from its fix history, not a one-time guess.
//
// Output: a ranked table + a "promote next" list. Read-only.

import fs from "fs";
import path from "path";
import os from "os";

// --- registry (same precedence as scripts/lattice _projects_registry_path) ---
function registryPath() {
  if (process.env.LATTICE_PROJECTS_REGISTRY) return process.env.LATTICE_PROJECTS_REGISTRY;
  const xdg = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "lattice", "projects.yml");
  if (fs.existsSync(xdg)) return xdg;
  return path.join(os.homedir(), ".claude", "lattice", "projects.yml");
}
function loadProjects() {
  const reg = registryPath();
  let text = "";
  try { text = fs.readFileSync(reg, "utf8"); } catch { return []; }
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const nm = raw.match(/^\s*-\s*name:\s*(.+?)\s*$/);
    const pm = raw.match(/^\s*path:\s*(.+?)\s*$/);
    if (nm) { cur = { name: nm[1].replace(/^["']|["']$/g, ""), path: "" }; out.push(cur); }
    else if (pm && cur) { cur.path = pm[1].replace(/^["']|["']$/g, "").replace(/^~/, os.homedir()); }
  }
  return out.filter((p) => p.path);
}

// --- canonical families: first match wins, so order specific→generic ---
const FAMILIES = [
  { id: "core/secret-in-logs", impl: true, re: /pii|secret|token.?logged|debugprint|sensitive.?log|leaks.?values|cleartext|unredacted|logs.?pii|email.?logged|bearer.?token|env-var-leak|header.*exfil/i },
  { id: "core/missing-rate-limit", impl: true, re: /rate-limit|cost-cap|no-per-user|body-size-limit|webhook-no-rate|abuse-.*limit/i },
  { id: "core/unbounded-external-call", impl: true, re: /timeout|no-outer|unbounded|no-deadline|stuck-parsing|default-timeout|backoff/i },
  { id: "core/missing-tenant-filter", impl: true, re: /tenant|idor|cross-tenant|optional-userid|rbac|userid-trust|sig-verify|xff|role-takeover|markbookingconfirmed/i },
  { id: "core/in-mem-state-no-cluster", impl: true, re: /singleton|in-memory|cluster-shared|per-request|no-cache|hot-reload|memory-prune|setinterval/i },
  { id: "core/env-var-silent-fallback", impl: true, re: /env-var|env-fallback|env-check|fallback-secret|hardcoded.*(secret|key|fallback)|pm2-restart/i },
  { id: "core/silent-fallback", impl: true, re: /silent|swallow|bails|fire-and-forget|fail-open|error-handling-missing|hides-degradation|no-ops-alert|fire.and.forget/i },
  // ---- not yet deterministic: promotion candidates ----
  { id: "no-atomic-state-mutation", impl: false, re: /race|no-cas|no-lock|non-?atomic|advisory-lock|read-then-flip|reread|idempoten|no-transaction|double-(apply|fire)|dedup|no-status-guard|unconditional-update|cas/i },
  { id: "missing-audit-log", impl: false, re: /activity-log|audit-log|no-audit|audit-trail|medical-llm-audit/i },
  { id: "accessibility", impl: false, re: /aria|contrast|keyboard|focus-trap|heading|skip-to-main|tab-roles|label-association|tap-target/i },
];

function readField(text, key) {
  const m = text.match(new RegExp("^" + key + ":\\s*(.+?)\\s*$", "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}
function classify(rule) {
  for (const f of FAMILIES) if (f.re.test(rule)) return f.id;
  return null; // unclustered
}
function* findingFiles(projPath) {
  for (const state of ["open", "closed"]) {
    const dir = path.join(projPath, ".lattice", "findings", state);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".yml")) yield { file: path.join(dir, e.name), state };
    }
  }
}

const fam = new Map(); // id -> {total, repos:Set, open, closed, fixed, invalid}
function bump(id) {
  if (!fam.has(id)) fam.set(id, { total: 0, repos: new Set(), open: 0, closed: 0, fixed: 0, invalid: 0 });
  return fam.get(id);
}

const projects = loadProjects();
for (const p of projects) {
  for (const { file, state } of findingFiles(p.path)) {
    let text; try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const rule = readField(text, "rule");
    const tier = readField(text, "tier").toUpperCase();
    if (tier === "OK") continue; // acknowledged-clean, not a real finding
    const id = classify(rule);
    if (!id) continue;
    const s = bump(id);
    s.total++; s.repos.add(p.name);
    if (state === "open") s.open++;
    else {
      s.closed++;
      const reason = readField(text, "close_reason").toLowerCase();
      if (reason === "" || reason === "fixed") s.fixed++;
      else s.invalid++; // false-positive / wont-fix / out-of-scope / duplicate
    }
  }
}

// --- rank + recommend ---
const rows = [...fam.entries()].map(([id, s]) => {
  const f = FAMILIES.find((x) => x.id === id);
  const fixedRate = s.closed > 0 ? s.fixed / s.closed : 0;
  let rec;
  if (f.impl) rec = "implemented";
  else if (s.repos.size >= 3 && fixedRate >= 0.6 && s.total >= 5) rec = "PROMOTE";
  else if (s.invalid > s.fixed && s.closed >= 3) rec = "noisy-refine";
  else rec = "watch";
  return { id, impl: f.impl, total: s.total, repos: s.repos.size, open: s.open, closed: s.closed, fixedRate, rec };
}).sort((a, b) => (b.repos - a.repos) || (b.total - a.total));

console.log(`# rules promote — ${projects.length} project(s): ${projects.map((p) => p.name).join(", ")}\n`);
console.log("REC           FAMILY                          REPOS  TOTAL  OPEN  CLOSED  FIXED%");
for (const r of rows) {
  console.log(
    `${r.rec.padEnd(13)} ${r.id.padEnd(31)} ${String(r.repos).padStart(4)}  ${String(r.total).padStart(5)}  ${String(r.open).padStart(4)}  ${String(r.closed).padStart(6)}  ${(r.fixedRate * 100).toFixed(0).padStart(4)}%`
  );
}
const promote = rows.filter((r) => r.rec === "PROMOTE");
console.log("");
if (promote.length) {
  console.log("→ EARNED PROMOTION (recurs in 3+ repos, mostly fixed, no scanner yet):");
  for (const r of promote) {
    console.log(`   • ${r.id} — ${r.total} findings across ${r.repos} repos, ${(r.fixedRate * 100).toFixed(0)}% fixed. Build scripts/lattice-${r.id.replace(/\//g, "-")}-scan.mjs.`);
  }
} else {
  console.log("→ No new families have earned promotion yet. Implemented rules cover the recurring set.");
}
