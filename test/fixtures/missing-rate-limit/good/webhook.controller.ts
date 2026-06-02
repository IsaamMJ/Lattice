import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";

// Public webhook surface but explicitly throttled — must NOT flag.
@Controller("webhooks/stripe")
@UseGuards(ThrottlerGuard)
export class StripeWebhookController {
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post()
  async handle(@Body() payload: unknown) {
    return { ok: true, payload };
  }
}
