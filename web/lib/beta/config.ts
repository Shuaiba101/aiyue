/** 内测模式：关闭开放注册，仅邀请码或已注册账号可进入。 */
export function isBetaClosed(): boolean {
  return process.env.BETA_CLOSED === "true" || process.env.BETA_CLOSED === "1";
}

/** 管理员在 Vercel 环境变量里配置的邀请码，逗号分隔。 */
export function getInviteCodes(): string[] {
  const raw = process.env.BETA_INVITE_CODES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

export function isValidInviteCode(code: string): boolean {
  const normalized = code.trim();
  if (!normalized) return false;
  const codes = getInviteCodes();
  if (!codes.length) return false;
  return codes.some((item) => item === normalized);
}
