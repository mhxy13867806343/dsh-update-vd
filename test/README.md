# 回归测试

这些测试**不放进 npm 包**（`package.json` 的 `files` 只列了 lib 等），只在仓库里跑。

## 怎么跑

```bash
# 1) 先准备 react（测试用 SSR 渲染客户端组件）
mkdir -p /tmp/dsh-test-deps && cd /tmp/dsh-test-deps
npm init -y && npm i react@18 react-dom@18
export DSH_TEST_DEPS=/tmp/dsh-test-deps/package.json

# 2) 在仓库根目录跑
cd <仓库根>/lib && cp client.js /tmp/c.mjs && node --check /tmp/c.mjs    # 客户端语法
node --check index.js && node --check resources.js                        # 宿主语法
cd .. && node test/vd-pages-test.mjs       # 既有功能：更新行/更新弹窗/技能页/MCP 页（18 项）
node test/dsh-notes-test.mjs               # 笔记各种视图（16 项）
node test/dsh-notes-verify.mjs             # 笔记独立复核（14 项，含下面两条「必须保留」）
node test/dsh-insert-test.mjs              # 插入契约（7 项）
node test/dsh-changelog-test.mjs           # 更新日志弹窗（5 项）
node test/dsh-agents-test.mjs              # 「智能体」设置页的各种视图（30 项）
node test/dsh-agents-host-test.mjs         # 「智能体」宿主侧：新路由全打一遍（含真实联网，62 项）
```

## 「智能体」页（`settings.section` = `agents`，order 150）怎么测

- `test/dsh-agents-test.mjs`：纯客户端。跟别的渲染测试一样，用 `renderToStaticMarkup` ＋ 受控 `useState`
  队列把每种视图的初始 state 喂进去 —— 列表（有数据 / 空 / 搜索无结果 / 注册表读不到）、查看正文、
  编辑器（新建 / 编辑 / 复制内置 / 系统提示词模式）、删除确认、导出（全部 / 单条）、导入（空白 / 报错）、
  在线搜索（有结果 / 搜不到 / 搜索中 / 加地址面板 / 报错）。队列顺序＝组件里 `useState` 的调用顺序：
  `state, query, mode, busy, sources, online, draft`（7 个）。
- `test/dsh-agents-host-test.mjs`：宿主侧。把 `DSH_HOME` 指到 `/tmp/dsh-agents-host-home`（**不碰真身**），
  `import` 宿主半边，用一个**假 ctx** apply：`connection.fetch.register` 收路由、
  `get('agentPresets')` 给一个假注册表、`plugin(模块, config)` 模拟「挂一行声明 = 注册表里多一条」。
  于是「保存 → 立刻出现在列表里 → 删掉 → 从列表消失」这条链路是真的走通了。
  **其中在线搜索那一段会真的发网络请求**（GitHub API + `raw.githubusercontent.com`），而且把
  `globalThis.fetch` 包了一层数请求次数：同一个仓库**第一次搜索要花 18 次请求**（repo + tree + 16 个
  候选 patch 的 raw），**换个关键字重搜必须是 0 次新请求**（命中 `AGENT_SEARCH_CACHE`）——
  这条断言是故意加重的，因为 GitHub 未登录只有 60 次/小时，缓存一旦失效这功能第二次就 403。
  没网 / 被墙时那几步记 `SKIP`，不算失败。

### ⚠️ 「智能体」页必须保留的约束

1. **纯加法**：`lib/client.js` 里这一页是**独立新增段落**（`AGENT_INLINE` / `AgentSource` / `AgentsPage` /
   `defaultAgentBodyText`），只在 `apply()` 末尾多注册一个 slot。**不要**去改
   `OnlineSearch` / `SkillsPage` / `McpPage` / 笔记 / 更新那几段 —— 尤其别顺手「修」`OnlineSearch` 里
   `onSources` / `removeAddress` 那两个未定义引用（它们被当成 props 名字用，动它就动了技能/MCP 的既有行为）。
   所以智能体页**没有复用** `OnlineSearch`，而是自己写了一个 `AgentSource`（交互一样，但 `onSources`
   正确解构了、「删除这个地址」也真的实现了）。
2. **不要动既有路由的语义**：`/agents*` 是新路由；`/sources`、`/sources/add`、`/sources/remove` 只是
   多认了一个 `kind: 'agents'`（由 `sourceKind()` 归一化），`skills` / `mcp` 的行为必须一模一样
   —— `dsh-agents-host-test.mjs` 里有「sources.skills / mcp 行为不变」这条断言。
3. **不要撞 slot id**：内置预设页的 id 是 `agent-presets`（order 20），本页是 `agents`（order 150）。
   `dsh-agents-test.mjs` 末尾会断言没撞 id、且 skills/mcp/agents 的 order 分别是 130/140/150。
4. **`agentPresets` 拿不到要给提示而不是崩**：`lib/resources.js` 的 `agentPresetService()` 会抛出
   「还没就绪」，`listAgents()` 把它降级成 `registryError` 并在页面顶部显示 —— 这样服务没就绪时
   至少还能管理本插件自己那几条。别把它改成 `ctx.agentPresets.xxx` 直接访问。
5. **预设正文必须走 DSH 自己的 YAML schema**：`js-yaml` + `@deepseek-ai/cordis-plugin-include` 的
   `entryListSchema`（这样 `!!js` 表达式、分组、`disabled` 都原样保留）。这两个包只装在 DSH 的 app 里，
   所以用 `appResolve()`（`createRequire` 指到 `<.app>/Contents/Resources/app/package.json`）解析，
   **不要**写成裸 `import 'js-yaml'` —— 打包后插件自己的 node_modules 是空的。
6. **下载只能走 Blob + `URL.createObjectURL` + `<a download>`**，别改成 `location.href = …`。
7. **不许静默覆盖**：`saveAgent` / `importAgent` 撞到内置（或别人管的）id 一定报错；撞到自己那些
   也必须显式 `overwrite: true` 或 `asCopy: true`。别为了「顺手」把它改成自动覆盖。
8. **`AGENT_SEARCH_CACHE`（10 分钟）不能删**：GitHub 未登录 60 次/小时，一次预设搜索就要 18 次请求
   （repo + tree + 每个候选 patch 一份 raw）。缓存存的是**未过滤**的完整结果，关键字过滤在本地做，
   所以同一仓库换关键字重搜是 0 次请求。删了它，这功能搜两次就会被 GitHub 403。
   注意它是本插件自己的 Map，**不要**去改技能那条路已有的 `TREE_CACHE`。

## ⚠️ 必须保留的两处修复（来自 62b1cff）

1. **插入不能冲掉用户已打好的草稿**：`snapshot.hooks.input` 是 **store**，草稿要读 `hooks.input.getSnapshot().draft`；
   直接读 `.draft` 恒为 `undefined` → 会被当成空草稿 → `setDraft` 整段覆盖。`dsh-notes-verify.mjs` 里有断言。
2. **窄栏（`wide === false`）的图标行要自带 `<style>`**：折叠侧栏且没开过弹窗时，光靠组件里那份 CSS 不存在，
   图标按钮会退化成浏览器默认外观。同一分支的更新行是自带 style 的，笔记行也必须带。

改动 `lib/client.js` 里的笔记段落时，请重跑上面 5 个测试；改了这两处必须先说服自己为什么。
