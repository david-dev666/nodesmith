import type { AgentToolCall } from '../types';

const CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODELS_ENDPOINT = 'https://api.deepseek.com/models';

export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;

/** OpenAI 风格的函数声明 —— DeepSeek 完全兼容这一套 */
export interface ChatToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 发起工具调用时才带 */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  /** tool 消息才有 */
  tool_call_id?: string;
}

export interface ChatResult {
  content: string;
  toolCalls: AgentToolCall[];
}

/**
 * 一次 chat 调用。
 *
 * 刻意做得很薄：它只负责「发消息、拿回复」，不掺任何编排逻辑 ——
 * agent 的循环在 runtime.ts 里，两边互不干扰。
 */
export async function chat(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const { apiKey, model, messages, tools, temperature = 0.5, maxTokens = 4000, signal } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw new Error(await describeError(response));

  const data = (await response.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
  };

  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('DeepSeek 没有返回内容，请再试一次');

  return {
    content: message.content ?? '',
    toolCalls: (message.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call) => ({
        id: call.id,
        name: call.function!.name!,
        args: call.function!.arguments ?? '{}',
      })),
  };
}

/** 只发一个 GET，不消耗 token，用来验证 Key 是否有效 */
export async function checkApiKey(apiKey: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error(await describeError(response));
}

async function describeError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // 忽略：保留默认文案
  }

  if (response.status === 401) return 'API Key 无效，请到设置里重新填写';
  if (response.status === 402) return 'DeepSeek 账户余额不足，请先充值';
  if (response.status === 429) return '请求太频繁了，等几秒再试';
  if (response.status >= 500) return 'DeepSeek 服务暂时不可用，稍后再试';
  return detail ? `请求失败（${response.status}）：${detail}` : `请求失败（${response.status}）`;
}
