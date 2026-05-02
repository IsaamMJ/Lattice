---
dimension: security
module: src/modules/payments
date: 2026-05-02T06:00:00Z
auditor: claude-code/security-audit
summary:
  CRITICAL: 1
  HIGH: 2
  MEDIUM: 1
  LOW: 0
  OK: 6
---

# Security Audit: src/modules/payments (sample, redacted)

## Findings

### [CRITICAL] Webhook signature compared with === (timing-unsafe)
- **dimension**: security
- **tier**: CRITICAL
- **file**: src/modules/payments/payments.controller.ts
- **line**: 47
- **owasp**: A02 (Cryptographic Failures)
- **exploitability**: Remote-unauth
- **blast_radius**: Attacker can forge Razorpay webhooks → arbitrary credit grants without payment
- **attack_scenario**: Adversary times response per byte of signature, recovers secret over thousands of requests, forges payment-success webhook
- **fix**: Replace `===` with `crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))`
- **secure_code_example**:
  ```ts
  // BAD — timing-unsafe
  if (receivedSig === computedSig) {
    return this.processPayment(payload);
  }

  // GOOD — constant-time compare
  const a = Buffer.from(receivedSig, 'hex');
  const b = Buffer.from(computedSig, 'hex');
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    return this.processPayment(payload);
  }
  ```

### [HIGH] Webhook handler lacks idempotency — replay = double-credit
- **dimension**: security
- **tier**: HIGH
- **file**: src/modules/payments/payments.service.ts
- **line**: 112
- **owasp**: A04 (Insecure Design)
- **exploitability**: Remote-unauth (after signature verified)
- **blast_radius**: Replayed webhook causes second credit grant; user gets 2× credits per payment
- **attack_scenario**: Razorpay retries on 5xx; if our handler errors after credit grant but before 200, the retry double-credits
- **fix**: Add unique constraint on `razorpayPaymentId` in credit_transactions table; wrap credit insert in upsert with `ON CONFLICT DO NOTHING`

### [HIGH] Missing rate limit on public webhook endpoint
- **dimension**: security
- **tier**: HIGH
- **file**: src/modules/payments/payments.controller.ts
- **line**: 34
- **owasp**: A04 (Insecure Design)
- **exploitability**: Remote-unauth
- **blast_radius**: Compute exhaustion via signature-verify CPU work
- **fix**: Add `@Throttle({ default: { limit: 100, ttl: 60_000 } })` from `@nestjs/throttler`

### [MEDIUM] Stack trace leaked in 500 response
- **dimension**: security
- **tier**: MEDIUM
- **file**: src/modules/payments/payments.controller.ts
- **line**: 62
- **fix**: Catch in controller, log full error, return generic `{error: 'internal'}` to caller

## Pre-deploy checklist (drafted entries)

```
- [ ] HIGH (payments): webhook handler lacks idempotency — replay = double-credit. Fix: unique constraint on razorpayPaymentId + upsert. Source: security-audit 2026-05-02.
- [ ] HIGH (payments): missing rate limit on public webhook. Fix: @Throttle 100/60s. Source: security-audit 2026-05-02.
- [ ] MEDIUM (payments): stack trace leaked in 500 response. Fix: catch + log + generic response. Source: security-audit 2026-05-02.
```

---

*This is a redacted sample. Real audit findings include full attack scenarios, exact code snippets, and project-specific context.*
