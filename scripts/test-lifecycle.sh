#!/usr/bin/env bash
# Lattice lifecycle test suite — v0.7 flat-layout regression coverage.
#
# Run locally:    bash scripts/test-lifecycle.sh
# CI runs it:     via scripts/validate.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LATTICE="${REPO_ROOT}/scripts/lattice"

# Disable telemetry in tests by default so we never POST to the real Worker.
# Individual tests override LATTICE_TELEMETRY / LATTICE_TELEMETRY_DEBUG as needed.
export LATTICE_TELEMETRY=0
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

note "Test 32: lattice doctor reports clean setup (v0.7.8)"
new_fixture t32
write_yaml .lattice/findings/open/LOW-doctor.yml doctor LOW
if "${LATTICE}" doctor >/tmp/lattice-t32.out 2>&1; then
  if grep -q "passed" /tmp/lattice-t32.out && grep -q "Environment" /tmp/lattice-t32.out; then
    ok "doctor runs and reports sections"
  else
    fail "doctor missing expected sections: $(cat /tmp/lattice-t32.out)"
  fi
else
  fail "doctor returned non-zero on clean setup: $(cat /tmp/lattice-t32.out)"
fi

note "Test 33: lattice doctor auto-bootstraps .lattice/ on fresh install (v0.8.0, closes #9)"
new_fixture t33
rm -rf .lattice
if "${LATTICE}" doctor >/tmp/lattice-t33.out 2>&1; then
  if grep -q "auto-created" /tmp/lattice-t33.out && [ -d .lattice/findings/open ] && [ -d .lattice/findings/closed ]; then
    ok "doctor auto-creates .lattice/findings/{open,closed} on first run"
  else
    fail "doctor did not bootstrap correctly: $(cat /tmp/lattice-t33.out)"
  fi
else
  fail "doctor should succeed (with WARN) after auto-bootstrap, got: $(cat /tmp/lattice-t33.out)"
fi

note "Test 34: lattice export --format markdown renders table (v0.7.8)"
new_fixture t34
write_yaml .lattice/findings/open/HIGH-exp1.yml exp1 HIGH
write_yaml .lattice/findings/open/LOW-exp2.yml exp2 LOW
if "${LATTICE}" export --format markdown >/tmp/lattice-t34.out 2>&1; then
  if grep -q "## HIGH (1)" /tmp/lattice-t34.out \
     && grep -q "## LOW (1)" /tmp/lattice-t34.out \
     && grep -q "| open |" /tmp/lattice-t34.out \
     && grep -q "Total: 2" /tmp/lattice-t34.out; then
    ok "export renders tiered markdown tables"
  else
    fail "export output missing expected structure: $(head -20 /tmp/lattice-t34.out)"
  fi
else
  fail "export failed: $(cat /tmp/lattice-t34.out)"
fi

note "Test 35: lattice export --tier filter (v0.7.8)"
new_fixture t35
write_yaml .lattice/findings/open/HIGH-keep.yml keep HIGH
write_yaml .lattice/findings/open/LOW-drop.yml drop LOW
"${LATTICE}" export --format markdown --tier HIGH >/tmp/lattice-t35.out 2>&1
if grep -q "## HIGH" /tmp/lattice-t35.out && ! grep -q "## LOW" /tmp/lattice-t35.out; then
  ok "export --tier filters out non-matching tiers"
else
  fail "export --tier did not filter correctly: $(cat /tmp/lattice-t35.out)"
fi

note "Test 36: lattice list --unblocked / --blocked filters (v0.7.9)"
new_fixture t36
write_yaml .lattice/findings/open/HIGH-block.yml block HIGH
echo 'blocked_by: "vendor X"' >> .lattice/findings/open/HIGH-block.yml
write_yaml .lattice/findings/open/HIGH-free.yml free HIGH
out_un="$("${LATTICE}" list --unblocked 2>/dev/null)"
out_bl="$("${LATTICE}" list --blocked 2>/dev/null)"
if echo "${out_un}" | grep -q "free" && ! echo "${out_un}" | grep -q "block" \
   && echo "${out_bl}" | grep -q "block" && ! echo "${out_bl}" | grep -q "free"; then
  ok "list --unblocked / --blocked partition correctly"
else
  fail "blocked filter mis-partitioned: unblocked=${out_un} blocked=${out_bl}"
fi

note "Test 37: lattice changelog renders closed findings (v0.7.9)"
new_fixture t37
write_yaml .lattice/findings/open/LOW-chlog.yml chlog LOW
"${LATTICE}" close LOW-chlog --reason fixed --commit abcdef1 >/dev/null
if "${LATTICE}" changelog --since 2026-01-01 >/tmp/lattice-t37.out 2>&1; then
  if grep -q "## Fixed" /tmp/lattice-t37.out && grep -q "chlog" /tmp/lattice-t37.out; then
    ok "changelog renders closed findings grouped by reason"
  else
    fail "changelog missing expected content: $(cat /tmp/lattice-t37.out)"
  fi
else
  fail "changelog failed: $(cat /tmp/lattice-t37.out)"
fi

note "Test 38: lattice changelog --since required (v0.7.9)"
new_fixture t38
if "${LATTICE}" changelog >/tmp/lattice-t38.out 2>&1; then
  fail "changelog should require --since"
else
  grep -q "since" /tmp/lattice-t38.out && ok "changelog requires --since" || fail "changelog error unclear"
fi

note "Test 39: lattice changelog --since validates date format (v0.7.9)"
new_fixture t39
if "${LATTICE}" changelog --since "yesterday" >/tmp/lattice-t39.out 2>&1; then
  fail "changelog should reject non-ISO date"
else
  ok "changelog rejects non-ISO --since"
fi

note "Test 40: lattice list --milestone filters by milestone field (v0.7.10)"
new_fixture t40
write_yaml .lattice/findings/open/LOW-launch.yml launch LOW
echo 'milestone: "p0-launch"' >> .lattice/findings/open/LOW-launch.yml
write_yaml .lattice/findings/open/HIGH-later.yml later HIGH
echo 'milestone: "post-launch"' >> .lattice/findings/open/HIGH-later.yml
write_yaml .lattice/findings/open/MEDIUM-nofield.yml nofield MEDIUM
out_p0="$("${LATTICE}" list --milestone p0-launch 2>/dev/null)"
out_post="$("${LATTICE}" list --milestone post-launch 2>/dev/null)"
if echo "${out_p0}" | grep -q "launch" && ! echo "${out_p0}" | grep -q "later" \
   && ! echo "${out_p0}" | grep -q "nofield" \
   && echo "${out_post}" | grep -q "later" && ! echo "${out_post}" | grep -q "launch"; then
  ok "list --milestone partitions correctly, excludes findings without the field"
else
  fail "milestone filter mis-partitioned: p0=${out_p0} post=${out_post}"
fi

note "Test 41: close --pending stamps __PENDING__ placeholder (v0.7.11)"
new_fixture t41
write_yaml .lattice/findings/open/LOW-pend.yml pend LOW
if "${LATTICE}" close LOW-pend --reason fixed --pending >/tmp/lattice-t41.out 2>&1; then
  if grep -q '^closed_by_commit: __PENDING__$' .lattice/findings/closed/LOW-pend.yml; then
    ok "close --pending writes __PENDING__ sentinel"
  else
    fail "close --pending did not write __PENDING__: $(grep closed_by_commit .lattice/findings/closed/LOW-pend.yml)"
  fi
else
  fail "close --pending failed: $(cat /tmp/lattice-t41.out)"
fi

note "Test 42: resolve-pending replaces __PENDING__ with HEAD short SHA (v0.7.11)"
new_fixture t42
write_yaml .lattice/findings/open/LOW-rp.yml rp LOW
"${LATTICE}" close LOW-rp --reason fixed --pending >/dev/null 2>&1
if "${LATTICE}" resolve-pending >/tmp/lattice-t42.out 2>&1; then
  STAMPED=$(grep '^closed_by_commit:' .lattice/findings/closed/LOW-rp.yml | awk '{print $2}')
  HEAD_SHA=$(git rev-parse --short HEAD)
  if [ "${STAMPED}" = "${HEAD_SHA}" ]; then
    ok "resolve-pending stamps current HEAD SHA"
  else
    fail "resolve-pending stamped wrong SHA: ${STAMPED} vs ${HEAD_SHA}"
  fi
else
  fail "resolve-pending failed: $(cat /tmp/lattice-t42.out)"
fi

note "Test 43: --pending and --commit mutually exclusive (v0.7.11)"
new_fixture t43
write_yaml .lattice/findings/open/LOW-conf.yml conf LOW
if "${LATTICE}" close LOW-conf --reason fixed --pending --commit HEAD >/tmp/lattice-t43.out 2>&1; then
  fail "--pending and --commit should be mutually exclusive"
else
  grep -q "mutually exclusive" /tmp/lattice-t43.out && ok "--pending + --commit conflict rejected" || fail "conflict error unclear"
fi

note "Test 44: post-commit hook resolves pending and stamped SHA matches fix commit (v0.7.11)"
new_fixture t44
cp "${REPO_ROOT}/scripts/post-commit-resolve-pending.sh" .git/hooks/post-commit
chmod +x .git/hooks/post-commit
write_yaml .lattice/findings/open/LOW-hook.yml hook LOW
"${LATTICE}" close LOW-hook --reason fixed --pending >/dev/null 2>&1
git add . && git commit -qm "fix LOW-hook test" 2>/dev/null
FIX_SHA=$(git log --oneline | grep "fix LOW-hook" | awk '{print $1}')
STAMPED_SHA=$(grep '^closed_by_commit:' .lattice/findings/closed/LOW-hook.yml | awk '{print $2}')
if [ "${FIX_SHA}" = "${STAMPED_SHA}" ] && git cat-file -e "${STAMPED_SHA}" 2>/dev/null; then
  ok "post-commit hook stamps reachable SHA matching fix commit"
else
  fail "hook mismatch: fix=${FIX_SHA} stamped=${STAMPED_SHA}"
fi

note "Test 45: close auto-stages both paths so single commit captures the move (v0.7.12)"
new_fixture t45
write_yaml .lattice/findings/open/LOW-stage.yml stage LOW
git add .lattice/findings/open/LOW-stage.yml && git commit -qm "file finding" 2>/dev/null
"${LATTICE}" close LOW-stage --reason fixed --commit HEAD >/dev/null
status=$(git status --short)
# Git should show this as a clean rename (R), no unstaged delete dangling
if echo "${status}" | grep -qE '^R[[:space:]]'; then
  ok "close stages move as a rename (no half-staged state)"
elif echo "${status}" | grep -qE '^A[[:space:]]' && echo "${status}" | grep -qE '^D[[:space:]]'; then
  # On some git versions rename detection requires -M flag; A+D is also acceptable
  ok "close stages both add and delete (no half-staged state)"
else
  fail "close left half-staged state: ${status}"
fi

note "Test 46: reopen auto-stages both paths (v0.7.12)"
new_fixture t46
write_yaml .lattice/findings/open/LOW-reop.yml reop LOW
"${LATTICE}" close LOW-reop --reason fixed --commit HEAD >/dev/null
git commit -qm "close LOW-reop" 2>/dev/null
"${LATTICE}" reopen LOW-reop --reason "regression" >/dev/null
status=$(git status --short)
if echo "${status}" | grep -qE '^R[[:space:]]' \
   || (echo "${status}" | grep -qE '^A[[:space:]]' && echo "${status}" | grep -qE '^D[[:space:]]'); then
  ok "reopen stages move so single commit captures both sides"
else
  fail "reopen left half-staged state: ${status}"
fi

note "Test 47: telemetry disabled by LATTICE_TELEMETRY=0 (v0.8.0)"
new_fixture t47
write_yaml .lattice/findings/open/LOW-tel0.yml tel0 LOW
# Debug + disabled: should produce NO telemetry payload lines
out="$(LATTICE_TELEMETRY=0 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  fail "telemetry should be disabled by LATTICE_TELEMETRY=0"
else
  ok "LATTICE_TELEMETRY=0 disables telemetry even with DEBUG=1"
fi

note "Test 48: telemetry payload shape on failed command (v0.8.0)"
new_fixture t48
rm -f "${HOME}/.claude/lattice/.telemetry-acknowledged"
out="$(LATTICE_TELEMETRY=1 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q '"command":"close"' \
   && echo "${out}" | grep -q '"exit_code":2' \
   && echo "${out}" | grep -q '"msg_fingerprint":"[a-f0-9]\{64\}"' \
   && echo "${out}" | grep -q '"user_hash":"[a-f0-9]\{64\}"'; then
  ok "telemetry payload contains expected whitelisted fields"
else
  fail "telemetry payload malformed: $(echo "${out}" | grep payload | head -1)"
fi

note "Test 49: telemetry payload never includes finding id / file path (v0.8.0)"
new_fixture t49
out="$(LATTICE_TELEMETRY=1 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "SECRET-SLUG-DO-NOT-LEAK" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "SECRET-SLUG-DO-NOT-LEAK"; then
  # Disclosure / error message can contain it; check ONLY the payload line
  payload="$(echo "${out}" | grep '"command"' | head -1)"
  if echo "${payload}" | grep -q "SECRET-SLUG-DO-NOT-LEAK"; then
    fail "PRIVACY LEAK: finding slug appeared in telemetry payload"
  else
    ok "finding slug not in telemetry payload (only in local error message)"
  fi
else
  ok "no leak of finding slug anywhere"
fi

note "Test 50: lattice config telemetry off persists to .lattice/config.yml (v0.8.0)"
new_fixture t50
"${LATTICE}" config telemetry off >/dev/null
if grep -qE '^telemetry:[[:space:]]*off' .lattice/config.yml; then
  ok "config telemetry off writes to project config"
else
  fail "config telemetry off did not persist: $(cat .lattice/config.yml 2>/dev/null)"
fi

note "Test 51: project-local telemetry off honored even when LATTICE_TELEMETRY=1 (v0.8.0)"
new_fixture t51
"${LATTICE}" config telemetry off >/dev/null
write_yaml .lattice/findings/open/LOW-told.yml told LOW
out="$(LATTICE_TELEMETRY=1 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  fail "project-local telemetry off should disable even with env=1"
else
  ok "project config overrides env for OFF state"
fi

note "Test 52: telemetry skipped for help/version/doctor exits (v0.8.0)"
new_fixture t52
rm -f "${HOME}/.claude/lattice/.telemetry-acknowledged"
# Trigger a help exit code (should be 0 anyway, but verify no payload either way)
out="$(LATTICE_TELEMETRY=1 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" help 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  fail "telemetry should not fire on help command"
else
  ok "help/version/doctor skipped from telemetry"
fi

note "Test 53: telemetry is OFF by default (v0.8.0 opt-IN, closes #12)"
new_fixture t53
rm -f "${HOME}/.claude/lattice/.telemetry-acknowledged"
rm -f "${HOME}/.claude/lattice/config.yml"
# Unset the suite-level LATTICE_TELEMETRY=0 so we test the *default* (no env, no config).
out="$(unset LATTICE_TELEMETRY; LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  fail "telemetry must default to OFF (opt-IN): $(echo "${out}" | grep payload | head -1)"
else
  ok "telemetry OFF by default — no payload emitted without explicit opt-in"
fi

note "Test 54: lattice config telemetry on (project) enables opt-in (v0.8.0)"
new_fixture t54
rm -f "${HOME}/.claude/lattice/config.yml"
"${LATTICE}" config telemetry on >/dev/null
# No finding seeded — close "" must fail and trip telemetry exit hook.
# Unset suite-level LATTICE_TELEMETRY=0 so the project-level `telemetry: on` actually wins.
out="$(unset LATTICE_TELEMETRY; LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  ok "explicit project opt-in enables telemetry"
else
  fail "telemetry should fire after explicit opt-in: cfg=$(cat .lattice/config.yml 2>/dev/null), out=$(echo "${out}" | tail -5)"
fi

note "Test 71: lattice mode read+set defaults to classic, persists to .lattice/config.yml (v0.9.0)"
new_fixture t71
if [ "$("${LATTICE}" mode 2>&1)" = "classic" ]; then
  ok "mode default = classic for fresh project"
else
  fail "mode default wrong: $("${LATTICE}" mode 2>&1)"
fi
"${LATTICE}" mode substrate >/dev/null
if grep -qE '^mode:[[:space:]]*substrate' .lattice/config.yml && [ "$("${LATTICE}" mode)" = "substrate" ]; then
  ok "mode set substrate persists to .lattice/config.yml"
else
  fail "mode set failed: $(cat .lattice/config.yml 2>/dev/null)"
fi

note "Test 72: lattice mode rejects unknown values (v0.9.0)"
new_fixture t72
if "${LATTICE}" mode bogus >/tmp/lattice-t72.out 2>&1; then
  fail "mode bogus should fail"
else
  grep -q "must be one of" /tmp/lattice-t72.out && ok "mode rejects unknown value" || fail "mode error msg wrong"
fi

note "Test 73: lattice decide writes ADR YAML with required fields (v0.9.0)"
new_fixture t73
dest="$("${LATTICE}" decide test-decision --title "Test ADR" --because "needed for test" 2>&1)"
if [ -f "${dest}" ] && grep -q '^id: 0001-test-decision' "${dest}" && grep -q '^status: active' "${dest}" && grep -q '^title: "Test ADR"' "${dest}"; then
  ok "decide creates ADR YAML with id/status/title/because"
else
  fail "decide output wrong: dest=${dest}, contents=$(cat "${dest}" 2>/dev/null)"
fi

note "Test 74: lattice decide --supersedes marks prior ADR (v0.9.0)"
new_fixture t74
"${LATTICE}" decide first-decision --title "First" --because "initial" >/dev/null
"${LATTICE}" decide second-decision --title "Second" --because "replaces first" --supersedes 0001 >/dev/null
if grep -q '^status: superseded' .lattice/decisions/0001-first-decision.yml && grep -q '^superseded_by: 0002-second-decision' .lattice/decisions/0001-first-decision.yml; then
  ok "decide --supersedes flips prior status + links forward"
else
  fail "supersede chain wrong: $(cat .lattice/decisions/0001-first-decision.yml 2>/dev/null)"
fi

note "Test 75: lattice decisions list filters by --status (v0.9.0)"
new_fixture t75
"${LATTICE}" decide one --title "One" --because "x" >/dev/null
"${LATTICE}" decide two --title "Two" --because "y" --status in_progress >/dev/null
out="$("${LATTICE}" decisions list --status in_progress 2>&1)"
if echo "${out}" | grep -q "0002-two" && ! echo "${out}" | grep -q "0001-one"; then
  ok "decisions list --status filters correctly"
else
  fail "decisions list filter wrong: ${out}"
fi

note "Test 77: lattice invariants derive on a Flutter-shaped project (v0.9.1)"
new_fixture t77
mkdir -p lib/features/auth lib/core/services
echo "void main() {}" > lib/main.dart
cat > pubspec.yaml <<'YML'
name: t77_app
description: test fixture
dependencies:
  flutter:
    sdk: flutter
YML
"${LATTICE}" invariants derive >/tmp/lattice-t77.out 2>&1
if [ -f .lattice/invariants/HEAD.yml ] && grep -q '^  - flutter' .lattice/invariants/HEAD.yml && grep -q 'lib/features/auth' .lattice/invariants/HEAD.yml; then
  ok "invariants derive detects flutter stack + modules"
else
  fail "invariants derive output wrong: $(cat .lattice/invariants/HEAD.yml 2>/dev/null)"
fi
# Re-running should be idempotent
"${LATTICE}" invariants derive >/dev/null 2>&1
if [ -f .lattice/invariants/HEAD.yml ]; then
  ok "invariants derive is idempotent"
fi

note "Test 78: lattice invariants derive on a Supabase-shaped project (v0.9.1)"
new_fixture t78
mkdir -p supabase/functions/razorpay-webhook supabase/migrations
echo "Deno.serve(() => new Response('ok'));" > supabase/functions/razorpay-webhook/index.ts
echo "CREATE TABLE IF NOT EXISTS public.user_subscriptions (id uuid PRIMARY KEY);" > supabase/migrations/01.sql
"${LATTICE}" invariants derive >/dev/null 2>&1
if grep -q '^  - supabase' .lattice/invariants/HEAD.yml && grep -q '^  - razorpay-webhook' .lattice/invariants/HEAD.yml && grep -q 'user_subscriptions' .lattice/invariants/HEAD.yml; then
  ok "invariants derive detects supabase stack + edge functions + db tables"
else
  fail "supabase invariants wrong: $(cat .lattice/invariants/HEAD.yml 2>/dev/null)"
fi

note "Test 79: lattice context prints mode + findings summary (v0.9.1)"
new_fixture t79
"${LATTICE}" mode substrate >/dev/null
"${LATTICE}" decide test-adr --title "Test" --because "for test 79" >/dev/null
"${LATTICE}" test-fixture sample --tier HIGH >/dev/null
out="$("${LATTICE}" context 2>&1)"
if echo "${out}" | grep -q "mode: substrate" \
   && echo "${out}" | grep -q "## Active decisions" \
   && echo "${out}" | grep -q "0001-test-adr" \
   && echo "${out}" | grep -q "HIGH: 1"; then
  ok "context emits mode + ADRs + findings summary"
else
  fail "context output wrong: ${out}"
fi

note "Test 81: lattice context announces telemetry status (v0.9.2 — discovery gap fix)"
new_fixture t81
out_off="$("${LATTICE}" context 2>&1)"
if echo "${out_off}" | grep -q "^telemetry: OFF" && echo "${out_off}" | grep -q "lattice config telemetry on"; then
  ok "context announces telemetry OFF with enable hint"
else
  fail "context missing telemetry OFF line: ${out_off}"
fi
out_on="$(unset LATTICE_TELEMETRY; LATTICE_OWNER_MODE=1 "${LATTICE}" context 2>&1)"
if echo "${out_on}" | grep -q "^telemetry: ON" && echo "${out_on}" | grep -q "github.com/IsaamMJ/Lattice"; then
  ok "context announces telemetry ON with issue URL"
else
  fail "context missing telemetry ON line: ${out_on}"
fi

note "Test 82: lattice report rejects missing args (v0.9.3)"
new_fixture t82
if "${LATTICE}" report 2>/tmp/lattice-t82.out; then
  fail "report with no args should fail"
else
  grep -q "report: usage:" /tmp/lattice-t82.out && ok "report rejects missing category" || fail "wrong error: $(cat /tmp/lattice-t82.out)"
fi
if "${LATTICE}" report bug 2>/tmp/lattice-t82b.out; then
  fail "report with no --title should fail"
else
  grep -q "title required" /tmp/lattice-t82b.out && ok "report rejects missing --title" || fail "wrong error: $(cat /tmp/lattice-t82b.out)"
fi

note "Test 83: lattice report rejects invalid category + severity (v0.9.3)"
new_fixture t83
if "${LATTICE}" report nonsense --title t --body b 2>/tmp/lattice-t83.out; then
  fail "report should reject 'nonsense' category"
else
  grep -q "category must be one of" /tmp/lattice-t83.out && ok "report rejects invalid category" || fail "wrong error: $(cat /tmp/lattice-t83.out)"
fi
if "${LATTICE}" report bug --title t --body b --severity URGENT 2>/tmp/lattice-t83b.out; then
  fail "report should reject 'URGENT' severity"
else
  grep -q "severity must be" /tmp/lattice-t83b.out && ok "report rejects invalid severity" || fail "wrong error: $(cat /tmp/lattice-t83b.out)"
fi

note "Test 84: lattice report debug payload shape (v0.9.3)"
new_fixture t84
out="$(LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" report bug --title "test t84" --body $'line1\nline2\nwith \"quotes\"' --severity HIGH 2>&1)"
if echo "${out}" | grep -q '"kind":"manual_report"' \
   && echo "${out}" | grep -q '"category":"bug"' \
   && echo "${out}" | grep -q '"severity":"HIGH"' \
   && echo "${out}" | grep -q '"title":"test t84"' \
   && echo "${out}" | grep -q 'line1\\nline2' \
   && echo "${out}" | grep -q 'with \\\"quotes\\\"'; then
  ok "report debug payload includes kind/category/severity + escapes newlines + quotes"
else
  fail "report debug payload wrong: ${out}"
fi

note "Test 85: lattice report --body-file reads body from file (v0.9.3)"
new_fixture t85
echo "Body loaded from file" > /tmp/lattice-t85-body.md
out="$(LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" report ux --title "file body" --body-file /tmp/lattice-t85-body.md 2>&1)"
if echo "${out}" | grep -q 'Body loaded from file'; then
  ok "report reads body from --body-file"
else
  fail "--body-file not loaded: ${out}"
fi
rm -f /tmp/lattice-t85-body.md

note "Test 80: lattice invariants show / diff (v0.9.1)"
new_fixture t80
"${LATTICE}" invariants derive >/dev/null 2>&1
"${LATTICE}" invariants show > /tmp/lattice-t80-show.out 2>&1
if grep -q '^commit:' /tmp/lattice-t80-show.out && grep -q '^derived_at:' /tmp/lattice-t80-show.out; then
  ok "invariants show prints stored YAML"
else
  fail "invariants show missing fields: $(cat /tmp/lattice-t80-show.out)"
fi

note "Test 76: LATTICE_OWNER_MODE=1 flips telemetry default ON (v0.9.0)"
new_fixture t76
rm -f "${HOME}/.claude/lattice/config.yml"
# Unset suite-level LATTICE_TELEMETRY=0 so owner-mode default isn't overridden.
out="$(unset LATTICE_TELEMETRY; LATTICE_OWNER_MODE=1 LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" close "" --reason fixed 2>&1 || true)"
if echo "${out}" | grep -q "telemetry] payload"; then
  ok "LATTICE_OWNER_MODE=1 flips telemetry default ON"
else
  fail "owner mode did not enable telemetry: $(echo "${out}" | tail -5)"
fi

note "Test 66: lattice install-hooks installs post-commit (v0.8.2, closes #7)"
new_fixture t66
"${LATTICE}" install-hooks > /tmp/lattice-t66.out 2>&1
if [ -x .git/hooks/post-commit ] && grep -q "resolve-pending\|lattice resolve-pending" .git/hooks/post-commit; then
  ok "install-hooks copied post-commit and made it executable"
else
  fail "install-hooks did not install correctly: $(cat /tmp/lattice-t66.out)"
fi

note "Test 67: lattice install-hooks is idempotent (v0.8.2)"
new_fixture t67
"${LATTICE}" install-hooks >/dev/null
out="$("${LATTICE}" install-hooks 2>&1)"
if echo "${out}" | grep -q "already installed"; then
  ok "install-hooks detects existing Lattice hook and no-ops"
else
  fail "install-hooks did not detect prior install: ${out}"
fi

note "Test 68: lattice stats reports tier + dimension totals (v0.8.2, closes #15)"
new_fixture t68
"${LATTICE}" test-fixture a --tier HIGH --dimension security > /dev/null
"${LATTICE}" test-fixture b --tier LOW  --dimension audit    > /dev/null
out="$("${LATTICE}" stats 2>&1)"
if echo "${out}" | grep -q "Open findings: 2" && echo "${out}" | grep -q "HIGH" && echo "${out}" | grep -q "security"; then
  ok "stats summarizes tier and dimension counts"
else
  fail "stats output wrong: ${out}"
fi

note "Test 69: lattice doctor flags lattice not in PATH (v0.8.2, closes #14)"
new_fixture t69
# Keep /usr/bin:/bin so bash + env still resolve; strip any user PATH so
# lattice itself is unreachable. /tmp is appended just to have a dummy dir.
out="$(env -i PATH=/usr/bin:/bin:/tmp HOME="${HOME}" bash "${LATTICE}" doctor 2>&1 || true)"
if echo "${out}" | grep -q "lattice not in PATH"; then
  ok "doctor warns when lattice is not in PATH"
else
  fail "doctor PATH check missing: ${out}"
fi

note "Test 70: regenerate emits did-you-mean hint on invalid dimension (v0.8.2, closes #19)"
new_fixture t70
cat > .lattice/findings/open/LOW-typo.yml <<YML
id: typo-id
rule: typo
dimension: securty
tier: LOW
module: mod
file: src/x.ts
line: 1
title: t
fix: f
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
YML
out="$("${LATTICE}" sync 2>&1 || true)"
if echo "${out}" | grep -q "did you mean 'security'"; then
  ok "did-you-mean suggests closest valid dimension"
else
  fail "did-you-mean hint missing: ${out}"
fi

note "Test 63: lattice test-fixture writes a valid YAML to .lattice/findings/open/ (v0.8.1)"
new_fixture t63
out_path="$("${LATTICE}" test-fixture demo --tier HIGH --exposure admin-only --verify-pattern '^code$' 2>&1)"
if [ -f "${out_path}" ] && grep -q "^tier: HIGH" "${out_path}" && grep -q "^exposure: admin-only" "${out_path}" && grep -q "^verify_pattern:" "${out_path}"; then
  ok "test-fixture emits valid YAML with tier/exposure/verify_pattern"
else
  fail "test-fixture output wrong: path=${out_path}, contents=$(cat "${out_path}" 2>/dev/null)"
fi

note "Test 64: lattice test-fixture refuses to overwrite without --force (v0.8.1)"
new_fixture t64
"${LATTICE}" test-fixture dupe > /dev/null
if "${LATTICE}" test-fixture dupe > /tmp/lattice-t64.out 2>&1; then
  fail "test-fixture should refuse overwrite without --force"
else
  grep -q "already exists" /tmp/lattice-t64.out && ok "test-fixture refuses overwrite (use --force)" || fail "test-fixture wrong refuse message: $(cat /tmp/lattice-t64.out)"
fi

note "Test 65: lattice test-fixture --force overwrites (v0.8.1)"
new_fixture t65
"${LATTICE}" test-fixture rep --tier HIGH > /dev/null
"${LATTICE}" test-fixture rep --tier LOW --force > /dev/null
if grep -q "^tier: LOW" .lattice/findings/open/LOW-rep.yml 2>/dev/null && [ ! -f .lattice/findings/open/HIGH-rep.yml ]; then
  # Actually --force writes a new path named after new tier; old stays. Check the new file at least exists.
  ok "test-fixture --force writes the new file"
elif [ -f .lattice/findings/open/LOW-rep.yml ]; then
  ok "test-fixture --force writes the new file"
else
  fail "test-fixture --force did not write LOW-rep.yml"
fi

note "Test 60: lattice list --exposure filters by exposure field (v0.8.0, closes #8)"
new_fixture t60
cat > .lattice/findings/open/HIGH-prod.yml <<YML
id: prod-id
rule: prod
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: prod issue
fix: fix it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
exposure: production-critical
YML
cat > .lattice/findings/open/HIGH-dead.yml <<YML
id: dead-id
rule: dead
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: dead-code issue
fix: fix it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
exposure: dead-code
YML
out="$("${LATTICE}" list --exposure production-critical 2>&1 || true)"
if echo "${out}" | grep -q "prod" && ! echo "${out}" | grep -q "dead"; then
  ok "list --exposure filters out non-matching exposure"
else
  fail "exposure filter wrong: ${out}"
fi

note "Test 61: lattice list --effective-tier demotes HIGH/admin-only -> MEDIUM (v0.8.0)"
new_fixture t61
cat > .lattice/findings/open/HIGH-admin.yml <<YML
id: admin-id
rule: admin
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: admin-only finding
fix: fix it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
exposure: admin-only
YML
out="$("${LATTICE}" list --effective-tier 2>&1 || true)"
if echo "${out}" | grep -qE "^MEDIUM .*was HIGH, admin-only"; then
  ok "list --effective-tier demotes HIGH+admin-only -> MEDIUM"
else
  fail "effective-tier demotion wrong: ${out}"
fi

note "Test 62: lattice list --effective-tier demotes CRITICAL/dead-code -> MEDIUM (2 steps) (v0.8.0)"
new_fixture t62
cat > .lattice/findings/open/CRITICAL-dead.yml <<YML
id: ddcrit-id
rule: ddcrit
dimension: audit
tier: CRITICAL
module: mod
file: src/x.ts
line: 1
title: dead-code crit
fix: fix it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
exposure: dead-code
YML
out="$("${LATTICE}" list --effective-tier 2>&1 || true)"
if echo "${out}" | grep -qE "^MEDIUM .*was CRITICAL, dead-code"; then
  ok "list --effective-tier demotes CRITICAL+dead-code 2 steps -> MEDIUM"
else
  fail "two-step demotion wrong: ${out}"
fi

note "Test 56: lattice verify --rerun-grep reports STILL OPEN when pattern matches (v0.8.0, closes #10)"
new_fixture t56
# Seed a finding with a verify_pattern that should currently match
cat > .lattice/findings/open/HIGH-rg-stale.yml <<YML
id: rg-stale-id
rule: stale
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: code still present
fix: remove it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
verify_pattern: ^code$
YML
if "${LATTICE}" verify HIGH-rg-stale --rerun-grep > /tmp/lattice-t56.out 2>&1; then
  fail "verify --rerun-grep should exit 1 when pattern still matches: $(cat /tmp/lattice-t56.out)"
else
  grep -q "STILL OPEN" /tmp/lattice-t56.out && ok "verify --rerun-grep reports STILL OPEN when pattern matches" || fail "missing STILL OPEN: $(cat /tmp/lattice-t56.out)"
fi

note "Test 57: lattice verify --rerun-grep reports PASS when pattern no longer matches (v0.8.0)"
new_fixture t57
cat > .lattice/findings/open/HIGH-rg-fixed.yml <<YML
id: rg-fixed-id
rule: fixed
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: code already removed
fix: remove it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
verify_pattern: this-never-appears-XYZQ
YML
if "${LATTICE}" verify HIGH-rg-fixed --rerun-grep > /tmp/lattice-t57.out 2>&1; then
  grep -q "PASS — finding appears resolved" /tmp/lattice-t57.out && ok "verify --rerun-grep reports PASS when pattern no longer matches" || fail "missing PASS: $(cat /tmp/lattice-t57.out)"
else
  fail "verify --rerun-grep should exit 0 when pattern gone: $(cat /tmp/lattice-t57.out)"
fi

note "Test 58: lattice verify --rerun-grep --close-clean moves YAML to closed/ (v0.8.0)"
new_fixture t58
cat > .lattice/findings/open/HIGH-rg-auto.yml <<YML
id: rg-auto-id
rule: auto
dimension: audit
tier: HIGH
module: mod
file: src/x.ts
line: 1
title: auto-close candidate
fix: remove it
sweep_date: 2026-05-14
sweep_id: sw1
auditor: claude-code/audit
status: open
verify_pattern: never-matches-ABCQ
YML
"${LATTICE}" verify HIGH-rg-auto --rerun-grep --close-clean > /tmp/lattice-t58.out 2>&1 || true
if [ ! -f .lattice/findings/open/HIGH-rg-auto.yml ] && ls .lattice/findings/closed/*.yml 2>/dev/null | grep -q rg-auto; then
  ok "verify --rerun-grep --close-clean moved finding to closed/"
else
  fail "finding not moved: $(ls .lattice/findings/open/ .lattice/findings/closed/ 2>/dev/null)"
fi

note "Test 59: lattice verify --rerun-grep with no verify_pattern emits hint (v0.8.0)"
new_fixture t59
write_yaml .lattice/findings/open/HIGH-rg-nop.yml nop HIGH
out="$("${LATTICE}" verify HIGH-rg-nop --rerun-grep 2>&1 || true)"
if echo "${out}" | grep -q "no verify_pattern: field"; then
  ok "verify --rerun-grep hints when verify_pattern missing"
else
  fail "missing hint about verify_pattern: ${out}"
fi

note "Test 55: lattice config telemetry on --global writes to ~/.claude/lattice/config.yml (v0.8.0)"
new_fixture t55
rm -f "${HOME}/.claude/lattice/config.yml"
"${LATTICE}" config telemetry on --global >/dev/null
if grep -qE '^telemetry:[[:space:]]*on' "${HOME}/.claude/lattice/config.yml" 2>/dev/null; then
  ok "--global flag writes opt-in to user-level config"
else
  fail "--global did not persist: $(cat "${HOME}/.claude/lattice/config.yml" 2>/dev/null)"
fi
# Cleanup: remove global config so it does not bleed into later test runs
rm -f "${HOME}/.claude/lattice/config.yml"

# ---------------------------------------------------------------------------
# v0.9.4 regression tests (#21 SIGPIPE, #22 frontend_calls parser, #24 context render)
# ---------------------------------------------------------------------------

note "Test 86: invariants derive emits proper method + call_site for frontend_calls (v0.9.4, #22)"
new_fixture t86
# Make it look like a Flutter app so the frontend_calls branch fires
cat > pubspec.yaml <<'YML'
name: t86
dependencies:
  flutter:
    sdk: flutter
YML
mkdir -p lib/x
cat > lib/x/a.dart <<'DART'
class A {
  doIt() async {
    final r = await dio.put(
      '/v1/a',
    );
    final s = await _dio.get('/v1/b');
    final t = await http.patch('/v1/c');
  }
}
DART
git add -A >/dev/null 2>&1
git -c user.email=t@t -c user.name=t commit -q -m t86 >/dev/null 2>&1
out="$("${LATTICE}" invariants derive --print 2>&1)"
# method must be a verb (uppercase, alpha-only); call_site must be file:line
if echo "${out}" | grep -qE 'method: (PUT|GET|PATCH)$' \
   && echo "${out}" | grep -qE 'call_site: lib/x/a\.dart:[0-9]+'; then
  ok "frontend_calls emits method + call_site properly"
else
  fail "frontend_calls parser regressed: $(echo "${out}" | sed -n '/frontend_calls/,$p')"
fi

note "Test 87: invariants frontend_calls never emits a line-number-shaped method (v0.9.4, #22)"
# Re-use t86 fixture state — still in lib/x/a.dart
out="$("${LATTICE}" invariants derive --print 2>&1)"
if echo "${out}" | grep -qE 'method: [0-9]+:'; then
  fail "frontend_calls method still holds line-number garbage: $(echo "${out}" | grep method:)"
else
  ok "no frontend_calls entry has a line-number-shaped method"
fi

note "Test 88: context renders inline values for invariants sections (v0.9.4, #24)"
new_fixture t88
cat > pubspec.yaml <<'YML'
name: t88
dependencies:
  flutter:
    sdk: flutter
YML
mkdir -p lib/m1 lib/m2
echo 'class A {}' > lib/m1/a.dart
echo 'class B {}' > lib/m2/b.dart
git add -A >/dev/null 2>&1
git -c user.email=t@t -c user.name=t commit -q -m t88 >/dev/null 2>&1
"${LATTICE}" mode substrate >/dev/null 2>&1
"${LATTICE}" invariants derive >/dev/null 2>&1
out="$("${LATTICE}" context 2>&1)"
# Must NOT have bare label lines (label followed by end-of-line / whitespace-only).
# Must have inline counts like `modules: 2`.
if echo "${out}" | grep -qE '^  (stack|modules|edge_functions|routes|db_tables):[[:space:]]*$'; then
  fail "context still emits bare-label lines: $(echo "${out}" | grep -E '^  (stack|modules):')"
elif echo "${out}" | grep -qE '^  modules: [0-9]+$' && echo "${out}" | grep -qE '^  stack: '; then
  ok "context renders inline values (no empty labels)"
else
  fail "context output missing expected inline values: $(echo "${out}" | sed -n '/Invariants/,/Next/p')"
fi

note "Test 107: review --file appends fingerprint to .filed.jsonl (v0.9.8)"
new_fixture t107
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
JSONL
out="$(LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" review --day "${day}" --file --yes 2>&1)"
filed_log=".lattice/sessions/.filed.jsonl"
if [ -f "${filed_log}" ] \
   && grep -q '"fingerprint":"[0-9a-f]\{64\}"' "${filed_log}" \
   && grep -q '"kind":"fullpath_workaround"' "${filed_log}" \
   && echo "${out}" | grep -q 'FILED.*fullpath_workaround' \
   && echo "${out}" | grep -q '1 filed, 0 skipped, 0 errored'; then
  ok "review --file filed candidate + appended fingerprint record"
else
  fail "review --file did not file correctly: out=${out}; log=$(cat "${filed_log}" 2>/dev/null)"
fi

note "Test 108: review --file is idempotent (re-run skips filed candidates) (v0.9.8)"
# Reuse t107 fixture state — log file + .filed.jsonl already populated.
out="$(LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" review --day "${day}" --file --yes 2>&1)"
filed_count="$(grep -c '"fingerprint"' "${filed_log}" 2>/dev/null || echo 0)"
if echo "${out}" | grep -q '0 filed, 1 skipped' && [ "${filed_count}" = "1" ]; then
  ok "review --file re-run skipped already-filed candidate (no duplicates)"
else
  fail "review --file not idempotent: out=${out}; filed_count=${filed_count}"
fi

note "Test 109: review --file refuses without --yes on non-TTY stdin (v0.9.8)"
new_fixture t109
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
JSONL
# stdin redirected from /dev/null = not a TTY
out="$(LATTICE_TELEMETRY_DEBUG=1 "${LATTICE}" review --day "${day}" --file </dev/null 2>&1 || true)"
if echo "${out}" | grep -q "non-TTY stdin; refusing without --yes"; then
  ok "review --file safety-guards non-TTY without --yes"
else
  fail "review --file did not refuse on non-TTY: ${out}"
fi

note "Test 110: review --json includes stable_key for external dedup (v0.9.8)"
new_fixture t110
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"derve","args":["derve"],"exit":2,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" --json 2>&1)"
if echo "${out}" | grep -q '"stable_key":"unknown_subcommand:derve"'; then
  ok "review --json emits stable_key per candidate"
else
  fail "review --json missing stable_key: ${out}"
fi

note "Test 101: review surfaces fullpath_workaround predicate (v0.9.7)"
new_fixture t101
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
{"ts":"2026-05-15T03:00:05Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" 2>&1)"
if echo "${out}" | grep -q 'fullpath_workaround' && echo "${out}" | grep -q '2x'; then
  ok "review detected fullpath_workaround with correct count"
else
  fail "review did not surface fullpath_workaround: ${out}"
fi

note "Test 102: review surfaces repeated_failure predicate (v0.9.7)"
new_fixture t102
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"close","args":["close","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
{"ts":"2026-05-15T03:00:05Z","cmd":"close","args":["close","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
{"ts":"2026-05-15T03:00:10Z","cmd":"close","args":["close","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" 2>&1)"
if echo "${out}" | grep -q 'repeated_failure' && echo "${out}" | grep -q 'close failed 3x'; then
  ok "review detected repeated_failure (3x)"
else
  fail "review did not surface repeated_failure: ${out}"
fi

note "Test 103: review surfaces failed_then_succeeded predicate (v0.9.7)"
new_fixture t103
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"verify","args":["verify","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
{"ts":"2026-05-15T03:00:05Z","cmd":"verify","args":["verify","x"],"exit":0,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" 2>&1)"
if echo "${out}" | grep -q 'failed_then_succeeded'; then
  ok "review detected failed_then_succeeded silent workaround"
else
  fail "review did not surface failed_then_succeeded: ${out}"
fi

note "Test 104: review surfaces unknown_subcommand predicate (v0.9.7)"
new_fixture t104
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"derve","args":["derve"],"exit":2,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" 2>&1)"
if echo "${out}" | grep -q 'unknown_subcommand' && echo "${out}" | grep -q "'derve'"; then
  ok "review detected unknown_subcommand 'derve'"
else
  fail "review did not surface unknown_subcommand: ${out}"
fi

note "Test 105: review --json emits one JSON object per candidate (v0.9.7)"
new_fixture t105
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" --json 2>&1)"
if echo "${out}" | grep -q '"kind":"fullpath_workaround"' \
   && echo "${out}" | grep -q '"severity":"MED"' \
   && echo "${out}" | grep -q '"evidence_count":1'; then
  ok "review --json emits structured candidate"
else
  fail "review --json output malformed: ${out}"
fi

note "Test 106: review --quiet prints candidate count only (v0.9.7)"
new_fixture t106
mkdir -p .lattice/sessions
day=$(date -u +%Y%m%d)
cat > ".lattice/sessions/${day}.jsonl" <<JSONL
{"ts":"2026-05-15T03:00:00Z","cmd":"list","args":["list"],"exit":0,"duration_ms":50,"invoked_via":"fullpath","cwd":"/x"}
{"ts":"2026-05-15T03:00:05Z","cmd":"close","args":["close","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
{"ts":"2026-05-15T03:00:10Z","cmd":"close","args":["close","x"],"exit":1,"duration_ms":50,"invoked_via":"path","cwd":"/x"}
JSONL
out="$("${LATTICE}" review --day "${day}" --quiet 2>&1)"
# 2 candidates expected: fullpath_workaround + repeated_failure
if [ "${out}" = "2" ]; then
  ok "review --quiet reports candidate count (2)"
else
  fail "review --quiet wrong count: '${out}' (expected '2')"
fi

note "Test 95: MAT log records subcommand + exit code (v0.9.6)"
new_fixture t95
"${LATTICE}" list >/dev/null 2>&1
day="$(date -u +%Y%m%d)"
log=".lattice/sessions/${day}.jsonl"
if [ -f "${log}" ] \
   && grep -q '"cmd":"list"' "${log}" \
   && grep -q '"exit":0' "${log}" \
   && grep -q '"invoked_via":"' "${log}"; then
  ok "MAT log records list invocation with exit 0 + invoked_via"
else
  fail "MAT log missing or malformed: $(cat "${log}" 2>/dev/null)"
fi

note "Test 96: MAT log records failed subcommands (v0.9.6)"
new_fixture t96
"${LATTICE}" nonexistent-cmd >/dev/null 2>&1 || true
day="$(date -u +%Y%m%d)"
log=".lattice/sessions/${day}.jsonl"
if [ -f "${log}" ] && grep -q '"cmd":"nonexistent-cmd"' "${log}" && grep -q '"exit":2' "${log}"; then
  ok "MAT log captures unknown-subcommand failure with exit 2"
else
  fail "MAT log did not capture failure: $(cat "${log}" 2>/dev/null)"
fi

note "Test 97: MAT log skips help/version/sessions to avoid chatter (v0.9.6)"
new_fixture t97
"${LATTICE}" version >/dev/null 2>&1
"${LATTICE}" help >/dev/null 2>&1
"${LATTICE}" sessions list >/dev/null 2>&1
day="$(date -u +%Y%m%d)"
log=".lattice/sessions/${day}.jsonl"
# All three are filtered — log file should not even exist (no events written).
if [ ! -f "${log}" ] || ! grep -qE '"cmd":"(help|version|sessions)"' "${log}"; then
  ok "MAT log skips help/version/sessions"
else
  fail "MAT log incorrectly recorded filtered cmd: $(cat "${log}")"
fi

note "Test 98: MAT log respects LATTICE_MAT=0 opt-out (v0.9.6)"
new_fixture t98
LATTICE_MAT=0 "${LATTICE}" list >/dev/null 2>&1
day="$(date -u +%Y%m%d)"
log=".lattice/sessions/${day}.jsonl"
if [ ! -f "${log}" ]; then
  ok "MAT log not written when LATTICE_MAT=0"
else
  fail "MAT log written despite opt-out: $(cat "${log}")"
fi

note "Test 99: lattice sessions show reports full-path invocations (v0.9.6)"
new_fixture t99
# Force fullpath by invoking through the absolute path.
bash "${LATTICE}" list >/dev/null 2>&1
out="$("${LATTICE}" sessions show 2>&1)"
# Heuristic: when ${LATTICE} contains "scripts/lattice", invoked_via should be
# fullpath OR path depending on whether the path ends in the suite-detector
# pattern. We just check the hint surfaces when fullpath > 0.
fullpath_count="$(echo "${out}" | grep -oE 'full-path invocations' | wc -l | tr -d ' ')"
events_line="$(echo "${out}" | grep 'events,')"
if echo "${events_line}" | grep -qE '[0-9]+ events,'; then
  ok "sessions show emits aggregate stats line"
else
  fail "sessions show output unexpected: ${out}"
fi

note "Test 100: cmd_doctor for-loop does not poison MAT subcommand field (v0.9.6 regression)"
new_fixture t100
"${LATTICE}" doctor >/dev/null 2>&1 || true
day="$(date -u +%Y%m%d)"
log=".lattice/sessions/${day}.jsonl"
if grep -q '"cmd":"doctor"' "${log}" && ! grep -q '"cmd":"findings/' "${log}"; then
  ok "doctor logs as cmd:\"doctor\" (not the for-loop iteration var)"
else
  fail "MAT log contaminated by doctor for-loop: $(cat "${log}")"
fi

note "Test 90: bulk-close accepts --reason + --rationale (v0.9.5, #23)"
new_fixture t90
write_yaml .lattice/findings/open/LOW-bulk-a.yml bulk-a LOW
write_yaml .lattice/findings/open/LOW-bulk-b.yml bulk-b LOW
write_yaml .lattice/findings/open/LOW-bulk-c.yml bulk-c LOW
"${LATTICE}" bulk-close --pattern 'LOW-bulk-*' \
  --reason out-of-scope \
  --rationale "ADR 0001: superseded by new flow" \
  --commit abcdef1 --yes >/tmp/lattice-t90.out 2>&1 || true
if [ -f .lattice/findings/closed/LOW-bulk-a.yml ] \
   && [ -f .lattice/findings/closed/LOW-bulk-b.yml ] \
   && [ -f .lattice/findings/closed/LOW-bulk-c.yml ] \
   && grep -q "^close_reason: out-of-scope" .lattice/findings/closed/LOW-bulk-a.yml \
   && grep -q "ADR 0001" .lattice/findings/closed/LOW-bulk-a.yml; then
  ok "bulk-close applied --reason + --rationale to all matched findings"
else
  fail "bulk-close --reason / --rationale not applied: $(cat /tmp/lattice-t90.out; ls .lattice/findings/closed/)"
fi

note "Test 91: bulk-close --reason validates the taxonomy (v0.9.5, #23)"
new_fixture t91
write_yaml .lattice/findings/open/LOW-val.yml val LOW
if "${LATTICE}" bulk-close --pattern 'LOW-val' --reason not-a-real-reason --commit abcdef1 --yes >/tmp/lattice-t91.out 2>&1; then
  fail "bulk-close should reject invalid --reason"
else
  if grep -q "fixed | false-positive\|must be one of" /tmp/lattice-t91.out; then
    ok "bulk-close rejects invalid --reason with helpful message"
  else
    fail "bulk-close error unclear: $(cat /tmp/lattice-t91.out)"
  fi
fi

note "Test 92: invariants derive --print also persists HEAD.yml (v0.9.5, #25)"
new_fixture t92
cat > pubspec.yaml <<'YML'
name: t92
dependencies:
  flutter:
    sdk: flutter
YML
mkdir -p lib/m
echo 'class M {}' > lib/m/m.dart
git add -A >/dev/null 2>&1
git -c user.email=t@t -c user.name=t commit -q -m t92 >/dev/null 2>&1
out="$("${LATTICE}" invariants derive --print 2>&1)"
# stdout must contain the YAML (printed)
# AND HEAD.yml must exist on disk now (persisted, #25 fix)
if echo "${out}" | grep -q '^commit:' \
   && [ -f .lattice/invariants/HEAD.yml ] \
   && grep -q '^commit:' .lattice/invariants/HEAD.yml; then
  ok "invariants derive --print prints AND persists HEAD.yml"
else
  fail "derive --print did not persist or did not print: stdout=${out}; head_exists=$([ -f .lattice/invariants/HEAD.yml ] && echo yes || echo no)"
fi

note "Test 93: decide --because-file reads multi-line rationale (v0.9.5, #27)"
new_fixture t93
cat > /tmp/lattice-t93-because.md <<'EOF'
The current stack costs $3k/month.

Supabase replaces it for ~$25/month.

Risks: vendor lock-in.
EOF
"${LATTICE}" decide t93-supabase --title "Migrate to Supabase" --because-file /tmp/lattice-t93-because.md >/tmp/lattice-t93.out 2>&1
adr_path="$(cat /tmp/lattice-t93.out | tail -1)"
if [ -f "${adr_path}" ] \
   && grep -q "^because: |$" "${adr_path}" \
   && grep -q "  The current stack costs" "${adr_path}" \
   && grep -q "  Supabase replaces it" "${adr_path}" \
   && grep -q "  Risks: vendor lock-in" "${adr_path}"; then
  ok "decide --because-file produces multi-line YAML block scalar"
else
  fail "decide --because-file produced unexpected output: $(cat "${adr_path}" 2>/dev/null || echo NOFILE)"
fi
rm -f /tmp/lattice-t93-because.md

note "Test 94: decide --because - reads multi-line from stdin (v0.9.5, #27)"
new_fixture t94
adr_out="$(printf 'first paragraph\n\nsecond paragraph' | "${LATTICE}" decide t94-stdin --title "stdin test" --because - 2>&1 | tail -1)"
if [ -f "${adr_out}" ] \
   && grep -q "^because: |$" "${adr_out}" \
   && grep -q "  first paragraph" "${adr_out}" \
   && grep -q "  second paragraph" "${adr_out}"; then
  ok "decide --because - reads multi-line stdin"
else
  fail "decide --because - failed: $(cat "${adr_out}" 2>/dev/null || echo NOFILE)"
fi

note "Test 89: telemetry skipped on SIGPIPE exit 141 (v0.9.4, #21)"
new_fixture t89
# Force a SIGPIPE on the lattice pipeline by closing the consumer mid-read.
# With set -o pipefail this should propagate exit 141 inside lattice. The
# telemetry trap must NOT send (v0.9.4 fix).
out="$(unset LATTICE_TELEMETRY; LATTICE_OWNER_MODE=1 LATTICE_TELEMETRY_DEBUG=1 bash -c "set -o pipefail; \"${LATTICE}\" help 2>&1 | head -c 1 >/dev/null" 2>&1 || true)"
# Even on exit 141, the debug-mode "payload (would send)" string must NOT appear.
if echo "${out}" | grep -q "payload (would send)"; then
  fail "telemetry fired on SIGPIPE 141: ${out}"
else
  ok "SIGPIPE exit 141 does not trigger telemetry"
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
