// Fixture: SHOULD flag — the surviving true-positive class (#195): a where
// that pins NO key declared in ../prisma/schema.prisma and no tenant key, so
// the statement can reach rows belonging to any tenant.

import { prisma } from "../db";

declare const courseId: string;
declare const data: any;

// HIGH — mass update scoped only by a non-key column.
export async function publishPending() {
  return prisma.booking.updateMany({ where: { status: "pending" }, data: { status: "live" } });
}

// HIGH — only ONE member of @@id([userId, courseId]) is present, so the
// composite does not key this write: it hits every user on the course.
export async function wipeCourseRoles() {
  return prisma.enrollment.updateMany({ where: { courseId }, data: { role: "member" } });
}

// HIGH — OR is not a conjunction: the keyed branch does not scope the other,
// so this reaches every open booking in every tenant.
export async function reopen() {
  return prisma.booking.updateMany({
    where: { OR: [{ id: "b1" }, { status: "open" }] },
    data: { status: "open" },
  });
}

// HIGH — deleteMany on a non-key column.
export async function purgeExpired() {
  return prisma.session.deleteMany({ where: { expired: true } });
}

// MEDIUM — read filtered only by a non-key column.
export async function listDelivered() {
  return prisma.result.findMany({ where: { suggestionsDeliveryStatus: "delivered" } });
}

// HIGH — a model the schema does not declare falls back to the id/<model>Id
// rule, and `flag` is neither.
export async function legacySweep() {
  return prisma.legacyRecord.updateMany({ where: { flag: true }, data });
}
