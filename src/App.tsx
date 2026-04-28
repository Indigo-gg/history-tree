import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CircleX,
  Clock3,
  GitBranch,
  KeyRound,
  PackageCheck,
  Search,
  Sparkles,
  Star,
  Swords,
} from "lucide-react";
import cardsData from "../data/app/history-cards.sample.json";
import ancientCardsData from "../data/app/history-cards.ancient.json";
import ancientLateCardsData from "../data/app/history-cards.ancient-late.json";
import chinaModernExtraCardsData from "../data/app/history-cards.china-modern-extra.json";
import worldCardsData from "../data/app/history-cards.world.json";
import edgesData from "../data/app/history-edges.sample.json";
import ancientEdgesData from "../data/app/history-edges.ancient.json";
import ancientLateEdgesData from "../data/app/history-edges.ancient-late.json";
import chinaModernExtraEdgesData from "../data/app/history-edges.china-modern-extra.json";
import worldEdgesData from "../data/app/history-edges.world.json";
import confusionsData from "../data/app/confusions.sample.json";
import ancientConfusionsData from "../data/app/confusions.ancient.json";
import ancientLateConfusionsData from "../data/app/confusions.ancient-late.json";
import chinaModernExtraConfusionsData from "../data/app/confusions.china-modern-extra.json";
import worldConfusionsData from "../data/app/confusions.world.json";
import { streamChatAboutCard, summarizeSearch } from "./ai";
import {
  clearAiThread,
  loadAiThread,
  loadApiKey,
  loadStudyState,
  saveAiThread,
  saveApiKey,
  saveStudyState,
  type StoredChatMessage,
} from "./storage";
import type { ConfusionPair, HistoryCard, HistoryEdge, StudyState } from "./types";

const cards = [
  ...(ancientCardsData as HistoryCard[]),
  ...(ancientLateCardsData as HistoryCard[]),
  ...(cardsData as HistoryCard[]),
  ...(chinaModernExtraCardsData as HistoryCard[]),
  ...(worldCardsData as HistoryCard[]),
];
const cardsById = new Map(cards.map((card) => [card.id, card]));
const graphEdges = [
  ...(ancientEdgesData as HistoryEdge[]),
  ...(ancientLateEdgesData as HistoryEdge[]),
  ...(edgesData as HistoryEdge[]),
  ...(chinaModernExtraEdgesData as HistoryEdge[]),
  ...(worldEdgesData as HistoryEdge[]),
];
const confusions = [
  ...(ancientConfusionsData as ConfusionPair[]),
  ...(ancientLateConfusionsData as ConfusionPair[]),
  ...(confusionsData as ConfusionPair[]),
  ...(chinaModernExtraConfusionsData as ConfusionPair[]),
  ...(worldConfusionsData as ConfusionPair[]),
];

type View = "tree" | "timeline" | "confusions" | "review";
type TreeScope = "ancient" | "china" | "world";
type TutorStatus = "idle" | "loading" | "error";
type CardStudyState = "mastered" | "confusing" | "review" | "fresh";

const FIRST_EXPLANATION_PROMPT =
  "请先帮我把这个知识点讲明白，不要只列考点。请按固定结构输出：1. 来龙去脉：先用通俗语言讲它为什么会发生、怎么一步步发展到这个结果；2. 重点信息：再提炼中考需要记住的时间、人物、性质或结论；3. 为什么重要：说明它带动了哪条历史线索；4. 容易混淆点；5. 怎么记。";
const FIRST_EXPLANATION_DISPLAY = "先帮我讲明白。";

const viewItems: { id: View; label: string; icon: typeof GitBranch }[] = [
  { id: "tree", label: "知识树", icon: GitBranch },
  { id: "timeline", label: "时间轴", icon: Clock3 },
  { id: "confusions", label: "易混点", icon: Swords },
  { id: "review", label: "复习包", icon: PackageCheck },
];

const treeScopeItems: { id: TreeScope; label: string }[] = [
  { id: "ancient", label: "古代史" },
  { id: "china", label: "中国近现代" },
  { id: "world", label: "世界史" },
];

function PixelIcon({ tone = "blue" }: { tone?: "blue" | "green" | "amber" | "red" }) {
  return <span className={`pixel-icon pixel-${tone}`} aria-hidden="true" />;
}

function PixelMascot() {
  return (
    <div className="pixel-mascot" aria-hidden="true">
      <span className="eye left" />
      <span className="eye right" />
      <span className="book" />
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>,
  );
}

const markdownSectionHeadings = new Set([
  "来龙去脉",
  "用一句话理解",
  "重点信息",
  "为什么重要",
  "容易混淆点",
  "一句话",
  "怎么串",
  "别混了",
  "怎么记",
]);

function normalizeAiMarkdown(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+([*-])\s+(?=(?:\*\*)?[^：:\n]{1,28}[：:])/g, "\n$1 ")
    .replace(/(^|\n)(来龙去脉|用一句话理解|重点信息|为什么重要|容易混淆点|一句话|怎么串|别混了|怎么记)\s+(?=\S)/g, "$1$2\n")
    .replace(/([^\n])\n([*-]\s+)/g, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getMarkdownHeading(line: string) {
  const trimmed = line.trim();
  const markdownHeading = trimmed.match(/^#{1,4}\s+(.+)$/);
  if (markdownHeading) return markdownHeading[1].replace(/\*\*/g, "").trim();
  return markdownSectionHeadings.has(trimmed) ? trimmed : "";
}

function MarkdownText({ text }: { text: string }) {
  const blocks = normalizeAiMarkdown(text).split(/\n{2,}/);

  return (
    <div className="markdown-output">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
        const elements: ReactNode[] = [];
        let paragraphLines: string[] = [];
        let listItems: string[] = [];

        function flushParagraph() {
          if (!paragraphLines.length) return;
          const currentLines = paragraphLines;
          paragraphLines = [];
          elements.push(
            <p key={`p-${elements.length}`}>
              {currentLines.map((line, lineIndex) => (
                <Fragment key={`${line}-${lineIndex}`}>
                  {renderInlineMarkdown(line)}
                  {lineIndex < currentLines.length - 1 ? <br /> : null}
                </Fragment>
              ))}
            </p>,
          );
        }

        function flushList() {
          if (!listItems.length) return;
          const currentItems = listItems;
          listItems = [];
          elements.push(
            <ul key={`ul-${elements.length}`}>
              {currentItems.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>,
          );
        }

        lines.forEach((line) => {
          const heading = getMarkdownHeading(line);
          if (heading) {
            flushParagraph();
            flushList();
            elements.push(<h3 key={`h-${elements.length}`}>{heading}</h3>);
            return;
          }

          const listItem = line.match(/^[-*]\s+(.+)$/);
          if (listItem) {
            flushParagraph();
            listItems.push(listItem[1]);
            return;
          }

          flushList();
          paragraphLines.push(line);
        });

        flushParagraph();
        flushList();

        return <Fragment key={index}>{elements}</Fragment>;
      })}
    </div>
  );
}

function KnowledgeNode({ data }: NodeProps<Node<{ card: HistoryCard; active: boolean; state: string }>>) {
  return (
    <button className={`flow-node ${data.active ? "active" : ""} ${data.state}`}>
      <Handle type="target" position={Position.Left} />
      <PixelIcon tone={data.state === "mastered" ? "green" : data.state === "confusing" ? "amber" : "blue"} />
      <span>
        <strong>{data.card.title}</strong>
        <small>{data.card.timeText || data.card.textbook.lesson}</small>
      </span>
      <Handle type="source" position={Position.Right} />
    </button>
  );
}

const nodeTypes = { knowledge: KnowledgeNode };

function uniqueToggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function getNodeState(card: HistoryCard, state: StudyState): CardStudyState {
  if (state.masteredIds.includes(card.id)) return "mastered";
  if (state.confusingIds.includes(card.id)) return "confusing";
  if (state.reviewIds.includes(card.id)) return "review";
  return "fresh";
}

function getStudyStateLabel(state: CardStudyState) {
  if (state === "mastered") return "已掌握";
  if (state === "confusing") return "易混";
  if (state === "review") return "复习";
  return "";
}

function cardInTreeScope(card: HistoryCard, scope: TreeScope) {
  if (scope === "ancient") return card.period === "china-ancient";
  if (scope === "china") return card.period === "china-modern" || card.period === "china-contemporary";
  return card.period === "world-ancient" || card.period === "world-modern";
}

function parseCenturyStart(century: number) {
  return (century - 1) * 100;
}

function getSortYear(card: HistoryCard) {
  const text = card.timeText ?? "";
  const beforeCommonEra = text.match(/公元前\s*(\d+)/);
  if (beforeCommonEra) return -Number(beforeCommonEra[1]);

  const yearsAgo = text.match(/距今约\s*(\d+)(?:\s*-\s*\d+)?\s*万年/);
  if (yearsAgo) return -Number(yearsAgo[1]) * 10000;

  const centuryRange = text.match(/(\d+)\s*-\s*(\d+)\s*世纪/);
  if (centuryRange) return parseCenturyStart(Number(centuryRange[1]));

  const century = text.match(/(\d+)\s*世纪/);
  if (century) {
    const base = parseCenturyStart(Number(century[1]));
    const decadeRange = text.match(/(\d{2})\s*-\s*\d{2}\s*年代/);
    if (decadeRange) return base + Number(decadeRange[1]);
    if (text.includes("90 年代") || text.includes("九十年代")) return base + 90;
    if (text.includes("80 年代") || text.includes("八十年代")) return base + 80;
    if (text.includes("70 年代") || text.includes("七十年代")) return base + 70;
    if (text.includes("60 年代") || text.includes("六十年代")) return base + 60;
    if (text.includes("50 年代") || text.includes("五十年代") || text.includes("四五十年代")) return base + 40;
    return base;
  }

  const normalYear = text.match(/(\d{3,4})/);
  if (normalYear) return Number(normalYear[1]);

  if (text.includes("传说")) return -5000;
  if (text.includes("夏朝")) return -2070;
  if (text.includes("西周")) return -1046;
  if (text.includes("东周") || text.includes("春秋")) return -770;
  if (text.includes("战国")) return -475;
  if (text.includes("秦朝")) return -221;
  if (text.includes("西汉")) return -202;
  if (text.includes("三国")) return 220;
  if (text.includes("魏晋南北朝")) return 220;
  if (text.includes("北魏")) return 386;
  if (text.includes("隋唐")) return 581;
  if (text.includes("隋朝")) return 581;
  if (text.includes("唐朝")) return 618;
  if (text.includes("唐太宗")) return 626;
  if (text.includes("武则天")) return 690;
  if (text.includes("唐玄宗")) return 712;
  if (text.includes("宋代")) return 960;
  if (text.includes("宋元")) return 960;
  if (text.includes("元朝")) return 1271;
  if (text.includes("明朝")) return 1368;
  if (text.includes("清朝")) return 1644;
  if (text.includes("一战后")) return 1919;
  if (text.includes("冷战结束后")) return 1991;
  return 99999;
}

function sortByTimeline(list: HistoryCard[]) {
  return [...list].sort((a, b) => getSortYear(a) - getSortYear(b));
}

function AppHeader({
  query,
  setQuery,
  apiKey,
  setApiKey,
  searchCount,
  onSummarizeSearch,
  searchSummaryStatus,
}: {
  query: string;
  setQuery: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  searchCount: number;
  onSummarizeSearch: () => void;
  searchSummaryStatus: "idle" | "loading" | "error";
}) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">
          <PixelIcon />
        </div>
        <div>
          <h1>历史知识树</h1>
          <p>把时间、事件和影响串起来</p>
        </div>
      </div>
      <label className="search-box">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事件、年份、关键词" />
        {query ? <span className="search-count">{searchCount}</span> : null}
      </label>
      <button className="summarize-button" onClick={onSummarizeSearch} disabled={!query.trim() || searchSummaryStatus === "loading"}>
        <Sparkles size={16} />
        {searchSummaryStatus === "loading" ? "整理中" : "AI整理"}
      </button>
      <button className="icon-button" onClick={() => setShowSettings((value) => !value)} title="AI 设置">
        <KeyRound size={18} />
      </button>
      {showSettings ? (
        <section className="settings-popover">
          <h2>AI 设置</h2>
          <button className="close-popover" onClick={() => setShowSettings(false)} title="关闭设置">
            <CircleX size={18} />
          </button>
          <p>API Key 只保存在当前浏览器本机，用于调用阿里云百炼兼容接口。</p>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="DASHSCOPE_API_KEY"
            type="password"
          />
          <button className="save-close" onClick={() => setShowSettings(false)}>
            保存并关闭
          </button>
        </section>
      ) : null}
    </header>
  );
}

function Sidebar({
  activeView,
  setActiveView,
  filteredCards,
  selectedId,
  selectCard,
}: {
  activeView: View;
  setActiveView: (view: View) => void;
  filteredCards: HistoryCard[];
  selectedId: string;
  selectCard: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <nav className="view-nav">
        {viewItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={activeView === item.id ? "selected" : ""} onClick={() => setActiveView(item.id)}>
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="section-title">知识点列表</div>
      <div className="lesson-list">
        {filteredCards.map((card) => (
          <button key={card.id} className={selectedId === card.id ? "selected" : ""} onClick={() => selectCard(card.id)}>
            <span>{card.title}</span>
            <small>{card.timeText}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function KnowledgeTree({
  selected,
  state,
  selectCard,
  visibleCards,
  treeScope,
  setTreeScope,
  renderInlineDetail,
}: {
  selected: HistoryCard;
  state: StudyState;
  selectCard: (id: string) => void;
  visibleCards: HistoryCard[];
  treeScope: TreeScope;
  setTreeScope: (scope: TreeScope) => void;
  renderInlineDetail: (card: HistoryCard) => ReactNode;
}) {
  const nodes = useMemo<Node[]>(() => {
    return visibleCards.map((card, index) => ({
      id: card.id,
      type: "knowledge",
      position: { x: (index % 2) * 310, y: Math.floor(index / 2) * 118 },
      data: {
        card,
        active: card.id === selected.id,
        state: getNodeState(card, state),
      },
    }));
  }, [selected.id, state, visibleCards]);

  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(visibleCards.map((card) => card.id));
    return graphEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type === "compare" ? "straight" : "smoothstep",
      markerEnd: edge.type === "compare" ? undefined : { type: MarkerType.ArrowClosed },
      className: `edge-${edge.type}`,
    }));
  }, [visibleCards]);

  return (
    <section className="tree-panel">
      <div className="panel-heading">
        <div>
          <h2>历史主线</h2>
          <p>先看顺序，再看每个节点为什么接在一起。</p>
        </div>
        <div className="heading-art">
          <PixelMascot />
          <span className="pixel-badge">主线</span>
        </div>
      </div>
      <div className="scope-tabs">
        {treeScopeItems.map((item) => (
          <button key={item.id} className={treeScope === item.id ? "active" : ""} onClick={() => setTreeScope(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <KnowledgeStoryline
        cards={visibleCards}
        selectedId={selected.id}
        selectCard={selectCard}
        state={state}
        renderInlineDetail={renderInlineDetail}
      />
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => selectCard(node.id)}
          fitView
          minZoom={0.35}
          maxZoom={1.35}
        >
          <Background color="#b8c6c2" gap={18} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>
    </section>
  );
}

function KnowledgeStoryline({
  cards,
  selectedId,
  selectCard,
  state,
  renderInlineDetail,
}: {
  cards: HistoryCard[];
  selectedId: string;
  selectCard: (id: string) => void;
  state: StudyState;
  renderInlineDetail: (card: HistoryCard) => ReactNode;
}) {
  return (
    <div className="storyline">
      {cards.map((card, index) => (
        <div key={card.id} className="story-item">
          <button className={`story-node ${selectedId === card.id ? "active" : ""}`} onClick={() => selectCard(card.id)}>
            <span className="bead-stack" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="story-index">{String(index + 1).padStart(2, "0")}</span>
            <strong>{card.title}</strong>
            <small>{card.timeText}</small>
            <em>{card.memoryTip || card.examPhrases[0]}</em>
            <span className={`state-dot ${getNodeState(card, state)}`} />
          </button>
          {selectedId === card.id ? renderInlineDetail(card) : null}
        </div>
      ))}
    </div>
  );
}

function CardDetailContent({
  card,
  studyState,
  updateStudyState,
  onOpenTutor,
  tutorBusy = false,
  activeTutorCardId,
}: {
  card: HistoryCard;
  studyState: StudyState;
  updateStudyState: (next: StudyState) => void;
  onOpenTutor: (cardId: string) => void;
  tutorBusy?: boolean;
  activeTutorCardId?: string;
}) {
  const tutorLocked = tutorBusy;
  const tutorLockTitle = activeTutorCardId === card.id ? "AI 正在生成回答" : "AI 正在讲另一个知识点";

  return (
    <>
      <div className="card-title-row">
        <div>
          <h2>{card.title}</h2>
          <p>{card.textbook.grade}年级{card.textbook.volume}册 · {card.textbook.lesson}</p>
        </div>
        <PixelIcon tone={studyState.confusingIds.includes(card.id) ? "amber" : "blue"} />
      </div>

      <div className="quick-facts">
        <span><Clock3 size={14} />{card.timeText || "时间待补充"}</span>
        <span><Star size={14} />重要度 {card.importance}</span>
      </div>

      <FactBlock title="一句话记忆" items={[card.memoryTip || card.examPhrases[0]]} />
      <FactBlock title="背景" items={card.background} />
      <FactBlock title="过程" items={card.process} />
      <FactBlock title="结果" items={card.result} />
      <FactBlock title="影响" items={card.influence} />

      <div className="keyword-cloud">
        {card.keywords.map((keyword) => (
          <span key={keyword}>{keyword}</span>
        ))}
      </div>

      <div className="detail-actions">
        <button onClick={() => updateStudyState({ ...studyState, reviewIds: uniqueToggle(studyState.reviewIds, card.id) })}>
          <BookOpen size={16} />
          {studyState.reviewIds.includes(card.id) ? "移出复习包" : "加入复习包"}
        </button>
        <button onClick={() => updateStudyState({ ...studyState, confusingIds: uniqueToggle(studyState.confusingIds, card.id) })}>
          <Brain size={16} />
          {studyState.confusingIds.includes(card.id) ? "取消易混" : "标记易混"}
        </button>
        <button onClick={() => updateStudyState({ ...studyState, masteredIds: uniqueToggle(studyState.masteredIds, card.id) })}>
          <Check size={16} />
          {studyState.masteredIds.includes(card.id) ? "取消掌握" : "已掌握"}
        </button>
      </div>

      <button
        className="ai-button"
        onClick={() => onOpenTutor(card.id)}
        disabled={tutorLocked}
        title={tutorLocked ? tutorLockTitle : "AI 帮我讲明白"}
      >
        <Sparkles size={17} />
        {tutorLocked ? "AI 正在生成中" : "AI 帮我讲明白"}
      </button>
    </>
  );
}

function DetailPanel({
  card,
  studyState,
  updateStudyState,
  onOpenTutor,
  tutorBusy,
  activeTutorCardId,
}: {
  card: HistoryCard;
  studyState: StudyState;
  updateStudyState: (next: StudyState) => void;
  onOpenTutor: (cardId: string) => void;
  tutorBusy: boolean;
  activeTutorCardId?: string;
}) {
  return (
    <aside className="detail-panel">
      <CardDetailContent
        card={card}
        studyState={studyState}
        updateStudyState={updateStudyState}
        onOpenTutor={onOpenTutor}
        tutorBusy={tutorBusy}
        activeTutorCardId={activeTutorCardId}
      />
    </aside>
  );
}

function TutorPanel({
  card,
  apiKey,
  visible,
  autoExplainKey,
  onStatusChange,
  onClose,
}: {
  card: HistoryCard;
  apiKey: string;
  visible: boolean;
  autoExplainKey: number;
  onStatusChange: (status: TutorStatus) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<StoredChatMessage[]>(() => loadAiThread(card.id));
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<TutorStatus>("idle");
  const panelRef = useRef<HTMLElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const statusRef = useRef<TutorStatus>("idle");
  const activeAbortRef = useRef<AbortController | null>(null);

  function updateStatus(next: TutorStatus) {
    statusRef.current = next;
    setStatus(next);
    onStatusChange(next);
  }

  useEffect(() => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    requestIdRef.current += 1;
    setMessages(loadAiThread(card.id));
    setDraft("");
    updateStatus("idle");
  }, [card.id]);

  useEffect(() => {
    if (!visible) return;
    const timeoutId = window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 30);
    return () => window.clearTimeout(timeoutId);
  }, [visible, card.id, autoExplainKey]);

  useEffect(() => {
    if (!visible || autoExplainKey === 0 || statusRef.current === "loading") return;
    const savedMessages = loadAiThread(card.id);
    void sendMessage(FIRST_EXPLANATION_PROMPT, savedMessages, FIRST_EXPLANATION_DISPLAY);
  }, [autoExplainKey, visible, card.id]);

  useEffect(() => {
    if (!visible) return;
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: status === "loading" ? "auto" : "smooth" });
  }, [messages, status, visible]);

  async function sendMessage(content: string, historyOverride?: StoredChatMessage[], displayContent?: string) {
    const trimmed = content.trim();
    if (!trimmed || statusRef.current === "loading") return;
    const history = historyOverride ?? messages;
    const visibleContent = displayContent?.trim() || trimmed;
    const nextMessages: StoredChatMessage[] = [...history, { role: "user", content: visibleContent }];
    const streamingMessages: StoredChatMessage[] = [...nextMessages, { role: "assistant", content: "" }];
    const requestId = requestIdRef.current + 1;
    const controller = new AbortController();
    requestIdRef.current = requestId;
    activeAbortRef.current?.abort();
    activeAbortRef.current = controller;
    setMessages(streamingMessages);
    saveAiThread(card.id, nextMessages);
    setDraft("");
    updateStatus("loading");
    try {
      const answer = await streamChatAboutCard(
        card,
        history,
        trimmed,
        apiKey,
        (_, fullText) => {
          if (requestIdRef.current !== requestId) return;
          setMessages([...nextMessages, { role: "assistant", content: fullText }]);
        },
        controller.signal,
      );
      if (requestIdRef.current !== requestId) return;
      const finalMessages: StoredChatMessage[] = [...nextMessages, { role: "assistant", content: answer }];
      setMessages(finalMessages);
      saveAiThread(card.id, finalMessages);
      updateStatus("idle");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      const errorMessage =
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 请求超时，请稍后重试。"
          : error instanceof Error
            ? error.message
            : "AI 请求失败。";
      const finalMessages: StoredChatMessage[] = [
        ...nextMessages,
        { role: "assistant", content: errorMessage },
      ];
      setMessages(finalMessages);
      saveAiThread(card.id, finalMessages);
      updateStatus("error");
    } finally {
      if (activeAbortRef.current === controller) {
        activeAbortRef.current = null;
      }
    }
  }

  function startExplain() {
    void sendMessage(FIRST_EXPLANATION_PROMPT, undefined, FIRST_EXPLANATION_DISPLAY);
  }

  function clearThread() {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    requestIdRef.current += 1;
    clearAiThread(card.id);
    setMessages([]);
    updateStatus("idle");
  }

  if (!visible) return null;

  return (
    <section className="tutor-panel" ref={panelRef} data-tutor-panel>
      <div className="tutor-head">
        <div>
          <h2>AI 学习助手</h2>
          <p>{status === "loading" ? "正在讲：" : "当前上下文："}{card.title}</p>
        </div>
        <div className="tutor-head-actions">
          <PixelMascot />
          <button className="tutor-close" onClick={onClose} title="关闭 AI 学习助手">
            <CircleX size={18} />
          </button>
        </div>
      </div>
      <div className="tutor-toolbar">
        <button onClick={startExplain} disabled={status === "loading"}>
          <Sparkles size={16} />
          {status === "loading" ? "讲解中..." : messages.length ? "再讲一遍重点" : "先讲明白"}
        </button>
        <button onClick={() => void sendMessage("这个知识点最容易和哪些内容混？请用对比方式解释。")} disabled={status === "loading"}>
          易混对比
        </button>
        <button onClick={clearThread} disabled={!messages.length || status === "loading"}>
          清空对话
        </button>
      </div>
      <div className="chat-log" ref={chatLogRef} aria-busy={status === "loading"}>
        {messages.length ? (
          messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
              <span>{message.role === "user" ? "我" : "AI"}</span>
              {message.role === "assistant" && !message.content.trim() && status === "loading" && index === messages.length - 1 ? (
                <p className="typing-placeholder">AI 正在组织回答...</p>
              ) : (
                <MarkdownText text={message.content} />
              )}
            </article>
          ))
        ) : (
          <div className="tutor-empty">
            <PixelMascot />
            <h3>开始 AI 对话</h3>
            <p>可生成讲解，也可以继续追问原因、区别和记忆方法。</p>
          </div>
        )}
        {status === "loading" ? (
          <div className="chat-thinking" role="status">
            <Sparkles size={15} />
            AI 正在生成回答，完成后可以继续追问...
          </div>
        ) : null}
      </div>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={status === "loading"}
          placeholder={status === "loading" ? "AI 正在生成，完成后可以继续问" : `继续问：${card.title} 为什么重要？`}
        />
        <button disabled={!draft.trim() || status === "loading"}>
          <ChevronRight size={18} />
        </button>
      </form>
    </section>
  );
}

function FactBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="fact-block">
      <h3>{title}</h3>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}

function SearchSummary({
  query,
  summary,
  status,
  onClear,
}: {
  query: string;
  summary: string;
  status: "idle" | "loading" | "error";
  onClear: () => void;
}) {
  if (!query.trim() && !summary) return null;
  return (
    <section className={`search-summary ${status === "error" ? "error" : ""}`}>
      <div className="search-summary-head">
        <strong>{query ? `“${query}” 怎么理解` : "搜索整理"}</strong>
        <span>把结果串成一条线</span>
        <button type="button" className="summary-clear" onClick={onClear} title="关闭整理结果">
          <CircleX size={16} />
        </button>
      </div>
      {status === "loading" ? <p>AI 正在把搜索结果整理成线索...</p> : null}
      {summary ? <MarkdownText text={summary} /> : null}
    </section>
  );
}

function SearchResults({
  query,
  results,
  selectedId,
  selectCard,
}: {
  query: string;
  results: HistoryCard[];
  selectedId: string;
  selectCard: (id: string) => void;
}) {
  if (!query.trim()) return null;
  return (
    <section className="search-results">
      <div className="search-results-head">
        <strong>找到 {results.length} 个相关点</strong>
        <span>选择知识点查看详情或进行 AI 梳理</span>
      </div>
      <div className="result-chips">
        {results.map((card) => (
          <button key={card.id} className={selectedId === card.id ? "active" : ""} onClick={() => selectCard(card.id)}>
            <span>{card.title}</span>
            <small>{card.timeText}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function TimelineView({
  timelineCards,
  selectedId,
  selectCard,
  studyState,
  renderInlineDetail,
}: {
  timelineCards: HistoryCard[];
  selectedId: string;
  selectCard: (id: string) => void;
  studyState: StudyState;
  renderInlineDetail: (card: HistoryCard) => ReactNode;
}) {
  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <h2>中外历史时间线</h2>
          <p>按时间把中国史和世界史排在一起，看同一时期的变化。</p>
        </div>
        <div className="heading-art">
          <PixelMascot />
          <span className="pixel-badge">时间线</span>
        </div>
      </div>
      <div className="timeline">
        {timelineCards.map((card, index) => {
          const cardState = getNodeState(card, studyState);
          const stateLabel = getStudyStateLabel(cardState);
          return (
            <div key={card.id} className="timeline-item">
              <button className={`${selectedId === card.id ? "active" : ""} ${cardState}`} onClick={() => selectCard(card.id)}>
                <span className="timeline-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="timeline-time">{card.timeText}</span>
                <strong>{card.title}</strong>
                <small>{card.examPhrases[0]}</small>
                {stateLabel ? <i className={`state-dot ${cardState}`} title={stateLabel} aria-label={stateLabel} /> : null}
              </button>
              {selectedId === card.id ? renderInlineDetail(card) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConfusionsView({
  selectedId,
  selectCard,
  renderInlineDetail,
}: {
  selectedId: string;
  selectCard: (id: string) => void;
  renderInlineDetail: (card: HistoryCard) => ReactNode;
}) {
  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <h2>易混点对比</h2>
          <p>用同一维度对齐，避免把意义、阶级、时间混在一起。</p>
        </div>
      </div>
      <div className="confusion-list">
        {confusions.map((confusion) => (
          <article key={confusion.id} className="confusion-card">
            <h3>{confusion.title}</h3>
            <table>
              <tbody>
                {confusion.dimensions.map((dimension) => (
                  <tr key={dimension.name}>
                    <th>{dimension.name}</th>
                    {confusion.nodeIds.map((id) => (
                      <td key={id} onClick={() => selectCard(id)}>
                        {dimension.values[id]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="confusion-stack">
              {confusion.nodeIds.map((id) => {
                const card = cardsById.get(id);
                if (!card) return null;
                return (
                  <button key={id} className={selectedId === id ? "active" : ""} onClick={() => selectCard(id)}>
                    <strong>{card.title}</strong>
                    {confusion.dimensions.map((dimension) => (
                      <span key={dimension.name}>
                        <b>{dimension.name}</b>
                        {dimension.values[id]}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
            <p className="memory-tip">{confusion.memoryTip}</p>
            <p className="common-mistake">{confusion.commonMistake}</p>
            {confusion.nodeIds.includes(selectedId) && cardsById.get(selectedId) ? renderInlineDetail(cardsById.get(selectedId)!) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewView({
  reviewCards,
  selectedId,
  selectCard,
  studyState,
  renderInlineDetail,
}: {
  reviewCards: HistoryCard[];
  selectedId: string;
  selectCard: (id: string) => void;
  studyState: StudyState;
  renderInlineDetail: (card: HistoryCard) => ReactNode;
}) {
  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <h2>考前复习包</h2>
          <p>加入复习包和标记易混的节点都会放在这里，方便集中攻克。</p>
        </div>
      </div>
      {reviewCards.length ? (
        <div className="review-grid">
          {reviewCards.map((card) => {
            const cardState = getNodeState(card, studyState);
            const stateLabel = getStudyStateLabel(cardState);
            return (
              <div key={card.id} className="review-item">
                <button className={`${selectedId === card.id ? "active" : ""} ${cardState}`} onClick={() => selectCard(card.id)}>
                  <PixelIcon tone={cardState === "confusing" ? "amber" : cardState === "mastered" ? "green" : "blue"} />
                  {stateLabel ? <span className={`state-pill ${cardState}`}>{stateLabel}</span> : null}
                  <strong>{card.title}</strong>
                  <small>{card.examPhrases[0]}</small>
                </button>
                {selectedId === card.id ? renderInlineDetail(card) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="pixel-hero" />
          <h3>暂无复习内容</h3>
          <p>加入复习包或标记易混的知识点会显示在这里。</p>
        </div>
      )}
    </section>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<View>("tree");
  const [query, setQuery] = useState("");
  const [studyState, setStudyState] = useState<StudyState>(() => loadStudyState());
  const [apiKey, setApiKeyState] = useState(() => loadApiKey());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [searchSummary, setSearchSummary] = useState("");
  const [searchSummaryStatus, setSearchSummaryStatus] = useState<"idle" | "loading" | "error">("idle");
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorCardId, setTutorCardId] = useState<string | undefined>(undefined);
  const [tutorStatus, setTutorStatus] = useState<TutorStatus>("idle");
  const [tutorAutoExplainKey, setTutorAutoExplainKey] = useState(0);
  const [treeScope, setTreeScope] = useState<TreeScope>("ancient");
  const searchSummaryRequestIdRef = useRef(0);

  useEffect(() => {
    saveStudyState({ ...studyState, selectedId });
  }, [studyState, selectedId]);

  function updateStudyState(next: StudyState) {
    setStudyState(next);
  }

  function setApiKey(value: string) {
    setApiKeyState(value);
    saveApiKey(value);
  }

  function selectCard(id: string) {
    setSelectedId(id);
    window.setTimeout(() => {
      document.querySelector(`[data-card-anchor="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 40);
  }

  function scrollTutorIntoView() {
    window.setTimeout(() => {
      document.querySelector("[data-tutor-panel]")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }

  function openTutor(cardId: string) {
    setTutorOpen(true);
    if (tutorStatus === "loading" && tutorCardId && tutorCardId !== cardId) {
      scrollTutorIntoView();
      return;
    }
    setTutorCardId(cardId);
    setTutorAutoExplainKey((value) => value + 1);
    scrollTutorIntoView();
  }

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return cards;
    return cards.filter((card) => {
      const haystack = [
        card.title,
        card.timeText,
        card.textbook.lesson,
        ...card.keywords,
        ...card.examPhrases,
        ...card.background,
        ...card.influence,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query]);

  const reviewCards = useMemo(() => {
    const queueIds = new Set([...studyState.reviewIds, ...studyState.confusingIds]);
    return cards.filter((card) => queueIds.has(card.id));
  }, [studyState.reviewIds, studyState.confusingIds]);
  const confusionCardIds = useMemo(() => new Set(confusions.flatMap((confusion) => confusion.nodeIds)), []);
  const treeCards = useMemo(() => filteredCards.filter((card) => cardInTreeScope(card, treeScope)), [filteredCards, treeScope]);
  const timelineCards = useMemo(() => sortByTimeline(filteredCards), [filteredCards]);

  function cardBelongsToView(cardId: string, view: View) {
    if (view === "tree") return treeCards.some((card) => card.id === cardId);
    if (view === "timeline") return timelineCards.some((card) => card.id === cardId);
    if (view === "confusions") return confusionCardIds.has(cardId);
    return reviewCards.some((card) => card.id === cardId);
  }

  function selectView(view: View) {
    setActiveView(view);
    setSelectedId(undefined);
  }

  function selectTreeScope(scope: TreeScope) {
    setTreeScope(scope);
    setSelectedId(undefined);
  }

  useEffect(() => {
    if (selectedId && !cardBelongsToView(selectedId, activeView)) {
      setSelectedId(undefined);
    }
  }, [activeView, selectedId, filteredCards, reviewCards, confusionCardIds]);

  const detailCard = selectedId && cardBelongsToView(selectedId, activeView) ? cards.find((card) => card.id === selectedId) : undefined;
  const tutorCard = tutorCardId ? cardsById.get(tutorCardId) : undefined;
  const tutorBusy = tutorStatus === "loading";

  function renderInlineDetail(card: HistoryCard) {
    return (
      <section className="inline-detail-card" data-card-anchor={card.id}>
        <CardDetailContent
          card={card}
          studyState={studyState}
          updateStudyState={updateStudyState}
          onOpenTutor={openTutor}
          tutorBusy={tutorBusy}
          activeTutorCardId={tutorCardId}
        />
      </section>
    );
  }

  async function handleSummarizeSearch() {
    const requestId = searchSummaryRequestIdRef.current + 1;
    searchSummaryRequestIdRef.current = requestId;
    setSearchSummaryStatus("loading");
    setSearchSummary("");
    try {
      const summary = await summarizeSearch(query, filteredCards, apiKey);
      if (searchSummaryRequestIdRef.current !== requestId) return;
      setSearchSummary(summary);
      setSearchSummaryStatus("idle");
    } catch (error) {
      if (searchSummaryRequestIdRef.current !== requestId) return;
      const errorMessage =
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 搜索整理超时，请稍后重试。"
          : error instanceof Error
            ? error.message
            : "AI 搜索整理失败。";
      setSearchSummary(errorMessage);
      setSearchSummaryStatus("error");
    }
  }

  function clearSearchSummary() {
    searchSummaryRequestIdRef.current += 1;
    setSearchSummary("");
    setSearchSummaryStatus("idle");
  }

  return (
    <div className="app-shell">
      <AppHeader
        query={query}
        setQuery={setQuery}
        apiKey={apiKey}
        setApiKey={setApiKey}
        searchCount={filteredCards.length}
        onSummarizeSearch={handleSummarizeSearch}
        searchSummaryStatus={searchSummaryStatus}
      />
      <main className="workspace">
        <Sidebar
          activeView={activeView}
          setActiveView={selectView}
          filteredCards={filteredCards}
          selectedId={detailCard?.id ?? ""}
          selectCard={selectCard}
        />
        <div className="main-area">
          <SearchResults query={query} results={filteredCards} selectedId={detailCard?.id ?? ""} selectCard={selectCard} />
          <SearchSummary query={query} summary={searchSummary} status={searchSummaryStatus} onClear={clearSearchSummary} />
          {tutorCard ? (
            <TutorPanel
              card={tutorCard}
              apiKey={apiKey}
              visible={tutorOpen}
              autoExplainKey={tutorAutoExplainKey}
              onStatusChange={setTutorStatus}
              onClose={() => setTutorOpen(false)}
            />
          ) : null}
          {activeView === "tree" ? (
            <KnowledgeTree
              selected={detailCard ?? treeCards[0] ?? cards[0]}
              state={studyState}
              selectCard={selectCard}
              visibleCards={treeCards}
              treeScope={treeScope}
              setTreeScope={selectTreeScope}
              renderInlineDetail={renderInlineDetail}
            />
          ) : null}
          {activeView === "timeline" ? (
            <TimelineView
              timelineCards={timelineCards}
              selectedId={detailCard?.id ?? ""}
              selectCard={selectCard}
              studyState={studyState}
              renderInlineDetail={renderInlineDetail}
            />
          ) : null}
          {activeView === "confusions" ? (
            <ConfusionsView selectedId={detailCard?.id ?? ""} selectCard={selectCard} renderInlineDetail={renderInlineDetail} />
          ) : null}
          {activeView === "review" ? (
            <ReviewView
              reviewCards={reviewCards}
              selectedId={detailCard?.id ?? ""}
              selectCard={selectCard}
              studyState={studyState}
              renderInlineDetail={renderInlineDetail}
            />
          ) : null}
        </div>
        {detailCard ? (
          <DetailPanel
            card={detailCard}
            studyState={studyState}
            updateStudyState={updateStudyState}
            onOpenTutor={openTutor}
            tutorBusy={tutorBusy}
            activeTutorCardId={tutorCardId}
          />
        ) : (
          <aside className="detail-panel detail-placeholder">
            <PixelMascot />
            <h2>选择知识点</h2>
            <p>知识点详情和学习操作会显示在这里。</p>
          </aside>
        )}
      </main>
      <nav className="mobile-tabs">
        {viewItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={activeView === item.id ? "selected" : ""} onClick={() => selectView(item.id)}>
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
