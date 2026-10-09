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
node test/dsh-other-ai-test.mjs            # 「从其它 AI 导入」独立视图（装了/没装两态、官网跳转、加删来源）
node test/dsh-other-ai-host-test.mjs       # 同上的宿主侧：真实 HOME 只读探测 + 临时 DSH_HOME 写操作
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

## 「从其它 AI 导入」（「智能体」页里的独立视图）怎么测

入口是「智能体」页列表头上那个「从其它 AI 导入」按钮，点开是一个**独立视图**（不是嵌套弹窗），
交互与「在线搜索」同款（独立视图 + 返回）。默认四个来源：**Codex / Claude Code / TRAE / WorkBuddy**。

- 探测路径（都是 macOS 上实测出来的，**不要凭印象改**）：
  | 来源 | 判据 | 可导入什么 | 官网 |
  | --- | --- | --- | --- |
  | Codex | `~/.codex` 存在 | `~/.codex/AGENTS.md`（全局指令）、`~/.codex/prompts/*.md` | https://developers.openai.com/codex/ |
  | Claude Code | `~/.claude/agents` 或 `~/.claude` 存在 | `~/.claude/agents/*.md`（子代理）、`~/.claude/commands/*.md` | https://claude.com/product/claude-code |
  | TRAE | `/Applications/Trae.app`（或 `Trae CN.app`）/ `trae` CLI **并且** 配置目录在 | `~/.trae/skills/*/SKILL.md`、`~/.trae/memory/user_profile.md`、`~/.trae-cn/skills/*/SKILL.md` | https://www.trae.cn/ |
  | WorkBuddy | `~/.workbuddy` 存在 | `SOUL.md` / `IDENTITY.md` / `USER.md`、`~/.workbuddy/skills/*/SKILL.md` | https://www.workbuddy.ai/ |
  **TRAE 是特例**：光有 `~/.trae`、`~/.trae-cn` 只是别的工具留下的配置残渣，
  必须 app 或 CLI 在才算「装了」（`installed=false` + `partial=true`），界面照旧显示「去官网下载安装」。
  自带的重型技能包（`~/.trae/builtin_skills`、`~/.trae/builtin/global/skills`）**故意不列**：太大且依赖它的运行时。

- `test/dsh-other-ai-test.mjs`：纯客户端，跟别的渲染测试一样用 `renderToStaticMarkup` ＋ 受控 `useState` 队列。
  **队列顺序 = `AgentsPage` 里 `useState` 的调用顺序，一共 9 个**（前 7 个是这页早就有的）：
  `state, query, mode, busy, sources, online, draft, ai, aiBusy, aiOpt` —— 少喂一个后面就串位。
  覆盖：装了/没装两态、未装的官网链接（`window.open(..., '_blank', 'noopener,noreferrer')`，**不许** `location.href`）、
  装了能列出可导入项、「已导入」标记、导入重名提示、加/删第三方来源、返回按钮、列表页那个新入口。
- `test/dsh-other-ai-host-test.mjs`：宿主侧，**分两个进程**：
  1. **主进程**在**真实 `HOME`** 上只读跑 `detectOtherAiToolkits()`（只有 `existsSync`/`readdir`，一个字节都不写），
     断言写的是**结构**而不是「一定装了谁」：正好 4 个来源、每个都有 `probeNote`/`homepage`/`format`、
     没装的 `items` 必须为空、TRAE 那种「只有配置残渣」必须 `installed=false && partial=true`；
     文件真在的话还要验「`~/.codex/AGENTS.md` 被扫出来了」「Claude 子代理的 frontmatter 生效」。
  2. **写操作必须走子进程**（`DSH_HOME=/tmp/dsh-other-ai-home` 再 `spawn` 自己）——
     因为 `lib/resources.js` 在**模块加载时**就把 `DSH_HOME` / `AGENT_STORE` / `skill-sources.json`
     的路径算成常量了：主进程要是在真实 HOME 下先 `import` 过它，后面再改 `process.env.DSH_HOME` 也没用，
     写操作会落进**真实的** `~/.dsh/`。子进程里用假 ctx 把 `/other-ai`、`/other-ai/read`、
     `/other-ai/import` 与 `other-ai` 那一类 `/sources*` 全打一遍，最后断言
     **真实的 `~/.dsh/agent-presets.json` 的 mtime/size 与跑之前一模一样**。

### ⚠️ 「从其它 AI 导入」必须保留的约束

1. **探测要快、要只读**：只在 `/other-ai` 被调用时探测一次，用 `existsSync` / 单层 `readdir` 直接命中，
   **不要**递归扫 home，也不要在进程启动时扫（宿主 `apply()` 里那条路径不能加任何扫描）。
2. **探测失败/目录不存在一律容错**：`detectOtherAiToolkits` 的每个来源、每个 extra 都包了 try/catch，
   坏掉的来源只在自己那条上显示 error，不许把 `/other-ai` 整条接口带崩，更不许崩进程。
3. **`listSources()` 里那个 `kind:'custom'` 的「自定义来源…」占位照旧不出现**（与 skills/mcp/agents 同一套约定），
   所以 `sources['other-ai']` 一开始是空数组。
4. **磁盘上第 4 个键叫 `otherAi`，不叫 `other-ai`**：`skill-sources.json` 的读者不只本插件，
   键名要能当普通标识符用。读取时两个都认（老文件兼容），写入一律写 `otherAi`。
5. **`listOtherAi()` 的响应里不许带 `content`**：装了 Claude Code 的机器一次能扫出十几万字，
   列一趟就要传几十上百 KB。要正文走 `/other-ai/read`。这条有断言盯着。
6. **没装的不许藏**：未检测到的来源也要渲染出来，带「没检测到 X」+ 可点的官网按钮
   （`window.open(homepage, '_blank', 'noopener,noreferrer')`，新窗口）。
7. **重名不许静默覆盖**：导入走的是既有的 `importAgent`，所以撞内置/别人管的照样报错、
   撞自己那几条要显式 `overwrite`；唯一的例外是**同一来源的同一项再导一次**——那是幂等刷新，
   否则用户连点两次就报错太蠢。这条有断言（「同一项再导一次是幂等刷新（不报错）」）。
8. **导入出来的预设正文必须是一行 `@deepseek-ai/dsh-persona`**（用现成的 `personaPlugins()` 包，
   不要手搓形状），并且带上 `external { via, toolkit, item, path, importedAt, truncated }` 溯源 ——
   那个视图的「已导入」标记与 `/agents` 列表里的「其它 AI · <来源>」标签都靠它。
9. **`importAgent` 的 `record` 入参**：为了让「从其它 AI 导入」复用那条链路上的重名/挂载逻辑，
   `importAgent` 多认了一个 `input.record`（调用方已经把内容读好、算成一条记录了）。
   不传这个键时**行为必须与以前完全一样** —— `dsh-agents-host-test.mjs` 那 62 项就是这条的后盾。
10. **`sourceKind('other-ai')` 之外的取值仍归 'skills'**：`skills` / `mcp` / `agents` 三个老 kind 的语义
    一个字都不许动（`dsh-agents-host-test.mjs` 里有「sources.skills / mcp 行为不变」这条断言）。

## ⚠️ 必须保留的两处修复（来自 62b1cff）

1. **插入不能冲掉用户已打好的草稿**：`snapshot.hooks.input` 是 **store**，草稿要读 `hooks.input.getSnapshot().draft`；
   直接读 `.draft` 恒为 `undefined` → 会被当成空草稿 → `setDraft` 整段覆盖。`dsh-notes-verify.mjs` 里有断言。
2. **窄栏（`wide === false`）的图标行要自带 `<style>`**：折叠侧栏且没开过弹窗时，光靠组件里那份 CSS 不存在，
   图标按钮会退化成浏览器默认外观。同一分支的更新行是自带 style 的，笔记行也必须带。

改动 `lib/client.js` 里的笔记段落时，请重跑上面 5 个测试；改了这两处必须先说服自己为什么。
