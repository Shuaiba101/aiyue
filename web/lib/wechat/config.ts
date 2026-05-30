export const WECHAT_OPEN_APP_ID = process.env.WECHAT_OPEN_APP_ID || "";
export const WECHAT_OPEN_APP_SECRET = process.env.WECHAT_OPEN_APP_SECRET || "";

export function isWechatLoginConfigured(): boolean {
  return Boolean(WECHAT_OPEN_APP_ID && WECHAT_OPEN_APP_SECRET);
}

export function wechatRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/wechat/callback`;
}
