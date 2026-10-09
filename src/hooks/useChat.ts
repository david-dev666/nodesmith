import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { runAgent } from '../agent/runtime';
import {
  appendMessages,
  compactSession,
  countUserTurns,
  emptySession,
  needsCompaction,
} from '../agent/session';
import {
  loadActiveThread,
  loadSessions,
  saveActiveThread,
  saveSessions,
} from '../storage';
import type { AgentMessage, AgentSession, AgentStep, Diagram } from '../types';
import { diffDiagrams, type DiagramDiff } from '../utils/diff';
import type { AiSettings } from './useAiSettings';
import type { DiagramsStore } from './useDiagrams';

/** 一轮 agent 最多跑这么久（它内部可能有多次模型往返，所以比单次请求宽松） */
const RUN_TIMEOUT_MS = 120_000;

/** 界面上的一轮：由会话消息聚出来的，不单独存 */
export interface ChatTurn {
  /** 就是这轮那条 user 消息的 id */
  id: string;
  prompt: string;
  steps: AgentStep[];
  reply: string;
  at: number;
  applied: boolean;
}

/** 沙盒改完、还没被确认的图 */
export interface Proposal {
  draft: Diagram;
  diff: DiagramDiff;
}

/**
 * 把线性的消息流聚成「一轮一轮」。
 *
 * 模型看到的是 user / assistant / tool 交错的一长串，
 * 但用户想看到的是「我说了啥 → 它干了啥 → 结论是啥」，所以界面上要重新分组。
 */
function groupTurns(messages: AgentMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: message.id,
        prompt: message.content,
        steps: [],
        reply: '',
        at: message.at,
        applied: message.applied ?? false,
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;

    if (message.role === 'tool') {
      current.steps.push({
        name: message.toolName ?? 'tool',
        label: message.label ?? message.content,
        wrote: message.wrote ?? false,
        ok: message.ok ?? true,
      });
      continue;
    }

    // assistant：中间那些带工具调用的不算「回复」，只有最后不带工具的那句才算
    if (!message.toolCalls?.length && message.content.trim()) {
      current.reply = message.content.trim();
    }
  }

  return turns;
}

/** 会话标签：拿第一句话的前几个字，够认人就行 */
function threadTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '新对话';
  return clean.length > 12 ? `${clean.slice(0, 12)}…` : clean;
}

/**
 * 对话状态。
 *
 * 会话按图分组：一张图一份「会话列表」，图与图之间互不干扰。
 * 同一张图里可以开多条会话 —— 聊乱了就开新的，但图始终是同一张。
 */
export function useChat(options: { diagrams: DiagramsStore; ai: AiSettings }) {
  const { diagrams, ai } = options;

  const [sessions, setSessions] = useState<Record<string, AgentSession[]>>({});
  const [activeIndex, setActiveIndex] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** 未确认的提案：只在内存里。没点「应用」的东西不该落盘 */
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});

  const sessionsRef = useRef<Record<string, AgentSession[]>>({});
  const activeIndexRef = useRef<Record<string, number>>({});
  const hydrated = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeId = diagrams.active?.id ?? '';

  useEffect(() => {
    let alive = true;
    (async () => {
      const [stored, indexes] = await Promise.all([loadSessions(), loadActiveThread()]);
      if (!alive) return;
      sessionsRef.current = stored;
      activeIndexRef.current = indexes;
      setSessions(stored);
      setActiveIndex(indexes);
      hydrated.current = true;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated.current) void saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (hydrated.current) void saveActiveThread(activeIndex);
  }, [activeIndex]);

  /** 没落过盘的图也得有一条稳定的空会话，否则每次渲染都会换一个对象 */
  const fallback = useMemo(() => emptySession(activeId), [activeId]);

  const threads = useMemo(() => {
    const list = sessions[activeId];
    return list?.length ? list : [fallback];
  }, [sessions, activeId, fallback]);

  const threadIndex = Math.min(
    Math.max(activeIndex[activeId] ?? threads.length - 1, 0),
    threads.length - 1,
  );
  const session = threads[threadIndex];

  const turns = useMemo(() => groupTurns(session.messages), [session.messages]);

  /** 写回某张图的会话列表，可选地同时切到某一条 */
  const writeThreads = useCallback(
    (diagramId: string, list: AgentSession[], nextIndex?: number) => {
      sessionsRef.current = { ...sessionsRef.current, [diagramId]: list };
      setSessions((prev) => ({ ...prev, [diagramId]: list }));

      if (nextIndex !== undefined) {
        activeIndexRef.current = { ...activeIndexRef.current, [diagramId]: nextIndex };
        setActiveIndex((prev) => ({ ...prev, [diagramId]: nextIndex }));
      }
    },
    [],
  );

  /** 当前图的会话列表（至少一条），ref 里的才是最新的 */
  const currentThreads = useCallback((diagramId: string): AgentSession[] => {
    const list = sessionsRef.current[diagramId];
    return list?.length ? list : [emptySession(diagramId)];
  }, []);

  const send = useCallback(
    async (prompt: string, focusNodeId?: string | null) => {
      const diagram = diagrams.active;
      const text = prompt.trim();
      if (!diagram || !text || running) return;

      if (!ai.hasKey) {
        setError('还没有配置 API Key。去「设置 → DeepSeek」填一个，agent 才能干活。');
        return;
      }

      setRunning(true);
      setLiveSteps([]);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

      const list = currentThreads(diagram.id);
      const at = Math.min(
        Math.max(activeIndexRef.current[diagram.id] ?? list.length - 1, 0),
        list.length - 1,
      );
      const current = list[at];

      try {
        const { outcome, messages } = await runAgent({
          apiKey: ai.apiKey,
          model: ai.model,
          diagram,
          session: current,
          prompt: text,
          history: diagrams.history.filter((item) => item.diagramId === diagram.id),
          focusNodeId,
          onStep: (step) => setLiveSteps((prev) => [...prev, step]),
          signal: controller.signal,
        });

        let next = appendMessages(current, messages);
        if (!next.title) next = { ...next, title: threadTitle(text) };

        // 会话太长了就折叠一次。压缩失败不影响这一轮的结果，下次再说
        if (needsCompaction(next)) {
          try {
            next = await compactSession({ apiKey: ai.apiKey, model: ai.model, session: next });
          } catch {
            // 忽略
          }
        }

        const updated = [...list];
        updated[at] = next;
        writeThreads(diagram.id, updated, at);

        const turnId = messages[0]?.id;
        if (turnId && !outcome.untouched) {
          const diff = diffDiagrams(diagram, outcome.draft);
          if (diff.changed) {
            setProposals((prev) => ({ ...prev, [turnId]: { draft: outcome.draft, diff } }));
          }
        }
      } catch (err) {
        setError(
          controller.signal.aborted
            ? '等了 2 分钟还没跑完，先停下了。可以拆成几句小要求再试。'
            : err instanceof Error
              ? err.message
              : '这轮没跑起来，请再试一次',
        );
      } finally {
        clearTimeout(timer);
        abortRef.current = null;
        setRunning(false);
        setLiveSteps([]);
      }
    },
    [ai, diagrams, running, writeThreads, currentThreads],
  );

  /** 把某一轮的沙盒结果提交到真图上 */
  const applyTurn = useCallback(
    (turnId: string) => {
      const proposal = proposals[turnId];
      const diagram = diagrams.active;
      if (!proposal || !diagram) return;

      const turn = turns.find((item) => item.id === turnId);
      diagrams.commitDiagram(
        proposal.draft,
        turn?.prompt ?? '',
        turn?.reply ?? '',
        proposal.diff.total,
      );

      const list = sessionsRef.current[diagram.id];
      if (list?.length) {
        const at = Math.min(
          Math.max(activeIndexRef.current[diagram.id] ?? list.length - 1, 0),
          list.length - 1,
        );
        const updated = [...list];
        updated[at] = {
          ...list[at],
          messages: list[at].messages.map((message) =>
            message.id === turnId ? { ...message, applied: true } : message,
          ),
        };
        writeThreads(diagram.id, updated);
      }

      setProposals((prev) => {
        const next = { ...prev };
        delete next[turnId];
        return next;
      });
    },
    [proposals, diagrams, turns, writeThreads],
  );

  const discardTurn = useCallback((turnId: string) => {
    setProposals((prev) => {
      const next = { ...prev };
      delete next[turnId];
      return next;
    });
  }, []);

  /** 给当前这张图开一条新会话 */
  const newThread = useCallback(() => {
    const diagram = diagrams.active;
    if (!diagram) return;
    const list = currentThreads(diagram.id);
    writeThreads(diagram.id, [...list, emptySession(diagram.id)], list.length);
    setProposals({});
    setError(null);
  }, [diagrams, currentThreads, writeThreads]);

  const selectThread = useCallback(
    (index: number) => {
      const diagram = diagrams.active;
      if (!diagram) return;
      activeIndexRef.current = { ...activeIndexRef.current, [diagram.id]: index };
      setActiveIndex((prev) => ({ ...prev, [diagram.id]: index }));
    },
    [diagrams],
  );

  /** 删掉一条会话；删空了就补一条空的，避免出现「零会话」这种状态 */
  const deleteThread = useCallback(
    (index: number) => {
      const diagram = diagrams.active;
      if (!diagram) return;
      const list = currentThreads(diagram.id);
      const kept = list.filter((_, i) => i !== index);
      const next = kept.length ? kept : [emptySession(diagram.id)];
      writeThreads(diagram.id, next, Math.min(index, next.length - 1));
    },
    [diagrams, currentThreads, writeThreads],
  );

  /** 清掉某张图的全部会话 —— 相当于让 agent 忘掉这张图的来龙去脉 */
  const resetSession = useCallback(
    (diagramId: string) => {
      writeThreads(diagramId, [emptySession(diagramId)], 0);
      setProposals({});
      setError(null);
    },
    [writeThreads],
  );

  /** 从备份里整体恢复会话 */
  const importSessions = useCallback((incoming: Record<string, AgentSession[]>) => {
    const indexes: Record<string, number> = {};
    for (const [diagramId, list] of Object.entries(incoming)) {
      indexes[diagramId] = Math.max(0, list.length - 1);
    }
    sessionsRef.current = incoming;
    activeIndexRef.current = indexes;
    setSessions(incoming);
    setActiveIndex(indexes);
    setProposals({});
  }, []);

  return {
    session,
    /** 当前图的全部会话（面板上的标签行） */
    threads,
    threadIndex,
    sessions,
    turns,
    proposals,
    running,
    liveSteps,
    error,
    chatReady: ready,
    turnCount: countUserTurns(session),
    send,
    applyTurn,
    discardTurn,
    newThread,
    selectThread,
    deleteThread,
    resetSession,
    importSessions,
    clearError: () => setError(null),
  };
}

export type ChatStore = ReturnType<typeof useChat>;
