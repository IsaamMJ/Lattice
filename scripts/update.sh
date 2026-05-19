#!/usr/bin/env bash
# Lattice update — pulls latest commands + helper scripts + schema docs from main branch
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/update.sh | bash
#
# Safe to run repeatedly. Mirrors install.sh's full set so commands and scripts stay in sync.

set -euo pipefail

RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep" "flow-audit" "lattice-fix" "close")
SCRIPTS=("lattice" "lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "lattice-write-manifest.sh" "migrate.sh" "migrate-status.sh" "migrate-v0.7.sh" "lattice-completion.bash" "lattice-completion.zsh" "prepare-commit-msg.sh" "post-commit-resolve-pending.sh" "lattice-statusline.mjs" "lattice-session-start.mjs")
DOCS=("finding-schema.md" "methodology.md" "contract-format.md")

DEST="${HOME}/.claude/commands"
SCRIPT_DEST="${HOME}/.claude/lattice/scripts"
DOC_DEST="${HOME}/.claude/lattice/docs"

if [ ! -d "${DEST}" ]; then
  echo "[lattice] no install found at ${DEST} — run install.sh first" >&2
  exit 1
fi

fetch() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${out}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${out}" "${url}"
  else
    echo "[lattice] error: need curl or wget" >&2
    exit 1
  fi
}

mkdir -p "${SCRIPT_DEST}" "${DOC_DEST}"

PREV="$(cat "${HOME}/.claude/lattice/VERSION" 2>/dev/null || echo "unknown")"
echo "[lattice] previously installed: ${PREV}"

echo "[lattice] updating commands"
for cmd in "${COMMANDS[@]}"; do
  echo "[lattice]   commands/${cmd}.md"
  fetch "${RAW}/commands/${cmd}.md" "${DEST}/${cmd}.md"
done

echo "[lattice] updating helper scripts"
for s in "${SCRIPTS[@]}"; do
  echo "[lattice]   scripts/${s}"
  fetch "${RAW}/scripts/${s}" "${SCRIPT_DEST}/${s}"
  chmod +x "${SCRIPT_DEST}/${s}" 2>/dev/null || true
done

echo "[lattice] updating schema docs"
for d in "${DOCS[@]}"; do
  if fetch "${RAW}/docs/${d}" "${DOC_DEST}/${d}" 2>/dev/null; then
    echo "[lattice]   docs/${d}"
  else
    echo "[lattice]   docs/${d} (skipped — not present in repo)"
  fi
done

# v1.0.4: refresh the MCP server source (mcp/) so users with `lattice mcp
# setup` wired don't end up running a stale dist/index.js after update.
MCP_DEST="${HOME}/.claude/lattice/mcp"
MCP_FILES=("package.json" "tsconfig.json" "src/index.ts")
echo "[lattice] updating MCP server source (mcp/)"
mkdir -p "${MCP_DEST}/src" 2>/dev/null || true
mcp_ok=1
for f in "${MCP_FILES[@]}"; do
  if fetch "${RAW}/mcp/${f}" "${MCP_DEST}/${f}" 2>/dev/null; then
    echo "[lattice]   mcp/${f}"
  else
    echo "[lattice]   mcp/${f} (skipped — pre-MCP version or fetch failed)"
    mcp_ok=0
  fi
done

# Rebuild MCP dist/ if all source files landed AND node is available.
# If anything's missing we leave the existing dist/index.js alone.
if [ "${mcp_ok}" = "1" ] && command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  if [ ! -d "${MCP_DEST}/node_modules" ]; then
    echo "[lattice] mcp: installing deps (first-time)"
    ( cd "${MCP_DEST}" && npm install --silent 2>&1 ) | sed 's/^/[lattice]   /'
  fi
  echo "[lattice] mcp: rebuilding dist/"
  ( cd "${MCP_DEST}" && npx --yes tsc 2>&1 ) | sed 's/^/[lattice]   /' || \
    echo "[lattice]   WARN: mcp build failed — \`lattice mcp\` may use stale dist/"
elif [ "${mcp_ok}" = "1" ]; then
  echo "[lattice] mcp: node/npm missing — skipped build (run \`lattice mcp build\` later)"
fi

# Refresh the Windows .cmd shim (#46 from v1.0.1). Only when on MSYS/Cygwin.
# install.sh creates this on first install; update.sh keeps it pointing at the
# current SCRIPT_DEST after upgrades to/from versions that didn't drop it.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    SHIM_DIR=""
    for candidate in "${HOME}/bin" "${HOME}/.local/bin" "${HOME}/.local/lattice/bin"; do
      if [ -d "${candidate}" ] && [ -f "${candidate}/lattice" ]; then
        SHIM_DIR="${candidate}"; break
      fi
    done
    if [ -n "${SHIM_DIR}" ]; then
      CMD_SHIM="${SHIM_DIR}/lattice.cmd"
      cat > "${CMD_SHIM}" <<'CMDWRAPPER'
@echo off
setlocal
set "BASH_EXE="
for /f "delims=" %%i in ('where bash 2^>nul') do (
  if not defined BASH_EXE set "BASH_EXE=%%i"
)
if not defined BASH_EXE if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not defined BASH_EXE if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\bin\bash.exe"
if not defined BASH_EXE (
  echo [lattice] ERROR: bash.exe not found. Install Git for Windows.>&2
  exit /b 1
)
"%BASH_EXE%" "__SCRIPT_DEST__/lattice" %*
endlocal
CMDWRAPPER
      sed -i.bak "s#__SCRIPT_DEST__#${SCRIPT_DEST}#g" "${CMD_SHIM}" 2>/dev/null || true
      rm -f "${CMD_SHIM}.bak" 2>/dev/null || true
      echo "[lattice] Windows .cmd wrapper refreshed at ${CMD_SHIM} (#46)"
    fi
    ;;
esac

VERSION="$(curl -fsSL "${RAW}/.claude-plugin/plugin.json" 2>/dev/null | grep -oE '"version"\s*:\s*"[^"]+"' | head -n1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/' || echo "unknown")"
printf "%s\n" "${VERSION}" > "${HOME}/.claude/lattice/VERSION"

echo ""
echo "[lattice] updated ${#COMMANDS[@]} commands + ${#SCRIPTS[@]} scripts + ${#DOCS[@]} docs."
echo "[lattice] ${PREV} -> ${VERSION}"

# v0.7.7: detect project-local copy of scripts/ in CWD. Projects sometimes
# pin a copy (e.g. jiive-backend keeps scripts/lattice next to its source) —
# these get stale because update.sh only writes to ${SCRIPT_DEST}. Offer to
# sync them, but don't force — pinning may be intentional.
if [ -d "./scripts" ] && [ -f "./scripts/lattice" ]; then
  echo ""
  echo "[lattice] detected project-local ./scripts/lattice in $(pwd)."
  echo "[lattice] update.sh only refreshed the global install at ${SCRIPT_DEST}."
  if [ "${LATTICE_SYNC_PROJECT_LOCAL:-0}" = "1" ]; then
    echo "[lattice] LATTICE_SYNC_PROJECT_LOCAL=1 — syncing project-local copies"
    for s in "${SCRIPTS[@]}"; do
      if [ -f "./scripts/${s}" ]; then
        cp "${SCRIPT_DEST}/${s}" "./scripts/${s}"
        chmod +x "./scripts/${s}" 2>/dev/null || true
        echo "[lattice]   synced ./scripts/${s}"
      fi
    done
  else
    echo "[lattice] to sync them too: LATTICE_SYNC_PROJECT_LOCAL=1 bash scripts/update.sh"
    echo "[lattice] (or leave pinned if that's intentional)"
  fi
fi

echo "[lattice] restart Claude Code to pick up command changes."
