# 回归测试

这些测试**不放进 npm 包**（`package.json` 的 `files` 只列了 lib 等），只在仓库里跑。

## 怎么跑

```bash
# 1) 装一次测试依赖（react/react-dom 已列在 devDependencies；不装进包里）
cd <仓库根> && npm install

# 2) 一键跑全部（推荐）
node test/run-all.mjs

# 或者单跑某套（测试默认用仓库自己的依赖；想用别处的就设 DSH_TEST_DEPS）
cd <仓库根>/lib && cp client.js /tmp/c.mjs && node --check /tmp/c.mjs    # 客户端语法
node --check index.js && node --check resources.js                        # 宿主语法
cd .. && node test/vd-pages-test.mjs       # 既有功能：更新行/更新弹窗/技能页/MCP 页（18 项）
node test/dsh-notes-test.mjs               # 笔记各种视图（16 项）
node test/dsh-notes-verify.mjs             # 笔记独立复核（14 项，含下面两条「必须保留」）
node test/dsh-insert-test.mjs              # 插入契约（7 项）
node test/dsh-changelog-test.mjs           # 更新日志弹窗（5 项）
node test/dsh-agents-test.mjs              # 「智能体」设置页的各种视图（30 项）
node test/dsh-agents-host-test.mjs         # 「智能体」宿主侧：新路由全打一遍（含真实联网，62 项）
node test/dsh-other-ai-test.mjs            # 「导入」设置页（`other-ai`，order 160）：装了/没装两态、官网跳转、加删来源、入口已从智能体页搬走
node test/dsh-other-ai-host-test.mjs       # 同上的宿主侧：真实 HOME 只读探测 + 临时 DSH_HOME 写操作
node test/dsh-conversations-test.mjs       # 「导入 → 对话记录」页签（页签/列表/搜索/分页/多选/导入结果）
node test/dsh-conversations-host-test.mjs  # 同上的宿主侧：真实 HOME 只读解析 + 临时 DSH_HOME 写会话
```

一次跑完（14 套 → 现在 16 套）：

```bash
cd <仓库根> && export DSH_TEST_DEPS=/tmp/dsudep9/package.json && for f in test/*.mjs; do node "$f" || echo "FAILED $f"; done
```

## 「智能体」页（`settings.section` = `agents`，order 150）怎么测

- `test/dsh-agents-test.mjs`：纯客户端。跟别的渲染测试一样，用 `renderToStaticMarkup` ＋ 受控 `useState`
  队列把每种视图的初始 state 喂进去 —— 列表（有数据 / 空 / 搜索无结果 / 注册表读不到）、查看正文、
  编辑器（新建 / 编辑 / 复制内置 / 系统提示词模式）、删除确认、导出（全部 / 单条）、导入（空白 / 报错）、
  在线搜索（有结果 / 搜不到 / 搜索中 / 加地址面板 / 报错）。队列顺序＝组件里 `useState` 的调用顺序：
  `state, query, mode, busy, sources, online, draft`（**7 个**）。
  **v1.9.1 起这页只有这 7 个 state** —— 原来排在这后面的 `ai` / `aiBusy` / `aiOpt` / `aiTab` / `conv*`
  （共 13 个）已经跟着「从其它 AI 导入」UI 一起搬去独立的一页 `OtherAiPage` 了，`mode.kind === 'otherAi'`
  这个分支和列表头上那个入口按钮也一并删掉了。
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
3. **不要撞 slot id**：内置预设页的 id 是 `agent-presets`（order 20），本页是 `agents`（order 150），
   搬出去的「导入」页是 `other-ai`（order 160）。
   `dsh-agents-test.mjs` 末尾会断言没撞 id、且 skills/mcp/agents 的 order 分别是 130/140/150；
   `dsh-other-ai-test.mjs` / `dsh-conversations-test.mjs` 末尾会断言 `other-ai` 的 order 是 160、
   且**「智能体」页里不再有**「从其它 AI 导入」这个入口（渲染结果与源码两处都断言）。
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

## 「从其它 AI 导入」（设置里独立的一页 `other-ai`，order 160）怎么测

v1.9.1 起它不是「智能体」页里的分支了：`settings.section` 里多注册了一页
`{ id: 'other-ai', order: 160, label: '导入' }`（排在「智能体」150 **下面**），
整套 UI 搬进独立组件 `OtherAiPage`；「智能体」页里那个入口按钮与 `mode.kind === 'otherAi'`
分支、以及 `ai` / `aiBusy` / `aiOpt` / `aiTab` / `conv*` 那 13 个 state 全部删掉。
默认四个来源：**Codex / Claude Code / TRAE / WorkBuddy**。

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
  它渲染的是**新页** `OtherAiPage`（`registered.find((e) => e.o.id === 'other-ai')`）。
  **队列顺序 = `OtherAiPage` 里 `useState` 的调用顺序，一共 15 个**：
  `presets, busy, ai, aiBusy, aiOpt, aiTab, conv, convQuery, convSource, convRows, convPageSize, convPage, convPicked, convResult, convCwd`
  —— 少喂一个后面就串位（第 1 个 `presets` 就是用来算「已导入」标记的 `/agents` 清单，
  第 2 个 `busy` 原来是借「智能体」页的 state，搬出来之后是这一页自己的）。
  覆盖：装了/没装两态、未装的官网链接（`window.open(..., '_blank', 'noopener,noreferrer')`，**不许** `location.href`）、
  装了能列出可导入项、「已导入」标记、`presets` 拿不到时不崩、加/删第三方来源、
  **反向断言**：渲染「智能体」页（7 个 state）结果里不再有「从其它 AI 导入」，
  且源码里 `AgentsPage` 那一段不再有 `otherAi` / `aiBusy` / `aiOpt` / `aiTab` / `conv` 与那句文案、`useState` 恰好 7 个；
  以及 slot：`skills/mcp/agents/other-ai` 的 order 分别是 130/140/150/160、`other-ai` 的 `label === '导入'`。
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
   这一页的「已导入」标记与 `/agents` 列表里的「其它 AI · <来源>」标签都靠它。
   搬出来之后「已导入」标记改由 `OtherAiPage` 自己拉 `/agents`（`loadPresets`），导入成功后
   `loadAi()` + `loadPresets()` 各刷一次；**不要再**去读「智能体」页的 `state.presets`（那页已经没有这份 state 了）。
9. **`importAgent` 的 `record` 入参**：为了让「从其它 AI 导入」复用那条链路上的重名/挂载逻辑，
   `importAgent` 多认了一个 `input.record`（调用方已经把内容读好、算成一条记录了）。
   不传这个键时**行为必须与以前完全一样** —— `dsh-agents-host-test.mjs` 那 62 项就是这条的后盾。
10. **`sourceKind('other-ai')` 之外的取值仍归 'skills'**：`skills` / `mcp` / `agents` 三个老 kind 的语义
    一个字都不许动（`dsh-agents-host-test.mjs` 里有「sources.skills / mcp 行为不变」这条断言）。
11. **这一页是独立 slot，不许再挂回「智能体」页**：`ctx.slots.register({ name: 'settings.section',
    id: 'other-ai', order: 160, label: '导入' }, OtherAiPage)` 是**唯一**入口；`OtherAiPage` 必须是
    `AgentsPage` 的**同级**函数（同一个 factory 作用域），别嵌进 `AgentsPage` 里面。
    「智能体」页的列表/搜索/新建/修改/删除/复制一份/导出/导入/在线搜索**一行都不许动**，
    那 7 个 state 的顺序也不许变（`dsh-agents-test.mjs` 喂的就是这 7 个）。
12. **布局继续用内联样式兜底**：这一页跟「智能体」页一样，只用 `AGENT_INLINE` 里的内联 style +
    宿主主题变量（`--dsw-alias-*`），不要指望宿主那份 `<style>` 一定会生效。

## ⚠️ 必须保留的两处修复（来自 62b1cff）

1. **插入不能冲掉用户已打好的草稿**：`snapshot.hooks.input` 是 **store**，草稿要读 `hooks.input.getSnapshot().draft`；
   直接读 `.draft` 恒为 `undefined` → 会被当成空草稿 → `setDraft` 整段覆盖。`dsh-notes-verify.mjs` 里有断言。
2. **窄栏（`wide === false`）的图标行要自带 `<style>`**：折叠侧栏且没开过弹窗时，光靠组件里那份 CSS 不存在，
   图标按钮会退化成浏览器默认外观。同一分支的更新行是自带 style 的，笔记行也必须带。

改动 `lib/client.js` 里的笔记段落时，请重跑上面 5 个测试；改了这两处必须先说服自己为什么。

## 「导入 → 对话记录」（独立设置页 `other-ai` 的第二个页签）怎么测

入口：`设置 → 导入`（导航里排在「智能体」下面；v1.9.1 起不再从「智能体」页进），
页签条上切到**「对话记录」**（默认还是「智能体预设」，**老行为一个字没动**）。
这一类的目标不是导「智能体」，而是把 Codex / Claude Code / WorkBuddy
里聊过的**会话**导成**真正的 DSH 会话**（导完在左侧会话列表里打开、能接着聊）。

- 本机探明的对话存放位置（**macOS 上实测出来的，不要凭印象改**）：
  | 来源 | 对话文件 | 格式 | 本机量 |
  | --- | --- | --- | --- |
  | Codex | `~/.codex/sessions/**/rollout-*.jsonl`（`YYYY/MM/DD/`）+ `~/.codex/archived_sessions` | JSONL：首行 `session_meta`，正文 `response_item`（`message` / `reasoning` / `function_call*`），`event_msg` 是 token 统计（跳过） | 230 + 11 个文件 → **117 条会话**（一个 session 会分卷成多个文件，按 session_id 合并） |
  | Claude Code | `~/.claude/projects/<转义目录>/<uuid>.jsonl` | JSONL：`type: user/assistant`，`message.content` 是字符串或 `[{type:text|tool_use|tool_result|thinking}]` | 22 条 |
  | WorkBuddy | `~/.workbuddy/projects/<转义目录>/<uuid>.jsonl` | JSONL：`message`（带 role）/ `reasoning` / `function_call(_result)` / `ai-title` | 213 条（标题从 `~/.workbuddy/workbuddy.db` 的 `sessions` 表只读补上） |
  | TRAE | `~/.trae/assistant`、`~/.trae-cn/assistant` **都是空目录** | 对话**不在文件里**（它自己的云端 / 应用内数据库） | **不支持解析**，界面如实写明 |

- `test/dsh-conversations-test.mjs`：纯客户端。渲染套路同上（`renderToStaticMarkup` ＋ 受控
  `useState` 队列），渲染的也是**新页** `OtherAiPage`（`registered.find((e) => e.o.id === 'other-ai')`）。
  **队列顺序 = `OtherAiPage` 里 `useState` 的调用顺序，一共 15 个**：
  `presets, busy, ai, aiBusy, aiOpt, aiTab, conv, convQuery, convSource, convRows, convPageSize,
  convPage, convPicked, convResult, convCwd` —— 少喂一个后面就串位；
  第 6 个 `aiTab` 决定渲染哪一个页签。覆盖：两个页签切换（含「智能体预设」页签里**不出现**
  对话 UI 的反向断言，以及这一页**不再有**「返回」的反向断言）、来源三态（装了 / 没装给官网按钮 /
  TRAE 明说解析不了）、列表有数据 / 空 / 搜不到 / 搜索命中、分页（每页 10 → 2 页、第 2 页只剩 2 条、
  每页 100 → 1 页）、多选与全选本页、导入中按钮文案、导入结果逐条报错（ok / 跳过 / 失败三种行）、
  导出 Markdown / 插入到输入框两条轻量备选、报错行、slot 没撞 id（`other-ai` order 160、label「导入」）。
- `test/dsh-conversations-host-test.mjs`：宿主侧，**分两个进程**：
  1. **主进程**在**真实 `HOME`** 上只读跑 `scanConversations()` / `readConversation()`
     （`readdir` / `readFile` / 只读打开 sqlite，一个字节都不写），断言写的是**结构与格式**：
     每个来源解析出的条数 > 0、每条都有 id / 标题 / 时间 / 消息条数、至少一条有「首条用户消息
     摘要」；完整读一个会话时角色（user/assistant/tool）与时间戳都在、`toSessionEvents()` 出来的
     事件 `seq` 从 0 连续、surface 事件都带 `surfaceOp: "append"`、结尾是 `session/title`。
     本机没有那个来源时记 `SKIP`，不写死数字。**TRAE 必须如实回报 `supported=false`**，
     读单个会明确抛错，不许假装 0 条。
  2. **写操作走子进程**（`DSH_HOME=/tmp/dsh-conv-home` 再 `spawn` 自己，并在里面另造一份假 HOME
     的假对话文件）—— 因为 `lib/conversations.js` 在**模块加载时**就把 `DSH_HOME` / 会话存储根
     算成常量了。子进程里把 `/other-ai/conversations`（清单）、`/list`、`/search`、`/read`、
     `/import` 五个新路由全打一遍，断言：
     · 真的落盘了 `session.v4.jsonl.zstd`（头行是 v4 会话头、`isSeeded:false`）；
     · **把落盘日志喂给宿主自己的 `ctx.sessions.prepare(id, { seed })` 校验通过**（跟 resume /
       恢复同一条校验路径 —— 这是「导完真能在左侧打开、能接着聊」的最硬一条证据）；
     · 同一个对话再导一次是**跳过**（幂等），内容指纹变了才用 `-2` 的新会话 id；
     · 失败**逐条报错**（不整批静默失败）；
     · 有一个「假 `sessionPersistence` 服务」的用例，验**官方 API 那条路**优先
       （`via === 'sessionPersistence'`、`create(header)` / `append(events)` / `flush` / `close` 都被调用）；
     · 跑完断言**真实的 `~/.dsh/sessions` 目录指纹（文件数 + 最近 mtime）与跑之前一模一样**。

### ⚠️ 「对话记录」必须保留的约束

1. **纯加法 + 位置迁移**：`lib/conversations.js` 是**新文件**（宿主半边），`lib/client.js` 里这部分
   （`aiTab` / `conv*` 那批 state、`loadConv`、`conversationsToMarkdown`、页签条与第二个分支）
   v1.9.1 起跟着「从其它 AI 导入」整套搬进了独立组件 `OtherAiPage`（slot `other-ai`）。
   **不要**去改 `OnlineSearch` / `SkillsPage` / `McpPage` / 笔记 / 更新那几段，
   也不要动「智能体预设」那条分支的既有行为（默认页签就是 `agents`）。
   宿主半边（`lib/index.js` / `lib/resources.js` / `lib/conversations.js`）的路由与函数行为**一个字都不许动**。
2. **既有路由语义不变**：`GET /other-ai` 不带参数时响应里**不能**多出 `conversations` 字段，
   `kind` 省略一律按 `agents` 处理（`dsh-conversations-host-test.mjs` 有这条反向断言）。
   新增的是 `/other-ai/conversations`、`/other-ai/conversations/list|search|read|import` 五条。
3. **探测/解析一律只读**：别人的配置目录（`~/.codex`、`~/.claude`、`~/.workbuddy`）**一个字节都不许写**，
   sqlite 要 `readOnly: true`；不递归整棵 home（Codex 只挖 4 层，Claude / WorkBuddy 2 层）。
   列表要带 60 秒缓存（Codex 单文件几十 MB，一次打开这一页不能把 home 读穿）。
4. **导入优先走官方 API**：`ctx.sessionPersistence.create(header)` + `handle.append(events)`，
   拿不到服务时才退回「按同一套编码自己写 `session.v4.jsonl.zstd`」（`projectKey` / `encodeSegment` /
   多帧 zstd 每帧一条记录，规则抄自 `@deepseek-ai/dsh-session-persistence-jsonl`）。
   **别改成只写文件**，也别改成裸 `fs.writeFile` 到真实 `~/.dsh`。
5. **生成的日志必须能被宿主自己的校验接受**：头行 `version:4`、`isSeeded:false`；事件 `seq` 从 0 连续；
   `system/message` / `user/message` / `assistant/message` 这些 surface 事件**必须**带
   `surfaceOp: "append"`；`assistant/message` 的 `data` 必须带 `stream: []`（少了会被
   「invalid settlement fields」拒掉）；`user/message` 的 `data.source.kind === "user"`，
   `assistant/message` 的 `message.source` 必须有 `provider` + `model`。改动这块**必须**重跑
   宿主侧那两个「Session 校验」断言。
6. **幂等不许退化成「不去重」**：靠写进第一条用户消息 `source.importedFrom.importDigest` 的 16 位
   内容指纹判断 —— 指纹一样就**跳过**；不一样就换 `-2` / `-3` 的会话 id **新建**，**绝不覆盖**已有会话。
7. **逐条报错**：`importConversations()` 的返回值里 `results[]` 每条都要有 `ok`，失败那条要带
   `error` 文案；`imported` / `skipped` / `failed` 三个计数必须对得上。
8. **TRAE 不许装懂**：它的对话不落地成文件，就必须在 UI 和错误文案里明说
   「暂不支持解析这个工具的对话格式」，不许显示成「0 个对话」然后让人以为可以导。
9. **导入是「导成 DSH 会话」+ 两条轻量备选**：主按钮导成会话；另外必须保留
   「导出 Markdown」与「插入到输入框」（走既有的 `downloadText` / `insertTextIntoInput`，
   **不要**改这两个函数的行为）。UI 里必须写清两者的差别（前者能在左侧会话列表打开、能接着聊）。
10. **写操作测试必须在子进程里跑**：`lib/conversations.js` 的 `DSH_HOME` / `SESSION_STORE_ROOT`
    是模块加载时常量。测试要用 `DSH_UPDATER_SESSION_ROOT`（临时目录）或子进程 + 临时 `DSH_HOME`
    来指开，跑完必须断言真实 `~/.dsh/sessions` 没被动过。

## 联网测试的配额预检

`host-search-test.mjs` / `host-sources-test.mjs` 会打 GitHub 公开 API（未登录 **60 次/小时**）。
这两套开头会先查 `rate_limit`：配额为 **0** 就打印「跳过：GitHub 未登录配额已用完」并以退出码 0 结束 ——
**这不是回归**。别把配额用尽当成代码坏了（曾经误报过两次）。
