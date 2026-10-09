import type {
  AgentMessage,
  AgentRunOutcome,
  AgentSession,
  AgentStep,
  Diagram,
  EditVersion,
} from '../types';
import { cloneDiagram, findNode, newId, diagramToText } from '../utils/graph';
import { chat, type ChatMessage } from './chat';
import { AGENT_SYSTEM_PROMPT, buildTurnBrief } from './prompts';
import { TOOL_DEFS, executeTool, parseToolArgs, type ToolContext } from './tools';

/**
 * 一轮对话里最多允许几次工具调用。
 * 有上限是为了防止模型在两个方块之间反复横跳、把 token 烧光。
 */
const MAX_STEPS = 8;

export interface AgentRunResult {
  outcome: AgentRunOutcome;
  /** 这一轮产生的消息，交给会话层落盘 */
  messages: AgentMessage[];
}

/**
 * Agent 的主循环 —— 整个架构的心脏。
 *
 * 一轮 run 的流程：
 *   1. 把「图 + 摘要 + 本轮要求」拼成简报
 *   2. 让模型决定下一步：继续调工具，还是给出结论
 *   3. 有工具调用就执行，把结果回灌，回到第 2 步
 *
 * 所有写入都发生在一个**沙盒副本**上（ctx.draft）。模型可以自由地读、试、改，
 * 但真图不受影响 —— 跑完把副本交给用户确认，就像一次 commit。
 */
export async function runAgent(options: {
  apiKey: string;
  model: string;
  diagram: Diagram;
  session: AgentSession;
  prompt: string;
  history: EditVersion[];
  focusNodeId?: string | null;
  onStep?: (step: AgentStep) => void;
  signal?: AbortSignal;
}): Promise<AgentRunResult> {
  const { apiKey, model, diagram, session, prompt, history, focusNodeId, onStep, signal } = options;

  const ctx: ToolContext = { draft: cloneDiagram(diagram), history };
  const focus = focusNodeId ? findNode(diagram, focusNodeId) : undefined;

  /**
   * 给模型看的 context 和要落盘的 context 是两回事：
   *
   * - 发出去的这一份里，工具结果是完整数据（模型要靠它推理）
   * - 存下来的那一份里，工具结果只有一行摘要（那是过去的事，不需要重新读一遍完整图）
   *
   * 不这么拆的话，历史里会堆满一张又一张的图快照，几轮之后 context 就爆了。
   */
  const apiMessages: ChatMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ...session.messages.map(toApiMessage),
    {
      role: 'user',
      content: buildTurnBrief({
        diagramText: diagramToText(diagram),
        nodeCount: diagram.nodes.length,
        edgeCount: diagram.edges.length,
        summary: session.summary,
        focusLabel: focus ? `[${focus.id}] ${focus.label}` : undefined,
        prompt,
      }),
    },
  ];

  const stored: AgentMessage[] = [
    { id: newId('m'), role: 'user', content: prompt, at: Date.now() },
  ];
  const steps: AgentStep[] = [];

  for (let round = 0; round < MAX_STEPS; round += 1) {
    const reply = await chat({
      apiKey,
      model,
      messages: apiMessages,
      tools: TOOL_DEFS,
      signal,
    });

    const assistantMessage: AgentMessage = {
      id: newId('m'),
      role: 'assistant',
      content: reply.content,
      toolCalls: reply.toolCalls.length ? reply.toolCalls : undefined,
      at: Date.now(),
    };
    stored.push(assistantMessage);
    apiMessages.push(toApiMessage(assistantMessage));

    // 没有再调工具 = 它认为这轮结束了
    if (!reply.toolCalls.length) {
      return {
        outcome: {
          draft: ctx.draft,
          reply: reply.content.trim() || '这轮没有要改的地方。',
          steps,
          untouched: !steps.some((step) => step.wrote),
        },
        messages: stored,
      };
    }

    for (const call of reply.toolCalls) {
      const outcome = executeTool(call.name, parseToolArgs(call.args), ctx);
      if (outcome.draft) ctx.draft = outcome.draft;
      steps.push(outcome.step);
      onStep?.(outcome.step);

      apiMessages.push({ role: 'tool', tool_call_id: call.id, content: outcome.output });
      stored.push({
        id: newId('m'),
        role: 'tool',
        content: outcome.step.ok ? outcome.step.label : `${outcome.step.label}（失败）`,
        toolCallId: call.id,
        toolName: call.name,
        label: outcome.step.label,
        wrote: outcome.step.wrote,
        ok: outcome.step.ok,
        at: Date.now(),
      });
    }
  }

  return {
    outcome: {
      draft: ctx.draft,
      reply: '这轮改动比较多，我先停在这里 —— 你看看现在的样子，需要的话我们接着改。',
      steps,
      untouched: !steps.some((step) => step.wrote),
    },
    messages: stored,
  };
}

/** 会话里的消息 → API 格式 */
function toApiMessage(message: AgentMessage): ChatMessage {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args },
      })),
    };
  }

  return { role: message.role, content: message.content };
}
