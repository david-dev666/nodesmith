#!/usr/bin/env node
/**
 * 确保 src/config/*.local.ts 存在。
 * 这些文件被 .gitignore 忽略，所以别人 clone 项目后需要从示例生成一份。
 * 通过 package.json 的 postinstall 自动执行。
 */
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, '..', 'src', 'config');

/**
 * 生成出来的文件开头用它自己的说明，不能照抄示例文件的注释
 * —— 示例文件是「会被 git 跟踪的模板」，这些是「不会被跟踪的个人配置」，
 * 直接复制过去会出现自相矛盾的描述。
 */
const TARGETS = [
  {
    local: 'seed.local.ts',
    example: 'seed.example.ts',
    header: `/**
 * 你的种子图 —— 本文件已被 .gitignore 忽略，不会被提交到任何地方。
 *
 * 这是 App 第一次启动时的那几张图。之后每一句话都由 DeepSeek 在上面继续改，
 * 改动存在手机本地；改了本文件并重启 App，会以它为准重建所有图。
 *
 * 字段说明见同目录的 seed.example.ts。
 * 想恢复成示例内容：删掉本文件，再跑一次 npm install。
 */
`,
  },
  {
    local: 'ai.local.ts',
    example: 'ai.example.ts',
    header: `/**
 * 你的 DeepSeek 配置 —— 本文件已被 .gitignore 忽略，不会被提交到任何地方。
 *
 * 建议留空：打开 App 在「设置 → DeepSeek」里填 Key 更安全，
 * 那样 Key 只存在手机本地，不会被写进代码或打进安装包。
 *
 * 字段说明见同目录的 ai.example.ts。
 */
`,
  },
];

for (const target of TARGETS) {
  const localFile = path.join(configDir, target.local);
  const exampleFile = path.join(configDir, target.example);

  try {
    if (fs.existsSync(localFile)) continue;

    if (!fs.existsSync(exampleFile)) {
      console.warn(`[nodesmith] 找不到 ${target.example}，跳过 ${target.local} 初始化`);
      continue;
    }

    // 只去掉示例文件里第一个块注释（即开头的说明），import 语句必须保留 ——
    // 用「删到第一个 */ 为止」会把文件顶部的 import 一并吃掉。
    const body = fs
      .readFileSync(exampleFile, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    fs.writeFileSync(localFile, `${target.header}\n${body}`);
    console.log(`[nodesmith] 已从 ${target.example} 生成 src/config/${target.local}`);
  } catch (error) {
    console.warn(`[nodesmith] 初始化 ${target.local} 失败：`, error.message);
  }
}

console.log('[nodesmith] 个人配置文件不会被提交到 git，可以自由修改。');
