// Fixture: SHOULD flag — a durable row (no cascading FK in ../prisma/schema.prisma)
// deleted and recreated inside one transaction. Every column the create does not
// set silently reverts to its default, including the `@default(uuid())` token
// that is already in a URL the customer holds.

import { Prisma } from "@prisma/client";
import { prisma } from "../db";

declare function addDays(n: number): Date;

// HIGH x2 — the incident itself (#196). Five callers could re-run this; each run
// minted a new /r/:token while the link already sent pointed at the deleted row,
// and the delete also discarded retestReminderOptIn, retestReminderSentAt,
// suggestionsDeliveryStatus and the token's viewCount.
export async function rebuildResult(bookingId: string, narrative: string) {
  return prisma.$transaction(async (tx) => {
    await tx.resultToken.deleteMany({ where: { result: { bookingId } } });
    await tx.result.deleteMany({ where: { bookingId } });
    const result = await tx.result.create({ data: { bookingId, narrative } });
    await tx.resultToken.create({ data: { resultId: result.id } });
    return result;
  });
}

// HIGH — same rewrite in the extracted-helper form: the transaction client
// arrives as a parameter, so the function body IS the transaction block. The
// create is a NESTED write on the parent, which mints the child all the same.
export async function reissueToken(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.resultToken.deleteMany({ where: { result: { bookingId } } });
  await tx.result.update({
    where: { bookingId },
    data: { token: { create: { expiresAt: addDays(30) } } },
  });
}

// HIGH — the sequential array form of $transaction: every statement in the
// array runs in the one transaction, so the same rewrite is written here too.
export async function rotateToken(resultId: string, token: string) {
  return prisma.$transaction([
    prisma.resultToken.deleteMany({ where: { resultId } }),
    prisma.resultToken.create({ data: { resultId, token } }),
  ]);
}
