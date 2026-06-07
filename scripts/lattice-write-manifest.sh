#!/usr/bin/env bash
# lattice-write-manifest — write a sweep manifest YAML to .lattice/findings/sweeps/<sweep_id>.yml
#
# Usage:
#   bash scripts/lattice-write-manifest.sh \
#     --sweep-id <id> --sweep-date <YYYY-MM-DD> --project-root <path> \
#     --modules "<csv>" --dimensions "<csv>" --mode SEQUENTIAL|PARALLEL \
#     --auditor <string> --auditor-model <opus|sonnet|haiku> \
#     --duration-ms <int> --totals "<KEY=n,...>" \
#     --opened "<csv>" --unchanged "<csv>" \
#     --closed-since-last "<csv>" --regressed "<csv>" \
#     --skipped <int> [--warnings "<line1>|<line2>"]
#
# All --opened/--unchanged/--closed-since-last/--regressed values are comma-separated slug lists.
# --warnings entries are pipe-separated.
#
# Exits 0 on success, 2 on missing required args.

set -euo pipefail

SWEEP_ID="" SWEEP_DATE="" PROJECT_ROOT="." MODULES="" DIMENSIONS=""
MODE="SEQUENTIAL" AUDITOR="claude-code/audit-sweep" AUDITOR_MODEL="sonnet"
DURATION_MS=0 TOTALS="" OPENED="" UNCHANGED="" CLOSED_SINCE="" REGRESSED=""
SKIPPED=0 WARNINGS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sweep-id)          SWEEP_ID="$2"; shift 2 ;;
    --sweep-date)        SWEEP_DATE="$2"; shift 2 ;;
    --project-root)      PROJECT_ROOT="$2"; shift 2 ;;
    --modules)           MODULES="$2"; shift 2 ;;
    --dimensions)        DIMENSIONS="$2"; shift 2 ;;
    --mode)              MODE="$2"; shift 2 ;;
    --auditor)           AUDITOR="$2"; shift 2 ;;
    --auditor-model)     AUDITOR_MODEL="$2"; shift 2 ;;
    --duration-ms)       DURATION_MS="$2"; shift 2 ;;
    --totals)            TOTALS="$2"; shift 2 ;;
    --opened)            OPENED="$2"; shift 2 ;;
    --unchanged)         UNCHANGED="$2"; shift 2 ;;
    --closed-since-last) CLOSED_SINCE="$2"; shift 2 ;;
    --regressed)         REGRESSED="$2"; shift 2 ;;
    --skipped)           SKIPPED="$2"; shift 2 ;;
    --warnings)          WARNINGS="$2"; shift 2 ;;
    *) echo "[lattice-write-manifest] error: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -z "${SWEEP_ID}" ]   && { echo "[lattice-write-manifest] error: --sweep-id required" >&2; exit 2; }
[ -z "${SWEEP_DATE}" ] && { echo "[lattice-write-manifest] error: --sweep-date required" >&2; exit 2; }

mkdir -p ".lattice/findings/sweeps"
OUT=".lattice/findings/sweeps/${SWEEP_ID}.yml"

# Convert comma-separated list to YAML inline list: [a, b, c]
csv_to_yaml_list() {
  local csv="$1"
  if [ -z "${csv}" ]; then
    echo "[]"
    return
  fi
  local IFS=',' items=()
  read -ra items <<< "${csv}"
  local out="["
  local first=1
  for item in "${items[@]}"; do
    item="${item// /}"
    [ -z "${item}" ] && continue
    [ "${first}" -eq 0 ] && out="${out}, "
    out="${out}${item}"
    first=0
  done
  out="${out}]"
  echo "${out}"
}

# Convert pipe-separated warnings to YAML block list lines
pipe_to_warnings() {
  local w="$1"
  if [ -z "${w}" ]; then
    echo "  []"
    return
  fi
  local IFS='|' lines=()
  read -ra lines <<< "${w}"
  for line in "${lines[@]}"; do
    line="${line# }"; line="${line% }"
    [ -z "${line}" ] && continue
    local esc; esc="${line//\"/\\\"}"
    echo "  - \"${esc}\""
  done
}

# Parse totals: CRITICAL=2,HIGH=3,...
declare -A TOTAL_MAP
TOTAL_MAP=([CRITICAL]=0 [HIGH]=0 [MEDIUM]=0 [LOW]=0 [BLOCKER]=0 [RISK]=0 [WATCH]=0 [DRIFT]=0 [INTENTIONAL]=0 [UNVERIFIABLE]=0 [OK]=0)
if [ -n "${TOTALS}" ]; then
  IFS=',' read -ra PAIRS <<< "${TOTALS}"
  for pair in "${PAIRS[@]}"; do
    local_key="${pair%%=*}"
    local_val="${pair##*=}"
    TOTAL_MAP["${local_key}"]="${local_val}"
  done
fi

WARNINGS_YAML="$(pipe_to_warnings "${WARNINGS}")"

cat > "${OUT}" <<YAML
sweep_id: ${SWEEP_ID}
sweep_date: ${SWEEP_DATE}
project_root: ${PROJECT_ROOT}
modules_audited: $(csv_to_yaml_list "${MODULES}")
dimensions: $(csv_to_yaml_list "${DIMENSIONS}")
mode: ${MODE}
auditor: ${AUDITOR}
auditor_model: ${AUDITOR_MODEL}
duration_ms: ${DURATION_MS}

totals:
  CRITICAL: ${TOTAL_MAP[CRITICAL]}
  HIGH: ${TOTAL_MAP[HIGH]}
  MEDIUM: ${TOTAL_MAP[MEDIUM]}
  LOW: ${TOTAL_MAP[LOW]}
  BLOCKER: ${TOTAL_MAP[BLOCKER]}
  RISK: ${TOTAL_MAP[RISK]}
  WATCH: ${TOTAL_MAP[WATCH]}
  DRIFT: ${TOTAL_MAP[DRIFT]}
  INTENTIONAL: ${TOTAL_MAP[INTENTIONAL]}
  UNVERIFIABLE: ${TOTAL_MAP[UNVERIFIABLE]}
  OK: ${TOTAL_MAP[OK]}

opened: $(csv_to_yaml_list "${OPENED}")
unchanged: $(csv_to_yaml_list "${UNCHANGED}")
closed_since_last: $(csv_to_yaml_list "${CLOSED_SINCE}")
regressed: $(csv_to_yaml_list "${REGRESSED}")

skipped: ${SKIPPED}
runtime_warnings:
${WARNINGS_YAML}
YAML

echo "[lattice-write-manifest] wrote ${OUT}"
