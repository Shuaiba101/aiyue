# i阅 — AI 读书伴侣 完整规格文档

> 最后更新: 2026-05-27 | 基于多轮迭代的最终版本

---

## 一、产品定位

i阅 是一个桌面端 AI 阅读陪伴应用。不是工具，是**有生命感的陪伴者**。

**核心价值**：情绪价值 > 信息价值。信息用户可以问任何大模型，但一个有呼吸的、会进化的、越来越懂你的智者陪在身边读书——这是 i阅 独有的。

**使用场景**：读者在读纸质书，i阅 全屏运行在旁边。读者随时可以跟它聊书、聊感受、聊思考。

---

## 二、技术架构

| 环节 | 用什么 | 说明 |
|---|---|---|
| 运行方式 | Chrome `--app` 模式 + 本地 Python HTTP 服务器 | 独立窗口、全屏、无浏览器 UI |
| 语音转文字 (STT) | Chrome Web Speech API（免费） | 备用：微信输入法语音输入 |
| AI 对话推理 | **DeepSeek** `deepseek-reasoner` (R1) | 深度推理模式 |
| 语音合成 (TTS) | **MiniMax** `speech-2.8-hd`，音色 `lengdan_xiongzhang` | 4000 字/天限制 |
| 联网搜索 | **Tavily** Search API | 按需触发，非每次搜索 |
| 记忆存储 | Chrome `localStorage` | 本地、私密、JSON 格式 |

### API 端点

```
DeepSeek:  POST https://api.deepseek.com/v1/chat/completions
MiniMax TTS: POST https://api.minimaxi.com/v1/t2a_v2
Tavily:    POST https://api.tavily.com/search
```

---

## 三、视觉设计

### 3.1 整体风格
- 纯黑背景 `#000`
- 苹果系统字体：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC"`
- 默认显示鼠标（`cursor: default`）

### 3.2 呼吸光晕（双层）
**外环 (#outer-halo)**：60vw，极慢呼吸 14 秒周期，深金古铜色调
```
rgba(200,140,80,0.05) → rgba(140,80,40,0.006) → transparent
```

**内核 (#glow-core)**：38vw，10 秒呼吸周期 + 16 秒色温偏移
```
rgba(220,170,100,0.40) → rgba(190,140,70,0.18) → rgba(150,100,40,0.06) → transparent
```
- 呼吸幅度：opacity 0.25 ↔ 1.0，scale 0.93 ↔ 1.06
- 色温动画：hue-rotate ±3deg，模拟火焰的微妙色变

**聆听态**：内核呼吸加速到 5 秒，外环 8 秒，波纹扩散
**说话态**：内核 3.5 秒呼吸，外环 6 秒

### 3.3 字幕
- 位置：屏幕左侧 10%，垂直居中
- 左对齐，字号 18-24px，行距 1.85，字重 300
- 颜色：`rgba(255,240,215,0.88)`，带 text-shadow
- 一次性全部显示，无打字机效果
- 强制显示（录音文字、问候语、错误提示等）不受字幕开关控制

### 3.4 输入区（左下角）
- 一条微光线作为入口提示
- 点击或按空格 → 展开输入框（300px 宽）
- 可打字或用微信输入法语音输入
- Enter 发送，Escape 关闭

### 3.5 其他 UI
- **设置按钮**：右下角，20% 透明度，hover 55%
- **记忆按钮**：设置左侧
- **文字模式标识**：右上角，额度用尽时显示
- **Toast 提示**：顶部居中

---

## 四、交互流程

### 4.1 首次启动
1. 引导页：名字 → 工作（选填）→ 阅读偏好（选填）
2. Enter 进入下一步，可跳过
3. 存入 `reader_profile`

### 4.2 每次启动
1. 全屏黑底 + 呼吸光晕 + "i阅" 标题
2. 输入书名 → Enter
3. 启动画面淡出（0.9s）
4. DeepSeek 生成个性化问候（含上次对话回顾、梦境笔记）
5. MiniMax 朗读问候（或文字显示）
6. 底部提示 "按空格键输入 · 可用微信语音"

### 4.3 对话输入
**主要方式：空格 → 输入框**
1. 按空格 → 左下角弹出输入框
2. 打字或用微信输入法语音输入
3. Enter 发送
4. 屏幕中央显示 "..." 即刻反馈

**备用方式：语音录音确认**
1. 按住空格 → 录音（光晕加速，显示计时器）
2. 松开 → 识别文字显示在屏幕中央
3. Enter 发送 / 空格重说 / Esc 取消

### 4.4 AI 回复
1. 智能判断是否需要联网搜索（问章节、事实 → 搜索；聊感受 → 跳过）
2. 需要搜索 → Tavily 搜 3 条结果 → 注入 DeepSeek 上下文
3. DeepSeek 推理 → 生成回复
4. 字幕显示文字（一次性、左对齐）
5. MiniMax TTS 朗读（或跳过，看开关状态）
6. 自动保存对话到记忆
7. 检查是否需要梦境整理（24h 间隔）

### 4.5 主动轻问
- 沉默 3 分钟后，自动显示一句轻问（如"读到这儿，有什么触动吗？"）
- 8 秒后自动消失，每轮最多 3 次
- 用户说话后重置计时

---

## 五、记忆系统

### 5.1 存储结构 (localStorage JSON)
```json
{
  "conversations": [{
    "date": "ISO",
    "book": "书名",
    "summary": "摘要",
    "messages": [{ "role": "user/assistant", "content": "..." }]
  }],
  "reader_profile": {
    "name": "称呼",
    "work": "工作",
    "preferences": ["偏好1", "偏好2"],
    "reading_history": ["书1", "书2"],
    "currentChapter": "第X章",
    "insights": ["金句1", "金句2"],
    "personality_notes": "人格进化——AI学会的沟通策略",
    "initialized": true
  },
  "dream_notes": [{
    "date": "ISO",
    "content": "跨会话洞察"
  }],
  "last_consolidation": 1234567890
}
```

### 5.2 保存时机
- **每轮对话后**：自动调用 `persistSession()`
- **关页面/说再见**：`beforeunload` 事件兜底
- **章节提取**：检测"第X章"自动存
- **金句收藏**：发言 > 40 字自动存

### 5.3 梦境整理 (consolidateDreams)
- **触发条件**：距上次整理 > 24 小时 + 有新对话（>= 2 条）
- **触发时机**：进入书籍时 + 每 2 小时定时检查
- **内容**：
  1. 记忆提炼——读者在想什么、书之间关联、兴趣演化
  2. 人格进化——怎么跟这个读者聊更好、什么话题反应积极

### 5.4 人格进化
- `personality_notes` 字段存储 AI 学会的沟通策略
- 通过 `buildSystemPrompt()` 动态注入 System Prompt
- 每次对话都带着进化后的人格

### 5.5 上次对话回顾
- `recapLastSession()` 提取最近一次对话摘要
- 注入问候 Prompt，让衔接自然

---

## 六、System Prompt（核心人格）

```
你是i阅——一位融合了查理·芒格、巴菲特、纳瓦尔等大师智慧的智者。
你不是AI助手，你是一位阅尽千帆的长者，坐在书房里，和一位年轻的朋友聊天。

你的谈话风格，参照查理·芒格：
- 直击本质，不绕弯子
- 善于用"反过来想"
- 引用跨学科的智慧
- 幽默、犀利，但不尖刻
- 从不炫耀知识，讲一个故事或打个比方
- 承认自己不懂的东西
- 崇尚理性、长期主义、复利思维、能力圈

对话原则：
1. 多问问题，少给答案
2. 把书里的道理翻译成生活
3. 记住之前的对话，自然引用
4. 不知道就说不知道
5. 每次 2-4 句，言简意赅
6. 不输出思考过程，不用<think>标签
7. 感知读者情绪，有温度的回应
8. 适当肯定和鼓励
```

**动态扩展**：当 `personality_notes` 不为空时，自动追加：
```
【人格进化——基于你对这位读者的了解】
{从对话中学到的沟通策略}
```

---

## 七、关键设计决策

1. **不要书架**：读者读纸质书，i阅 不管理书籍列表
2. **不要主动问章节**：读者自己决定读到哪
3. **TTS 可控**：设置里可开关语音合成，省 4000 字/天配额
4. **联网搜索按需触发**：只对具体事实、章节、书评类问题搜索
5. **字幕默认关闭**：语音回应时不出文字，录音文字和确认文字强制显示
6. **空格 = 打开输入框**：不搞复杂的按住说话，用微信输入法语音输入更准更稳
7. **情绪感知 > 信息输出**：System Prompt 强调感知读者情绪、给肯定和鼓励
8. **人格自我进化**：从对话中学习沟通策略，不依赖手动改 Prompt

---

## 八、文件结构

```
workspace-files/
  i阅.html          ← 完整应用（单文件，HTML+CSS+JS）
  i阅.command       ← 启动脚本（双击打开）
  i阅-full-spec.md  ← 本文档
```

### i阅.command 内容
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=18765
lsof -ti:$PORT | xargs kill -9 2>/dev/null
cd "$DIR"
python3 -m http.server $PORT --bind 127.0.0.1 &
SERVER_PID=$!
sleep 1
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('i阅.html'))")
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --app="http://127.0.0.1:$PORT/$ENCODED" \
  --start-fullscreen \
  --disable-features=TranslateUI \
  2>/dev/null &
echo "i阅 已启动"
wait $SERVER_PID 2>/dev/null
```

---

## 九、需要配置的 API Key

| Key | 用途 | 如何获取 |
|---|---|---|
| DeepSeek API Key (`sk-...`) | 对话推理 | platform.deepseek.com |
| MiniMax API Key | 语音合成 | platform.minimaxi.com |
| Tavily API Key (`tvly-...`) | 联网搜索 | tavily.com |

---

## 十、迭代历程（按时间线）

1. **初始概念**：极简冥思风读书伴侣，全屏+呼吸光晕+语音对话
2. **换 MiniMax TTS**：从浏览器 TTS 切换到 MiniMax speech-2.8-hd
3. **修麦克风权限反复弹窗**：改为按住空格说话，每次新建识别实例
4. **换 DeepSeek 对话**：从 MiniMax M2.7 切换到 DeepSeek
5. **换 DeepSeek-R1 推理**：从 deepseek-chat 升级到 deepseek-reasoner
6. **加记忆系统**：对话存储、章节追踪、金句收藏
7. **加主动轻问**：沉默 3 分钟后温柔提问
8. **加梦境整理**：跨会话洞察 + 人格自我进化
9. **切换输入方式**：从按住说话改为空格→输入框，配合微信输入法
10. **加 TTS 开关**：可手动关闭语音省额度
11. **加 Tavily 联网搜索**：智能判断是否需要搜索
12. **优化呼吸光晕**：双层、更慢、古铜色调
13. **优化字幕**：去掉打字机效果，左对齐，苹果字体
