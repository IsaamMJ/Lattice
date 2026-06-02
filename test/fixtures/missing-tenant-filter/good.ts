// Fixture: MUST be 0 hits — every access is properly tenant-scoped, global,
// commented, or a test. The same call SHAPES as bad.ts but done correctly.

import { prisma } from "../db";

declare const id: string;
declare const tenantId: string;
declare const data: any;
declare const ctx: { db: typeof prisma };

// Tenant-scoped update — has tenantId in where → safe.
export async function editInvoice() {
  return prisma.invoice.update({ where: { id, tenantId }, data });
}

// Tenant-scoped delete — safe.
export async function removeUser() {
  return prisma.user.delete({ where: { id, tenantId } });
}

// Tenant-scoped updateMany — safe.
export async function publishAll() {
  return prisma.post.updateMany({ where: { status: "draft", tenantId }, data: { status: "live" } });
}

// Tenant-scoped deleteMany — safe.
export async function purge() {
  return prisma.session.deleteMany({ where: { expired: true, tenantId } });
}

// Tenant-scoped findUnique via compound key — safe.
export async function getOrder() {
  return prisma.order.findUnique({ where: { id, tenantId } });
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
// return prisma.invoice.update({ where: { id }, data });
// prisma.user.delete({ where: { id } });

// A non-Prisma .update on an array — must not match the accessor shape.
export function bump(arr: number[]) {
  return arr.map((x) => x + 1);
}
