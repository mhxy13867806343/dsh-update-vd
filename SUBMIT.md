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
  en: DSH Desktop update center: sidebar version + update button, a progress-bar update dialog, and unattended install (mounts the DMG, replaces the app, relaunches) with resume support.
  zh: DSH Desktop 更新中心：侧栏显示版本与更新按钮，弹窗带进度条，下载完成后自动挂载 DMG、替换应用并重启，支持断点续传与取消二次确认。
```

> 分类 `ui` 贴合它做的事（侧栏 + 弹窗都是界面）。描述只讲功能、不带营销词，且与代码一致。

## 前置门槛（已核对）

| 项 | 要求 | 本仓库 |
|---|---|---|
| `dsh.bundle` manifest | package.json 声明 | ✅ `{"patch":"./cordis.patch.yml"}` |
| `cordis.patch.yml` | 仓库根 | ✅ 有 |
| `dsh-plugin` topic | 仓库 About 里加 | ⬜ 待加（见下） |
| 仓库年龄 | ≥1 天 | ⬜ 刚建，明天才达标 |
| 提交数 | ≥10 | ⬜ 刚建 |

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
