// Fixture: MUST be 0 hits — keys come from ../prisma/schema/*.prisma, a
// multi-file Prisma schema folder (#195).

import { prisma } from "../db";

declare const id: string;
declare const token: string;
declare const number: string;

// @id declared in billing.prisma.
export async function voidInvoice() {
  return prisma.invoice.update({ where: { id }, data: { status: "void" } });
}

// The @@unique composite's declared client name (`name: "invoiceRef"`).
export async function byRef(customerId: string) {
  return prisma.invoice.findFirst({ where: { invoiceRef: { customerId, number } } });
}

// @unique declared in access.prisma — a different file of the same schema.
export async function revoke() {
  return prisma.apiToken.updateMany({ where: { token }, data: { revokedAt: new Date() } });
}
