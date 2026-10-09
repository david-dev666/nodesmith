import type { AgentMessage, AgentSession } from '../types';
import { newId } from '../utils/graph';
import { chat } from './chat';
import { COMPACT_SYSTEM_PROMPT } from './prompts';

/** 消息条数超过这个值就折叠一次 */
export const COMPACT_THRESHOLD = 24;

/** 折叠时保留最近这么多条原文，剩下的压成摘要 */
const KEEP_RECENT = 10;

export function emptySession(diagramId: string): AgentSession {
  return {
    id: newId('t'),
    diagramId,
    messages: [],
    summary: '',
    compactedCount: 0,
    updatedAt: Date.now(),
  };
}

export function appendMessages(session: AgentSession, messages: AgentMessage[]): AgentSession {
  return {
    ...session,
    messages: [...session.messages, ...messages],
    updatedAt: Date.now(),
  };
}

export function needsCompaction(session: AgentSession): boolean {
  return session.messages.length > COMPACT_THRESHOLD;
}

/**
 * 上下文压缩。
 *
 * 会话是「长期维护一张图」的，会无限长下去。每轮都把这些原样塞回模型，
 * 既贵又会让它抓不住重点 —— 所以老消息要折叠成一段摘要。
 *
 * 这是 agent 长期记忆里最实际的一个问题：**保什么、丢什么**。
 * 判断标准写在 COMPACT_SYSTEM_PROMPT 里：保目标、决策、命名习惯，丢试错过程。
 */
export async function compactSession(options: {
  apiKey: string;
  model: string;
  session: AgentSession;
  signal?: AbortSignal;
}): Promise<AgentSession> {
  const { apiKey, model, session, signal } = options;

  // 截断点必须落在 user 消息上：tool 消息必须紧跟发起它的 assistant，
  // 从中间切开会让 API 直接拒绝这串历史。
  let start = Math.max(0, session.messages.length - KEEP_RECENT);
  while (start < session.messages.length && session.messages[start].role !== 'user') {
    start += 1;
  }
  if (start >= session.messages.length) return session;

  const old = session.messages.slice(0, start);
  if (!old.length) return session;

  const transcript = old
    .map((message) => {
      const who =
        message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具';
      return `${who}：${message.content}`;
    })
    .join('\n');

  const result = await chat({
    apiKey,
    model,
    signal,
    temperature: 0.3,
    maxTokens: 800,
    messages: [
      { role: 'system', content: COMPACT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${
          session.summary ? `【已有的摘要】\n${session.summary}\n\n` : ''
        }【新的历史对话】\n${transcript}`,
      },
    ],
  });

  const summary = result.content.trim();
  if (!summary) return session;

  return {
    ...session,
    messages: session.messages.slice(start),
    summary,
    compactedCount: session.compactedCount + old.length,
    updatedAt: Date.now(),
  };
}

/** 会话里用户说过几句话 —— 界面顶部的「第 N 轮」 */
export function countUserTurns(session: AgentSession): number {
  return session.messages.filter((message) => message.role === 'user').length;
}
