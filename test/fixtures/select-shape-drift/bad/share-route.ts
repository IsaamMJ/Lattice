// A fourth copy, nested one level down. `result` is a relation on ResultToken,
// so the inner select is a projection of Result — which only the schema can
// say. It drifts from getResult()'s copy in endpoints.ts by one column.

export async function shareRoute(db: any, token: string) {
  return db.resultToken.findUnique({
    where: { token },
    select: {
      token: true,
      viewCount: true,
      result: {
        select: { id: true, narrative: true, summary: true, createdAt: true, bookingId: true },
      },
    },
  });
}
