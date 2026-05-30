import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(1).max(500),
  lastBook: z.string().min(1).max(200),
  welcomeHint: z.string().optional()
});

type ClassifyResult = {
  intent: "continue" | "new_book" | "new_book_pending" | "title";
  book: string;
};

/** 规则无法判断时，用 DeepSeek 理解「继续读还是换一本」类回复。 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "请求格式不对。" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ intent: "continue", book: parsed.data.lastBook });
  }

  const { text, lastBook, welcomeHint } = parsed.data;
  const system = `你是阅读助手 i阅 的意图分类器。读者尚未进入某本书的阅读界面。
上一本在读的书是《${lastBook}》。
${welcomeHint ? `界面刚问过读者：${welcomeHint}` : ""}

判断读者这句话的意图，只输出一行 JSON，不要其它文字：
- {"intent":"continue","book":"${lastBook}"} — 继续读上一本、 affirmative、解释读过了等
- {"intent":"new_book_pending","book":""} — 想换书但没给新书名
- {"intent":"title","book":"书名"} — 读者直接给出了新书名（去掉书名号）

读者说：「${text}」`;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: system }],
        temperature: 0.1,
        max_tokens: 120
      })
    });

    if (!response.ok) {
      return Response.json({ intent: "continue", book: lastBook });
    }

    const data = await response.json();
    const raw = String(data.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ intent: "continue", book: lastBook });
    }

    const result = JSON.parse(jsonMatch[0]) as ClassifyResult;
    if (result.intent === "continue") {
      return Response.json({ intent: "continue", book: lastBook });
    }
    if (result.intent === "new_book_pending") {
      return Response.json({ intent: "new_book_pending", book: "" });
    }
    if (result.intent === "title" && result.book?.trim()) {
      return Response.json({ intent: "title", book: result.book.trim() });
    }
    return Response.json({ intent: "continue", book: lastBook });
  } catch {
    return Response.json({ intent: "continue", book: lastBook });
  }
}
