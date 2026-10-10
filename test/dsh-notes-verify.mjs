import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/**
 * 独立复核（第二个 agent 写的，不复用 /tmp/dsh-notes-test.mjs）：
 *   A. notesToText 的单条 / 多条格式
 *   B. 「插入」走官方 API 时，**必须保住用户已经打好的草稿**（按宿主真实契约构造 uiSession 绑定）
 *   C. 没有会话（binding.key === undefined）时必须返回 no-session，不能静默成功
 *   D. 窄栏（wide=false）那一行必须自带 <style>，否则折叠侧栏时是浏览器默认按钮外观
 *   E. 列表行里有「插入 / 编辑 / 删除」三个按钮、页码按钮、右上角 ×
 *
 * 关键点：宿主的 hooks 是 **store**（createSnapshotStore = {getSnapshot, subscribe, …}），
 * 由 uiSession.provide 的 materialize() 原样塞进绑定里；渲染器再把它包成 useInput(selector)。
 * 所以读草稿必须 hooks.input.getSnapshot().draft，写成 hooks.input.draft 会永远读到 undefined。
 */
import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {}, getSelection: () => null };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [], createRange: () => ({ selectNodeContents() {}, collapse() {} }), execCommand: () => true };
globalThis.Event = class { constructor(type) { this.type = type; } };

await import(CLIENT_PATH);

let queue = [];
const React2 = Object.create(React);
React2.useState = (init) => React.useState(queue.length > 0 ? queue.shift() : typeof init === 'function' ? init() : init);
const mod = captured.factory((id) => {
	if (id === 'react') return React2;
	throw new Error(id);
});

// —— 按宿主真实契约造一个 uiSession 绑定：hooks.input 是 store，不是快照 ——
let sent = null;
let draftInStore = '';
const binding = () => ({
	key: 'session-1',
	hooks: { input: { getSnapshot: () => ({ draft: draftInStore, draftRev: 3, phase: 'plain' }), subscribe: () => () => {} } },
	props: { inputActions: { setDraft: (text) => { sent = text; }, captureInsertion: () => ({ draftRev: 3 }), insertText: () => true, submit: () => {} } },
});
const ctx = {
	effect: (fn) => fn(),
	slots: { inject: (_key, cb) => cb(), register: () => {} },
	locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) },
	get: (name) => (name === 'uiSession' ? { adapter: { current: { getSnapshot: binding } } } : undefined),
};
mod.apply(ctx);

let fail = 0;
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (!ok) fail += 1;
};
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

console.log('— A. 插入文本格式 —');
const one = { id: 'a', title: '命令 A', content: 'git commit -m "x"' };
const two = [one, { id: 'b', title: '命令 B', content: 'git status' }];
check('单条只插内容（不带 # 标题）', mod.__test.notesToText([one]) === 'git commit -m "x"', JSON.stringify(mod.__test.notesToText([one])));
check('多条用空行分隔且每条带 # 标题', mod.__test.notesToText(two) === '# 命令 A\ngit commit -m "x"\n\n# 命令 B\ngit status', JSON.stringify(mod.__test.notesToText(two)));

console.log('\n— B. 官方 API 插入时必须保住已有草稿 —');
draftInStore = '用户已经打好的草稿';
sent = null;
const r1 = mod.__test.insertTextIntoInput('笔记内容');
check('走的是官方 setDraft', r1.ok === true && r1.via === 'setDraft', JSON.stringify(r1));
check('已有草稿被保住（新文本接在后面）', sent !== null && sent.includes('用户已经打好的草稿') && sent.includes('笔记内容'), `setDraft 收到: ${JSON.stringify(sent)}`);

draftInStore = '';
sent = null;
mod.__test.insertTextIntoInput('只有笔记内容');
check('草稿为空时只写笔记内容', sent === '只有笔记内容', JSON.stringify(sent));

console.log('\n— C. 没有会话时 —');
const ctxNoSession = { ...ctx, get: (name) => (name === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ key: undefined, hooks: { input: undefined }, props: { inputActions: undefined } }) } } } : undefined) };
mod.apply(ctxNoSession);
const r2 = mod.__test.insertTextIntoInput('笔记内容');
check('返回 no-session（不静默成功）', r2.ok === false && r2.reason === 'no-session', JSON.stringify(r2));
mod.apply(ctx);

console.log('\n— D/E. 渲染：窄栏自带样式、列表按钮齐 —');
const notes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, title: `命令 ${i}`, content: `git commit -m "第 ${i} 条"`, updatedAt: 1700000000000 + i }));
const row = mod.__test && null; // 占位：row 组件从 apply 里取
let registered = [];
mod.apply({ ...ctx, slots: { inject: (_key, cb) => cb(), register: (o, C) => registered.push({ o, C }) } });
const rowEntry = registered.find((e) => e.o.id === 'dsh-update-notes');
const modalEntry = registered.find((e) => e.o.id === 'dsh-update-notes-modal');
check('侧栏行 order=120 / 弹窗 order=160', rowEntry?.o.order === 120 && modalEntry?.o.order === 160, `${rowEntry?.o.order}/${modalEntry?.o.order}`);

// 注意：wide 必须显式传 false 才是窄栏；不传 props 会走宽栏分支（peer 的测试就漏了这一点）。
queue = [notes, false];
const railHtml = renderToStaticMarkup(React.createElement(rowEntry.C, { wide: false }));
check('窄栏自带 <style>（不依赖别处注入）', railHtml.includes('<style>'), `${railHtml.length} 字节，文本=${text(railHtml)}`);
check('窄栏只出图标、不出现「笔记」文字', !text(railHtml).includes('笔记'), text(railHtml));
check('窄栏用 dsn-row-rail（与更新行同样的 32×32 图标按钮）', railHtml.includes('dsn-row-rail'), '');

queue = [true, notes, '', 10, 1, [], { kind: 'list' }, null];
const listHtml = renderToStaticMarkup(React.createElement(modalEntry.C));
check('每行都有「插入」按钮', listHtml.includes('>插入<'), '');
check('有页码按钮（不是只有上一页/下一页）', />上一页</.test(listHtml) && />1<\/button>/.test(listHtml) && listHtml.includes('>2<'), '');
check('右上角是 × 关闭', listHtml.includes('✕'), '');
check('多选底部按钮文案', listHtml.includes('插入选中的 0 条'), '');

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
