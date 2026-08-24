import type { Prisma } from "@prisma/client";

// 1. Two endpoints projecting the SAME Booking keys. Duplication is not drift —
//    the sets are equal, so there is no symmetric difference to report and this
//    rule has nothing to say.
export async function listBookings(prisma: any) {
  return prisma.booking.findMany({
    select: { id: true, reference: true, customerName: true, scheduledAt: true },
  });
}

export async function bookingById(prisma: any, id: string) {
  return prisma.booking.findUnique({
    where: { id },
    select: { id: true, reference: true, customerName: true, scheduledAt: true },
  });
}

// 2. A genuinely different projection of the same model: 1 of 6 keys shared,
//    far below the threshold. Two queries selecting different things is not a
//    copy that drifted.
export async function bookingContacts(prisma: any) {
  return prisma.booking.findMany({ select: { id: true, phone: true, email: true } });
}

// 3. The fix for this rule — one shared constant, referenced rather than
//    copied. The constant's own shape is read (the generated type names the
//    model) and it equals the copies above, so it is silent; the `select:
//    BOOKING_CARD` reference below is not a literal at all, so that block is
//    undecidable and drops out of the corpus. A select that has already been
//    extracted must never be reported as drifting from itself.
const BOOKING_CARD = {
  id: true,
  reference: true,
  customerName: true,
  scheduledAt: true,
} satisfies Prisma.BookingSelect;

export async function bookingCard(prisma: any, id: string) {
  return prisma.booking.findUnique({ where: { id }, select: BOOKING_CARD });
}

// 4. A spread makes the shape unreadable. Half a key set would compare as drift
//    against its own complete copy, so the block is dropped whole.
export async function bookingCardPlus(prisma: any, id: string) {
  return prisma.booking.findUnique({
    where: { id },
    select: { ...BOOKING_CARD, phone: true, email: true },
  });
}

// 5. A conditional value: whether `email` is projected is a runtime decision,
//    so the set is not statically known.
export async function bookingMaybeEmail(prisma: any, withEmail: boolean) {
  return prisma.booking.findMany({
    select: { id: true, reference: true, customerName: true, scheduledAt: true, email: withEmail },
  });
}

// 6. Not Prisma at all — `select` on a query builder whose keys are nothing the
//    schema declares for a model called `booking`. The schema is what rejects
//    it; no identifier was matched by name.
export function bookingReport(report: any) {
  return report.booking.findMany({ select: { total: true, bucket: true, windowStart: true } });
}
