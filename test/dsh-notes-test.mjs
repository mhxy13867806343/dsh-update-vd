import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {}, getSelection: () => null };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [], createRange: () => ({ selectNodeContents() {}, collapse() {} }), execCommand: () => true };
let captured = null;
await import(CLIENT_PATH);

let queue = [];
const React2 = Object.create(React);
React2.useState = (init) => React.useState(queue.length > 0 ? queue.shift() : typeof init === 'function' ? init() : init);
const mod = captured.factory((id) => { if (id === 'react') return React2; throw new Error(id); });
const reg = [];
mod.apply({ effect: (fn) => fn(), slots: { inject: (_k, cb) => cb(), register: (o, C) => reg.push({ o, C }) }, locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) }, remote: { account: {} } });
const row = reg.find((e) => e.o.id === 'dsh-update-notes');
const modal = reg.find((e) => e.o.id === 'dsh-update-notes-modal');
if (row === undefined || modal === undefined) { console.log('FAIL 没注册上'); process.exit(1); }
console.log(`  注册: 行 order=${row.o.order} / 弹窗 order=${modal.o.order}（余额行是 110，所以排在它下面 ✓）`);

const notes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, title: `命令 ${i}`, content: `git commit -m "第 ${i} 条"\n第二行内容`, updatedAt: 1700000000000 + i }));
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();
let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };
// props 必须能显式传：wide 不传的话 NotesRow 走的是宽栏分支，
// 「窄栏只出图标」那条断言就会变成永远成立的假测试（这个坑真的漏过一个 bug）。
const render = (component, picks, label, props) => { queue = picks; try { const html = renderToStaticMarkup(React.createElement(component, props)); return html; } catch (e) { fail += 1; console.log(`  FAIL ${label} 渲染抛错 → ${e.message}`); return ''; } };

console.log('\n— 侧栏行 —');
let html = render(row.C, [notes, false], '侧栏行', { wide: true });
check('显示「笔记」和条数', html.includes('笔记') && html.includes('12'), text(html));
html = render(row.C, [notes, false], '窄栏', { wide: false });
check('窄栏只出图标（不显示文字）', !/\.\s*笔记/u.test(text(html)) && text(html).includes('📝'), text(html));
check('窄栏自带 <style>（折叠侧栏时样式不能丢）', html.includes('<style>') && html.includes('dsn-row-rail'), `${html.length} 字节`);

console.log('\n— 弹窗：列表 / 分页 —');
const M = (open, list, q, size, page, picked, view, hint) => [open, list, q, size, page, picked, view, hint];
html = render(modal.C, M(true, notes, '', 10, 1, [], { kind: 'list' }, null), '第1页');
check('第1页只出 10 条', (html.match(/dsn-item"/gu) ?? []).length === 10 && html.includes('第 1/2 页'), text(html).slice(0, 90));
html = render(modal.C, M(true, notes, '', 10, 2, [], { kind: 'list' }, null), '第2页');
check('第2页出剩下 2 条', (html.match(/dsn-item"/gu) ?? []).length === 2 && html.includes('第 2/2 页'), '');
html = render(modal.C, M(true, notes, '', 20, 1, [], { kind: 'list' }, null), '每页20');
check('每页 20 时只有 1 页', html.includes('第 1/1 页') && html.includes('20 条'), '');
html = render(modal.C, M(true, notes, '', 10, 1, ['n0', 'n1'], { kind: 'list' }, null), '多选');
check('多选后按钮变「插入选中的 2 条」', html.includes('插入选中的 2 条'), '');
html = render(modal.C, M(true, notes, '不存在的关键字', 10, 1, [], { kind: 'list' }, null), '搜不到');
check('搜不到有文案', html.includes('没有匹配的笔记'), '');
html = render(modal.C, M(true, [], '', 10, 1, [], { kind: 'list' }, null), '空');
check('空状态有文案', html.includes('还没有笔记'), '');
html = render(modal.C, M(true, notes, '', 10, 1, ['n0'], { kind: 'list' }, '没找到可写入的输入框：请先在左侧选一个工作区目录'), '写不进去的提示');
check('「没选工作区」提示会显示', html.includes('请先在左侧选一个工作区目录'), '');

html = render(modal.C, M(true, notes, '', 10, 1, [], { kind: 'list' }, null), '全选控件');
check('有「全选本页」+「全选全部」+已选计数', html.includes('全选本页（10 条）') && html.includes('全选全部 12 条') && html.includes('已选 0 条'), '');
html = render(modal.C, M(true, notes, '', 10, 1, ['n0', 'n1'], { kind: 'list' }, null), '已选状态');
check('已选时出现「清空选择」', html.includes('清空选择') && html.includes('已选 2 条'), '');
html = render(modal.C, M(true, notes, '', 10, 2, notes.slice(0, 10).map((n) => n.id), { kind: 'list' }, null), '本页全勾时不重复选');
check('第2页只勾本页 2 条（不误选别的页）', html.includes('插入选中的 10 条') && html.includes('全选本页（2 条）'), '');

console.log('\n— 弹窗：编辑 / 删除确认 —');
html = render(modal.C, M(true, notes, '', 10, 1, [], { kind: 'edit', isNew: true, draft: { title: '标题', content: '内容' } }, null), '新增');
check('新增表单有标题/内容/字数', html.includes('新增笔记') && html.includes('2/50') && html.includes('2/1000'), '');
html = render(modal.C, M(true, notes, '', 10, 1, [], { kind: 'edit', isNew: false, draft: { id: 'n0', title: '', content: '' } }, null), '空内容时保存禁用');
check('全空时保存按钮 disabled', /disabled=""[^>]*>保存|>保存<\/button>/u.test(html) ? html.includes('disabled') : false, '');
html = render(modal.C, M(true, notes, '', 10, 1, [], { kind: 'confirm', note: notes[0] }, null), '删除确认');
check('删除有二次确认', html.includes('确定要删除') && html.includes('确定删除'), '');
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
