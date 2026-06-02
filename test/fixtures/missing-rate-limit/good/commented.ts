// Everything below is in a comment or a string description — must NOT flag.
//
// @Controller("webhooks/legacy")  -- old design, removed
// export async function POST(req) { ... }   // a public route we deleted
// app.post("/auth/login", handler)          // express login, gone now

const docs = `
  We used to expose @Post() on a webhook controller with no @Throttle.
  Now everything routes through the gateway.
`;

export const NOTE = docs;
