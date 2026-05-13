#!/usr/bin/env bash
# Lattice lifecycle test suite — v0.7 flat-layout regression coverage.
#
# Run locally:    bash scripts/test-lifecycle.sh
# CI runs it:     via scripts/validate.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LATTICE="${REPO_ROOT}/scripts/lattice"
MIGRATE="${REPO_ROOT}/scripts/migrate-v0.7.sh"
MANIFEST="${REPO_ROOT}/scripts/lattice-write-manifest.sh"

PASS=0
FAIL=0
FAILED_TESTS=()

note() { printf "[test] %s\n" "$*"; }
ok()   { printf "[test]   PASS: %s\n" "$*"; PASS=$((PASS + 1)); }
fail() { printf "[test]   FAIL: %s\n" "$*" >&2; FAIL=$((FAIL + 1)); FAILED_TESTS+=("$*"); }

ROOT_TMP="$(mktemp -d -t lattice-tests-XXXXXX)"
trap 'rm -rf "${ROOT_TMP}"' EXIT

new_fixture() {
  local name="$1"
  local dir="${ROOT_TMP}/${name}"
  mkdir -p "${dir}/.lattice/findings/open" "${dir}/.lattice/findings/closed"
  cd "${dir}"
  git init -q
  git config user.email test@test
  git config user.name test
  echo "fixture for ${name}" > README.md
  mkdir -p src
  echo "code" > src/x.ts
  git add README.md src/x.ts
  git commit -q -m "fixture"
}

write_yaml() {
  local path="$1" slug="$2" tier="${3:-MEDIUM}" dim="${4:-audit}"
  mkdir -p "$(dirname "${path}")"
  cat > "${path}" <<YML
id: ${slug}-id
rule: ${slug}
dimension: ${dim}
tier: ${tier}
module: mod
file: src/x.ts
line: 1
title: ${slug}
fix: fix it
sweep_date: 2026-05-11
sweep_id: sw1
auditor: claude-code/audit
status: open
YML
}

note "Test 1: close requires --reason for full closes"
new_fixture t1
write_yaml .lattice/findings/open/HIGH-close-reason.yml HIGH-close-reason HIGH
if "${LATTICE}" close HIGH-close-reason --commit abcdef1 >/dev/null 2>&1; then
  fail "close without --reason should fail"
else
  ok "close without --reason fails"
fi

note "Test 2: close accepts full YAML path and writes flat closed/<slug>.yml"
new_fixture t2
write_yaml .lattice/findings/open/LOW-full-path.yml LOW-full-path LOW
if "${LATTICE}" close .lattice/findings/open/LOW-full-path.yml --reason fixed --commit abcdef1 >/dev/null; then
  [ -f .lattice/findings/closed/LOW-full-path.yml ] && grep -q "^close_reason: fixed$" .lattice/findings/closed/LOW-full-path.yml \
    && ok "full YAML path accepted" || fail "close did not write flat closed YAML"
else
  fail "close full YAML path failed"
fi

note "Test 3: close substring ambiguity fails non-interactively"
new_fixture t3
write_yaml .lattice/findings/open/HIGH-alpha-payments-leak.yml alpha HIGH
write_yaml .lattice/findings/open/HIGH-beta-payments-leak.yml beta HIGH
if "${LATTICE}" close payments-leak --reason fixed --commit abcdef1 >/tmp/lattice-t3.out 2>&1; then
  fail "ambiguous substring should not close deterministic first"
else
  grep -q "matches 2 findings" /tmp/lattice-t3.out && ok "ambiguous substring rejected with choices" || fail "ambiguous substring error unclear"
fi

note "Test 4: multiline rationale and defer reason remain valid YAML"
new_fixture t4
write_yaml .lattice/findings/open/MEDIUM-rationale.yml rationale MEDIUM
"${LATTICE}" close MEDIUM-rationale --reason fixed --commit abcdef1 --rationale "$(printf 'line one\nline two')" >/dev/null
write_yaml .lattice/findings/open/MEDIUM-defer.yml defer MEDIUM
"${LATTICE}" defer MEDIUM-defer --until 2026-05-12 --reason "$(printf 'first\nsecond')" >/dev/null
if "${LATTICE}" validate >/tmp/lattice-t4.out 2>&1; then
  ok "multiline lifecycle fields parse"
else
  fail "multiline lifecycle fields broke YAML: $(cat /tmp/lattice-t4.out)"
fi

note "Test 5: verify --run strips YAML list quotes"
new_fixture t5
write_yaml .lattice/findings/open/LOW-verify.yml verify LOW
cat >> .lattice/findings/open/LOW-verify.yml <<'YML'
simulate:
  - "echo SAFE_VERIFY"
YML
if "${LATTICE}" verify LOW-verify --run >/tmp/lattice-t5.out 2>&1 && grep -q SAFE_VERIFY /tmp/lattice-t5.out; then
  ok "verify --run executes quoted simulate steps"
else
  fail "verify --run failed quoted simulate step: $(cat /tmp/lattice-t5.out)"
fi

note "Test 6: migrate-v0.7 keeps newer duplicate open finding"
new_fixture t6
rm -rf .lattice/findings/open .lattice/findings/closed
mkdir -p .lattice/findings/open/2026-05-01 .lattice/findings/open/2026-05-02 .lattice/findings/closed
write_yaml .lattice/findings/open/2026-05-01/HIGH-conflict.yml conflict HIGH
sed -i 's/title: conflict/title: older/' .lattice/findings/open/2026-05-01/HIGH-conflict.yml
sed -i 's/sweep_date: 2026-05-11/sweep_date: 2026-05-01/' .lattice/findings/open/2026-05-01/HIGH-conflict.yml
write_yaml .lattice/findings/open/2026-05-02/HIGH-conflict.yml conflict HIGH
sed -i 's/title: conflict/title: newer/' .lattice/findings/open/2026-05-02/HIGH-conflict.yml
sed -i 's/sweep_date: 2026-05-11/sweep_date: 2026-05-02/' .lattice/findings/open/2026-05-02/HIGH-conflict.yml
"${MIGRATE}" >/tmp/lattice-t6.out
grep -q "title: newer" .lattice/findings/open/HIGH-conflict.yml && ok "newer duplicate wins migration" || fail "migration did not keep newer duplicate"

note "Test 7: validate rejects legacy nested layout after v0.7"
new_fixture t7
rm -rf .lattice/findings/open
mkdir -p .lattice/findings/open/2026-05-11
write_yaml .lattice/findings/open/2026-05-11/LOW-legacy.yml legacy LOW
if "${LATTICE}" validate >/tmp/lattice-t7.out 2>&1; then
  fail "validate should reject legacy nested layout"
else
  grep -q "legacy nested" /tmp/lattice-t7.out && ok "legacy nested layout rejected" || fail "legacy nested error unclear"
fi

note "Test 8: ci-check catches missing file refs"
new_fixture t8
write_yaml .lattice/findings/open/LOW-missing-file.yml missing LOW
sed -i 's|file: src/x.ts|file: src/missing.ts|' .lattice/findings/open/LOW-missing-file.yml
if "${LATTICE}" ci-check --tier CRITICAL >/tmp/lattice-t8.out 2>&1; then
  fail "ci-check should fail missing file refs even when tier is low"
else
  grep -q "missing-file" /tmp/lattice-t8.out && ok "ci-check catches missing file refs" || fail "ci-check missing-file output unclear"
fi

note "Test 9: manifest writer creates sweeps data"
new_fixture t9
"${MANIFEST}" --sweep-id 20260511abcdef --sweep-date 2026-05-11 --modules mod --dimensions audit --duration-ms 5 --totals "LOW=1" --opened LOW-x --unchanged "" --closed-since-last "" --regressed "" --skipped 0 >/dev/null
"${LATTICE}" sweeps >/tmp/lattice-t9.out
if grep -q 20260511abcdef /tmp/lattice-t9.out; then
  ok "sweeps lists written manifest"
else
  fail "sweeps did not list written manifest"
fi

note "Test 10: usage logging and reports are local"
new_fixture t10
write_yaml .lattice/findings/open/LOW-usage.yml usage LOW
"${LATTICE}" list >/dev/null
"${LATTICE}" show LOW-usage >/dev/null
if [ -f .lattice/usage/events.jsonl ] && "${LATTICE}" usage --json | grep -q '"command": "show"'; then
  ok "usage events logged and reportable"
else
  fail "usage events missing or usage report broken"
fi

note "Test 11: config init and update check use version drift without applying"
new_fixture t11
"${LATTICE}" config init >/dev/null
"${LATTICE}" update --enable-auto >/dev/null
if grep -q "mode: auto" .lattice/config.yml \
   && LATTICE_TEST_LATEST_VERSION=9.9.9 "${LATTICE}" update --check >/tmp/lattice-t11.out 2>&1; then
  fail "update --check should return non-zero when an update is available"
else
  if grep -q "update available" /tmp/lattice-t11.out && grep -q "mode: auto" .lattice/config.yml; then
    ok "config auto mode and update drift check work"
  else
    fail "update drift output unclear: $(cat /tmp/lattice-t11.out 2>/dev/null || true)"
  fi
fi

note "Test 12: close \"\" rejects empty id (data-loss guard)"
new_fixture t12
write_yaml .lattice/findings/open/LOW-empty-arg.yml empty-arg LOW
if "${LATTICE}" close "" --reason fixed --commit abcdef1 >/tmp/lattice-t12.out 2>&1; then
  fail "close with empty id should not succeed"
else
  if [ -f .lattice/findings/open/LOW-empty-arg.yml ] && grep -q "empty arg\|is required" /tmp/lattice-t12.out; then
    ok "close empty id rejected, finding preserved"
  else
    fail "empty close did not surface error or destroyed finding: $(cat /tmp/lattice-t12.out)"
  fi
fi

note "Test 13: close --commit HEAD resolves through git rev-parse"
new_fixture t13
write_yaml .lattice/findings/open/LOW-head-ref.yml head-ref LOW
if "${LATTICE}" close LOW-head-ref --reason fixed --commit HEAD >/tmp/lattice-t13.out 2>&1; then
  if [ -f .lattice/findings/closed/LOW-head-ref.yml ] && grep -qE "^closed_by_commit: [0-9a-f]{7}$" .lattice/findings/closed/LOW-head-ref.yml; then
    ok "close --commit HEAD resolves to short SHA"
  else
    fail "close HEAD succeeded but YAML lacks short SHA"
  fi
else
  fail "close --commit HEAD rejected: $(cat /tmp/lattice-t13.out)"
fi

note "Test 14: close -> reopen -> close cycle with multi-line rationale keeps sync clean"
new_fixture t14
write_yaml .lattice/findings/open/MEDIUM-cycle.yml cycle MEDIUM
"${LATTICE}" close MEDIUM-cycle --reason wont-fix --rationale "$(printf 'line one\nline two: with colons')" --commit abcdef1 >/dev/null
"${LATTICE}" reopen MEDIUM-cycle --reason "regression test" >/dev/null
# Open YAML must NOT carry close lifecycle fields anymore
if grep -qE '^(close_reason|closure_rationale|closed_at|closed_by_commit)[[:space:]]*:' .lattice/findings/open/MEDIUM-cycle.yml; then
  fail "reopen left close lifecycle fields in open/ YAML"
fi
"${LATTICE}" close MEDIUM-cycle --reason fixed --commit fedcba1 >/dev/null
if "${LATTICE}" validate >/tmp/lattice-t14.out 2>&1; then
  ok "close -> reopen -> close YAML stays parseable"
else
  fail "validate failed after cycle: $(cat /tmp/lattice-t14.out)"
fi

note "Test 15: usage --global aggregates across projects"
new_fixture t15
# Force a clean global to avoid contamination from real local usage
export HOME="${ROOT_TMP}/t15-home"
mkdir -p "${HOME}/.claude/lattice/usage"
write_yaml .lattice/findings/open/LOW-global.yml global LOW
"${LATTICE}" list >/dev/null
"${LATTICE}" show LOW-global >/dev/null
if [ -f "${HOME}/.claude/lattice/usage/global.jsonl" ] \
   && "${LATTICE}" usage --global --json | grep -q '"command": "show"'; then
  ok "global usage aggregates across projects"
else
  fail "global usage aggregate missing or empty"
fi
unset HOME
export HOME="$(cd ~ && pwd)"

note "Test 16: close rejects whitespace-only id"
new_fixture t16
write_yaml .lattice/findings/open/LOW-whitespace.yml whitespace LOW
if "${LATTICE}" close "   " --reason fixed --commit abcdef1 >/tmp/lattice-t16.out 2>&1; then
  fail "close with whitespace-only id should fail"
else
  [ -f .lattice/findings/open/LOW-whitespace.yml ] && ok "whitespace id rejected, finding preserved" || fail "whitespace id close destroyed finding"
fi

note "Test 17: close rejects id with shell metachars (no injection)"
new_fixture t17
write_yaml .lattice/findings/open/LOW-shellsafe.yml shellsafe LOW
rm -f /tmp/lattice-pwned-t17
"${LATTICE}" close 'LOW-shellsafe; touch /tmp/lattice-pwned-t17' --reason fixed --commit abcdef1 >/dev/null 2>&1 || true
if [ -f /tmp/lattice-pwned-t17 ]; then
  rm -f /tmp/lattice-pwned-t17
  fail "SECURITY: shell injection via close id arg"
else
  ok "no shell injection via close id"
fi

note "Test 18: regen rejects BOM-prefixed yaml gracefully OR parses it"
new_fixture t18
printf '\xef\xbb\xbfrule: bom-test\nmodule: m\nfile: README.md\nline: 1\ntier: DRIFT\ndimension: audit\nid: bom-id\nstatus: open\n' > .lattice/findings/open/DRIFT-bom.yml
if "${LATTICE}" validate >/tmp/lattice-t18.out 2>&1; then
  ok "BOM-prefixed yaml parses (BOM stripped)"
else
  grep -q "BOM\|UTF-8" /tmp/lattice-t18.out && ok "BOM-prefixed yaml rejected with helpful message" || fail "BOM yaml failed cryptically: $(cat /tmp/lattice-t18.out)"
fi

note "Test 19: regen rejects invalid dimension"
new_fixture t19
write_yaml .lattice/findings/open/DRIFT-baddim.yml baddim DRIFT
sed -i 's/dimension: audit/dimension: made-up-thing/' .lattice/findings/open/DRIFT-baddim.yml
if "${LATTICE}" validate >/tmp/lattice-t19.out 2>&1; then
  fail "validate should reject invalid dimension"
else
  grep -q "dimension" /tmp/lattice-t19.out && ok "invalid dimension rejected" || fail "invalid dimension error unclear"
fi

note "Test 20: regen rejects non-integer line"
new_fixture t20
write_yaml .lattice/findings/open/DRIFT-badline.yml badline DRIFT
sed -i 's/line: 1/line: not-a-number/' .lattice/findings/open/DRIFT-badline.yml
if "${LATTICE}" validate >/tmp/lattice-t20.out 2>&1; then
  fail "validate should reject non-integer line"
else
  grep -q "line" /tmp/lattice-t20.out && ok "non-integer line rejected" || fail "non-integer line error unclear"
fi

note "Test 21: regen rejects negative line"
new_fixture t21
write_yaml .lattice/findings/open/DRIFT-negline.yml negline DRIFT
sed -i 's/line: 1/line: -5/' .lattice/findings/open/DRIFT-negline.yml
if "${LATTICE}" validate >/tmp/lattice-t21.out 2>&1; then
  fail "validate should reject negative line"
else
  ok "negative line rejected"
fi

note "Test 22: regen rejects empty yaml"
new_fixture t22
echo "" > .lattice/findings/open/DRIFT-empty.yml
if "${LATTICE}" validate >/tmp/lattice-t22.out 2>&1; then
  fail "validate should reject empty yaml"
else
  ok "empty yaml rejected"
fi

note "Test 23: regen tolerates markdown special chars in fields"
new_fixture t23
cat > .lattice/findings/open/DRIFT-md.yml <<'YML'
id: md-id
rule: md-test
module: mod
dimension: audit
tier: DRIFT
file: src/[weird](path).md
line: 1
title: has | pipe | and `backticks`
fix: PATCH_DOC replace `foo` with `bar`
sweep_date: 2026-05-11
sweep_id: sw1
auditor: test
status: open
YML
if "${LATTICE}" sync >/tmp/lattice-t23.out 2>&1; then
  if [ -f CLAUDE.md ] && grep -qF '\[weird\]' CLAUDE.md && grep -qF '\`foo\`' CLAUDE.md; then
    ok "markdown special chars escaped in output"
  else
    fail "markdown special chars not properly escaped: $(grep 'weird\|backticks' CLAUDE.md | head -2)"
  fi
else
  fail "sync failed on markdown special chars: $(cat /tmp/lattice-t23.out)"
fi

note "Test 24: regen rejects CLAUDE.md with duplicate start markers"
new_fixture t24
write_yaml .lattice/findings/open/LOW-dup.yml dup LOW
cat > CLAUDE.md <<'MD'
# Project
<!-- lattice:checklist:start -->
old block 1
<!-- lattice:checklist:end -->
filler
<!-- lattice:checklist:start -->
old block 2
<!-- lattice:checklist:end -->
MD
if "${LATTICE}" sync >/tmp/lattice-t24.out 2>&1; then
  fail "sync should refuse duplicate markers"
else
  grep -q "marker" /tmp/lattice-t24.out && ok "duplicate markers rejected" || fail "duplicate marker error unclear"
fi

note "Test 25: 5x close-reopen cycle preserves YAML integrity"
new_fixture t25
write_yaml .lattice/findings/open/LOW-cycle5.yml cycle5 LOW
CYCLE_OK=1
for i in 1 2 3 4 5; do
  "${LATTICE}" close LOW-cycle5 --reason fixed --commit abcdef1 --rationale "$(printf 'iter %s\nwith newline' "$i")" >/dev/null 2>&1 || CYCLE_OK=0
  "${LATTICE}" reopen LOW-cycle5 --reason "iter $i regress" >/dev/null 2>&1 || CYCLE_OK=0
done
if [ $CYCLE_OK -eq 1 ] && "${LATTICE}" validate >/tmp/lattice-t25.out 2>&1; then
  ok "5x cycle preserves YAML integrity"
else
  fail "5x cycle broke YAML: $(cat /tmp/lattice-t25.out 2>/dev/null)"
fi

note "Test 26: reopen rejects missing --reason"
new_fixture t26
write_yaml .lattice/findings/open/LOW-r1.yml r1 LOW
"${LATTICE}" close LOW-r1 --reason fixed --commit abcdef1 >/dev/null
if "${LATTICE}" reopen LOW-r1 >/tmp/lattice-t26.out 2>&1; then
  fail "reopen without --reason should fail"
else
  ok "reopen requires --reason"
fi

note "Test 27: lattice handoff produces brief with file/line"
new_fixture t27
write_yaml .lattice/findings/open/LOW-h.yml h LOW
if "${LATTICE}" handoff LOW-h >/tmp/lattice-t27.out 2>&1; then
  if grep -q "src/x.ts" /tmp/lattice-t27.out && grep -q ":1" /tmp/lattice-t27.out; then
    ok "handoff includes file:line"
  else
    fail "handoff missing file:line: $(cat /tmp/lattice-t27.out | head -5)"
  fi
else
  fail "handoff failed: $(cat /tmp/lattice-t27.out)"
fi

note "Test 28: id-gen is deterministic"
new_fixture t28
ID1=$("${LATTICE}" id-gen audit test-rule README.md "some code snippet" 2>&1)
ID2=$("${LATTICE}" id-gen audit test-rule README.md "some code snippet" 2>&1)
if [ "$ID1" = "$ID2" ] && [ ${#ID1} -ge 8 ]; then
  ok "id-gen deterministic (id=$ID1)"
else
  fail "id-gen non-deterministic: '$ID1' vs '$ID2'"
fi

note "Test 29: 100-finding regen perf"
new_fixture t29
for i in $(seq 1 100); do
  cat > ".lattice/findings/open/DRIFT-perf-$i.yml" <<YML
id: perf-$i
rule: perf
module: mod
dimension: audit
tier: DRIFT
file: src/x.ts
line: $i
title: perf-$i
fix: fix
sweep_date: 2026-05-11
sweep_id: sw1
auditor: test
status: open
YML
done
START_NS=$(date +%s%N 2>/dev/null || python -c "import time; print(int(time.time()*1e9))")
"${LATTICE}" sync >/dev/null 2>&1
END_NS=$(date +%s%N 2>/dev/null || python -c "import time; print(int(time.time()*1e9))")
DUR_MS=$(( (END_NS - START_NS) / 1000000 ))
echo "[test]   info: 100-finding sync = ${DUR_MS}ms"
if [ $DUR_MS -lt 10000 ]; then
  ok "100-finding regen under 10s (${DUR_MS}ms)"
else
  fail "100-finding regen too slow: ${DUR_MS}ms"
fi

note "Test 30: OK findings render under Acknowledged, not Open actionable (v0.7.7)"
new_fixture t30
write_yaml .lattice/findings/open/OK-confirmed-safe.yml confirmed-safe OK
write_yaml .lattice/findings/open/DRIFT-real-work.yml real-work DRIFT
"${LATTICE}" sync >/tmp/lattice-t30.out 2>&1
if [ -f CLAUDE.md ] \
   && grep -q "Open findings (1 actionable)" CLAUDE.md \
   && grep -q "## Acknowledged (1)" CLAUDE.md; then
  ok "OK findings filtered out of actionable count, shown under Acknowledged"
else
  fail "OK findings still in actionable section: $(grep -E '^## (Open findings|Acknowledged)' CLAUDE.md)"
fi

note "Test 31: lattice show accepts hex id from YAML (v0.7.7)"
new_fixture t31
write_yaml .lattice/findings/open/LOW-hex-lookup.yml hex-lookup LOW
# YAML's id field is "hex-lookup-id" per write_yaml. Use a real hex by overwriting.
sed -i 's/^id: hex-lookup-id$/id: a1b2c3d4e5f6/' .lattice/findings/open/LOW-hex-lookup.yml
if "${LATTICE}" show a1b2c3d4e5f6 >/tmp/lattice-t31.out 2>&1 && grep -q "hex-lookup" /tmp/lattice-t31.out; then
  ok "show <hex-id> resolves to slug"
else
  fail "show <hex-id> not found: $(cat /tmp/lattice-t31.out)"
fi

cd "${REPO_ROOT}"
echo
echo "[test] passed: ${PASS}"
echo "[test] failed: ${FAIL}"
if [ "${FAIL}" -ne 0 ]; then
  echo "[test] failed tests:" >&2
  for t in "${FAILED_TESTS[@]}"; do echo "  - ${t}" >&2; done
  exit 1
fi
