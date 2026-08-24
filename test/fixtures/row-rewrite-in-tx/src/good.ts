// Fixture: MUST NOT flag — every shape here is either declared transient by
// ../prisma/schema.prisma, loses nothing, or is not a rewrite at all.

import { Prisma } from "@prisma/client";
import { prisma } from "../db";

declare const rows: any[];
declare const narrative: string;

// The legitimate cascade delete: BiomarkerValue and AiSuggestion declare
// `onDelete: Cascade`, so the schema itself says these rows live and die with
// their Result. Replacing the whole set is the documented pattern, not a
// rewrite of durable state — the hand-delete is only there to order the writes.
export async function replaceDerivedRows(resultId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.biomarkerValue.deleteMany({ where: { resultId } });
    await tx.biomarkerValue.createMany({ data: rows });
    await tx.aiSuggestion.deleteMany({ where: { resultId } });
    await tx.aiSuggestion.createMany({ data: rows });
  });
}

// An upsert is the correct spelling of "make this row match" — it preserves
// every column it does not name.
export async function upsertResult(bookingId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.result.upsert({
      where: { bookingId },
      create: { bookingId, narrative },
      update: { narrative },
    });
  });
}

// Deleted, not recreated: a real retention delete keeps no identity alive.
export async function purgeResult(bookingId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.resultToken.deleteMany({ where: { result: { bookingId } } });
    await tx.result.deleteMany({ where: { bookingId } });
  });
}

// Create-then-delete is not a rewrite: the row that survives is the new one and
// nothing was read back off the old one.
export async function supersedeResult(bookingId: string, oldId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.result.create({ data: { bookingId, narrative } });
    await tx.result.deleteMany({ where: { id: oldId } });
  });
}

// Different models: deleting a token and creating a Result loses nothing that
// the create does not restore, because they are not the same row.
export async function detachToken(bookingId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.resultToken.deleteMany({ where: { result: { bookingId } } });
    await tx.booking.create({ data: { tenantId: "t1" } });
  });
}

// Durable (no cascade), but every column of DailyMetric is required with no
// default, so the create has to restore all of them. Nothing can silently
// reset, so there is nothing to report.
export async function rebuildMetric(day: string, bookingId: string, total: number) {
  return prisma.$transaction(async (tx) => {
    await tx.dailyMetric.deleteMany({ where: { day } });
    await tx.dailyMetric.create({ data: { day, bookingId, total } });
  });
}

// A model the schema does not declare is UNDECIDED: without a cascade to read,
// the rule cannot tell a durable row from a transient one, and it does not
// guess. Counted on stderr, never reported.
export async function rebuildLegacy(bookingId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.legacyThing.deleteMany({ where: { bookingId } });
    await tx.legacyThing.create({ data: { bookingId } });
  });
}

// Not one transaction: the create runs on the base client, so the pair is not
// atomic and `upsert` is not the fix — a delete that commits without its create
// is a different defect, and this rule does not claim it.
export async function mixedClients(resultId: string, token: string) {
  return prisma.$transaction(async (tx) => {
    await tx.resultToken.deleteMany({ where: { resultId } });
    await prisma.resultToken.create({ data: { resultId, token } });
  });
}

// No transaction at all — outside a transaction the delete is durable on its
// own, which this rule leaves to the reader.
export async function looseRewrite(resultId: string, token: string) {
  await prisma.resultToken.deleteMany({ where: { resultId } });
  await prisma.resultToken.create({ data: { resultId, token } });
}

// The helper form with nothing to pair: a transient child replaced wholesale.
export async function refreshBiomarkers(tx: Prisma.TransactionClient, resultId: string) {
  await tx.biomarkerValue.deleteMany({ where: { resultId } });
  await tx.biomarkerValue.createMany({ data: rows });
}
