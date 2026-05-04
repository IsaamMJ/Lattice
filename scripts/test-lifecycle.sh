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
# Re-open by moving back, then close again with a different commit (v0.6.3: SHAs truncate to 7-char)
mkdir -p .lattice/findings/open/2026-05-02
mv .lattice/findings/closed/aaaaaaa/HIGH-mod-rule.yml .lattice/findings/open/2026-05-02/
bash "${CLOSE}" HIGH-mod-rule --commit bbbbbbb2 >/dev/null

dest=".lattice/findings/closed/bbbbbbb/HIGH-mod-rule.yml"
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
# Test 9 (v0.6.3): close.sh truncates SHA to 7-char short form
# ---------------------------------------------------------------------------
note "Test 9 (v0.6.3): close.sh normalizes SHA to 7-char"
new_fixture t9 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-mod-rule.yml <<'YML'
id: t9aa
rule: rule
dimension: security
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
bash "${CLOSE}" HIGH-mod-rule --commit 7481d57c5138f39c25a1058593a753835e7575af >/dev/null
if [ -d ".lattice/findings/closed/7481d57" ] \
   && [ -f ".lattice/findings/closed/7481d57/HIGH-mod-rule.yml" ] \
   && grep -q "^closed_by_commit: 7481d57$" ".lattice/findings/closed/7481d57/HIGH-mod-rule.yml"; then
  ok "long SHA truncated to 7-char (dir + closed_by_commit field)"
else
  fail "long SHA not normalized: $(ls .lattice/findings/closed/ 2>&1)"
fi

# ---------------------------------------------------------------------------
# Test 10 (v0.6.3): --partial keeps finding in open/ with status: in_progress
# ---------------------------------------------------------------------------
note "Test 10 (v0.6.3): --partial keeps finding in open/, sets in_progress"
new_fixture t10 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/RISK-booking-no-tx.yml <<'YML'
id: t10a
rule: no-tx
dimension: scale
tier: RISK
module: booking
file: src/booking.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/scale-audit
status: open
YML
bash "${CLOSE}" RISK-booking-no-tx --partial "advisory lock deferred" --commit aaaaaaa1 >/dev/null

src=".lattice/findings/open/2026-05-02/RISK-booking-no-tx.yml"
if [ -f "${src}" ] \
   && grep -q "^status: in_progress$" "${src}" \
   && grep -q "^partial_commits: \[aaaaaaa\]$" "${src}" \
   && grep -q '^remaining: "advisory lock deferred"$' "${src}"; then
  ok "partial close keeps file in open/ with in_progress + partial_commits + remaining"
else
  fail "partial close fields wrong:\n$(cat "${src}" 2>&1)"
fi

# Second partial commit should APPEND to partial_commits
bash "${CLOSE}" RISK-booking-no-tx --partial "still need retry logic" --commit bbbbbbb2 >/dev/null
if grep -q "^partial_commits: \[aaaaaaa, bbbbbbb\]$" "${src}" \
   && grep -q '^remaining: "still need retry logic"$' "${src}"; then
  ok "second --partial appends to partial_commits, overwrites remaining"
else
  fail "second partial did not append correctly:\n$(cat "${src}" 2>&1)"
fi

# Now do a FULL close — should move to closed/ and strip in_progress fields
bash "${CLOSE}" RISK-booking-no-tx --commit ccccccc3 >/dev/null
dest=".lattice/findings/closed/ccccccc/RISK-booking-no-tx.yml"
if [ -f "${dest}" ] \
   && ! grep -q "^status: in_progress" "${dest}" \
   && ! grep -q "^partial_commits:" "${dest}" \
   && ! grep -q "^remaining:" "${dest}" \
   && grep -q "^closed_by_commit: ccccccc$" "${dest}"; then
  ok "full close after partial strips in_progress fields, moves to closed/"
else
  fail "full close after partial did not clean up:\n$(cat "${dest}" 2>&1)"
fi

# ---------------------------------------------------------------------------
# Test 11 (v0.6.3): lattice-reopen.sh moves closed → open with previously_closed_in
# ---------------------------------------------------------------------------
REOPEN="${REPO_ROOT}/scripts/lattice-reopen.sh"
note "Test 11 (v0.6.3): reopen moves closed → open and preserves origin SHA"
new_fixture t11 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-x-y.yml <<'YML'
id: t11a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
bash "${CLOSE}" HIGH-x-y --commit ddddddd4 >/dev/null
bash "${REOPEN}" HIGH-x-y --reason "regression in 1234567" >/dev/null

today="$(date -u +%Y-%m-%d)"
reopened=".lattice/findings/open/${today}/HIGH-x-y.yml"
if [ -f "${reopened}" ] \
   && grep -q "^status: open$" "${reopened}" \
   && grep -q "^previously_closed_in: ddddddd$" "${reopened}" \
   && grep -q '^reopen_reason: "regression in 1234567"$' "${reopened}" \
   && ! grep -q "^closed_at:" "${reopened}" \
   && ! grep -q "^closed_by_commit:" "${reopened}"; then
  ok "reopen moves to open/<today>/, sets previously_closed_in, strips closed_* fields"
else
  fail "reopen did not produce expected file:\n$(cat "${reopened}" 2>&1)"
fi

# Idempotent — re-opening an already-open finding is a no-op
out="$(bash "${REOPEN}" HIGH-x-y 2>&1)"
if echo "${out}" | grep -q "already open"; then
  ok "reopen is idempotent (already-open is no-op)"
else
  fail "reopen not idempotent: ${out}"
fi

# ---------------------------------------------------------------------------
# Test 12 (v0.6.3): regen --check exits 1 on drift
# ---------------------------------------------------------------------------
note "Test 12 (v0.6.3): regen --check detects manual CLAUDE.md edits"
new_fixture t12 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-x-y.yml <<'YML'
id: t12a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
echo "# fixture" > CLAUDE.md
bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null

# Sanity: --check passes immediately after regen
if bash "${REGEN}" --claude-md ./CLAUDE.md --check >/dev/null 2>&1; then
  ok "regen --check passes when CLAUDE.md is in sync"
else
  fail "regen --check failed when freshly regenerated"
fi

# Hand-edit the markered section → --check must fail
sed -i 's/Open findings/MANUALLY EDITED HEADING/' CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md --check >/dev/null 2>&1; then
  fail "regen --check should detect drift, but passed"
else
  ok "regen --check detects manual edits to CLAUDE.md"
fi

# ---------------------------------------------------------------------------
# Test 13 (v0.6.3): regen renders status sections (in_progress, deferred)
# ---------------------------------------------------------------------------
note "Test 13 (v0.6.3): regen groups by status field"
new_fixture t13 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-a-actionable.yml <<'YML'
id: t13a
rule: actionable
dimension: security
tier: HIGH
module: a
file: src/a.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
write_yaml .lattice/findings/open/2026-05-02/RISK-b-partial.yml <<'YML'
id: t13b
rule: partial
dimension: scale
tier: RISK
module: b
file: src/b.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/scale-audit
status: in_progress
partial_commits: [eeeeeee]
remaining: "still missing retry"
YML
write_yaml .lattice/findings/open/2026-05-02/RISK-c-deferred.yml <<'YML'
id: t13c
rule: deferred
dimension: scale
tier: RISK
module: c
file: src/c.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/scale-audit
status: deferred
YML
echo "# fixture" > CLAUDE.md
bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null

if grep -q "^## Open findings (1 actionable)" CLAUDE.md \
   && grep -q "^## In progress (1)" CLAUDE.md \
   && grep -q "^## Deferred (1)" CLAUDE.md \
   && grep -q "still missing retry" CLAUDE.md \
   && grep -q "eeeeeee" CLAUDE.md; then
  ok "regen groups by status (open/in_progress/deferred) with partial details"
else
  fail "regen did not group by status correctly:\n$(cat CLAUDE.md)"
fi

# ---------------------------------------------------------------------------
# Test 14 (v0.6.3): regen rejects invalid status values
# ---------------------------------------------------------------------------
note "Test 14 (v0.6.3): regen rejects unknown status"
new_fixture t14 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-x-y.yml <<'YML'
id: t14a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: bogus_value
YML
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  fail "regen should reject status: bogus_value"
else
  ok "regen rejects invalid status values"
fi

# ---------------------------------------------------------------------------
# Test 15 (v0.6.3): migrate-status.sh adds status: open idempotently
# ---------------------------------------------------------------------------
MIGRATE="${REPO_ROOT}/scripts/migrate-status.sh"
note "Test 15 (v0.6.3): migrate-status adds status: open idempotently"
new_fixture t15 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-no-status.yml <<'YML'
id: t15a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
YML
bash "${MIGRATE}" >/dev/null
if grep -q "^status: open$" ".lattice/findings/open/2026-05-02/HIGH-no-status.yml"; then
  ok "migrate-status added status: open"
else
  fail "migrate-status did not add status field"
fi
# Run again — must not duplicate
bash "${MIGRATE}" >/dev/null
count=$(grep -cE "^status:" ".lattice/findings/open/2026-05-02/HIGH-no-status.yml")
if [ "${count}" = "1" ]; then
  ok "migrate-status is idempotent (no duplicate status field)"
else
  fail "migrate-status duplicated status field (count=${count})"
fi

# ---------------------------------------------------------------------------
# Test 16 (v0.6.3.1): close refuses to overwrite existing closed finding
# ---------------------------------------------------------------------------
note "Test 16 (v0.6.3.1): close refuses to overwrite existing closed finding"
new_fixture t16 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-x-y.yml <<'YML'
id: t16a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t1
fix: f1
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
bash "${CLOSE}" HIGH-x-y --commit 1234567 >/dev/null

# Now create a different open finding with the same slug (e.g. resurrected by another sweep)
mkdir -p .lattice/findings/open/2026-05-04
write_yaml .lattice/findings/open/2026-05-04/HIGH-x-y.yml <<'YML'
id: t16b
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: 1
title: t2-different
fix: f2
sweep_date: 2026-05-04
sweep_id: s2
auditor: claude-code/security-audit
status: open
YML

# Closing again with the same SHA should refuse, NOT overwrite
if bash "${CLOSE}" HIGH-x-y --commit 1234567 >/dev/null 2>&1; then
  fail "close should refuse to overwrite existing closed/<sha>/<slug>.yml, but succeeded"
else
  if grep -q "title: t1" .lattice/findings/closed/1234567/HIGH-x-y.yml \
     && [ -f .lattice/findings/open/2026-05-04/HIGH-x-y.yml ]; then
    ok "close refused to overwrite; original closed finding intact, source still in open/"
  else
    fail "close refused but state was corrupted"
  fi
fi

# LATTICE_FORCE_OVERWRITE=1 should allow it (escape hatch)
if LATTICE_FORCE_OVERWRITE=1 bash "${CLOSE}" HIGH-x-y --commit 1234567 >/dev/null 2>&1; then
  if grep -q "title: t2-different" .lattice/findings/closed/1234567/HIGH-x-y.yml; then
    ok "LATTICE_FORCE_OVERWRITE=1 escape hatch works"
  else
    fail "force overwrite did not actually overwrite"
  fi
else
  fail "LATTICE_FORCE_OVERWRITE=1 should permit overwrite"
fi

# ---------------------------------------------------------------------------
# Test 17 (v0.6.3.1): --partial with multiline text produces valid YAML
# ---------------------------------------------------------------------------
note "Test 17 (v0.6.3.1): --partial multiline uses YAML block scalar"
new_fixture t17 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/RISK-x-multiline.yml <<'YML'
id: t17a
rule: ml
dimension: scale
tier: RISK
module: x
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/scale-audit
status: open
YML
bash "${CLOSE}" RISK-x-multiline --partial "$(printf 'line one\nline two\nline three')" --commit 7890abc >/dev/null

src=".lattice/findings/open/2026-05-02/RISK-x-multiline.yml"
# Block scalar form: `remaining: |` then indented lines
if grep -q "^remaining: |$" "${src}" \
   && grep -q "^  line one$" "${src}" \
   && grep -q "^  line two$" "${src}" \
   && grep -q "^  line three$" "${src}"; then
  ok "multiline --partial uses block scalar form"
else
  fail "multiline --partial did not use block scalar:\n$(cat "${src}")"
fi

# And regen must successfully parse it (this was the core failure mode in P2 #4)
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  ok "regen parses block-scalar multiline remaining text without error"
else
  fail "regen failed on block-scalar multiline finding"
fi

# ---------------------------------------------------------------------------
# Test 18 (v0.6.3.1): regen rejects non-integer line values
# ---------------------------------------------------------------------------
note "Test 18 (v0.6.3.1): regen rejects line: <non-integer>"
new_fixture t18 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-x-bad-line.yml <<'YML'
id: t18a
rule: y
dimension: security
tier: HIGH
module: x
file: src/x.ts
line: not-a-number
title: t
fix: f
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/security-audit
status: open
YML
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  fail "regen should reject non-integer line, but succeeded"
else
  ok "regen rejects line: not-a-number"
fi

# ---------------------------------------------------------------------------
# Test 19 (v0.6.3.1): closed findings get required-field validation
# ---------------------------------------------------------------------------
note "Test 19 (v0.6.3.1): closed findings missing rule/module fail regen"
new_fixture t19 >/dev/null
mkdir -p .lattice/findings/closed/abcdefg
write_yaml .lattice/findings/closed/abcdefg/HIGH-corrupt.yml <<'YML'
closed_at: 2026-05-04T00:00:00Z
closed_by_commit: abcdefg
YML
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  fail "regen should reject closed YAML missing rule/module, but succeeded"
else
  ok "regen applies required-field validation to closed findings"
fi

# ---------------------------------------------------------------------------
# Test 20 (v0.6.4): tests:/simulate: block-lists parse + render through regen
# ---------------------------------------------------------------------------
note "Test 20 (v0.6.4): tests:/simulate: block-list YAML parses through regen"
new_fixture t20 >/dev/null
write_yaml .lattice/findings/open/2026-05-02/HIGH-lumi-onboarding.yml <<'YML'
id: t20a
rule: happy-path-incomplete
dimension: flow
tier: HIGH
module: lumi
file: src/modules/lumi/onboarding.ts
line: 42
title: "Onboarding consent step missing"
fix: "Add handler for consent response"
sweep_date: 2026-05-02
sweep_id: s
auditor: claude-code/flow-audit
status: open
impact: "Customer reaches continue button, nothing happens"
tests:
  - "First-time user sends 'hi' → consent message appears"
  - "User sends 'no' to consent → bot exits with explanation"
  - "User who already consented → consent skipped on return"
simulate:
  - "Send WhatsApp 'hi' from fresh test number"
  - "Admin tool: reset_user --phone +91XXX && send 'hi'"
YML
echo "# fixture" > CLAUDE.md
if bash "${REGEN}" --claude-md ./CLAUDE.md >/dev/null 2>&1; then
  if grep -q "happy-path-incomplete" CLAUDE.md \
     && grep -q "src/modules/lumi/onboarding.ts:42" CLAUDE.md; then
    ok "block-list tests:/simulate: YAML parses + renders through regen"
  else
    fail "regen did not render the block-list finding correctly"
  fi
else
  fail "regen failed on block-list YAML (parser broken)"
fi

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
