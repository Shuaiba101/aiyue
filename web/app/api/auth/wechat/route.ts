import { NextResponse } from "next/server";
import { isWechatLoginConfigured, WECHAT_OPEN_APP_ID, wechatRedirectUri } from "@/lib/wechat/config";

export const runtime = "nodejs";

function randomState(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 返回微信网站应用扫码登录地址（需配置 WECHAT_OPEN_APP_ID / SECRET）。 */
export async function GET(request: Request) {
  if (!isWechatLoginConfigured()) {
    return NextResponse.json({ enabled: false, error: "微信登录尚未配置。" });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = encodeURIComponent(wechatRedirectUri(origin));
  const state = randomState();
  const url =
    `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_OPEN_APP_ID}` +
    `&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;

  const response = NextResponse.json({ enabled: true, url });
  response.cookies.set("wechat_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/"
  });
  return response;
}
