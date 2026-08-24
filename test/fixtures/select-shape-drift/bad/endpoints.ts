// The incident (#196): three endpoints build the same response from hand-copied
// `prisma.result` selects. Nothing here throws, logs, or fails a test — the
// consuming UI guards on the field that only one of them selects, so the button
// it renders simply never appears.

export async function listResults(prisma: any, tenantId: string) {
  return prisma.result.findMany({
    where: { booking: { tenantId } },
    select: { id: true, narrative: true, summary: true, status: true, createdAt: true },
  });
}

// Copy #2 — later grew `bookingId`, which the other two never learned. This is
// the drift: the endpoint the UI actually calls is the one WITHOUT it.
export async function getResult(prisma: any, id: string) {
  return prisma.result.findFirst({
    where: { id },
    select: {
      id: true,
      narrative: true,
      summary: true,
      status: true,
      createdAt: true,
      bookingId: true,
    },
  });
}

// Copy #3 — drifted the other way: `createdAt` was dropped when the share view
// stopped rendering a timestamp, and nobody put it back.
export async function resultForShare(prisma: any, id: string) {
  return prisma.result.findUniqueOrThrow({
    where: { id },
    select: { id: true, narrative: true, summary: true, status: true },
  });
}
