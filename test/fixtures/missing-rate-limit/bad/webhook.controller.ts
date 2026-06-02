import { Controller, Post, Body } from "@nestjs/common";

// Public Stripe webhook surface. No @Throttle, no ThrottlerGuard anywhere.
@Controller("webhooks/stripe")
export class StripeWebhookController {
  @Post()
  async handle(@Body() payload: unknown) {
    return this.process(payload);
  }

  private process(payload: unknown) {
    return { ok: true, payload };
  }
}
