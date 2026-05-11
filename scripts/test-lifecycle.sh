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

cd "${REPO_ROOT}"
echo
echo "[test] passed: ${PASS}"
echo "[test] failed: ${FAIL}"
if [ "${FAIL}" -ne 0 ]; then
  echo "[test] failed tests:" >&2
  for t in "${FAILED_TESTS[@]}"; do echo "  - ${t}" >&2; done
  exit 1
fi
