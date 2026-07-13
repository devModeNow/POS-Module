type AuthReq = { user?: Record<string, unknown> };

export const posOrgId = (req: AuthReq): number => {
  const n = Number(req.user?.['orgId'] ?? req.user?.['org_id'] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export const posUserId = (req: AuthReq): number => {
  const n = Number(req.user?.['sub'] ?? req.user?.['userId'] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export const posRoleName = (req: AuthReq): string =>
  String(req.user?.['roleName'] ?? req.user?.['rolename'] ?? '').trim().toLowerCase();

export const isPosCashier = (req: AuthReq): boolean => posRoleName(req).includes('cashier');

/** Non-cashier POS users receive sale + message notifications (cashiers: messages only). */
export const receivesPosAdminNotifications = (req: AuthReq): boolean => {
  if (isPosCashier(req)) return false;
  return posOrgId(req) > 0;
};
