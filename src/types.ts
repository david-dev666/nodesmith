/** 结构图上的一个方块 */
export interface DiagramNode {
  id: string;
  /** 方块里的主文字 */
  label: string;
  /** 方块里的补充说明（小字），可空 */
  detail?: string;
  /** 分组名，同组共用一种颜色；可空 */
  group?: string;
}

/** 两个方块之间的一条连线 */
export interface DiagramEdge {
  from: string;
  to: string;
  /** 连线上的文字，可空 */
  label?: string;
}

/** 一张结构图 */
export interface Diagram {
  id: string;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 对图的原子操作。
 *
 * agent 的工具最终都会落到这上面 —— 校验逻辑（id 是否存在、会不会成环）
 * 只有这一份实现，工具层不用再写一遍。
 */
export type DiagramOp =
  | { op: 'add'; label: string; detail?: string; group?: string; parentId?: string }
  | { op: 'update'; id: string; label?: string; detail?: string; group?: string }
  | { op: 'remove'; id: string }
  | { op: 'link'; from: string; to: string; label?: string }
  | { op: 'unlink'; from: string; to: string }
  | { op: 'move'; id: string; parentId: string }
  | { op: 'title'; title: string };

/** 一次已经应用的编辑，用来撤销 */
export interface EditVersion {
  id: string;
  at: number;
  /** 这次改的是哪张图 */
  diagramId: string;
  diagramTitle: string;
  /** 用户当时说的那句话 */
  prompt: string;
  /** agent 的总结 */
  reply: string;
  opCount: number;
  /** 应用这一次编辑「之前」那张图的快照，撤销时直接还原 */
  before: Diagram;
}

/** 落盘的一整包：所有图 + 当前在看哪张 */
export interface DiagramStore {
  diagrams: Diagram[];
  activeId: string;
}

/* ============================================================
 * 下面是 agent 层
 * ============================================================ */

/** 模型发起的一次工具调用 */
export interface AgentToolCall {
  id: string;
  name: string;
  /** 模型给的原始 JSON 字符串，故意不预先解析 —— 解析失败也是正常的输入 */
  args: string;
}

/**
 * 会话里的一个步骤。
 *
 * 和聊天记录不同：这里既有给模型看的 tool 结果，也有给用户看的一行人话，
 * 因为两边需要的东西不一样 —— 模型要看完整数据，用户只想扫一眼发生了什么。
 */
export interface AgentStep {
  name: string;
  /** 给用户看的一行描述，比如「在「职业」下面加了 3 个方块」 */
  label: string;
  /** 这一步是否真的改动了图 */
  wrote: boolean;
  ok: boolean;
}

/** 会话里的一条消息。结构对齐 OpenAI 的 chat 格式，方便直接回灌给模型 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 发起的工具调用 */
  toolCalls?: AgentToolCall[];
  /** role === 'tool' 时，对应哪次调用 */
  toolCallId?: string;
  toolName?: string;
  /** 给用户看的一行描述（只对 tool 消息有意义） */
  label?: string;
  /** 这一步是否真的改动了图（只对 tool 消息有意义） */
  wrote?: boolean;
  /** 这一步有没有成功（只对 tool 消息有意义） */
  ok?: boolean;
  /** 这一轮的提案是否已经被用户确认（挂在每轮的第一条 user 消息上） */
  applied?: boolean;
  at: number;
}

/**
 * 一次会话（thread）。
 *
 * 图本身是结果，会话是过程 —— 过程必须留住，否则每句话都要从头解释。
 * 一张图可以有多个会话：这条路聊乱了，就新开一条从零开始，但图还是那张图。
 */
export interface AgentSession {
  /** 会话自己的 id，在同一张图下唯一 */
  id: string;
  diagramId: string;
  /** 会话标签，取第一句话的前几个字 */
  title?: string;
  messages: AgentMessage[];
  /** 被折叠掉的老消息压成的一段摘要 */
  summary: string;
  /** 一共折叠掉多少条，用来在界面上交代「更早的 N 条已收进摘要」 */
  compactedCount: number;
  updatedAt: number;
}

/** 一次 agent 运行的产物 */
export interface AgentRunOutcome {
  /** 沙盒里改完的图 —— 还没有提交到真正的图上 */
  draft: Diagram;
  /** agent 最后对用户说的话 */
  reply: string;
  steps: AgentStep[];
  /** agent 只读没写，等于没改动 */
  untouched: boolean;
}
