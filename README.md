# i阅 / ireading

AI 阅读陪伴产品。你读纸质书，i阅 安静地在旁边——有灵感、疑问或触动，说给它听，它会陪你想下去，并且越来越懂你。

- **网页版（商业化）**：`web/` — Next.js，部署在 [ireading.top](https://ireading.top)
- **桌面版（本地化）**：Electron + 单文件 HTML，数据留在本机
- **共享内核**：`web/lib/core.mjs` — 记忆、人格、克制的自我进化

## 本地开发

```bash
cd web
cp .env.example .env.local   # 填入 DeepSeek / MiMo / Tavily / Supabase key
npm install
npm run dev                  # http://localhost:3000
```

## 部署

网页版走 **Vercel + GitHub 自动部署**。环境变量在 Vercel 控制台配置，不要提交 `.env.local`。

详见 [部署上线指南.md](./部署上线指南.md)。

## 迭代智能体

核心提示词与记忆逻辑在 `web/lib/core.mjs`：

- `buildSystemPrompt` — 对话人格 + 两层记忆 + 克制原则
- `captureTurn` / `recordConversation` — 沉淀笔记与思想节点
- `buildConsolidationMessages` / `applyConsolidation` — 夜间进化，越来越懂「人」

改完 push 到 `main`，Vercel 自动上线。
