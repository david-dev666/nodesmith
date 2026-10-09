import type { DiagramStore } from '../types';

/**
 * 示例种子（这个文件会被 git 跟踪，作为模板）
 *
 * 想换成自己的图？请修改同目录下的 `seed.local.ts` —— 那个文件不会被提交到 git。
 * 如果它不存在，执行 `npm install` 会自动从这里生成一份。
 *
 * 说明：
 *   - 这只是「初始的那几张图」。App 跑起来之后，你在对话页说的每句话都由 DeepSeek 改成新的图，
 *     改动存在手机本地；改这里的种子文件并重启，会以它为准重建。
 *   - nodes 是方块，edges 是连线。edge.from -> edge.to 表示 from 在 to 的上一层。
 *   - id 只要在同一张图里唯一即可。AI 靠 id 定位节点，别重复。
 *   - group 是可选的：同组的方块共用一个颜色。用来把「一片」内容标出来。
 *   - 建议保持树形（除了根节点，每个节点只有一个父节点），这样排出来最好看。
 */
export const SEED_STORE: DiagramStore = {
  activeId: 'd-self',
  diagrams: [
    {
      id: 'd-self',
      title: '我的个人画像',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 'self', label: '我', detail: '用一张图描述我自己', group: '自我' },

        { id: 'work', label: '职业', group: '职业' },
        { id: 'work.role', label: '角色', detail: '后端工程师', group: '职业' },
        { id: 'work.skill', label: '技能', detail: '分布式系统、数据库', group: '职业' },

        { id: 'life', label: '生活', group: '生活' },
        { id: 'life.habit', label: '习惯', detail: '早起、跑步', group: '生活' },
        { id: 'life.city', label: '常驻', detail: '杭州', group: '生活' },

        { id: 'mind', label: '价值观', group: '价值观' },
        { id: 'mind.growth', label: '看重成长', group: '价值观' },
        { id: 'mind.truth', label: '讨厌含糊其辞', group: '价值观' },
      ],
      edges: [
        { from: 'self', to: 'work' },
        { from: 'self', to: 'life' },
        { from: 'self', to: 'mind' },
        { from: 'work', to: 'work.role' },
        { from: 'work', to: 'work.skill' },
        { from: 'life', to: 'life.habit' },
        { from: 'life', to: 'life.city' },
        { from: 'mind', to: 'mind.growth' },
        { from: 'mind', to: 'mind.truth' },
      ],
    },
    {
      id: 'd-team',
      title: '一个产品团队',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 'team', label: '产品团队', group: '团队' },
        { id: 'pm', label: '产品', detail: '需求与节奏', group: '岗位' },
        { id: 'design', label: '设计', detail: '交互与视觉', group: '岗位' },
        { id: 'dev', label: '研发', group: '岗位' },
        { id: 'qa', label: '测试', detail: '发布前的最后一道', group: '岗位' },
        { id: 'dev.fe', label: '前端', group: '研发' },
        { id: 'dev.be', label: '后端', group: '研发' },
        { id: 'dev.infra', label: '基础架构', detail: '构建、发布、监控', group: '研发' },
      ],
      edges: [
        { from: 'team', to: 'pm' },
        { from: 'team', to: 'design' },
        { from: 'team', to: 'dev' },
        { from: 'team', to: 'qa' },
        { from: 'dev', to: 'dev.fe' },
        { from: 'dev', to: 'dev.be' },
        { from: 'dev', to: 'dev.infra' },
      ],
    },
  ],
};
