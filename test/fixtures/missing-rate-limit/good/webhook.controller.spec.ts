import { Controller, Post } from "@nestjs/common";

// A test file: even though this looks like an unthrottled public controller,
// the scanner must skip it because the path matches the test pattern.
@Controller("webhooks/test")
export class TestWebhookController {
  @Post()
  handle() {
    return { ok: true };
  }
}
