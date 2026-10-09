import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SEED_STORE } from '../config/seed.local';
import {
  HISTORY_LIMIT,
  loadHistory,
  loadSeedSource,
  loadStore,
  saveHistory,
  saveSeedSource,
  saveStore,
} from '../storage';
import type { Diagram, DiagramStore, EditVersion } from '../types';
import { applyOps } from '../utils/diagramOps';
import { cloneDiagram, newId } from '../utils/graph';

/** 种子文件内容的指纹，变了就说明用户改过自己的种子图 */
const SEED_FINGERPRINT = JSON.stringify(SEED_STORE);

function cloneStore(store: DiagramStore): DiagramStore {
  return JSON.parse(JSON.stringify(store)) as DiagramStore;
}

/** 当前在看哪张图；数据异常时兜底到第一张 */
function pickActive(store: DiagramStore): Diagram | undefined {
  return store.diagrams.find((item) => item.id === store.activeId) ?? store.diagrams[0];
}

function blankDiagram(title = '未命名'): Diagram {
  const now = Date.now();
  return { id: newId('d'), title, nodes: [], edges: [], createdAt: now, updatedAt: now };
}

/**
 * 所有图的读写都收在这里。
 *
 * 优先级：App 内的改动（存在本机）> src/config/seed.local.ts 里的种子图。
 * 一旦检测到种子文件被改动，就以文件为准重建 —— 和 tally 里「个人配置不进 git」是同一套思路。
 */
export function useDiagrams() {
  const [store, setStore] = useState<DiagramStore>(SEED_STORE);
  const [history, setHistory] = useState<EditVersion[]>([]);
  const [ready, setReady] = useState(false);

  /** 用 ref 持有最新值，供同步读取（撤销、导入这类操作要立刻拿到它） */
  const storeRef = useRef<DiagramStore>(SEED_STORE);
  const hydrated = useRef(false);

  const commit = useCallback((updater: (prev: DiagramStore) => DiagramStore) => {
    const next = updater(storeRef.current);
    storeRef.current = next;
    setStore(next);
  }, []);

  const pushHistory = useCallback((entry: EditVersion) => {
    setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [storedStore, mark, storedHistory] = await Promise.all([
        loadStore(),
        loadSeedSource(),
        loadHistory(),
      ]);
      if (!alive) return;

      const seedChanged = mark !== SEED_FINGERPRINT;
      if (storedStore && !seedChanged) {
        storeRef.current = storedStore;
        setStore(storedStore);
      } else {
        storeRef.current = SEED_STORE;
        setStore(SEED_STORE);
        void saveSeedSource(SEED_FINGERPRINT);
      }
      setHistory(storedHistory);
      hydrated.current = true;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated.current) void saveStore(store);
  }, [store]);

  useEffect(() => {
    if (hydrated.current) void saveHistory(history);
  }, [history]);

  const active = useMemo(() => pickActive(store), [store]);

  /** 用新版本替换掉同 id 的图 */
  const replaceDiagram = useCallback(
    (next: Diagram) => {
      commit((prev) => ({
        ...prev,
        diagrams: prev.diagrams.map((item) => (item.id === next.id ? next : item)),
      }));
    },
    [commit],
  );

  /** 改动前留个快照，撤销时直接还原它 */
  const recordBefore = useCallback(
    (diagram: Diagram, prompt: string, reply: string, opCount: number) => {
      pushHistory({
        id: newId('v'),
        at: Date.now(),
        diagramId: diagram.id,
        diagramTitle: diagram.title,
        prompt,
        reply,
        opCount,
        before: cloneDiagram(diagram),
      });
    },
    [pushHistory],
  );

  const restore = useCallback(
    (version: EditVersion) => {
      commit((prev) => {
        if (!prev.diagrams.some((item) => item.id === version.diagramId)) return prev;
        return {
          diagrams: prev.diagrams.map((item) =>
            item.id === version.diagramId ? cloneDiagram(version.before) : item,
          ),
          activeId: version.diagramId,
        };
      });
    },
    [commit],
  );

  /* ---------------- 图的增删改 ---------------- */

  const selectDiagram = useCallback(
    (id: string) => {
      commit((prev) => (prev.diagrams.some((item) => item.id === id) ? { ...prev, activeId: id } : prev));
    },
    [commit],
  );

  const createDiagram = useCallback(
    (title: string) => {
      const diagram = blankDiagram(title.trim() || '未命名');
      commit((prev) => ({ diagrams: [...prev.diagrams, diagram], activeId: diagram.id }));
      return diagram.id;
    },
    [commit],
  );

  const deleteDiagram = useCallback(
    (id: string) => {
      commit((prev) => {
        const diagrams = prev.diagrams.filter((item) => item.id !== id);
        // 不允许删到一张不剩：留一张空白图兜底
        if (!diagrams.length) {
          const fallback = blankDiagram();
          return { diagrams: [fallback], activeId: fallback.id };
        }
        return {
          diagrams,
          activeId: prev.activeId === id ? diagrams[0].id : prev.activeId,
        };
      });
    },
    [commit],
  );

  const renameDiagram = useCallback(
    (id: string, title: string) => {
      const value = title.trim();
      if (!value) return;
      commit((prev) => ({
        ...prev,
        diagrams: prev.diagrams.map((item) =>
          item.id === id ? { ...item, title: value, updatedAt: Date.now() } : item,
        ),
      }));
    },
    [commit],
  );

  /* ---------------- 内容改动 ---------------- */

  /**
   * 提交一张「已经改好的图」。
   *
   * agent 是在沙盒里把图改完的，交上来的是一整张图而不是一串操作 ——
   * 这里负责把它落下去，并在历史里留一份改动前的快照。
   */
  const commitDiagram = useCallback(
    (next: Diagram, prompt: string, reply: string, changeCount: number) => {
      const current = storeRef.current.diagrams.find((item) => item.id === next.id);
      if (!current) return false;

      recordBefore(current, prompt, reply, changeCount);
      replaceDiagram({ ...next, updatedAt: Date.now() });
      return true;
    },
    [recordBefore, replaceDiagram],
  );

  /** 手动加一个方块（没配 Key 时也能用） */
  const addNode = useCallback(
    (label: string, parentId?: string, detail?: string) => {
      const current = pickActive(storeRef.current);
      if (!current) return false;

      const outcome = applyOps(current, [{ op: 'add', label, detail, parentId }]);
      if (outcome.applied === 0) return false;

      recordBefore(current, `手动新增「${label}」`, '在画布上手动加了一个方块', 1);
      replaceDiagram(outcome.diagram);
      return true;
    },
    [recordBefore, replaceDiagram],
  );

  /** 手动删一个方块（连带它身上的连线） */
  const removeNode = useCallback(
    (id: string) => {
      const current = pickActive(storeRef.current);
      const node = current?.nodes.find((item) => item.id === id);
      if (!current || !node) return false;

      const outcome = applyOps(current, [{ op: 'remove', id }]);
      if (outcome.applied === 0) return false;

      recordBefore(current, `手动删除「${node.label}」`, '在画布上删掉了一个方块', 1);
      replaceDiagram(outcome.diagram);
      return true;
    },
    [recordBefore, replaceDiagram],
  );

  /* ---------------- 撤销与重置 ---------------- */

  const undo = useCallback((): boolean => {
    const latest = history[0];
    if (!latest) return false;
    restore(latest);
    setHistory((prev) => prev.slice(1));
    return true;
  }, [history, restore]);

  /** 回滚到某次编辑「之前」，并丢弃这次及之后的所有记录 */
  const rollbackTo = useCallback(
    (versionId: string) => {
      const index = history.findIndex((item) => item.id === versionId);
      if (index < 0) return;
      restore(history[index]);
      setHistory((prev) => prev.slice(index + 1));
    },
    [history, restore],
  );

  const resetToSeed = useCallback(() => {
    commit(() => cloneStore(SEED_STORE));
    setHistory([]);
  }, [commit]);

  const importStore = useCallback(
    (incoming: DiagramStore) => {
      commit(() => incoming);
      setHistory([]);
    },
    [commit],
  );

  const stats = useMemo(() => {
    if (!active) return { nodeCount: 0, edgeCount: 0, roots: 0 };
    const targets = new Set(active.edges.map((edge) => edge.to));
    return {
      nodeCount: active.nodes.length,
      edgeCount: active.edges.length,
      roots: active.nodes.filter((node) => !targets.has(node.id)).length,
    };
  }, [active]);

  return {
    store,
    diagrams: store.diagrams,
    active,
    history,
    stats,
    diagramsReady: ready,
    canUndo: history.length > 0,
    selectDiagram,
    createDiagram,
    deleteDiagram,
    renameDiagram,
    commitDiagram,
    addNode,
    removeNode,
    undo,
    rollbackTo,
    resetToSeed,
    importStore,
  };
}

export type DiagramsStore = ReturnType<typeof useDiagrams>;
