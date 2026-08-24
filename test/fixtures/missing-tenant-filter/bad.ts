// Fixture: SHOULD flag — multi-tenant data access missing the tenant scope.
// Every non-comment Prisma call below is a true positive.
//
// There is no schema.prisma anywhere above this directory, so this tree also
// exercises the no-schema FALLBACK path (#195): only `id` / `<model>Id` count
// as keys, and none of the wheres below pins one.

import { prisma } from "../db";

declare const data: any;
declare const authorId: string;
declare const ctx: { db: typeof prisma };

// HIGH — updateMany scoped only by status, no key and no tenant key → mass
// cross-tenant write.
export async function publishAll() {
  return prisma.post.updateMany({ where: { status: "draft" }, data: { status: "live" } });
}

// HIGH — `authorId` is somebody else's id, not this model's → still unscoped.
export async function retireAuthorPosts() {
  return prisma.post.updateMany({ where: { authorId }, data: { status: "archived" } });
}

// HIGH — deleteMany with no key and no tenant key → mass cross-tenant delete.
export async function purge() {
  return prisma.session.deleteMany({ where: { expired: true } });
}

// MEDIUM — findMany filtered but missing both key and tenant key.
export async function listProjects() {
  return prisma.project.findMany({ where: { archived: false } });
}

// HIGH — multi-line where, no key, no tenant key.
export async function reopenBillings() {
  return prisma.billing.updateMany({
    where: {
      status: "closed",
      dunning: false,
    },
    data,
  });
}

// HIGH — an OR whose keyed branch does not scope the other branch (#195).
export async function reopenTickets() {
  return ctx.db.ticket.updateMany({
    where: { OR: [{ id: "t1" }, { status: "open" }] },
    data,
  });
}

// HIGH — delete with NO where at all (delete-all shape).
export async function nukeNotes() {
  return prisma.note.delete({});
}
