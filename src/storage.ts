import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AgentMessage,
  AgentSession,
  AgentToolCall,
  Diagram,
  DiagramEdge,
  DiagramNode,
  DiagramStore,
  EditVersion,
} from './types';
import { newId } from './utils/graph';

const STORE_KEY = 'nodesmith.store.v1';
const HISTORY_KEY = 'nodesmith.history.v1';
/** v2 起：一张图对应一个会话数组 */
const SESSIONS_KEY = 'nodesmith.sessions.v2';
const SESSIONS_KEY_V1 = 'nodesmith.sessions.v1';
const ACTIVE_THREAD_KEY = 'nodesmith.sessions.active.v1';
const SEED_SOURCE_KEY = 'nodesmith.seed.source.v1';
const API_KEY_KEY = 'nodesmith.ai.key.v1';
const MODEL_KEY = 'nodesmith.ai.model.v1';

/** 历史最多留这么多条，超出的从旧的开始挤掉 */
export const HISTORY_LIMIT = 30;

/* ---------------- 校验 ---------------- */

function isValidNode(value: unknown): value is DiagramNode {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    (v.detail === undefined || typeof v.detail === 'string') &&
    (v.group === undefined || typeof v.group === 'string')
  );
}

function isValidEdge(value: unknown): value is DiagramEdge {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    (v.label === undefined || typeof v.label === 'string')
  );
}

/** 结构校验：任何一项对不上就整张丢掉，绝不半信半疑地渲染 */
function normalizeDiagram(value: unknown): Diagram | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  if (!Array.isArray(v.nodes) || !v.nodes.every(isValidNode)) return null;
  if (!Array.isArray(v.edges) || !v.edges.every(isValidEdge)) return null;

  // 指向不存在节点的边，直接剔掉
  const ids = new Set((v.nodes as DiagramNode[]).map((node) => node.id));
  const edges = (v.edges as DiagramEdge[]).filter(
    (edge) => ids.has(edge.from) && ids.has(edge.to),
  );

  return {
    id: v.id,
    title: v.title,
    nodes: v.nodes as DiagramNode[],
    edges,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now(),
  };
}

function isValidVersion(value: unknown): value is EditVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.at === 'number' &&
    typeof v.diagramId === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.reply === 'string' &&
    typeof v.opCount === 'number' &&
    normalizeDiagram(v.before) !== null
  );
}

/* ---------------- 图 ---------------- */

export async function loadStore(): Promise<DiagramStore | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const v = parsed as { diagrams?: unknown; activeId?: unknown };
    if (!Array.isArray(v.diagrams)) return null;

    const diagrams = v.diagrams
      .map(normalizeDiagram)
      .filter((item): item is Diagram => item !== null);
    if (!diagrams.length) return null;

    const activeId =
      typeof v.activeId === 'string' && diagrams.some((item) => item.id === v.activeId)
        ? v.activeId
        : diagrams[0].id;

    return { diagrams, activeId };
  } catch {
    return null;
  }
}

export async function saveStore(store: DiagramStore): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 写入失败不打断交互，下一次变更会重试
  }
}

/* ---------------- 种子指纹 ---------------- */

/**
 * 记录上次同步的「种子文件指纹」。
 * 用户改了 src/config/seed.local.ts 后重启 App，
 * 指纹对不上就会用新种子覆盖本机数据，从而让文件改动生效。
 */
export async function loadSeedSource(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SEED_SOURCE_KEY);
  } catch {
    return null;
  }
}

export async function saveSeedSource(fingerprint: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SEED_SOURCE_KEY, fingerprint);
  } catch {
    // 同上
  }
}

/* ---------------- 编辑历史 ---------------- */

export async function loadHistory(): Promise<EditVersion[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidVersion);
  } catch {
    return [];
  }
}

export async function saveHistory(history: EditVersion[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // 同上
  }
}

/* ---------------- 会话（一张图可以有多个 thread） ---------------- */

function isValidToolCall(value: unknown): value is AgentToolCall {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && typeof v.name === 'string' && typeof v.args === 'string'
  );
}

function isValidMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.role !== 'user' && v.role !== 'assistant' && v.role !== 'tool') return false;
  if (typeof v.id !== 'string' || typeof v.content !== 'string' || typeof v.at !== 'number') {
    return false;
  }
  if (v.toolCalls !== undefined) {
    return Array.isArray(v.toolCalls) && v.toolCalls.every(isValidToolCall);
  }
  return true;
}

/** 校验并收口一份会话；结构不对就整份丢掉 */
export function normalizeThread(diagramId: string, value: unknown): AgentSession | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.messages)) return null;

  const messages = v.messages.filter(isValidMessage);

  // 截断过的历史（以 tool 消息开头）会让 API 拒绝整串请求，这里顺手修掉
  let start = 0;
  while (start < messages.length && messages[start].role !== 'user') start += 1;

  return {
    id: typeof v.id === 'string' ? v.id : newId('t'),
    diagramId,
    title: typeof v.title === 'string' ? v.title : undefined,
    messages: messages.slice(start),
    summary: typeof v.summary === 'string' ? v.summary : '',
    compactedCount: typeof v.compactedCount === 'number' ? v.compactedCount : 0,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now(),
  };
}

export async function loadSessions(): Promise<Record<string, AgentSession[]>> {
  try {
    // v1 的 key 里是「一张图一个对象」，读到就顺手迁移成数组
    const raw =
      (await AsyncStorage.getItem(SESSIONS_KEY)) ??
      (await AsyncStorage.getItem(SESSIONS_KEY_V1));
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Record<string, AgentSession[]> = {};
    for (const [diagramId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const list = Array.isArray(value) ? value : [value];
      const threads = list
        .map((item) => normalizeThread(diagramId, item))
        .filter((item): item is AgentSession => item !== null);
      if (threads.length) out[diagramId] = threads;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveSessions(sessions: Record<string, AgentSession[]>): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // 写入失败不打断交互，下一次变更会重试
  }
}

/** 每张图当前停在第几个会话 */
export async function loadActiveThread(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_THREAD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [diagramId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[diagramId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveActiveThread(indexes: Record<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_THREAD_KEY, JSON.stringify(indexes));
  } catch {
    // 同上
  }
}

/* ---------------- DeepSeek 配置 ---------------- */

export async function loadApiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(API_KEY_KEY);
  } catch {
    return null;
  }
}

export async function saveApiKey(value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(API_KEY_KEY, value);
  } catch {
    // 同上
  }
}

export async function loadModel(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export async function saveModel(value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(MODEL_KEY, value);
  } catch {
    // 同上
  }
}
