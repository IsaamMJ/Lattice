# Telemetry setup runbook

Deploy the `lattice-telemetry` Cloudflare Worker so error reports from Lattice clients land as GitHub Issues on `IsaamMJ/Lattice`.

**One-time setup. ~30 minutes.** Browser steps mixed with terminal commands. Follow top to bottom; don't skip.

---

## 0. Prerequisites

You'll need:
- A Cloudflare account (free tier is sufficient — no card required)
- A GitHub account with admin access to `IsaamMJ/Lattice`
- Node.js ≥ 18 locally
- `wrangler` CLI (`npm install -g wrangler` if not already installed)

---

## 1. Generate a fine-grained GitHub PAT

This token lets the Worker create issues on your behalf without exposing your password.

1. Open https://github.com/settings/personal-access-tokens/new
2. **Token name:** `lattice-telemetry-worker`
3. **Resource owner:** your account (`IsaamMJ`)
4. **Expiration:** 1 year (renew yearly — set a calendar reminder)
5. **Repository access:** **Only select repositories** → pick `IsaamMJ/Lattice`
6. **Permissions → Repository permissions:**
   - **Issues:** Read and write
   - Leave everything else as "No access"
7. Click **Generate token**
8. Copy the token (`github_pat_...`). **You only see it once.** Paste it into a temporary text file — you'll feed it to wrangler in step 4.

---

## 2. Sign in to Cloudflare and find your account ID

1. Go to https://dash.cloudflare.com → sign in (or sign up, free)
2. On the dashboard, look at the right sidebar — copy the **Account ID** value
3. Open `worker/wrangler.toml` in this repo and **uncomment** the `account_id` line, pasting your ID:
   ```toml
   account_id = "abc123def456..."
   ```

---

## 3. Authenticate wrangler locally

In a terminal, in the `worker/` directory:

```bash
cd worker
wrangler login
```

This opens a browser for OAuth. Approve. You should see `Successfully logged in`.

Verify:
```bash
wrangler whoami
# Should print your Cloudflare email + account ID.
```

---

## 4. Create the dedup KV namespace

Workers KV is the storage we use to remember which fingerprints we've already filed (so we comment "+1 occurrence" instead of opening duplicate issues).

```bash
wrangler kv namespace create lattice_dedup
```

Output looks like:
```
🌀 Creating namespace with title "lattice-telemetry-lattice_dedup"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "lattice_dedup"
id = "abc123def456789..."
```

**Copy the `id` value.** Open `worker/wrangler.toml` and replace `REPLACE_WITH_KV_NAMESPACE_ID` with that id (keep the `binding = "DEDUP_KV"` line — that name is what the Worker code expects).

---

## 5. Set the GitHub PAT as a Worker secret

```bash
wrangler secret put GITHUB_TOKEN
```

It prompts for the value. Paste the `github_pat_...` token you generated in step 1. Press Enter.

Verify:
```bash
wrangler secret list
# Should show GITHUB_TOKEN with a creation timestamp.
```

After this, you can safely delete the temp text file holding the PAT.

---

## 6. Deploy the Worker

```bash
wrangler deploy
```

Output:
```
✨ Compiled Worker successfully
Total Upload: 6 KiB / gzip: 2 KiB
Uploaded lattice-telemetry (1.45 sec)
Deployed lattice-telemetry triggers (1.20 sec)
  https://lattice-telemetry.<your-subdomain>.workers.dev
Current Version ID: ...
```

**Copy the URL** (e.g. `https://lattice-telemetry.iisaam.workers.dev`). This is what the Lattice client will POST to.

---

## 7. Smoke-test it

Health check:
```bash
curl -s https://lattice-telemetry.<your-subdomain>.workers.dev/health
# Expected: {"ok":true,"service":"lattice-telemetry"}
```

Manual telemetry post (creates a real test issue — close it after):
```bash
curl -s -X POST https://lattice-telemetry.<your-subdomain>.workers.dev \
  -H "content-type: application/json" \
  -d '{
    "version": "0.7.12",
    "command": "close",
    "exit_code": 2,
    "os": "linux",
    "msg_fingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "msg_excerpt": "smoke test from runbook",
    "timestamp": "2026-05-14T08:00:00Z"
  }'
# Expected: {"ok":true,"accepted":true}
```

Within ~5 seconds, a new GitHub Issue should appear on `IsaamMJ/Lattice` with the `telemetry`, `auto-reported`, and `bug` labels. Close it after verifying.

Run the same curl a **second time** — you should see the same response (`accepted:true`), but instead of a new issue, the existing one gets a **+1 occurrence** comment.

---

## 8. Hand the Worker URL back to me

In your next Lattice session, paste the URL like:

> Worker URL: `https://lattice-telemetry.iisaam.workers.dev`

I'll wire it into `scripts/lattice` as the telemetry endpoint, build the client-side error trap, add the disclosure layer, and ship as v0.8.0-rc1.

---

## Maintenance

- **PAT expires in 1 year.** Calendar reminder: re-run step 1, then `wrangler secret put GITHUB_TOKEN` to update.
- **Worker analytics:** `wrangler tail` shows live logs. Useful when debugging client integration.
- **Stop receiving telemetry:** `wrangler delete lattice-telemetry`. KV namespace persists separately — delete via dashboard if you want a clean wipe.

---

## What this Worker WILL NOT do (privacy guarantees)

- Will not accept or store any field outside the documented whitelist (see `docs/telemetry-protocol.md`)
- Will not retain raw payloads — only the fingerprint + occurrence count
- Will not forward to any third-party service
- KV records expire after `DEDUP_WINDOW_HOURS` (default 24h) automatically

If a curious user inspects the Worker code via Cloudflare's dashboard, everything is plainly visible.
