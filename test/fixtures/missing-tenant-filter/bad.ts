// Fixture: SHOULD flag — multi-tenant data access missing the tenant scope.
// Every non-comment Prisma call below is a true positive.

import { prisma } from "../db";

declare const id: string;
declare const data: any;
declare const ctx: { db: typeof prisma };

// HIGH — update by primary key only, no tenant key → cross-tenant write / IDOR.
export async function editInvoice() {
  return prisma.invoice.update({ where: { id }, data });
}

// HIGH — delete by id only, no tenant key → cross-tenant delete / IDOR.
export async function removeUser() {
  return prisma.user.delete({ where: { id } });
}

// HIGH — updateMany scoped only by status, no tenant key → mass cross-tenant write.
export async function publishAll() {
  return prisma.post.updateMany({ where: { status: "draft" }, data: { status: "live" } });
}

// HIGH — deleteMany with no tenant key → mass cross-tenant delete.
export async function purge() {
  return prisma.session.deleteMany({ where: { expired: true } });
}

// MEDIUM — findUnique by id only, no tenant key → possible IDOR read.
export async function getOrder() {
  return prisma.order.findUnique({ where: { id } });
}

// MEDIUM — findFirst by id only, no tenant key.
export async function firstDoc() {
  return prisma.document.findFirst({ where: { id } });
}

// MEDIUM — findMany filtered but missing tenant key (where IS visible).
export async function listProjects() {
  return prisma.project.findMany({ where: { archived: false } });
}

// HIGH — multi-line where, no tenant key.
export async function editBilling() {
  return prisma.billing.update({
    where: {
      id,
      status: "open",
    },
    data,
  });
}

// HIGH — delete with NO where at all (delete-all shape).
export async function nukeNotes() {
  return prisma.note.delete({});
}

// HIGH — accessor via ctx.db, update by id only.
export async function editViaCtx() {
  return ctx.db.ticket.update({ where: { id }, data });
}
