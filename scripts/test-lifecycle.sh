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

cd "${REPO_ROOT}"
echo
echo "[test] passed: ${PASS}"
echo "[test] failed: ${FAIL}"
if [ "${FAIL}" -ne 0 ]; then
  echo "[test] failed tests:" >&2
  for t in "${FAILED_TESTS[@]}"; do echo "  - ${t}" >&2; done
  exit 1
fi
