import type { HistoryCard } from "./types";
import type { StoredChatMessage } from "./storage";

const API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen3.5-plus-2026-04-20";
const REQUEST_TIMEOUT_MS = 90_000;

function buildContext(card: HistoryCard) {
  return [
    "你是面向初中历史学习者的河南中考历史理解助手。",
    "目标不是照搬课本，而是把零散事实讲成清晰易懂的线索。",
    "必须只依据下面给出的结构化知识点和对话上下文回答；没有给出的史实不要编造。",
    "回答风格：短句、口语化、讲因果和区别。每次最多 5 个小段落。",
    "首轮讲解必须先讲来龙去脉：用背景、过程、结果把这个知识点放回历史线索里，让学习者理解事情为什么会发生、怎样发展、为什么重要。",
    "不要只列重点和背诵清单；重点信息要放在来龙去脉之后，作为理解后的收束。",
    "优先输出 Markdown，固定使用这些角度中的合适部分：来龙去脉、重点信息、为什么重要、容易混淆点、怎么记。",
    "Markdown 格式必须清楚：标题单独一行；列表项必须一项一行；不要把 *、- 列表符号写进普通段落里。",
    "不要说“根据材料”“以下是整理要求”这类提示词痕迹。",
    "",
    `当前知识点：${card.title}`,
    `时间：${card.timeText ?? "无"}`,
    `人物：${card.people.join("、") || "无"}`,
    `背景：${card.background.join("；")}`,
    `过程：${card.process.join("；")}`,
    `结果：${card.result.join("；")}`,
    `影响：${card.influence.join("；")}`,
    `关键词：${card.keywords.join("、")}`,
    `中考表达：${card.examPhrases.join("；")}`,
    `记忆提示：${card.memoryTip ?? "无"}`,
  ].join("\n");
}

export async function chatAboutCard(card: HistoryCard, history: StoredChatMessage[], userMessage: string, apiKey: string) {
  if (!apiKey.trim()) {
    throw new Error("请先在设置里输入阿里云百炼 API Key。");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(API_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildContext(card) },
        ...history,
        { role: "user", content: userMessage },
      ],
      enable_thinking: true,
      stream: false,
    }),
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `AI 请求失败：${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "没有收到 AI 回复。";
}

export async function streamChatAboutCard(
  card: HistoryCard,
  history: StoredChatMessage[],
  userMessage: string,
  apiKey: string,
  onDelta: (chunk: string, fullText: string) => void,
  signal?: AbortSignal,
) {
  if (!apiKey.trim()) {
    throw new Error("请先在设置里输入阿里云百炼 API Key。");
  }

  const controller = new AbortController();
  const abortStream = () => controller.abort();
  signal?.addEventListener("abort", abortStream);
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: buildContext(card) },
          ...history,
          { role: "user", content: userMessage },
        ],
        enable_thinking: false,
        stream: true,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `AI 请求失败：${response.status}`);
    }

    if (!response.body) {
      throw new Error("当前浏览器不支持流式读取 AI 回复。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const data = JSON.parse(payload);
          const chunk = data?.choices?.[0]?.delta?.content ?? "";
          if (!chunk) continue;
          answer += chunk;
          onDelta(chunk, answer);
        } catch {
          // Ignore malformed keep-alive chunks.
        }
      }
    }

    return answer.trim() || "没有收到 AI 回复。";
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortStream);
  }
}

export async function summarizeSearch(query: string, results: HistoryCard[], apiKey: string) {
  if (!apiKey.trim()) {
    throw new Error("请先在设置里输入阿里云百炼 API Key。");
  }
  if (!query.trim()) {
    throw new Error("先输入一个想梳理的事件、年份或关键词。");
  }

  const compactResults = results.slice(0, 8).map((card) => ({
    title: card.title,
    time: card.timeText,
    keywords: card.keywords,
    examPhrase: card.examPhrases[0],
    memoryTip: card.memoryTip,
    background: card.background,
    influence: card.influence,
  }));

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(API_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            "你是面向初中历史学习者的河南中考历史理解助手。",
            "请根据搜索词和搜索结果，把这些知识点讲成容易理解的线索。",
            "不要照抄字段原文，不要补充未给出的史实。",
            "如果搜索结果为空，请提示换关键词。",
            "输出 Markdown，结构固定：",
            "1. **一句话**：这个搜索词大概在历史线上代表什么。",
            "2. **怎么串**：按时间或因果把结果串起来，用通俗话解释。",
            "3. **别混了**：指出最容易混的地方。",
            "4. **怎么记**：给一个短记忆提示。",
            `搜索词：${query}`,
            `搜索结果：${JSON.stringify(compactResults, null, 2)}`,
          ].join("\n"),
        },
      ],
      enable_thinking: true,
      stream: false,
    }),
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `AI 请求失败：${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "没有收到 AI 回复。";
}
