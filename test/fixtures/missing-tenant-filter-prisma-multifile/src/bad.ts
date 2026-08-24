// Fixture: SHOULD flag — no declared key in the where, no tenant key (#195).

import { prisma } from "../db";

// HIGH — mass write keyed on nothing (only one member of the @@unique pair).
export async function voidAllDrafts(number: string) {
  return prisma.invoice.updateMany({ where: { number }, data: { status: "void" } });
}

// HIGH — `userId` is not unique on ApiToken: this revokes every user's tokens.
export async function revokeAll(userId: string) {
  return prisma.apiToken.deleteMany({ where: { userId } });
}
