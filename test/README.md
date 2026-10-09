# 回归测试

这些测试**不放进 npm 包**（`package.json` 的 `files` 只列了 lib 等），只在仓库里跑。

## 怎么跑

```bash
# 1) 先准备 react（测试用 SSR 渲染客户端组件）
mkdir -p /tmp/dsh-test-deps && cd /tmp/dsh-test-deps
npm init -y && npm i react@18 react-dom@18
export DSH_TEST_DEPS=/tmp/dsh-test-deps/package.json

# 2) 在仓库根目录跑
cd <仓库根>/lib && cp client.js /tmp/c.mjs && node --check /tmp/c.mjs    # 语法
cd .. && node test/vd-pages-test.mjs       # 既有功能：更新行/更新弹窗/技能页/MCP 页（18 项）
node test/dsh-notes-test.mjs               # 笔记各种视图（16 项）
node test/dsh-notes-verify.mjs             # 笔记独立复核（14 项，含下面两条「必须保留」）
node test/dsh-insert-test.mjs              # 插入契约（7 项）
node test/dsh-changelog-test.mjs           # 更新日志弹窗（5 项）
```

## ⚠️ 必须保留的两处修复（来自 62b1cff）

1. **插入不能冲掉用户已打好的草稿**：`snapshot.hooks.input` 是 **store**，草稿要读 `hooks.input.getSnapshot().draft`；
   直接读 `.draft` 恒为 `undefined` → 会被当成空草稿 → `setDraft` 整段覆盖。`dsh-notes-verify.mjs` 里有断言。
2. **窄栏（`wide === false`）的图标行要自带 `<style>`**：折叠侧栏且没开过弹窗时，光靠组件里那份 CSS 不存在，
   图标按钮会退化成浏览器默认外观。同一分支的更新行是自带 style 的，笔记行也必须带。

改动 `lib/client.js` 里的笔记段落时，请重跑上面 5 个测试；改了这两处必须先说服自己为什么。
