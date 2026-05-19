#!/usr/bin/env bash
# Lattice install — copies command files + helper scripts + schema docs
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

set -euo pipefail

REPO="https://github.com/IsaamMJ/Lattice"
RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep" "flow-audit" "lattice-fix" "close")
SCRIPTS=("lattice" "lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "lattice-write-manifest.sh" "migrate.sh" "migrate-status.sh" "migrate-v0.7.sh" "lattice-completion.bash" "lattice-completion.zsh" "prepare-commit-msg.sh" "post-commit-resolve-pending.sh" "lattice-statusline.mjs" "lattice-session-start.mjs")
DOCS=("finding-schema.md" "methodology.md" "contract-format.md")

DEST="${HOME}/.claude/commands"
SCRIPT_DEST="${HOME}/.claude/lattice/scripts"
DOC_DEST="${HOME}/.claude/lattice/docs"

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

mkdir -p "${DEST}" "${SCRIPT_DEST}" "${DOC_DEST}"

echo "[lattice] installing commands to ${DEST}"
for cmd in "${COMMANDS[@]}"; do
  echo "[lattice]   commands/${cmd}.md"
  fetch "${RAW}/commands/${cmd}.md" "${DEST}/${cmd}.md"
done

echo "[lattice] installing helper scripts to ${SCRIPT_DEST}"
for s in "${SCRIPTS[@]}"; do
  echo "[lattice]   scripts/${s}"
  fetch "${RAW}/scripts/${s}" "${SCRIPT_DEST}/${s}"
  chmod +x "${SCRIPT_DEST}/${s}" 2>/dev/null || true
done

echo "[lattice] installing schema docs to ${DOC_DEST}"
for d in "${DOCS[@]}"; do
  # methodology + contract-format are optional — don't fail if absent in repo
  if fetch "${RAW}/docs/${d}" "${DOC_DEST}/${d}" 2>/dev/null; then
    echo "[lattice]   docs/${d}"
  else
    echo "[lattice]   docs/${d} (skipped — not present in repo yet)"
  fi
done

# Version sentinel — lets `lattice --version` (and update.sh) report what's installed
mkdir -p "${HOME}/.claude/lattice"
VERSION="$(curl -fsSL "${RAW}/.claude-plugin/plugin.json" 2>/dev/null | grep -oE '"version"\s*:\s*"[^"]+"' | head -n1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/' || echo "unknown")"
printf "%s\n" "${VERSION}" > "${HOME}/.claude/lattice/VERSION"
echo "[lattice] version sentinel: ${VERSION}"

echo ""
echo "[lattice] installed ${#COMMANDS[@]} commands + ${#SCRIPTS[@]} scripts + ${#DOCS[@]} docs."
echo ""
echo "[lattice] restart Claude Code to load commands, then try:"
echo "[lattice]   /audit-sweep ."
echo ""
echo "[lattice] CLI dispatcher (v0.9.17) installed at:"
echo "[lattice]   ${SCRIPT_DEST}/lattice"
echo ""

# v0.9.18 (#37): pick a shim dir already on PATH so the current shell sees
# `lattice` immediately (no "open a new shell" step). Falls back to
# ~/.local/bin if nothing on PATH is a writable personal-bin dir, and updates
# rc files for the next shell. Wrapper-or-symlink choice unchanged from v0.8.3.
SHIM_DIR=""
for candidate in "${HOME}/bin" "${HOME}/.local/bin" "${HOME}/.local/lattice/bin"; do
  case ":${PATH}:" in
    *":${candidate}:"*)
      if [ -d "${candidate}" ] && [ -w "${candidate}" ]; then
        SHIM_DIR="${candidate}"; break
      fi
      ;;
  esac
done
# No on-PATH writable personal-bin? Fall back to ~/.local/bin and we'll wire
# rc files below (next-shell behavior).
if [ -z "${SHIM_DIR}" ]; then
  SHIM_DIR="${HOME}/.local/bin"
fi
SHIM_PATH="${SHIM_DIR}/lattice"
mkdir -p "${SHIM_DIR}" 2>/dev/null || true

shim_ok=0
shim_kind=""
if [ -L "${SHIM_PATH}" ] && [ "$(readlink "${SHIM_PATH}" 2>/dev/null)" = "${SCRIPT_DEST}/lattice" ]; then
  shim_ok=1; shim_kind="existing symlink"
elif [ -f "${SHIM_PATH}" ] && grep -q "${SCRIPT_DEST}/lattice" "${SHIM_PATH}" 2>/dev/null; then
  shim_ok=1; shim_kind="existing wrapper"
else
  # Try a real symlink first; fall back to a tiny exec wrapper if symlink fails.
  if ln -sfn "${SCRIPT_DEST}/lattice" "${SHIM_PATH}" 2>/dev/null; then
    shim_ok=1; shim_kind="symlink"
  else
    cat > "${SHIM_PATH}" <<WRAPPER
#!/usr/bin/env bash
exec bash "${SCRIPT_DEST}/lattice" "\$@"
WRAPPER
    chmod +x "${SHIM_PATH}" 2>/dev/null || true
    [ -x "${SHIM_PATH}" ] && { shim_ok=1; shim_kind="wrapper script"; }
  fi
fi

if [ "${shim_ok}" -eq 1 ]; then
  echo "[lattice] shim installed at ${SHIM_PATH} (${shim_kind})"
else
  echo "[lattice] WARN: could not install shim at ${SHIM_PATH} — fall back to manual alias:"
  echo "[lattice]   alias lattice=\"${SCRIPT_DEST}/lattice\""
fi

# v1.0.1 (#46): on Windows, also drop a .cmd wrapper so `lattice` works in
# PowerShell + cmd.exe (not just Git Bash). Detect Windows via uname output;
# msys/mingw/cygwin all match. The .cmd resolves bash.exe at runtime via
# `where bash` so it works whether the user installed Git for Windows in the
# default location or a custom one.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
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
    # Patch the SCRIPT_DEST path into the .cmd (sed -i for portability).
    sed -i.bak "s#__SCRIPT_DEST__#${SCRIPT_DEST}#g" "${CMD_SHIM}" 2>/dev/null || true
    rm -f "${CMD_SHIM}.bak" 2>/dev/null || true
    echo "[lattice] Windows .cmd wrapper installed at ${CMD_SHIM} (#46)"

    # Check if SHIM_DIR is on the Windows-side User PATH. PowerShell + cmd.exe
    # read $env:PATH from the Windows registry, NOT from Git Bash's $PATH.
    # Translate /c/Users/Jahir/bin -> C:\Users\Jahir\bin for comparison.
    win_shim_dir="$(cygpath -w "${SHIM_DIR}" 2>/dev/null || echo "${SHIM_DIR}")"
    win_user_path="$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path', 'User')" 2>/dev/null | tr -d '\r')"
    case ";${win_user_path};" in
      *";${win_shim_dir};"*|*";${win_shim_dir}\\;"*)
        echo "[lattice] ${win_shim_dir} already on Windows User PATH — \`lattice\` resolves in PowerShell"
        ;;
      *)
        echo "[lattice] note: ${win_shim_dir} is NOT on your Windows User PATH"
        echo "[lattice] adding it via setx (one-time; takes effect in NEW PowerShell windows)..."
        new_path="${win_shim_dir}"
        [ -n "${win_user_path}" ] && new_path="${win_user_path};${win_shim_dir}"
        if powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', \"${new_path}\", 'User')" >/dev/null 2>&1; then
          echo "[lattice]   ok: open a NEW PowerShell window, then \`lattice doctor\` will work"
        else
          echo "[lattice]   WARN: could not update Windows PATH automatically. Run this in PowerShell:"
          echo "[lattice]   [Environment]::SetEnvironmentVariable('Path', \$env:Path + ';${win_shim_dir}', 'User')"
        fi
        ;;
    esac
    ;;
esac

# PATH check: is the chosen SHIM_DIR actually on PATH right now? If not, write
# a one-line guard into the user's shell rc so the next shell picks it up.
case ":${PATH}:" in
  *":${SHIM_DIR}:"*)
    echo "[lattice] ${SHIM_DIR} on PATH — \`lattice\` resolves in this shell already"
    ;;
  *)
    echo "[lattice] note: ${SHIM_DIR} is NOT on your current PATH"
    rc_target=""
    if [ -n "${ZSH_VERSION:-}" ] || [ -n "${BASH_VERSION:-}" ]; then
      # Prefer the rc file the user actually has.
      for rc in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.bash_profile" "${HOME}/.profile"; do
        if [ -f "${rc}" ]; then rc_target="${rc}"; break; fi
      done
    fi
    # If we found one and it doesn't already mention .local/bin, append the guard line.
    if [ -n "${rc_target}" ] && ! grep -q '\.local/bin' "${rc_target}" 2>/dev/null; then
      {
        echo ""
        echo "# Added by lattice install.sh — ensures ~/.local/bin is on PATH"
        echo 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac'
      } >> "${rc_target}"
      echo "[lattice] added PATH guard to ${rc_target}"
      echo "[lattice] open a new shell (or: source ${rc_target}) and \`lattice help\` will work"
    else
      echo "[lattice] add manually to your shell rc:"
      echo "[lattice]   export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    ;;
esac
echo ""
echo "[lattice] verify: lattice doctor"
echo ""

# v0.9.10: Bootstrap the global ~/.claude/CLAUDE.md with the Lattice block.
# This is the single biggest discoverability lever — every Claude Code session
# on this machine immediately sees the Lattice onboarding without manual
# config. Idempotent (re-install replaces block content, never duplicates) and
# always backs up the existing file to ~/.claude/lattice/claude-md-backups/
# before any mutation.
echo "[lattice] integrating with ~/.claude/CLAUDE.md (Lattice block at top, sentinel-managed)"
if "${SCRIPT_DEST}/lattice" claude-md-tune --bootstrap 2>&1 | sed 's/^/[lattice]   /'; then
  echo "[lattice] global onboarding done — every new Claude Code session will see Lattice instructions"
else
  echo "[lattice] WARN: claude-md-tune failed; you can re-run manually with: lattice claude-md-tune --apply" >&2
fi
echo ""

# v0.9.10: Opt-in repo star prompt. We only ask when running interactively AND
# `gh` is authenticated — otherwise skip silently. Never automatic.
if [ -t 0 ] && [ -t 2 ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf "[lattice] Star IsaamMJ/Lattice on GitHub? [y/N] "
  read -r _star_ans
  case "${_star_ans}" in
    y|Y|yes|YES)
      gh repo star IsaamMJ/Lattice 2>&1 | sed 's/^/[lattice]   /' || \
        echo "[lattice] (star skipped — gh returned non-zero)"
      ;;
    *)
      echo "[lattice] (skipped — not starred)"
      ;;
  esac
  echo ""
fi

echo ""
echo "[lattice] OPTIONAL — statusline (v0.9.14 — Node.js, replaces deprecated bash version)"
echo "[lattice]   Shows Lattice findings, friction, context %, 5h/weekly limits in the"
echo "[lattice]   Claude Code status bar. Cold start ~85ms on Windows; no subprocesses."
echo "[lattice]"
echo "[lattice]   Add this to ~/.claude/settings.json (adjust Node path if needed):"
echo "[lattice]"
echo "[lattice]     \"statusLine\": {"
echo "[lattice]       \"type\": \"command\","
echo "[lattice]       \"command\": \"node ${SCRIPT_DEST}/lattice-statusline.mjs\""
echo "[lattice]     }"
echo "[lattice]"
echo "[lattice]   Windows users: use full Node path if 'node' isn't on PATH, e.g."
echo "[lattice]     \"\\\"C:/Program Files/nodejs/node\\\" \\\"${SCRIPT_DEST}/lattice-statusline.mjs\\\"\""
echo "[lattice]"
echo "[lattice]   Opt-outs:  LATTICE_STATUSLINE_NOCOLOR=1   (strip ANSI)"
echo "[lattice]              LATTICE_STATUSLINE_DISABLE=1   (instant no-op kill switch)"
echo "[lattice]"
echo "[lattice]   The legacy 'lattice statusline' bash command is a no-op stub kept for"
echo "[lattice]   safety — do NOT wire that one; it was the cause of the orphan-bash"
echo "[lattice]   incident on Windows + Git Bash (2026-05-16)."
echo ""
echo "[lattice] OPTIONAL — SessionStart hook (v0.9.16)"
echo "[lattice]   Auto-injects Lattice state (mode, open findings, top-3, telemetry)"
echo "[lattice]   into every new Claude Code session. Closes the 'session forgot Lattice"
echo "[lattice]   exists' gap structurally. ~170ms cold start on Windows; no subprocesses."
echo "[lattice]"
echo "[lattice]   Add to ~/.claude/settings.json:"
echo "[lattice]"
echo "[lattice]     \"hooks\": {"
echo "[lattice]       \"SessionStart\": ["
echo "[lattice]         { \"hooks\": ["
echo "[lattice]             { \"type\": \"command\","
echo "[lattice]               \"command\": \"node ${SCRIPT_DEST}/lattice-session-start.mjs\""
echo "[lattice]             }"
echo "[lattice]           ]"
echo "[lattice]         }"
echo "[lattice]       ]"
echo "[lattice]     }"
echo "[lattice]"
echo "[lattice]   Windows: use full Node path if 'node' isn't on PATH:"
echo "[lattice]     \"\\\"C:/Program Files/nodejs/node\\\" \\\"${SCRIPT_DEST}/lattice-session-start.mjs\\\"\""
echo "[lattice]"
echo "[lattice]   The hook is silent in non-Lattice repos and exits 0 on any error."
echo "[lattice]   Kill switch: LATTICE_SESSION_START_DISABLE=1"
echo ""
echo "[lattice] docs: ${REPO}#readme"
echo ""
echo "[lattice] tab completion (optional):"
echo "[lattice]   bash: echo 'source ${SCRIPT_DEST}/lattice-completion.bash' >> ~/.bashrc"
echo "[lattice]   zsh:  echo 'source ${SCRIPT_DEST}/lattice-completion.zsh'  >> ~/.zshrc"
echo ""
echo "[lattice] v0.7 migration (if upgrading from v0.6):"
echo "[lattice]   bash ${SCRIPT_DEST}/migrate-v0.7.sh --dry-run   # preview"
echo "[lattice]   bash ${SCRIPT_DEST}/migrate-v0.7.sh             # apply"
