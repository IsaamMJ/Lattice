# Lattice telemetry protocol

This document specifies the wire format between Lattice clients and the `lattice-telemetry` Worker. It's the **complete** description of what gets sent — anything not listed here is either dropped by the client or rejected by the Worker.

Public so users can verify what's being transmitted. Audit the Worker code at `worker/lattice-telemetry.js`.

---

## Endpoint

```
POST https://lattice-telemetry.<owner-subdomain>.workers.dev
Content-Type: application/json; charset=utf-8
```

**The request body MUST be UTF-8.** v2.3.2 (#199): the Worker decodes the raw
request bytes itself with a strict UTF-8 decoder and only falls back to CP1252
when the bytes are provably not UTF-8. That fallback exists because Windows
`git-bash` clients were emitting the payload in the shell ANSI codepage, and the
Worker's previous lossy decode turned every em dash into a permanent U+FFFD in
the filed issue title (#194-#198). Clients should send UTF-8 and not rely on it.

No authentication. Rate-limited by Cloudflare's default DDoS protection. Async — server returns `202 Accepted` before the GitHub issue is filed.

---

## Request body (JSON)

| Field | Type | Required | Sent value | Why |
|-------|------|----------|------------|-----|
| `version` | string | yes | Lattice version, e.g. `"0.7.12"`. Pattern: `\d+\.\d+\.\d+(-[a-z0-9]+)?` | So issues can be linked to a release |
| `command` | string | yes | Subcommand name only (no args), e.g. `"close"`, `"sync"`. Pattern: `[a-z_-]+` max 32 chars | So bugs can be grouped by command |
| `exit_code` | integer | yes | Exit status of the failed command (1-255) | Distinguishes error categories |
| `os` | string | yes | `"linux"`, `"darwin"`, or `"windows"` | OS-specific bug patterns |
| `msg_fingerprint` | string | yes | sha256 hex digest of the normalized error message | Dedup key |
| `timestamp` | string | yes | ISO 8601 UTC, e.g. `"2026-05-14T08:00:00Z"` | When the error occurred |
| `msg_excerpt` | string | no | Last ~20 lines / first ~400 chars of stderr with paths/SHAs stripped | Triage signal in the issue body. **Required in practice** — a report without it is not diagnosable (#200) |
| `error_class` | string | no | Coarse categorization, e.g. `"missing_field"`, `"git_failure"` | Filtering |
| `user_hash` | string | no | sha256 hex of a machine-stable but not personally-identifiable value | Distinguishes "1 user hit this 50 times" from "50 users hit this once" |

**Anything outside this list is dropped by the Worker.** See `sanitize()` in `worker/lattice-telemetry.js`.

---

## What is explicitly NEVER sent

The client constructs the payload from a whitelist. The following never appear anywhere in the request:

| Category | Examples |
|----------|----------|
| Project identity | repo name, directory path, remote URL |
| Source code | file contents, diffs |
| Finding data | finding IDs, slugs, titles, rules, modules, fix text |
| Commit refs | SHAs, branch names, tags |
| User identity | git config name/email, GitHub username, OS username |
| File paths | client strips `/absolute/path/foo.ts` → `[path]` in excerpts |
| Stack traces with paths | sanitized to method names only |

---

## msg_excerpt sanitization (client-side)

Before sending, the client applies these substitutions to `msg_excerpt`:

| Pattern | Replaced with |
|---------|---------------|
| `/abs/path/foo` (Unix paths) | `[path]` |
| `C:\some\path\foo` (Windows paths) | `[path]` |
| Bare hex strings 7-64 chars that are >= 12 chars **or** contain a digit (git SHAs) | `[sha]` |
| Control characters | space |

The Worker re-applies the same substitutions defensively. If the client misses something, the Worker catches it.

Maximum length: 400 chars after sanitization.

v2.3.2 (#199): the SHA rule used to be a bare `[0-9a-f]{7,40}`, which redacts any
seven-letter word spelled from `a`-`f` (`acceded`, `defaced`, `effaced`). It now
also requires length >= 12 or at least one digit — every real abbreviated SHA
satisfies one of those, no English word satisfies both.

### Title sanitization is separate

`title` (manual reports only) does **not** go through the excerpt sanitizer. An
excerpt is machine stderr, where over-redaction is free; a title is prose, is the
only text that appears in `gh issue list`, in search and in notifications, and a
false redaction there is permanent. The title sanitizer redacts a slash-bearing
token only when it carries genuine path evidence:

| Evidence | Example |
|----------|---------|
| Drive letter | `C:\Users\bob\proj`, `C:/Users/bob` |
| Filesystem anchor | `/home/u/x`, `./x/y`, `../x`, `~/.lattice/state.json` |
| >= 3 segments, or 2 segments one of which is filename-shaped | `src/components/Button`, `scripts/lattice-core.mjs` |

and never when every segment is numeric. Ratios, dates and slashed prose —
`0/8`, `24/7`, `2026/08/21`, `A/B`, `CI/CD`, `and/or`, `TypeScript/JS` — are left
alone. Filing `0/8 true positives` used to store `0[path] true positives` (#195).

Titles are truncated at 160 characters **on code-point boundaries**, so a cap
landing inside a surrogate pair cannot leave a lone surrogate (which serialises
to U+FFFD).

---

## msg_fingerprint construction

The client builds a stable fingerprint so the same error from different machines/sessions/days collapses to one issue.

Algorithm:
```
1. Take the full error message (stderr line that triggered the report)
2. Normalize:
   - Replace any /absolute/path or C:\path with `[path]`
   - Replace bare hex 7-40 chars with `[sha]`
   - Replace digit sequences > 5 chars with `[n]`
   - Collapse whitespace runs to single space
   - Trim leading/trailing whitespace
3. sha256 of the normalized string, hex-encoded
```

This means: same bug from two different repos with different paths produces the same fingerprint → comments on the same issue.

---

## Response

```json
{ "ok": true, "accepted": true }
```

Status: `202 Accepted` on success. Other codes (400, 405, 503) for malformed/unsupported requests. The client treats any non-2xx as "telemetry unavailable" and silently moves on — never surfaces to the user.

---

## Server-side flow

1. Receive POST, validate JSON shape
2. Run `sanitize()` — whitelist-only, reject anything malformed
3. Return `202` to client immediately (don't block on GitHub API)
4. In background (`ctx.waitUntil`):
   - Look up fingerprint in Workers KV (cache for the issue *number* only)
   - On a KV miss, search GitHub for `lattice-fp:<fingerprint>` across **open and
     closed** issues
   - If found and closed: `PATCH .../issues/{n}` with `state: open` — a recurrence
     after a close is a regression and belongs on the original thread
   - If found: bump the occurrence count and
     `POST /repos/IsaamMJ/Lattice/issues/{n}/comments`
   - If new: `POST /repos/IsaamMJ/Lattice/issues` (creates issue), then `GET` the
     issue back and log `title_readback_mismatch` if GitHub stored something other
     than what was sent
   - Update the KV record with the issue number + last_seen

Manual reports (`kind: "manual_report"`) take the same dedup path since v2.3.2,
keyed on the client's `sha256("report:<title>")` fingerprint.

### Occurrence counting

v2.3.2 (#200): the occurrence count lives in the **issue body**, as a
`<!-- lattice-occurrences:N -->` marker kept in sync with the rendered
`- **Occurrences:** N` line. It used to live only in KV, which expires after
`DEDUP_WINDOW_HOURS` (24h) — so a crash recurring weeks later restarted at 1 and
was filed as a brand-new issue. #184/#192 and #183/#186 are two pairs of
byte-identical fingerprints filed as four issues, each stamped `Occurrences: 1`.
Issue bodies do not expire; KV does. Bodies without the marker are read from the
rendered line and upgraded in place.

---

## Disable telemetry (user-facing)

A Lattice user can opt out in any of these ways:

1. **Config flag:** `lattice config telemetry off` → writes `telemetry: off` to `.lattice/config.yml`
2. **Env var:** `export LATTICE_TELEMETRY=0` → overrides config
3. **Global:** `echo "telemetry: off" > ~/.claude/lattice/config.yml`

When disabled, the client never constructs or sends any payload.

---

## Verification

Want to verify what's actually being sent? Run any failing `lattice` command with `LATTICE_TELEMETRY_DEBUG=1`:

```
$ LATTICE_TELEMETRY_DEBUG=1 lattice close "" --reason fixed
...
[lattice-telemetry] payload (would send):
{
  "version": "0.7.12",
  "command": "close",
  "exit_code": 2,
  "os": "linux",
  "msg_fingerprint": "abc123...",
  ...
}
[lattice-telemetry] (debug mode — not sent)
```

This lets users see the exact payload without it leaving their machine.

---

## Audit

- Worker source: `worker/lattice-telemetry.js` (public in this repo)
- Sanitizer: `sanitize()` function, top of the Worker file
- Client builder: `build_telemetry_payload()` in `scripts/lattice` (added in v0.8.0)
- Issues are PUBLIC at https://github.com/IsaamMJ/Lattice/issues with the `telemetry` label — you can see exactly what's been filed
