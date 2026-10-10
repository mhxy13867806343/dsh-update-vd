# dsh-update-vd

> DSH Desktop 更新中心：**侧栏版本号** + **一条「更新」按钮** + **带进度条的更新弹窗**，
> 下载完自动替换 `/Applications` 里的 app 并重启 —— 不用再把 DMG 里的 app 手动拖进 Applications。

一个基于 **DeepSeek Harness / DSH Desktop** 的 Cordis 插件（宿主端 + 客户端），把 DSH Desktop 的
更新体验换成一条自动链路；另外给设置面板加了 **技能**、**MCP**、**智能体（Agent 预设）**、**导入**
四页（「导入」＝ 从本机其它 AI 工具把智能体预设 / 对话记录搬进来，v1.9.1 从智能体页搬出来独立成页），
技能 / MCP / 智能体都支持按「源地址」联网搜索与一键取用。侧栏还带一个**笔记**弹窗。

---

## ✨ 功能

### 1. 侧栏底部那一行（账号行上面）
- 平时：`版本 2.0.16` + `[检查更新]`
- 有新版本：`2.0.16 → 2.0.17` + 高亮的 `[更新]`
- 下载中：`正在下载 28%` + 一条细进度条
- 取消过 / 断网过：`[继续下载]`（**断点续传**）
- 侧栏收起成窄栏时是一个图标按钮，有新版本时带一个小圆点

### 2. 更新弹窗
| 场景 | 行为 |
| --- | --- |
| 正在下载 | 「升级 APP / 正在为您更新，请耐心等待 / 已下载 28%」+ 进度条 + `[取消] [后台升级]` |
| 点 **取消** | **二次确认**：「确定要取消下载吗？」`[继续下载] [确定取消]`，并说明已下载的部分会保留 |
| 点 **空白处** / Esc | 隐藏弹窗 = **后台升级**（下载继续，侧栏那行继续显示百分比）。二次确认开着时，点空白处只收回确认 |
| 取消过 / 失败过 | 提示「上次已下载 32%，从断点继续」，点继续就是**接着下**（HTTP Range），不从头来 |
| 下载完成 | 自动挂载 DMG → 校验版本与签名 → 替换 app → 自动重启 |

### 3. 装机细节
- 全程只请求 `dshdesktop.cn` 两个固定端点，重定向到别的主机直接拒绝。
- 安装前先整份 `ditto` 到暂存目录并 `codesign --verify --deep --strict` 验签，
  通过之后才「移开旧的 / 换上新的」（任一步失败都把旧的搬回来）。
- 退出旧 app 用三保险：`killall -TERM <CFBundleExecutable>` → `osascript … quit` →
  等它的 HTTP 端口关掉，超时再 `killall -KILL`。

### 4. 设置 → **技能**（`settings.section` = skills）
- 列出所有技能（含随包发布的、项目里的，只读的会标出来），带来源与磁盘路径；
- **搜索**（名字 / 描述）；**新增**、**编辑**（改名字 / 描述 / Markdown 正文）；
- **删除**要二次确认（并显示会被删掉的路径）；
- **导入**：给一个 http/https 地址（抓 SKILL.md），或给一个本机路径（技能目录 / 单个 .md）；
  重名会明确报错，不覆盖。
- 可写目录：`~/.dsh/skills`、`~/.agents/skills`（随包 / 项目里的只展示，不改写）。

### 5. 设置 → **MCP**（`settings.section` = mcp）
- 列出 MCP 服务器（名字 / 类型 / 地址或命令 / 是否连上）；
- **搜索**、**新增**、**编辑**、**删除**（要确认）、**启用 / 停用**；
- 两种类型都支持：`streamable-http`（URL + 请求头）与 `stdio`（命令 + 参数 + 环境变量）；
- 清单存在 `~/.dsh/mcp-servers.json`，保存后**立刻挂载/断开**（内部按 `@deepseek-ai/dsh-mcp-client`
  的行来动态挂载），不用改 profile 的 patch，也不用重启。连不上会明确告诉你哪个服务器、什么原因。

### 6. 设置 → **智能体**（`settings.section` = agents，排在「MCP」后面）

> 「**从其它 AI 导入**」v1.9.1 起**不在这一页里了** —— 它搬成了导航里「智能体」**下面**独立的一页
> 「**导入**」（`settings.section` = `other-ai`，order 160），见下面第 9 节。

管的是 DSH 的 **Agent 预设**：一个预设就是一行 `@deepseek-ai/dsh-agent-preset` 声明，
`config.plugins`（正文）决定这个智能体能用哪些插件/工具。

- **列表**：内置的（`standard` / `ptc` / `minimal` / `cordis`，随 `@deepseek-ai/dsh-web-app` 发布）、
  你/别人随包装的、以及本插件自己加的都在一起。每条显示名字、来源徽标、简介（截断两行）、
  标识、插件数 / 工具行数；装配失败的会标红并把 DSH 给的诊断原样贴出来；
- **搜索**：按名字 / 标识 / 简介 / 来源实时过滤；
- **新建 / 编辑 / 删除**：标识 + 名字 + 简介 + 排序 + 模型备注 + 正文（DSH patch 的条目清单 YAML）。
  正文也可以勾「这段是系统提示词」直接写一段话（保存时自动包成一行 `@deepseek-ai/dsh-persona`）。
  删除要**二次确认**；
- **内置的只读，但可以「复制一份」**：选它的理由 —— 内置预设随包发布、重启/升级会被覆盖，
  允许改会造成「我改的东西下次更新就没了」的错觉；而拦住用户又不合适，所以给一条明确的出路：
  任意预设（含内置）都能「复制一份」成自己的副本再改；
- **导入**：粘贴内容 / 选本地文件 / 给本机路径 / 给 http(s) 地址，四种随便挑一种。
  重名会明确报错，并给出「自动改个名字」和「覆盖同名自定义预设」两个显式选项 —— **不会静默覆盖**；
- **导出**：单条导出 + 全部导出，下载成文件（Blob + `createObjectURL` + `<a download>`）。
  两种格式：本插件 JSON（再导入时名字/简介/模型备注一起还原）、DSH 补丁 YAML（贴进 bundle 就能用）；
- **在线搜索 + 装第三方**：见下面第 7 节；
- **从其它 AI 导入**：见下面第 9 节 —— v1.9.1 起它是设置里**独立的一页**（导航「导入」，排在「智能体」下面），
  这一页不再有那个入口按钮。

数据落在 `~/.dsh/agent-presets.json`。保存后在运行时动态挂载那一行声明
（跟 MCP 一个套路：`ctx.plugin(模块, config)`），所以**不用改 profile 的 patch、也不用重启**；
删掉就是 dispose，`agentPresets` 注册表里同步消失。第三方预设如果引用的插件包没装，
它会留在列表里并标成「装配失败」，把 DSH 的报错原样显示出来 —— 装好那个包再重启 DSH 即可。

### 7. 在线搜索（三个页面都有，**多个源可选**）

技能页进「导入」就能看到；MCP 页与智能体页点「在线搜索」。选一个**源地址** → 填关键字 → 搜索 → 一键取用。

| 页面 | 内置源 | 说明 |
| --- | --- | --- |
| 技能 | `anthropics/skills` | Anthropic 官方技能库（20+ SKILL.md） |
| 技能 | `obra/superpowers` | 社区技能合集 |
| 技能 | 自定义地址… | 填 `owner/repo` 或完整 GitHub 链接（任何放 SKILL.md 的仓库都能搜） |
| MCP | MCP 官方注册表 | `registry.modelcontextprotocol.io`，按关键字搜，结果自带 `streamable-http` URL 或 stdio 启动命令 |
| MCP | `modelcontextprotocol/servers` | 官方参考实现（自动填成 `npx -y @modelcontextprotocol/server-<名字>`） |
| MCP | 自定义地址… | 别的注册表 URL，或 `owner/repo` |
| 智能体 | **本机自带预设** | 直接读随包的 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`（离线可用；取用＝复制一份成自定义） |
| 智能体 | `deepseek-ai/deepseek-harness` | 上游官方预设集合（standard / ptc / minimal / cordis） |
| 智能体 | `AcidGr/dsh-preset-mobile-use` | 第三方预设（手机自动化 Agent），**装它＝把别人的插件行挂进你的 DSH** |
| 智能体 | 自定义地址… | `owner/repo`，或一个 `.patch.yml` 的完整 https 地址 |

- 技能：搜到直接「导入这个」→ 抓 raw 的 SKILL.md 存成 `~/.dsh/skills/<名字>/SKILL.md`；
- MCP：搜到点「用它新建」→ 表单自动填好，确认后再保存（保存即挂载）；
- 智能体：搜到点「装到本机」→ 抓那份 patch、把里面的预设声明写进本机清单并**立刻挂载**（默认自动改名，不覆盖你已有的）。
  智能体的源是「扫仓库里所有 patch 文件，找带 `@deepseek-ai/dsh-agent-preset` 声明的」，所以任何按
  DSH 约定发布预设的仓库都能当源；
- **智能体的搜索结果有 10 分钟缓存**：一次搜索要花十几次 GitHub 请求，而未登录配额只有 60 次/小时，
  所以同一个仓库 10 分钟内换关键字重搜是 0 次请求（结果里会写「N 秒前抓的缓存」）；
- 都是公开只读接口、不需要 key。GitHub 未登录配额 60 次/小时，所以仓库清单有 10 分钟缓存；
- 搜索失败会把真实原因（HTTP 状态 / 认不出的地址）原样显示出来，不吞。

### 8. 从本机其它 AI 工具导入（技能 / MCP 两页有）

| 页面 | 从哪读 | 读到什么 |
| --- | --- | --- |
| 技能 | `~/.codex/skills/*/SKILL.md`、`~/.claude/skills/*/SKILL.md`、`~/.agents/skills/*/SKILL.md` | 勾选后复制进 `~/.dsh/skills/<名字>/`（同名会标出来，不覆盖） |
| MCP | Codex `~/.codex/config.toml`（含 `[mcp_servers.X.env]`）、Claude `~/.claude.json`、Cursor `~/.cursor/mcp.json`、Windsurf、Gemini CLI、OpenCode、Continue | 勾选后写进清单并**立刻挂载**；没连上会在界面上说清楚是哪个、为什么 |

实测这台机器：从 Codex 扫到 **12 个技能 + 4 个 MCP 服务器**，从 Claude 扫到 1 个，导入后文件真的落到 `~/.dsh/skills/`、清单真的落盘、挂载真的被调用（生成的配置还拿 `@deepseek-ai/dsh-mcp-client` 的官方 Zod schema 校验过）。

### 9. 从其它 AI 导入（设置里**独立的一页**：导航「导入」，在「智能体」下面）

导航里点「**导入**」→ 就是这一页（`settings.section` 的 `other-ai`，order 160，排在「智能体」150 下面；
v1.9.1 从「智能体」页**搬出来**，那边的入口按钮已经删掉），里面有**两个页签**：

| 页签 | 导什么 |
| --- | --- |
| **智能体预设**（默认） | 那几家里的「智能体 / 提示词 / 技能」，导成 DSH 智能体预设（见下面 9.1） |
| **对话记录** | 那几家里的**历史会话**，导成**真正的 DSH 会话**（能在左侧会话列表打开、能接着聊；见下面 9.2） |

#### 9.1 智能体预设页签

默认四个来源，**装了就把里面的智能体/提示词一键导成 DSH 智能体预设**，没装就**照旧显示出来**并给官网入口
（`window.open` 新窗口）—— 不把没装的藏起来。

| 来源 | 探测判据 | 能导入什么 | 官网 |
| --- | --- | --- | --- |
| **Codex** | `~/.codex` 存在 | `~/.codex/AGENTS.md`（它的全局指令文件）、`~/.codex/prompts/*.md` | [developers.openai.com/codex](https://developers.openai.com/codex/) |
| **Claude Code** | `~/.claude/agents` 或 `~/.claude` 存在 | `~/.claude/agents/*.md`（子代理：`name`/`description` 来自 frontmatter，正文＝系统提示词）、`~/.claude/commands/*.md` | [claude.com/product/claude-code](https://claude.com/product/claude-code) |
| **TRAE** | `/Applications/Trae.app`（国内版 `Trae CN.app`）或 `trae` CLI **并且** 配置目录在 | `~/.trae/skills/*/SKILL.md`、`~/.trae/memory/user_profile.md`、`~/.trae-cn/skills/*/SKILL.md` | [trae.cn](https://www.trae.cn/) |
| **WorkBuddy** | `~/.workbuddy` 存在 | `SOUL.md`（人格总纲）/ `IDENTITY.md`（身份卡）/ `USER.md`（用户画像）、`~/.workbuddy/skills/*/SKILL.md` | [workbuddy.ai](https://www.workbuddy.ai/) |

- **Codex 没有「子代理」这个概念**，所以能导的是「全局指令 + 提示词」，界面上写明了它们是它的全局指令文件；
- **TRAE 是特例**：光有 `~/.trae` / `~/.trae-cn` 只是别的工具留下的配置残渣，必须 app 或 CLI 在才算「装了」，
  否则界面上标「只有配置残渣」并显示下载入口。它自带的重型技能包（`builtin_skills` 等）故意不列 ——
  几十上百 KB 且依赖它的运行时，导过来没有意义；
- **导入的形态**：因为这几家都不是 DSH 预设格式，统一转成「一段系统提示词」的 DSH 智能体预设
  （正文就是一行 `@deepseek-ai/dsh-persona`），落到 `~/.dsh/agent-presets.json` 并**立刻挂载**。
  撞内置/撞已有都会**明确报错**，可以勾「重名自动改名」导成副本；只有「同一来源的同一项再导一次」
  才当作幂等刷新（不然连点两次就报错太蠢）；
- **可以加第三方来源**：填一个**本机路径**（md 文件，或一个目录 —— 里面的 `*.md` 会一个一个列出来）
  或一个 **http/https 地址**（一个文件，或一个 GitHub 仓库 —— 会去找里面的 `AGENTS.md` / `CLAUDE.md` /
  `agents/` / `prompts/`）。加进清单后能删；删来源**不会**删已经导进来的预设；
- **探测是只读且很快的**：只看它自己的配置目录/可执行文件在不在（`existsSync` + 单层 `readdir`），
  不递归扫 home、不上网、进程启动时也不扫（打开这一页才跑一次），界面上把「探测的是什么」原样写出来。

#### 9.2 对话记录页签（把「聊过的会话」搬进 DSH）

这一页的第二个页签不导智能体，导的是**对话本身**：Codex / Claude Code / WorkBuddy 聊过的那些会话，
可以**一键导成真正的 DSH 会话** —— 导完在左侧会话列表里就能打开、能接着聊。

| 来源 | 对话文件长什么样 | 本机实测 |
| --- | --- | --- |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/archived_sessions`；首行 `session_meta`，正文是 `response_item` | 230 + 11 个文件 → **117 条会话**（一个 session 会分卷成多个文件，按 `session_id` 合并） |
| **Claude Code** | `~/.claude/projects/<目录转义名>/<uuid>.jsonl`（`type: user/assistant`） | **22 条** |
| **WorkBuddy** | `~/.workbuddy/projects/<目录转义名>/<uuid>.jsonl`（标题从 `~/.workbuddy/workbuddy.db` 只读补） | **213 条** |
| **TRAE** | `~/.trae/assistant`、`~/.trae-cn/assistant` **都是空目录** | **暂不支持解析这个工具的对话格式**（对话在它自己的云端 / 应用内数据库里，没有稳定的本地文件可读）——界面上如实写明 |

- **列表**：标题（优先来源自己的标题 → 首条**真实**用户消息 → session id）、时间、消息条数、来源徽标。
  上游塞进「用户消息」里的注入上下文（Codex 的 `# AGENTS.md instructions…` / `<recommended_plugins>`、
  WorkBuddy 的 `<user_query>` 等）**不会**被当成标题露出来；
- **搜索**（标题 / 首条用户消息 / session id）、**单选/多选**、**全选本页** / 全选全部、**每页 10/20/50/100 + 分页**
  —— 交互与「笔记」页同款；
- **导入 = 导成 DSH 会话**：走宿主自己的会话存储服务 `ctx.sessionPersistence`
  （`create(header)` → `handle.append(events)`，头行 `version:4`、事件 `seq` 从 0 连续、surface 事件带
  `surfaceOp:"append"`）；拿不到这个服务时才退回「按同一套编码自己写
  `~/.dsh/sessions/<项目转义目录>/<会话 id>/session.v4.jsonl.zstd`」。**角色、文本、时间戳都保留**，
  工具调用/工具结果折成 `[调用工具 x] …` 一行文本，思考块不进正文（省得把会话撑爆）；
- **幂等**：会话 id 是 `session-import-<来源>-<原会话 id>`，重复导入同一个对话 = **跳过**；
  内容变了才用 `-2` 的新会话 id 新建，**绝不覆盖**已经导过的会话。失败**逐条报错**（哪条、为什么），不整批静默失败；
- **两条轻量备选**（导不成会话 / 只想看一眼时用）：「导出 Markdown」落成 `.md` 文件、
  「插入到输入框」直接塞进当前会话；也可以单条「复制 Markdown」。UI 里写清了两者的差别；
- **可选**：导入前可以填一个工作区目录，不填就用原对话自己的 `cwd`（Codex / Claude / WorkBuddy 都记了 `cwd`）；
- **只读**：别人的配置目录一个字节都不写（sqlite 用 `readOnly` 打开），Codex 只挖 4 层、Claude / WorkBuddy 2 层，
  列表带 60 秒缓存。

### 10. 侧栏「笔记」（在「充值」下面）

- 点侧栏那行「📝 笔记 N」→ 中间弹窗；
- **新增 / 编辑 / 删除**（删除要二次确认）；标题最多 **50 字**、内容最多 **1000 字**（都带实时字数）；
- **搜索**（标题 + 内容）；**每页 10 / 20 / 50 / 100** 可自由切换，带上一页 / 下一页 / 页码；
- **多选**后点「插入选中的 N 条」，或单条插入 → 直接写进当前会话的输入框（多条会按 `# 标题` 分段）；
- 没打开会话 / 没选工作区目录（找不到输入框）时会**明确提示**，不会静默失败；
- 数据存本机 `localStorage`（纯客户端，刷新页面即生效，不需要重启应用），首次自动带 3 条种子示例。

---

## 🚀 如何安装

### 方式一：DSH Market 插件市场（推荐，一键）
1. 打开 DSH Desktop 侧边栏 **插件市场**；
2. 搜索 **dsh-update-vd**；
3. 点 **安装**，重启 DSH Desktop 即常驻（下次启动自动加载）。

### 方式二：命令行
```bash
# 从 npm（若已发布）
dsh plugin --profile desktop add @mhxy13867806343/dsh-update-vd

# 或直接从本仓库装（本地目录 / git 均可）
dsh plugin --profile desktop add /path/to/dsh-update-vd
```

### 方式三：手动加进 profile
```jsonc
// profile 的 package.json
{ "dependencies": { "@mhxy13867806343/dsh-update-vd": "file:/path/to/dsh-update-vd" } }
```
```yaml
# profile 的 cordis.patch.yml（或本包的 cordis.patch.yml 会被作为 bundle 层自动应用）
- id: desktop-updates
  disabled: true
- insert:
    - id: dsh-update-vd
      name: '@mhxy13867806343/dsh-update-vd'
```

> ⚠️ 本插件会**关掉 DSH Desktop 自带的更新行**（`desktop-updates`）。不想关就删掉
> `cordis.patch.yml` 里那一段 —— 但两套更新流程同时开着会各弹各的框。

---

## ⚙️ 开关（环境变量）

| 变量 | 作用 |
| --- | --- |
| `DSH_UPDATER_AUTO_INSTALL=0` | 下载完不自动装，停在「待安装」，弹窗里给「立即安装并重启」 |
| `DSH_UPDATER_CACHE_DIR` | 缓存/暂存目录，默认 `~/Library/Caches/dsh-update-vd` |
| `DSH_UPDATER_CHANNEL` | 发布通道，默认 `stable`（也认 `beta` / `next`） |
| `DSH_UPDATER_DRY_RUN=1` | 演练：只跑到「暂存 + 验签」，不换 app、不重启 |
| `DSH_UPDATER_NO_RELAUNCH=1` | 安装脚本换完 app 后不重启（手工诊断用） |

> 环境变量要写在**启动 DSH Desktop 的那个环境**里才生效（插件随宿主进程加载）。

## 🩺 出问题先看这两个文件

- `~/Library/Caches/dsh-update-vd/state.json` —— 宿主当前完整状态（`phase` / `error` /
  已下字节数 / `code` 代码版本标记）。**`code` 跟代码里的 `CODE_TAG` 对不上，说明跑的不是最新代码**。
- `~/Library/Application Support/DSH Desktop/logs/host/dsh-<日期>.log` —— `[dsh-update-vd]`
  开头的行就是失败原因；安装细节在 `~/Library/Caches/dsh-update-vd/install.log`。
- 宿主路由：`GET /api/dsh-update-vd/status|check` · `POST /api/dsh-update-vd/download|install|cancel`

## ⚠️ 说明与限制

- **目前只支持 macOS**：安装步骤用 `hdiutil` 挂 DMG + `ditto` 替换 `.app` + `open` 重启。
  Windows/Linux 上只到「检查更新」为止（`/api/downloads/windows` 的安装流程没实现）。
- 自动安装会**退出并重启 DSH Desktop**：正在跑的任务会中断，重启后会话记录还在。
- 下载约 500MB，缓存在 `~/Library/Caches/dsh-update-vd/`；装完自动删除安装包，
  被取消/中断的 `.part` 会保留下来供续传。
- 本插件的更新来源是官方版本服务 `https://www.dshdesktop.cn/api/desktop/version` 与
  `https://www.dshdesktop.cn/api/downloads/mac`，与 DSH Desktop 自带更新用的是同一对端点。

## 📄 许可

MIT © 2026 mhxy13867806343
