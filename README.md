# dsh-update-vd

> DSH Desktop 更新中心：**侧栏版本号** + **一条「更新」按钮** + **带进度条的更新弹窗**，
> 下载完自动替换 `/Applications` 里的 app 并重启 —— 不用再把 DMG 里的 app 手动拖进 Applications。

一个基于 **DeepSeek Harness / DSH Desktop** 的 Cordis 插件（宿主端 + 客户端），把 DSH Desktop 的
更新体验换成一条自动链路。

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
