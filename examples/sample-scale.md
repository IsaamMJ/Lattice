---
dimension: scale
module: src/modules/lumi
date: 2026-05-02T06:00:00Z
auditor: claude-code/scale-audit
target_instances: 2+ behind LB
summary:
  BLOCKER: 1
  RISK: 2
  WATCH: 1
  OK: 5
---

# Scale Audit: src/modules/lumi (sample, redacted)

## Findings

### [BLOCKER] setInterval session-cleanup runs on every instance
- **dimension**: scale
- **tier**: BLOCKER
- **file**: src/modules/lumi/sessions/session.service.ts
- **line**: 89
- **failure_mode**: With 2 instances, both fire the cleanup every 5 min — duplicate DB writes, race on session expiry, possible double-finalization of bills
- **fix**: Move to BullMQ scheduled job with single-consumer queue, OR wrap in `redlock`-acquired lock so only one instance runs the cleanup tick

### [RISK] In-process Map holding rate-limit counters
- **dimension**: scale
- **tier**: RISK
- **file**: src/modules/lumi/guards/rate-limit.guard.ts
- **line**: 23
- **failure_mode**: Counters diverge per instance; per-user rate limit becomes per-instance — a 10/min limit becomes 20/min with 2 instances
- **fix**: Back with Valkey/Redis using `INCR` + `EXPIRE`, or `@nestjs/throttler` with redis storage adapter

### [RISK] Promise.all over unbounded user list
- **dimension**: scale
- **tier**: RISK
- **file**: src/modules/lumi/notifications/broadcast.service.ts
- **line**: 51
- **failure_mode**: For 10k users, opens 10k concurrent HTTP calls — overwhelms downstream + memory pressure
- **fix**: Use `p-limit` with concurrency cap of 20, or batch through BullMQ jobs

### [WATCH] Local file write for transcript debug dump
- **dimension**: scale
- **tier**: WATCH
- **file**: src/modules/lumi/debug/transcript-dump.service.ts
- **line**: 17
- **failure_mode**: Lost on instance death; only visible to one box
- **fix**: Already gated by `process.env.LUMI_DEBUG_DUMP === 'true'` — fine for now. CLAUDE.md notes this is a debug-only path.
- **intentional_citation**: CLAUDE.md:142 ("LUMI_DEBUG_DUMP is dev-only and never enabled in prod")

## Pre-scale checklist (drafted entries)

```
- [ ] BLOCKER (lumi): setInterval session-cleanup duplicates on instance #2. Fix: BullMQ scheduled job or redlock. Source: scale-audit 2026-05-02.
- [ ] RISK (lumi): in-process rate-limit Map diverges across instances. Fix: redis-backed throttler. Source: scale-audit 2026-05-02.
- [ ] RISK (lumi): unbounded Promise.all on user broadcast. Fix: p-limit cap or BullMQ batching. Source: scale-audit 2026-05-02.
```

---

*This is a redacted sample. Real audit findings include exact code snippets and project-specific context.*
