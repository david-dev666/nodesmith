/**
 * 示例：DeepSeek 配置（这个文件会被 git 跟踪，作为模板）
 *
 * 真正生效的是同目录的 `ai.local.ts`（已被 .gitignore 忽略，
 * `npm install` 时会自动从本文件生成一份）。
 *
 * ⚠️ 一般来说不用改这里。打开 App →「设置 → DeepSeek」把 Key 填进去即可，
 * 那样 Key 只存在手机本地，不进代码、不进安装包，也不会被提交到仓库。
 *
 * 这个文件只在「自己编译 APK 给自己用」时有价值：
 * 把 Key 写进 LOCAL_AI_KEY，就不必在手机上再输一遍。
 * 但请务必确认 ai.local.ts 已被 .gitignore 忽略。
 */
export const LOCAL_AI_KEY = '';

/** 可选 deepseek-chat（快、便宜）或 deepseek-reasoner（推理更强、更慢更贵） */
export const LOCAL_AI_MODEL = 'deepseek-chat';
