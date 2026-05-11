#compdef lattice
# lattice-completion.zsh — zsh tab completion for the lattice CLI
# Install (add to ~/.zshrc):
#   source ~/.claude/lattice/scripts/lattice-completion.zsh

_lattice_open_slugs() {
  local slugs=()
  local f
  for f in .lattice/findings/open/*.yml(.N) .lattice/findings/open/*/*.yml(.N); do
    slugs+=("$(basename "${f}" .yml)")
  done
  compadd -a slugs
}

_lattice_closed_slugs() {
  local slugs=()
  local f
  for f in .lattice/findings/closed/*.yml(.N) .lattice/findings/closed/*/*.yml(.N); do
    slugs+=("$(basename "${f}" .yml)")
  done
  compadd -a slugs
}

_lattice() {
  local state line
  typeset -A opt_args

  _arguments \
    '1: :->subcommand' \
    '*: :->args'

  case "${state}" in
    subcommand)
      local subcommands=(
        'close:mark a finding closed'
        'reopen:move a closed finding back to open'
        'sync:regenerate the CLAUDE.md checklist block'
        'regenerate:alias for sync'
        'defer:mark a finding deferred until a date'
        'list:list open findings'
        'ls:alias for list'
        'show:pretty-print one finding YAML'
        'cat:alias for show'
        'triage:interactive walk through open findings'
        'cluster:walk the relates_to graph BFS'
        'bulk-close:close every finding matching a glob'
        'handoff:emit a Markdown executor brief'
        'next:print the highest-priority open finding'
        'timeline:list closed findings by date'
        'verify:print or run simulate: steps'
        'ci-check:exit 1 if any CRITICAL/BLOCKER finding is open'
        'pr-body:emit PR body section of closed findings'
        'usage:summarize local command usage'
        'update:check for or apply Lattice updates'
        'config:create or show project-local config'
        'validate:scan every YAML for parse/schema errors'
        'sweeps:list sweep manifests'
        'sweep-id:generate a sweep ID'
        'id-gen:compute a stable v0.7 finding id'
        'version:print the installed version'
        'help:show usage'
      )
      _describe 'subcommand' subcommands
      ;;
    args)
      case "${line[1]}" in
        close|show|cat|handoff|verify|cluster|defer)
          _lattice_open_slugs ;;
        reopen)
          _lattice_closed_slugs ;;
        list|ls|triage)
          _arguments \
            '--module[filter by module]:module:' \
            '--tier[filter by tier]:tier:(CRITICAL BLOCKER HIGH MEDIUM LOW WATCH RISK DRIFT OK)' \
            '--status[filter by status]:status:(open in_progress deferred wont_fix)' \
            '--dimension[filter by dimension]:dimension:(audit scale security flow coverage)' \
            '--due-for-review[show findings past defer_until]' \
            '--cluster[sort cluster-root findings first]' ;;
        next)
          _arguments '--module[filter by module]:module:' ;;
        defer)
          _arguments \
            '--until[defer until (YYYY-MM-DD)]:date:' \
            '--reason[reason for deferral]:reason:' ;;
        sync|regenerate)
          _arguments '--check[dry-run: exit 1 on drift]' ;;
        bulk-close)
          _arguments \
            '--pattern[glob pattern]:glob:' \
            '--commit[commit sha]:sha:' \
            '--yes[skip confirmation]' ;;
        verify)
          _arguments '--run[execute the simulate: steps]' ;;
        ci-check)
          _arguments '--tier[space-separated tiers to fail on]:tiers:' ;;
        pr-body|timeline)
          _arguments '--since[only include findings closed after this date]:date:' ;;
        usage)
          _arguments \
            '--since[lookback window in days]:days:' \
            '--unused[unused threshold in days]:days:' \
            '--json[emit JSON]' ;;
        update)
          _arguments \
            '--check[check latest version]' \
            '--self[run installed updater]' \
            '--enable-auto[set updates.mode auto]' \
            '--disable-auto[set updates.mode notify]' ;;
        config)
          _arguments '1:action:(init show)' ;;
      esac
      ;;
  esac
}

_lattice "$@"
