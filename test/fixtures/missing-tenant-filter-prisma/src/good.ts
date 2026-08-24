// Fixture: MUST be 0 hits — every access is keyed by a PRIMARY/UNIQUE key
// declared in ../prisma/schema.prisma, so the key IS the scope (#195).
// The first three functions are the real false positives from issue #195
// (jiive-backend results-pipeline.service.ts:786 / :1221 / :1428).

import { prisma } from "../db";

declare const bookingId: string;
declare const resultId: string;
declare const userId: string;
declare const courseId: string;
declare const token: string;
declare const narrative: string;

// :786 — the exactly-once CAS claim: primary key PLUS a guard. A narrower
// where cannot be broader, so it is still keyed → not a finding.
export async function claimBooking() {
  const claim = await prisma.booking.updateMany({
    where: { id: bookingId, resultDeliveredAt: null },
    data: { resultDeliveredAt: new Date() },
  });
  return claim;
}

// :1221 — update by @id.
export async function markDelivered() {
  await prisma.result.update({
    where: { id: resultId },
    data: { suggestionsDeliveryStatus: "delivered" },
  });
}

// :1428 — update by @id, single line.
export async function saveNarrative() {
  await prisma.result.update({ where: { id: resultId }, data: { narrative } });
}

// @unique non-id column → keyed.
export async function expireSession() {
  return prisma.session.updateMany({ where: { token }, data: { expired: true } });
}

// @unique foreign key on Result → keyed.
export async function resultForBooking() {
  return prisma.result.findFirst({ where: { bookingId } });
}

// Every member of @@id([userId, courseId]) present → keyed.
export async function promote() {
  return prisma.enrollment.updateMany({ where: { userId, courseId }, data: { role: "owner" } });
}

// Prisma's compound-key selector for the same composite → keyed.
export async function demote() {
  return prisma.enrollment.update({
    where: { userId_courseId: { userId, courseId } },
    data: { role: "member" },
  });
}

// AND is a conjunction — the members constrain the same row, so the @id
// inside it still keys the write.
export async function closeBooking() {
  return prisma.booking.updateMany({
    where: { AND: [{ id: bookingId }, { status: "open" }] },
    data: { status: "closed" },
  });
}

// Tenant-scoped the classic way — still safe (pre-#195 behaviour preserved).
export async function listForTenant(tenantId: string) {
  return prisma.booking.findMany({ where: { tenantId, status: "open" } });
}
