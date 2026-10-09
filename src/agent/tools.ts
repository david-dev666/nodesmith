import type { AgentStep, Diagram, DiagramOp, EditVersion } from '../types';
import { applyOps } from '../utils/diagramOps';
import { diagramToText, findNode } from '../utils/graph';
import type { ChatToolDef } from './chat';

export interface ToolContext {
  /** 沙盒里的图。所有写入都发生在这上面，不会碰真图 */
  draft: Diagram;
  /** 这张图之前改过什么 */
  history: EditVersion[];
}

export interface ToolOutcome {
  /** 回给模型的文本 */
  output: string;
  /** 显示给用户的一行 */
  step: AgentStep;
  /** 写入类工具会返回改完的新图 */
  draft?: Diagram;
}

function pickString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const LABEL = {
  type: 'string',
  description: '方块里的主文字，2 到 6 个字最好',
};

/**
 * 工具清单。
 *
 * 读取类（read_diagram / read_history）是这套架构里最容易被低估的部分：
 * 有了它们，模型不用把整张图背在上下文里，而是需要时自己去查 ——
 * 这也是图变大以后还能撑住的原因。
 */
export const TOOL_DEFS: ChatToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'read_diagram',
      description:
        '读取这张图现在的完整结构（所有方块、连线、层级）。改图前想确认现状时先调用它，不要凭上文的印象猜。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_history',
      description:
        '查看这张图之前的改动记录（用户说过什么、你改了什么）。用户提到「之前」「刚才」「恢复成原来那样」时很有用。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '看最近几条，默认 5' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_node',
      description: '新增一个方块。给了 parentId 就会同时连到它下面；不给自己成为一个孤立方块。',
      parameters: {
        type: 'object',
        properties: {
          label: LABEL,
          detail: { type: 'string', description: '方块里的补充小字，可空' },
          group: { type: 'string', description: '分组名，同组共用一个颜色' },
          parentId: { type: 'string', description: '上一层的方块 id，不填则孤立' },
        },
        required: ['label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_node',
      description: '修改一个方块的名字、说明或分组。只传要改的字段。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要改的方块 id' },
          label: LABEL,
          detail: { type: 'string', description: '新的补充小字，传空字符串表示清空' },
          group: { type: 'string', description: '新的分组名，传空字符串表示取消分组' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_node',
      description: '删掉一个方块。挂在它身上的连线会一起消失，它下面的子方块会变成孤立节点留在图上。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '要删的方块 id' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_nodes',
      description: '在两个已存在的方块之间连一条线，from 在 to 的上一层。不能连成环。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '上一层的方块 id' },
          to: { type: 'string', description: '下一层的方块 id' },
          label: { type: 'string', description: '连线上的文字，可空' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unlink_nodes',
      description: '断开两个方块之间的连线。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_node',
      description:
        '把一个方块挪到另一个方块下面（会摘掉它原来的父连线）。调整层级用这个，比删了重建干净。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要移动的方块 id' },
          newParentId: { type: 'string', description: '新的上一层方块 id' },
        },
        required: ['id', 'newParentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_diagram',
      description: '给这张图改个名字。',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: '新标题' } },
        required: ['title'],
      },
    },
  },
];

/** 名字 → 一行给人看的话 */
function nameOf(diagram: Diagram, id: string): string {
  return findNode(diagram, id)?.label ?? '不存在的方块';
}

/**
 * 执行一次工具调用。
 *
 * 所有写入都走 applyOps —— 校验（id 存不存在、会不会成环）只有那一份实现，
 * 这里不重复判断，只是把失败原因翻译成人话回给模型。
 */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): ToolOutcome {
  const fail = (step: AgentStep, output: string): ToolOutcome => ({ output, step });

  const run = (op: DiagramOp, step: AgentStep): ToolOutcome => {
    const outcome = applyOps(ctx.draft, [op]);
    if (outcome.applied === 0) {
      return fail(
        { ...step, ok: false, wrote: false, label: `没成功：${step.label}` },
        `没成功：${step.label}。原因通常是这个方块不存在，或者这个操作会让图连成环 —— 先调用 read_diagram 确认一下真实的 id。`,
      );
    }
    return { output: `${step.label}（成功）`, step, draft: outcome.diagram };
  };

  if (name === 'read_diagram') {
    return {
      output: diagramToText(ctx.draft),
      step: { name, label: '看了当前这张图', wrote: false, ok: true },
    };
  }

  if (name === 'read_history') {
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 15) : 5;
    const recent = ctx.history.slice(0, limit).reverse();
    const output = recent.length
      ? recent.map((item, index) => `${index + 1}. 用户：${item.prompt}\n   你：${item.reply}`).join('\n')
      : '这张图还没有改动记录。';
    return {
      output,
      step: { name, label: `看了最近 ${recent.length} 条改动记录`, wrote: false, ok: true },
    };
  }

  if (name === 'add_node') {
    const label = pickString(args, 'label');
    if (!label) {
      return fail({ name, label: '没加成功', wrote: false, ok: false }, '失败：label 不能为空');
    }
    const parentId = pickString(args, 'parentId');
    const parentText = parentId ? `「${nameOf(ctx.draft, parentId)}」下面` : '（作为孤立方块）';
    return run(
      { op: 'add', label, detail: pickString(args, 'detail'), group: pickString(args, 'group'), parentId },
      { name, label: `加了「${label}」到${parentText}`, wrote: true, ok: true },
    );
  }

  if (name === 'update_node') {
    const id = pickString(args, 'id');
    if (!id) return fail({ name, label: '没改成功', wrote: false, ok: false }, '失败：缺 id');
    // 传了空字符串 = 清空该字段，所以这里不能用 pickString（它会把空串当没传）
    const detail = typeof args.detail === 'string' ? args.detail : undefined;
    const group = typeof args.group === 'string' ? args.group : undefined;
    return run(
      { op: 'update', id, label: pickString(args, 'label'), detail, group },
      { name, label: `改了「${nameOf(ctx.draft, id)}」`, wrote: true, ok: true },
    );
  }

  if (name === 'remove_node') {
    const id = pickString(args, 'id');
    if (!id) return fail({ name, label: '没删成功', wrote: false, ok: false }, '失败：缺 id');
    return run(
      { op: 'remove', id },
      { name, label: `删掉了「${nameOf(ctx.draft, id)}」`, wrote: true, ok: true },
    );
  }

  if (name === 'link_nodes') {
    const from = pickString(args, 'from');
    const to = pickString(args, 'to');
    if (!from || !to) {
      return fail({ name, label: '没连成功', wrote: false, ok: false }, '失败：缺 from 或 to');
    }
    return run(
      { op: 'link', from, to, label: pickString(args, 'label') },
      {
        name,
        label: `把「${nameOf(ctx.draft, from)}」连到「${nameOf(ctx.draft, to)}」`,
        wrote: true,
        ok: true,
      },
    );
  }

  if (name === 'unlink_nodes') {
    const from = pickString(args, 'from');
    const to = pickString(args, 'to');
    if (!from || !to) {
      return fail({ name, label: '没断开', wrote: false, ok: false }, '失败：缺 from 或 to');
    }
    return run({ op: 'unlink', from, to }, { name, label: '断开了两条线之间的连线', wrote: true, ok: true });
  }

  if (name === 'move_node') {
    const id = pickString(args, 'id');
    const newParentId = pickString(args, 'newParentId');
    if (!id || !newParentId) {
      return fail({ name, label: '没挪成功', wrote: false, ok: false }, '失败：缺 id 或 newParentId');
    }
    return run(
      { op: 'move', id, parentId: newParentId },
      {
        name,
        label: `把「${nameOf(ctx.draft, id)}」挪到「${nameOf(ctx.draft, newParentId)}」下面`,
        wrote: true,
        ok: true,
      },
    );
  }

  if (name === 'rename_diagram') {
    const title = pickString(args, 'title');
    if (!title) return fail({ name, label: '没改名', wrote: false, ok: false }, '失败：title 不能为空');
    return run({ op: 'title', title }, { name, label: `改名为「${title}」`, wrote: true, ok: true });
  }

  return fail(
    { name, label: `未知工具 ${name}`, wrote: false, ok: false },
    `失败：没有叫 ${name} 的工具。可用的工具见系统提示。`,
  );
}

/** 模型给的参数是字符串，解析失败是常态，不能让它把整轮跑挂 */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
