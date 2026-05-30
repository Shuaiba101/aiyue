import { isBetaClosed } from "@/lib/beta/config";

export const runtime = "nodejs";

/** 告知前端是否处于内测封闭期（无需鉴权）。 */
export async function GET() {
  return Response.json({ closed: isBetaClosed() });
}
