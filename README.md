# NodeSmith · 节点工坊

> 用文字维护层级结构图的端侧 Agent。

手机上画结构图，难的不是画出来，是之后一直改。NodeSmith 是跑在手机本地的轻量 Agent，记得上下文、能自己查图、多轮改同一张图。

## 核心架构

```
用户输入
   │
   ▼
Agent Runtime ── ReAct 循环，最多 8 步，超 24 条消息自动压缩
   │
   ├─► 只读工具   read_diagram / read_history
   └─► 沙盒修改   add_node / move_node / link_nodes（改 draft 副本）
   │
   ▼
变更提案
   │
   ▼  人工确认
落入真图并重排
```

在 React Native（Expo）里没有 Node、也没有服务端，要长期维护一张图，没有套通用 Agent 框架，自己实现了四个核心部分：

### 沙盒执行，确认落盘

模型的写操作都在内存副本（`ctx.draft`）上，支持多步试错和回滚，真图全程不动。跑完产出结构变更提案，必须用户点击确认，才提交并触发重排。

### 只读工具，按需查图

上下文只存对话目标和操作简报，不存全量图快照。模型需要时主动调 `read_diagram` 查当前图，避免多轮迭代后 context 膨胀。

### 会话自动压缩

超过 24 条历史就把旧消息压成意图摘要。截断点锁在 `user` 消息边界，保证 `assistant → tool` 调用链完整，否则 API 会拒绝这串历史。

## 为什么不用 LangGraph

LangGraph.js 依赖的底层包在 React Native 里有原生兼容问题，Checkpointer 又强绑服务端存储（Postgres / SQLite / Redis），手机上没有对应位置。

| 需求 | LangGraph 概念 | NodeSmith 方案 |
| --- | --- | --- |
| 状态机 | `StateGraph` | `agent/runtime.ts`（纯 TS 循环） |
| 工具层 | `@tool` | 9 个原子工具函数 |
| 状态持久化 | `Checkpointer` | 每张图一个 `AgentSession`，落 `AsyncStorage` |
| 记忆修剪 | `MemorySaver` | 规则驱动的边界截断与摘要注入 |

以后要迁到服务端，只需替换 `runtime.ts` 的调用入口，工具定义可以直接搬到 Python 侧当 `@tool`。

## 工程取舍

- **自动分层布局**：不做拖动节点，位置由布局算法算（叶子按序占位、父节点落在子节点正中、连线走直角），改完自动重排
- **手势不触发重渲染**：单指平移走 `PanResponder` + `Animated`，双指捏合连续缩放，按钮走档位
- **纯端侧运行**：纯 Expo Managed Workflow，没有自定义原生代码，API Key 只存本地

## 快速开始

需要 Node.js 18+。

```bash
git clone https://github.com/david-dev666/nodesmith.git
cd nodesmith
npm install    # 自动生成 src/config/seed.local.ts 与 ai.local.ts
npm start      # 手机装 Expo Go 扫码即可运行
```

启动后进「设置 → DeepSeek」填入 [API Key](https://platform.deepseek.com/api_keys)，回到「结构图」页说第一句话。

> Web 端受浏览器 CORS 限制，连不上 DeepSeek，完整体验要用手机或原生构建。

### 构建 APK

```bash
npm run build:apk      # 产出到 android/app/build/outputs/apk/release/
```

## 技术栈

- 运行时：Expo SDK 57 / React Native 0.86 / TypeScript 6
- 渲染：`react-native-svg`
- Agent：自研 ReAct 循环（Tool Calling + 沙盒隔离）
- 模型：DeepSeek `deepseek-chat` / `deepseek-reasoner`

## 许可证

[MIT](LICENSE) © david-dev666
