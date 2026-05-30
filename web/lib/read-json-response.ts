/** 安全解析 fetch 响应；避免 500 纯文本被当成 JSON 抛 cryptic 错误。 */
export async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (response.status >= 500) {
      throw new Error("服务暂时异常，请刷新页面后再试。");
    }
    const snippet = text.replace(/\s+/g, " ").slice(0, 80);
    throw new Error(snippet ? `请求失败：${snippet}` : `请求失败 (${response.status})`);
  }
}
