// Fixture: MUST be 0 hits — every access is properly tenant-scoped, keyed by
// a primary key, global, commented, or a test. The same call SHAPES as bad.ts
// but done correctly.
//
// No schema.prisma exists above this directory, so the key-scoped cases here
// are decided by the no-schema FALLBACK (#195): `id` / `<model>Id` only.

import { prisma } from "../db";

declare const id: string;
declare const commentId: string;
declare const tenantId: string;
declare const data: any;
declare const ctx: { db: typeof prisma };

// Tenant-scoped update — has tenantId in where → safe.
export async function editInvoice() {
  return prisma.invoice.update({ where: { id, tenantId }, data });
}

// Tenant-scoped deleteMany — safe.
export async function purge() {
  return prisma.session.deleteMany({ where: { expired: true, tenantId } });
}

// Key-scoped write (#195): the primary key IS the scope — a tenant filter here
// would be strictly redundant, so this must NOT flag.
export async function removeUser() {
  return prisma.user.delete({ where: { id } });
}

// Key-scoped read — findUnique by primary key.
export async function getOrder() {
  return prisma.order.findUnique({ where: { id } });
}

// `<model>Id` spelling of the same key (#195 fallback).
export async function hideComment() {
  return prisma.comment.updateMany({ where: { commentId }, data: { hidden: true } });
}

// Key PLUS an extra guard — the exactly-once CAS shape from #195. A narrower
// where cannot be broader, so it is still keyed.
export async function claimBooking() {
  return prisma.booking.updateMany({
    where: { id, resultDeliveredAt: null },
    data: { resultDeliveredAt: new Date() },
  });
}

// Multi-line where with tenantId — safe.
export async function editBilling() {
  return prisma.billing.update({
    where: {
      id,
      tenantId,
      status: "open",
    },
    data,
  });
}

// Accessor via ctx.db, keyed by primary key — safe.
export async function editViaCtx() {
  return ctx.db.ticket.update({ where: { id }, data });
}

// Global / system model — a missing tenant key here is expected, not a leak.
export async function readSystem() {
  return prisma.systemConfig.findMany({ where: { key: "feature.flags" } });
}

// Global audit log — skipped by model name.
export async function trimAudit() {
  return prisma.auditLog.deleteMany({ where: { old: true } });
}

// findMany with NO where (list-all read) — deliberately NOT flagged (too noisy).
export async function listAll() {
  return prisma.project.findMany();
}

// Commented-out dangerous call — must be ignored.
// return prisma.post.updateMany({ where: { status: "draft" }, data });
// prisma.session.deleteMany({ where: { expired: true } });

// A non-Prisma .update on an array — must not match the accessor shape.
export function bump(arr: number[]) {
  return arr.map((x) => x + 1);
}
