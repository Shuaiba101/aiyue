/** Tavily 按需联网搜索，供 /api/chat 与 chat-cli 共用。 */
export async function tavilySearch(book, query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { context: "", configured: false };

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${book} ${query}`,
      search_depth: "basic",
      max_results: 3,
      include_answer: false
    })
  });

  if (!response.ok) return { context: "", configured: true };

  const data = await response.json();
  const context = (data.results || [])
    .slice(0, 3)
    .map((item, index) => {
      return `[搜索结果${index + 1}] ${item.title || ""}\n${item.content || ""}\n${item.url || ""}`;
    })
    .join("\n\n");

  return { context, configured: true };
}

/** 读者明确要背景/介绍类信息（仍应短、不剧透）。 */
export function isBookBackgroundRequest(text) {
  return /介绍|背景|讲的什么|讲什么|是谁写|作者是谁|这本书是|了解一下|概况|主要内容|简介/.test(String(text || ""));
}
