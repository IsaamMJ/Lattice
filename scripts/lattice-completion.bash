#!/usr/bin/env bash
# lattice-completion.bash — bash tab completion for the lattice CLI
# Install (add to ~/.bashrc or ~/.bash_profile):
#   source ~/.claude/lattice/scripts/lattice-completion.bash

_lattice_subcommands=(
  close reopen sync regenerate defer list ls show cat triage cluster
  bulk-close handoff next timeline verify ci-check pr-body validate
  sweeps sweep-id id-gen version help
)

_lattice_open_slugs() {
  local slugs=()
  local f
  for f in .lattice/findings/open/*.yml .lattice/findings/open/*/*.yml; do
    [ -f "${f}" ] && slugs+=("$(basename "${f}" .yml)")
  done
  printf '%s\n' "${slugs[@]:-}"
}

_lattice_closed_slugs() {
  local slugs=()
  local f
  for f in .lattice/findings/closed/*.yml .lattice/findings/closed/*/*.yml; do
    [ -f "${f}" ] && slugs+=("$(basename "${f}" .yml)")
  done
  printf '%s\n' "${slugs[@]:-}"
}

_lattice_complete() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  if [ "${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${_lattice_subcommands[*]}" -- "${cur}") )
    return 0
  fi

  local sub="${COMP_WORDS[1]}"
  case "${sub}" in
    close|show|cat|handoff|verify|cluster|defer|next)
      COMPREPLY=( $(compgen -W "$(_lattice_open_slugs)" -- "${cur}") )
      ;;
    reopen)
      COMPREPLY=( $(compgen -W "$(_lattice_closed_slugs)" -- "${cur}") )
      ;;
    list|ls|triage)
      COMPREPLY=( $(compgen -W "--module --tier --status --dimension --due-for-review --cluster" -- "${cur}") )
      ;;
    sync|regenerate)
      COMPREPLY=( $(compgen -W "--check" -- "${cur}") )
      ;;
    bulk-close)
      COMPREPLY=( $(compgen -W "--pattern --commit --yes" -- "${cur}") )
      ;;
    ci-check)
      COMPREPLY=( $(compgen -W "--tier" -- "${cur}") )
      ;;
    pr-body|timeline)
      COMPREPLY=( $(compgen -W "--since" -- "${cur}") )
      ;;
    verify)
      COMPREPLY=( $(compgen -W "--run" -- "${cur}") )
      ;;
    next)
      COMPREPLY=( $(compgen -W "--module" -- "${cur}") )
      ;;
  esac
  return 0
}

complete -F _lattice_complete lattice
