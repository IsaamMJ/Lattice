// Fixture: fail-open in an auth/guard file. The catch returns a permissive
// value, so a failed permission check silently grants access — HIGH.

export async function canActivate(ctx: Context): Promise<boolean> {
  try {
    const token = ctx.headers.authorization;
    return await verifyToken(token);
  } catch (e) {
    return true;                       // fail-open
  }
}
