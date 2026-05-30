import { NextResponse } from "next/server";
import { isBetaClosed } from "@/lib/beta/config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { WECHAT_OPEN_APP_ID, WECHAT_OPEN_APP_SECRET, wechatRedirectUri } from "@/lib/wechat/config";

export const runtime = "nodejs";

type WechatTokenResponse = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

async function exchangeWechatCode(code: string) {
  const params = new URLSearchParams({
    appid: WECHAT_OPEN_APP_ID,
    secret: WECHAT_OPEN_APP_SECRET,
    code,
    grant_type: "authorization_code"
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${params}`);
  return (await response.json()) as WechatTokenResponse;
}

/** 微信扫码回调：换取 openid，在 Supabase 创建/登录用户后跳转到 /read。 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = url.origin;
  const fail = (message: string) => NextResponse.redirect(`${origin}/read?auth_error=${encodeURIComponent(message)}`);

  if (!code) return fail("微信授权未完成。");

  const cookieState = request.headers.get("cookie")?.match(/wechat_oauth_state=([^;]+)/)?.[1];
  if (!state || !cookieState || state !== cookieState) return fail("微信登录状态校验失败，请重试。");

  const token = await exchangeWechatCode(code);
  if (!token.openid) return fail(token.errmsg || "微信授权失败。");

  const admin = getSupabaseAdmin();
  if (!admin) return fail("服务端未配置 SUPABASE_SERVICE_ROLE_KEY，暂无法完成微信登录。");

  const openid = token.openid;
  const email = `wechat_${openid.slice(-20)}@users.ireading.top`;
  const passwordSeed = `${openid}:${WECHAT_OPEN_APP_SECRET}`.slice(0, 48);

  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const matched = existing.data.users.find(
    (user) => user.email === email || user.user_metadata?.wechat_openid === openid
  );

  if (!matched) {
    if (isBetaClosed()) {
      return fail("内测期间，新用户需要邀请码注册。微信登录仅限已有账号。");
    }
    const created = await admin.auth.admin.createUser({
      email,
      password: passwordSeed,
      email_confirm: true,
      user_metadata: { wechat_openid: openid, auth_provider: "wechat" }
    });
    if (created.error) return fail(created.error.message);
  }

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback?next=/read` }
  });
  if (link.error || !link.data.properties?.action_link) {
    return fail(link.error?.message || "无法创建登录会话。");
  }

  const response = NextResponse.redirect(link.data.properties.action_link);
  response.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
}
