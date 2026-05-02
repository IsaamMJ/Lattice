#!/usr/bin/env bash
# Lattice lifecycle test suite — exercises lattice-close.sh and lattice-regenerate.sh
# against disposable fixtures. THIS IS THE PROTECTION LAYER added in v0.6.2 to
# prevent the kind of silent-bug shipping that motivated v0.6.2 itself.
#
# Run locally:    bash scripts/test-lifecycle.sh
# CI runs it:     via scripts/validate.sh
#
# All tests use a private temp dir; nothing in the repo is touched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOSE="${REPO_ROOT}/scripts/lattice-close.sh"
REGEN="${REPO_ROOT}/scripts/lattice-regenerate.sh"

PASS=0
FAIL=0
FAILED_TESTS=()

note() { printf "[test] %s\n" "$*"; }
ok()   { printf "[test]   PASS: %s\n" "$*"; PASS=$((PASS + 1)); }
fail() { printf "[test]   FAIL: %s\n" "$*" >&2; FAIL=$((FAIL + 1)); FAILED_TESTS+=("$*"); }

# Each test gets its own clean fixture dir under a single root.
ROOT_TMP="$(mktemp -d -t lattice-tests-XXXXXX)"
trap 'rm -rf "${ROOT_TMP}"' EXIT

new_fixture() {
  local name="$1"
  local dir="${ROOT_TMP}/${name}"
  mkdir -p "${dir}/.lattice/findings/open/2026-05-02"
  cd "${dir}"
  git init -q
  git config user.email test@test
  git config user.name test
  echo "fixture for ${name}" > README.md
  git add README.md
  git commit -q -m "fixture"
  echo "${dir}"
}

write_yaml() {
  local path="$1"
  cat > "${path}"
}

# ---------------------------------------------------------------------------
# Test 1: re-closing a finding does NOT duplicate lifecycle fields
# (Bug #1 — append → upsert)
# ---------------------------------------------------------------------------
note "Test 1: re-close does not duplicate lifecycle fields"
new_fixture t1 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-mod-rule.yml <<'YML'
id: aaaa
rule: rule
dimension: security
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: sweep1
auditor: claude-code/security-audit
YML

bash "${CLOSE}" HIGH-mod-rule --commit aaaaaaa1 >/dev/null
# Re-open by moving back, then close again with a different commit
mkdir -p .lattice/findings/open/2026-05-02
mv .lattice/findings/closed/aaaaaaa1/HIGH-mod-rule.yml .lattice/findings/open/2026-05-02/
bash "${CLOSE}" HIGH-mod-rule --commit bbbbbbb2 >/dev/null

dest=".lattice/findings/closed/bbbbbbb2/HIGH-mod-rule.yml"
count_at=$(grep -cE '^closed_at:[[:space:]]' "${dest}" || true)
count_commit=$(grep -cE '^closed_by_commit:[[:space:]]' "${dest}" || true)
if [ "${count_at}" = "1" ] && [ "${count_commit}" = "1" ]; then
  ok "no duplicate lifecycle fields after re-close (closed_at=${count_at} closed_by_commit=${count_commit})"
else
  fail "duplicate lifecycle fields after re-close (closed_at=${count_at} closed_by_commit=${count_commit})"
fi

# ---------------------------------------------------------------------------
# Test 2: outside git, close hard-fails without --commit (no silent "unknown")
# ---------------------------------------------------------------------------
note "Test 2: close outside git fails when --commit missing"
ROOT_NO_GIT="${ROOT_TMP}/t2"
mkdir -p "${ROOT_NO_GIT}/.lattice/findings/open/2026-05-02"
cd "${ROOT_NO_GIT}"
write_yaml .lattice/findings/open/2026-05-02/LOW-x-y.yml <<'YML'
id: bbbb
rule: y
dimension: security
tier: LOW
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML

if bash "${CLOSE}" LOW-x-y >/dev/null 2>&1; then
  fail "close outside git should hard-fail without --commit, but succeeded"
else
  ok "close outside git hard-fails without --commit"
fi

# Same fixture, but with --commit, should succeed
if bash "${CLOSE}" LOW-x-y --commit deadbeef >/dev/null 2>&1; then
  ok "close outside git succeeds when --commit provided"
else
  fail "close outside git failed even with --commit"
fi

# ---------------------------------------------------------------------------
# Test 3: --commit / --pr arity validation gives a clean error (not shell error)
# ---------------------------------------------------------------------------
note "Test 3: arity validation on --commit / --pr"
new_fixture t3 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/MEDIUM-a-b.yml <<'YML'
id: cccc
rule: b
dimension: security
tier: MEDIUM
module: a
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML

if out="$(bash "${CLOSE}" MEDIUM-a-b --commit 2>&1)"; then
  fail "missing value for --commit should fail, but succeeded"
else
  if echo "${out}" | grep -q "requires a value"; then
    ok "--commit without value fails with clear error"
  else
    fail "--commit error message unclear: ${out}"
  fi
fi

# ---------------------------------------------------------------------------
# Test 4: regenerator FAILS on malformed YAML (does not silently render '?')
# ---------------------------------------------------------------------------
note "Test 4: regenerator fails fast on malformed YAML"
new_fixture t4 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-bad.yml <<'YML'
id: dddd
rule broken-no-colon
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: nope
title: t
fix: f
YML
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  fail "regenerator should fail on malformed YAML, but succeeded"
else
  ok "regenerator fails on malformed YAML"
fi

# ---------------------------------------------------------------------------
# Test 5: Markdown fields with pipes / brackets / backticks are escaped
# ---------------------------------------------------------------------------
note "Test 5: Markdown injection in field values is escaped"
new_fixture t5 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/CRITICAL-x-inject.yml <<'YML'
id: eeee
rule: inject
dimension: security
tier: CRITICAL
module: x
file: src/x.ts
line: 1
title: t
fix: pipe|bracket[stuff]backtick`thing
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML
echo "# fixture" > CLAUDE.md
bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null
if grep -qF '\|' CLAUDE.md && grep -qF '\[' CLAUDE.md && grep -qF '\`' CLAUDE.md; then
  ok "pipes / brackets / backticks escaped in CLAUDE.md"
else
  fail "Markdown injection NOT escaped: $(grep -E 'pipe|bracket|backtick' CLAUDE.md || echo 'no match')"
fi

# ---------------------------------------------------------------------------
# Test 6: regenerator REJECTS duplicate start markers (no destructive replace)
# ---------------------------------------------------------------------------
note "Test 6: duplicate markers rejected"
new_fixture t6 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/LOW-x-y.yml <<'YML'
id: ffff
rule: y
dimension: security
tier: LOW
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML
cat > CLAUDE.md <<'MD'
# fixture
<!-- lattice:checklist:start -->
old content one
<!-- lattice:checklist:end -->

something else

<!-- lattice:checklist:start -->
old content two
<!-- lattice:checklist:end -->
MD
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  fail "regenerator should reject duplicate markers, but succeeded"
else
  if grep -q "old content one" CLAUDE.md && grep -q "old content two" CLAUDE.md; then
    ok "regenerator refused to write — original content preserved"
  else
    fail "regenerator refused but content was modified"
  fi
fi

# ---------------------------------------------------------------------------
# Test 7: --days-closed must be a non-negative integer
# ---------------------------------------------------------------------------
note "Test 7: --days-closed validates numeric input"
new_fixture t7 >/dev/null
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md --days-closed foo >/dev/null 2>&1; then
  fail "--days-closed=foo should fail, but succeeded"
else
  ok "--days-closed rejects non-numeric input"
fi

# ---------------------------------------------------------------------------
# Test 8: regenerator preserves content OUTSIDE the markers
# ---------------------------------------------------------------------------
note "Test 8: regenerator preserves content outside markers"
new_fixture t8 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/MEDIUM-x-y.yml <<'YML'
id: gggg
rule: y
dimension: security
tier: MEDIUM
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML
cat > CLAUDE.md <<'MD'
# fixture

## Triage notes
- manual note A
- manual note B

<!-- lattice:checklist:start -->
old generated
<!-- lattice:checklist:end -->

## After-marker section
should survive
MD

bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null

if grep -q "manual note A" CLAUDE.md \
   && grep -q "manual note B" CLAUDE.md \
   && grep -q "After-marker section" CLAUDE.md \
   && grep -q "should survive" CLAUDE.md \
   && ! grep -q "old generated" CLAUDE.md; then
  ok "manual content preserved; old generated content replaced"
else
  fail "regenerator damaged content outside markers"
fi

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
cd "${REPO_ROOT}"
echo
echo "[test] passed: ${PASS}"
echo "[test] failed: ${FAIL}"
if [ "${FAIL}" -ne 0 ]; then
  echo "[test] failed tests:" >&2
  for t in "${FAILED_TESTS[@]}"; do echo "  - ${t}" >&2; done
  exit 1
fi
