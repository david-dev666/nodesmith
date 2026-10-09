import { useCallback, useEffect, useRef, useState } from 'react';

import { LOCAL_AI_KEY, LOCAL_AI_MODEL } from '../config/ai.local';
import { loadApiKey, loadModel, saveApiKey, saveModel } from '../storage';

/**
 * DeepSeek 配置。
 *
 * 优先级：App 设置页里填的值（存手机本地）> src/config/ai.local.ts 里的值。
 * 前者不会进 git，也不会被打进安装包，所以推荐用前者。
 */
export function useAiSettings() {
  const [apiKey, setApiKeyState] = useState(LOCAL_AI_KEY.trim());
  const [model, setModelState] = useState(LOCAL_AI_MODEL || 'deepseek-chat');
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [storedKey, storedModel] = await Promise.all([loadApiKey(), loadModel()]);
      if (!alive) return;
      if (storedKey !== null) setApiKeyState(storedKey);
      if (storedModel) setModelState(storedModel);
      hydrated.current = true;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated.current) void saveApiKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (hydrated.current) void saveModel(model);
  }, [model]);

  const setApiKey = useCallback((value: string) => setApiKeyState(value.trim()), []);
  const setModel = useCallback((value: string) => setModelState(value), []);

  return { apiKey, model, setApiKey, setModel, aiReady: ready, hasKey: apiKey.length > 0 };
}

export type AiSettings = ReturnType<typeof useAiSettings>;
