# 提交到 awesome-dsh-plugin 收录

把本插件收录进 DSH 插件市场（dsh-market）的提交材料。市场数据来自
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 注册表，
**一个文件一条**。

## 提交文件（内容照抄）

在 `awesome-dsh-plugin` 仓库新建文件
`data/plugins/mhxy13867806343__dsh-update-vd.yml`：

```yaml
url: https://github.com/mhxy13867806343/dsh-update-vd
name: mhxy13867806343/dsh-update-vd
category: ui
description:
  en: 'DSH Desktop update center — sidebar version and update button, a progress-bar dialog, and unattended install (mount the DMG, replace the app, relaunch) with resume support.'
  zh: 'DSH Desktop 更新中心——侧栏显示版本与更新按钮，弹窗带进度条，下载完成后自动挂载 DMG、替换应用并重启，支持断点续传与取消二次确认。'
```
> 英文那行**必须加引号**：描述里有「冒号+空格」，不加引号 YAML 会当成嵌套键解析失败。

> 分类 `ui` 贴合它做的事（侧栏 + 弹窗都是界面）。描述只讲功能、不带营销词，且与代码一致。

## 前置门槛（已核对）

门槛来自 [check-submission.mjs](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/check-submission.mjs)：
`MIN_AGE_DAYS = 1`，**已经没有提交数门槛了**（2026-09-03 取消，见脚本注释 #4196）。

| 项 | 要求 | 本仓库 |
|---|---|---|
| `dsh.bundle` manifest | package.json 声明 | ✅ `{"patch":"./cordis.patch.yml"}` |
| `cordis.patch.yml` | 仓库根 | ✅ 有 |
| `dsh-plugin` topic | 仓库 About 里加 | ✅ 已加 |
| 仓库存在且未归档、非 DSH 本体 | — | ✅ |
| 仓库年龄 | **≥1 天** | ⬜ 建于 2026-10-09T08:31Z，**2026-10-10 08:32Z 之后**可提交 |
| 提交数 | 已取消该门槛 | — |

## 提交流程

1. **加 `dsh-plugin` topic**：GitHub 仓库 → About → Topics → 添加 `dsh-plugin`（CI 会查）。
   命令行等价写法：
   ```bash
   gh api -X PUT repos/mhxy13867806343/dsh-update-vd/topics -f names[]=dsh-plugin
   ```
2. 在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 点
   **New Pull Request**，添加上面那个 `data/plugins/...yml` 文件。
3. PR 标题/正文建议：
   ```
   Add mhxy13867806343/dsh-update-vd
   ```
   ```markdown
   ## 提交插件
   - repo: https://github.com/mhxy13867806343/dsh-update-vd
   - 分类: ui
   - 说明: DSH Desktop 更新中心（进度条 + 一键装好 + 断点续传）
   ```
4. 合并后，站点 + dsh-market 会在次日自动收录（daily build）。之后在插件市场就能**一键安装**。

## 可选

- **截图**：在仓库根放 `screenshots.json` 列出 1-8 张图片（市场详情页展示），路径相对该文件。
  ```json
  ["assets/screenshot-1.png"]
  ```
- **npm 包**：`npm publish` 到 `@mhxy13867806343/dsh-update-vd`（`package.json` 里的
  `repository` / `publishConfig` 已配好，会自动关联下载量）。

## 备注

> 本插件会关掉 DSH Desktop 自带的 `desktop-updates` 行（见 `cordis.patch.yml`）。
> 市场审核若对此有疑问，可说明：自带流程是「下载 DMG → Finder 打开 → 手动拖进 Applications」，
> 本插件就是替代它，两者同时开启会各弹各的框，因此默认只留一个。
