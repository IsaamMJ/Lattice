// Shared scan-ignore decision for every audit dimension — core scanners (#132).
//
// Before this module each scanner carried its own hardcoded `EXCLUDE_DIRS`
// denylist (and some carried none), so what an audit skipped depended on which
// dimension you ran. The ignore decision is a property of the PROJECT, not of
// the rule, so it lives here once and every scanner imports it.
//
// The decision is:
//
//   1. `.git` and the baseline build/dependency directories are never audit
//      targets, in any mode. `node_modules` is in that set unconditionally —
//      "ignore node_modules" must hold even in a project whose .gitignore
//      forgot it, or in a directory that is not a git repo at all.
//   2. Anything git considers ignored is ignored. This is resolved by asking
//      git itself (`git check-ignore -z --stdin`) rather than re-implementing
//      .gitignore matching: negations, `**`, nested .gitignore files, the
//      global excludesFile and .git/info/exclude all come along for free, and
//      a file that is TRACKED despite matching a pattern is correctly NOT
//      ignored (git check-ignore consults the index by default).
//   3. When git is unavailable, or the scan target is not inside a work tree,
//      rule 1 stands alone — the same denylist the scanners used before, so a
//      non-git tree behaves exactly as it did.
//
// Batching: the walk collects candidates first (pruning the baseline denylist
// as it goes, which is what keeps node_modules/dist/.venv from being descended
// into) and then decides the whole list in ONE `git check-ignore` call. Never
// one call per file — that was the whole cost objection. Descending into a
// gitignored directory that is not on the baseline denylist costs a readdir,
// not a read: its files are dropped by the batched call before anything opens
// them. In exchange the walk order is unchanged from the per-scanner walks it
// replaces, which matters because `audit-core` derives finding slugs (and
// their `-1`/`-2` disambiguating suffixes) from emission order.

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// Baseline denylist: directories that are build output, vendored dependencies,
// or tool state. Never audit targets even when a project commits them, and the
// sole ignore source when git can't answer. Kept identical to the per-scanner
// EXCLUDE_DIRS sets this module replaces.
export const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "vendor",
  ".lattice", "__pycache__", ".venv", "venv", ".dart_tool", ".netlify",
]);

// Memo of the last git resolution, so a scanner that filters more than once
// (walk mode plus an explicit list) probes `git rev-parse` at most once. A
// single slot, not a Map: a scanner process resolves exactly one scan root.
let gitTopMemo = null; // { key, top } once resolved

// Resolve the git work tree containing `root`. Returns null when git is not
// installed or `root` is not inside a repository — the fallback path.
function gitToplevel(root) {
  const key = path.resolve(root);
  if (gitTopMemo && gitTopMemo.key === key) return gitTopMemo.top;
  let top = null;
  try {
    const dir = fs.existsSync(key) && fs.statSync(key).isDirectory() ? key : path.dirname(key);
    const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!r.error && r.status === 0 && r.stdout.trim()) top = path.resolve(r.stdout.trim());
  } catch { /* git missing → fallback denylist */ }
  gitTopMemo = { key, top };
  return top;
}

// Path segments to test against the baseline denylist. Prefer the path as the
// caller sees it (relative to the scan root, then to cwd) so a project that
// genuinely lives under e.g. /srv/build/app is not ignored wholesale; only a
// path outside both is matched on its absolute segments.
function relSegments(p, root) {
  const abs = path.resolve(p);
  for (const base of [path.resolve(root), process.cwd()]) {
    const rel = path.relative(base, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split(/[\\/]+/);
    }
  }
  return abs.split(/[\\/]+/);
}

// Rule 1 alone — the denylist decision, no git, no I/O. Exported because the
// walk needs it to prune a directory BEFORE descending into it.
export function isDenylisted(p, root = ".") {
  return relSegments(p, root).some((seg) => DEFAULT_IGNORE_DIRS.has(seg));
}

// Ask git which of `paths` are ignored, in one call. Returns a Set of the
// resolved absolute paths git reported, or null when git could not answer (not
// a repo, git missing, or the call failed) so the caller can fall back.
//
// `git check-ignore` exits 0 when at least one path is ignored and 1 when none
// are — only 128/spawn-failure is an actual error.
function gitIgnoredSet(paths, root) {
  const top = gitToplevel(root);
  if (!top) return null;

  // Paths outside the work tree make git fail the whole batch; they simply get
  // no gitignore opinion and keep their denylist verdict.
  const inside = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    const rel = path.relative(top, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) inside.push(abs);
  }
  if (inside.length === 0) return new Set();

  const r = spawnSync("git", ["-C", top, "check-ignore", "-z", "--stdin"], {
    input: inside.join("\0") + "\0",
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || (r.status !== 0 && r.status !== 1)) return null;
  const out = r.stdout || "";
  return new Set(out.split("\0").filter(Boolean).map((s) => path.resolve(top, s)));
}

// THE ignore decision, batched. Given candidate paths, return the ones an audit
// should look at, in the order supplied.
export function filterIgnored(paths, root = ".") {
  const list = Array.isArray(paths) ? paths : [...paths];
  if (list.length === 0) return [];
  const kept = list.filter((p) => !isDenylisted(p, root));
  if (kept.length === 0) return kept;
  const ignored = gitIgnoredSet(kept, root);
  if (!ignored) return kept; // no git → denylist verdict is final
  return kept.filter((p) => !ignored.has(path.resolve(p)));
}

// Depth-first walk of `root`, yielding files whose extension is in `exts` (all
// files when `exts` is omitted). Denylisted directories are pruned here so the
// expensive trees are never descended; gitignore is applied by the caller in
// one batch. Same traversal order as the per-scanner walks this replaces.
function* walk(dir, exts, root) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!DEFAULT_IGNORE_DIRS.has(e.name) && !isDenylisted(p, root)) yield* walk(p, exts, root);
    } else if (!exts || exts.has(path.extname(e.name))) {
      yield p;
    }
  }
}

// Resolve a scanner's target set: the diff-scoped LATTICE_SCAN_FILES list when
// it is set (one path per line — the pre-commit hook and session-start use it
// to scan only changed files), otherwise a walk of `root`. The ignore decision
// applies to BOTH: an explicit list is still a list of candidates, and a
// gitignored or vendored file in it must not produce findings.
//
// Returns an array (not a generator) because the git call is batched over the
// whole set; order is the walk/list order.
export function scanTargets(root = ".", exts = null) {
  const env = process.env.LATTICE_SCAN_FILES;
  let candidates;
  if (env && env.trim()) {
    candidates = [];
    for (const raw of env.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      if (exts && !exts.has(path.extname(t))) continue;
      try { if (fs.statSync(t).isFile()) candidates.push(t); } catch { /* gone */ }
    }
  } else {
    candidates = [...walk(root, exts, root)];
  }
  return filterIgnored(candidates, root);
}
