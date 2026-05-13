# Lattice telemetry protocol

This document specifies the wire format between Lattice clients and the `lattice-telemetry` Worker. It's the **complete** description of what gets sent — anything not listed here is either dropped by the client or rejected by the Worker.

Public so users can verify what's being transmitted. Audit the Worker code at `worker/lattice-telemetry.js`.

---

## Endpoint

```
POST https://lattice-telemetry.<owner-subdomain>.workers.dev
Content-Type: application/json
```

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
| `msg_excerpt` | string | no | First ~200 chars of error message with paths/SHAs stripped | Triage signal in the issue body |
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
| Bare hex strings 7-40 chars (git SHAs) | `[sha]` |
| Control characters | space |

The Worker re-applies the same substitutions defensively. If the client misses something, the Worker catches it.

Maximum length: 400 chars after sanitization.

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
   - Look up fingerprint in Workers KV
   - If new: `POST /repos/IsaamMJ/Lattice/issues` (creates issue)
   - If seen: `POST /repos/IsaamMJ/Lattice/issues/{n}/comments` (+1 occurrence)
   - Update KV record with new count + last_seen

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
