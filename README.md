# Lattice

> **Audit framework for keeping docs aligned with code.** Doc-vs-code drift, scale risks, security exposures — every finding grounded in a `file:line` citation.

Lattice ships four slash commands for Claude Code:

| Command | Catches |
|---|---|
| `/audit <doc-path>` | Doc-vs-code drift; rewrites docs in contract format |
| `/scale-audit <module-path>` | Horizontal-scaling killers (in-memory state, `setInterval` crons, in-process rate limiters) |
| `/security-audit <module-path>` | Auth gaps, signature bypass, secret leaks, IDOR, OWASP Top 10 |
| `/audit-sweep <project-root>` | Runs all three across every module; aggregates into one report |

Every finding cites a file and line. Every verdict requires evidence. Audits stop at human-approval gates — Lattice never auto-applies fixes or auto-commits.

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

---

## 5-minute quickstart

Pick one module in your project and run all three audits:

```
/audit docs/ttd/<your-module>.md
/scale-audit src/modules/<your-module>
/security-audit src/modules/<your-module>
```

Or do it in one shot:

```
/audit-sweep .
```

Findings land in `.lattice/findings/<audit-type>-<module>-<timestamp>.md`. Each finding has:

- A verdict (DRIFT / OK / INTENTIONAL / UNVERIFIABLE for `/audit`; BLOCKER / RISK / WATCH / OK for `/scale-audit`; CRITICAL / HIGH / MEDIUM / LOW for `/security-audit`)
- Evidence (`file:line` or commit hash)
- A recommended action (PATCH_DOC, NO_ACTION, NEEDS_HUMAN, or a fix snippet)

Then triage: fix CRITICALs/BLOCKERs immediately, defer the rest into a `Pre-deploy checklist` section in your `CLAUDE.md`.

---

## Methodology

Read `docs/methodology.md` for the full living-truth-first methodology and the four-verdict model. Read `docs/contract-format.md` for the doc rewrite spec (`Module / Context / Contracts / Decisions / Constraints / Unresolved`). Read `docs/postmortem-reef.md` for the failure that motivated this.

---

## What Lattice deliberately is NOT

- Not a CI gate (you can wire it into one, but Lattice itself is interactive)
- Not an auto-fixer (every change is human-approved)
- Not a code reviewer (use `oh-my-claudecode:code-reviewer` or your team for that)
- Not a multi-language linter (NestJS/TypeScript-tuned out of the box; patterns generalize)

---

## Roadmap

- **v0.2** — `update.sh` + better fallback when `oh-my-claudecode:executor` isn't installed
- **v0.3** — `/mock-sweep` (find stubs/TODOs about to ship), `/reliability-audit` (error handling, retries, idempotency)
- **v0.4** — `/perf-audit` (N+1 queries, blocking I/O, missing indexes)
- **v1.0** — when 5+ skills + 3 real users + Claude Code marketplace listing

---

## License

MIT — see `LICENSE`.

---

*Built because docs that drift from code become lies, and lies become incidents.*
