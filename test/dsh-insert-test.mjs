import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? '/tmp/dsudep9/package.json');
const React = require('react');
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {}, getSelection: () => null };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [], createRange: () => ({ selectNodeContents() {}, collapse() {} }), execCommand: () => true };
let captured = null;
await import(CLIENT_PATH);
let uiSession = undefined;
const mod = captured.factory((id) => { if (id === 'react') return React; throw new Error(id); });
const slots = { inject: (_k, cb) => cb(), register: () => {} };
mod.apply({ effect: (fn) => fn(), slots, locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) }, get: (name) => (name === 'uiSession' ? uiSession : undefined) });
let fail = 0;
const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) fail += 1; };

console.log('— 插入：走官方 uiSession API —');
let sent = null;
uiSession = { adapter: { current: { getSnapshot: () => ({ key: 's1', hooks: { input: { getSnapshot: () => ({ draft: '已有草稿' }) } }, props: { inputActions: { setDraft: (text) => { sent = text; } } } }) } } };
let r = mod.__test.insertTextIntoInput('git status');
check('用 setDraft 且保留已有草稿', r.ok === true && r.via === 'setDraft' && sent === '已有草稿\n\ngit status', JSON.stringify({ r, sent }));
uiSession = { adapter: { current: { getSnapshot: () => ({ key: 's1', hooks: { input: { getSnapshot: () => ({ draft: '   ' }) } }, props: { inputActions: { setDraft: (text) => { sent = text; } } } }) } } };
r = mod.__test.insertTextIntoInput('git log');
check('草稿是空白时不加多余空行', sent === 'git log', JSON.stringify(sent));
uiSession = { adapter: { current: { getSnapshot: () => ({ key: 's1', hooks: { input: { getSnapshot: () => ({ draft: '' }) } }, props: { inputActions: { insertText: (text) => { sent = text; } } } }) } } };
r = mod.__test.insertTextIntoInput('只有 insertText 也能用');
// insertText(text) 需要 captureInsertion() 给的 span，只传文本会抛错 —— 这条分支已被去掉，
// 只有 insertText 可用时不再硬用，而是走 DOM 兜底（本测试环境没有输入框 → no-input）
check('只有 insertText 时不硬用（避免抛错），改走 DOM 兜底', r.ok === false && r.reason === 'no-input', JSON.stringify(r));

console.log('\n— 没有会话 / 没有服务 —');
uiSession = { adapter: { current: { getSnapshot: () => ({ key: undefined, hooks: {}, props: {} }) } } };
r = mod.__test.insertTextIntoInput('x');
check('没选工作区 → no-session（界面据此提示）', r.ok === false && r.reason === 'no-session');
uiSession = undefined;
r = mod.__test.insertTextIntoInput('x');
check('服务拿不到 → 退回 DOM（DOM 也没有输入框则 no-input）', r.ok === false && r.reason === 'no-input');

console.log('\n— 文本拼装 —');
check('单条只插内容（不带 # 标题）', mod.__test.notesToText([{ title: 'T', content: 'git add -A' }]) === 'git add -A');
const multi = mod.__test.notesToText([{ title: 'A', content: 'a1' }, { title: '', content: 'b1' }]);
check('多条带 # 标题分段', multi === '# A\na1\n\nb1', JSON.stringify(multi));
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
