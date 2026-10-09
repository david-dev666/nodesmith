import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { normalizeThread } from '../storage';
import type { AgentSession, DiagramStore, EditVersion } from '../types';
import { dayKey } from './date';

export interface BackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  store: DiagramStore;
  history: EditVersion[];
  /**
   * 每张图的会话，一张图可以有多条。
   *
   * 带上它，是因为「agent 记得你们聊过什么」本身就是这份数据的一部分 ——
   * 丢了会话，图还在，但 agent 会把你之前所有的交代重新问一遍。
   * 体积不用担心：会话超过 24 条会自动折叠成摘要。
   */
  sessions?: Record<string, AgentSession[]>;
}

const APP_TAG = 'nodesmith';
const BACKUP_VERSION = 3;

/** 只判断「是不是我们的备份」，字段细节交给各自的归一化函数 */
interface RawPayload {
  app: string;
  version?: number;
  exportedAt?: string;
  store: DiagramStore;
  history?: unknown;
  sessions?: unknown;
}

function isPayload(value: unknown): value is RawPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.app !== APP_TAG) return false;
  const store = v.store as { diagrams?: unknown } | undefined;
  return !!store && Array.isArray(store.diagrams);
}

/**
 * 导出成 JSON 并唤起系统分享面板。
 * 面板里可以选「保存到文件」「发给自己」等，去哪由用户决定。
 */
export async function exportBackup(
  store: DiagramStore,
  history: EditVersion[],
  sessions: Record<string, AgentSession[]>,
): Promise<string> {
  const payload: BackupPayload = {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    store,
    history: history.slice(0, 10),
    sessions,
  };

  const file = new File(Paths.cache, `nodesmith-${dayKey(Date.now())}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: '导出 NodeSmith 备份',
      UTI: 'public.json',
    });
  }

  return file.uri;
}

/**
 * 老备份里「一张图一份会话」是单个对象，v3 起是数组。
 * 两种都收下，顺手把字段校验做掉。
 */
function normalizeSessions(raw: unknown): Record<string, AgentSession[]> {
  if (!raw || typeof raw !== 'object') return {};

  const out: Record<string, AgentSession[]> = {};
  for (const [diagramId, value] of Object.entries(raw as Record<string, unknown>)) {
    const list = Array.isArray(value) ? value : [value];
    const threads = list
      .map((item) => normalizeThread(diagramId, item))
      .filter((item): item is AgentSession => item !== null);
    if (threads.length) out[diagramId] = threads;
  }
  return out;
}

/** 让用户挑一个备份文件并解析，取消则返回 null */
export async function pickBackup(): Promise<BackupPayload | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets.length) return null;

  const text = await new File(result.assets[0].uri).text();
  const parsed: unknown = JSON.parse(text);

  if (!isPayload(parsed)) throw new Error('这个文件不是 NodeSmith 的备份');

  return {
    app: parsed.app,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    store: parsed.store,
    history: Array.isArray(parsed.history) ? (parsed.history as EditVersion[]) : [],
    sessions: normalizeSessions(parsed.sessions),
  };
}
