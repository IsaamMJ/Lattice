# Lattice

> **Audit framework for keeping docs aligned with code.** Doc-vs-code drift, scale risks, security exposures — every finding grounded in a `file:line` citation.

Lattice ships four slash commands for Claude Code:

| Command | Catches |
|---|---|
| `/audit <doc-path>` | Doc-vs-code drift; rewrites docs in contract format |
| `/scale-audit <module-path>` | Horizontal-scaling killers (in-memory state, `setInterval` crons, in-process rate limiters) |
| `/security-audit <module-path>` | Auth gaps, signature bypass, secret leaks, IDOR, OWASP Top 10 |
| `/audit-sweep <project-root>` | Runs all three across every module via one dispatch per module; aggregates into one report |

Every finding cites a file and line. Every verdict requires evidence. Audits stop at human-approval gates — Lattice never auto-applies fixes or auto-commits.

---

## 30-second quickstart

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

# 2. cd into the project you want to audit, then in Claude Code:
/audit-sweep .

# 3. Findings land in .lattice/findings/sweep-<timestamp>.md
```

Expected output:
```
[SWEEP] Module 1/5 starting: src/modules/payments (dimensions: audit, scale, security)
[SWEEP] Module 1/5 complete: src/modules/payments — audit=12OK/3DRIFT scale=0B/2R security=1C/4H
[SWEEP] Module 2/5 starting: src/modules/admin ...
...
Lattice sweep complete. Findings: .lattice/findings/sweep-20260502-060500.md
```

---

## Why this exists

Built after the cc-reef postmortem (see `docs/postmortem-reef.md`). The short version: AI-driven doc reviews that don't read living-truth files first produce confidently-wrong critique. Lattice encodes the methodology that prevents that:

1. **Read CLAUDE.md / AGENTS.md / drift logs first** — before judging any claim
2. **Check Revision History on the doc** — what was already updated?
3. **Verify every claim against actual code** with `Grep`/`Glob`/`Read`
4. **Check git log for intentional deletions** before flagging "missing"
5. **Default-assume "deliberately removed"** until evidence proves otherwise

If your doc says module X exports function Y, Lattice greps for Y. If Y doesn't exist, Lattice doesn't say "DRIFT" — it checks `git log` for a deletion commit, then CLAUDE.md for an intentional-removal note, and only then assigns a verdict (`DRIFT`, `INTENTIONAL`, or `UNVERIFIABLE`).

---

## Install

### Option 1 — direct (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash
```

This copies `commands/*.md` to `~/.claude/commands/`. Commands appear bare: `/audit`, `/scale-audit`, `/security-audit`, `/audit-sweep`.

### Option 2 — Claude Code plugin marketplace

```bash
# In Claude Code:
/plugin marketplace add IsaamMJ/Lattice
/plugin install lattice@lattice-marketplace
```

Commands appear namespaced: `/lattice:audit`, `/lattice:scale-audit`, etc.

### Update

```bash
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/update.sh | bash
```

### Migrate from pre-v0.5 (legacy `.cc-reef/audits/`)

```bash
bash scripts/migrate.sh   # moves legacy findings to .lattice/findings/
```

---

## Architecture (v0.6)

**Findings as a structured YAML database.** Each finding is one file:
- Open: `.lattice/findings/open/<sweep-date>/<TIER>-<module>-<rule>.yml`
- Closed: `.lattice/findings/closed/<commit-sha>/<TIER>-<module>-<rule>.yml`

Status lives in the path. Closing a finding = `bash scripts/lattice-close.sh <id> --commit <sha>`. The CLAUDE.md checklist is regenerated from YAML truth between `<!-- lattice:checklist:start -->` markers — never edited by hand inside the markers.

**Module-scoped dispatch (from v0.5).** `/audit-sweep` sends one Sonnet sub-agent per module that runs all in-scope dimensions inline. A 5-module sweep = 5 dispatches (not 15). Anthropic prompt caching reuses the methodology library across module dispatches at ~90% discount.

**Standalone.** Works without `oh-my-claudecode` — same methodology, same verdict quality, slightly more tokens.

See `docs/finding-schema.md` for the YAML schema every skill conforms to.

---

## Methodology

- `docs/methodology.md` — full living-truth-first methodology and the four-verdict model
- `docs/contract-format.md` — doc rewrite spec (Module / Context / Contracts / Decisions / Constraints / Unresolved)
- `docs/finding-schema.md` — output schema all skills conform to
- `docs/postmortem-reef.md` — the failure that motivated this

---

## What Lattice deliberately is NOT

- Not a CI gate (you can wire it into one, but Lattice itself is interactive)
- Not an auto-fixer (every change is human-approved)
- Not a code reviewer (use `oh-my-claudecode:code-reviewer` or your team for that)
- Not a multi-language linter (NestJS/TypeScript-tuned out of the box; patterns generalize)
- Not yet recommended for public adoption — currently being hardened on real projects

---

## Roadmap

- **v0.5** — module-scoped dispatch, prompt-cache-aware, output schema contract, sequential echo-back guard, validate.sh cross-skill checks
- **v0.6** (current) — YAML-per-finding lifecycle (open/closed in path), CLAUDE.md regenerated from YAML truth via markers, `lattice-close.sh` + `lattice-regenerate.sh` helpers
- **v0.7** — `lattice diff <since-sweep>` (incremental sweeps, regression detection)
- **v0.8** — cross-dimension dedupe by `file:line` + rule (one finding, one report)
- **v1.0** — pre-push hook blocking on open CRITICAL, spec written after v0.8 real usage

See `CHANGELOG.md` for full version history.

---

## License

MIT — see `LICENSE`.

---

*Built because docs that drift from code become lies, and lies become incidents.*
