import type { Prisma } from "@prisma/client";

// The same drift in the shape teams reach for to FIX it: two named select
// constants, one of which grew a column. The model comes from the generated
// type, not from the constant's name.
export const tokenPreview = {
  id: true,
  token: true,
  viewCount: true,
  expiresAt: true,
} satisfies Prisma.ResultTokenSelect;

export const tokenAdmin: Prisma.ResultTokenSelect = {
  id: true,
  token: true,
  viewCount: true,
  expiresAt: true,
  resultId: true,
};
