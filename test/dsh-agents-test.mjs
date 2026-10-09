import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/**
 * 渲染测试：「DSH 智能体」设置页的**每种视图**都渲染一遍。
 * SSR 不跑 state 变化，所以用受控 useState 把初始 state 直接喂进去 ——
 * 列表（有数据/空/搜不到）、查看正文、编辑器（新建/编辑）、删除确认、
 * 导出、导入、在线搜索都能真的走一遍（slot 里抛错会整片空白）。
 */
import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? '/tmp/dsudep9/package.json');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ style: {}, click: () => {}, remove: () => {} }), body: { appendChild: () => {} } };
globalThis.URL = globalThis.URL ?? {};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, presets: [], servers: [], skills: [], roots: [], sources: {} }) });

await import(CLIENT_PATH);
const mod = captured.factory((id) => {
	if (id === 'react') return React;
	throw new Error(`unexpected require(${id})`);
});

// 记录设置页组件：slots.register 时把组件抓下来
const registered = [];
let queue = [];
const React2 = Object.create(React);
React2.useState = (initial) => {
	const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial;
	return React.useState(value);
};
const fakeRequire = (id) => {
	if (id === 'react') return React2;
	throw new Error(`unexpected require(${id})`);
};
const mod2 = captured.factory(fakeRequire);
mod2.apply({
	effect: (fn) => fn(),
	slots: { inject: (_k, cb) => cb(), register: (o, C) => registered.push({ o, C }) },
	locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) },
});

const agents = registered.find((e) => e.o.id === 'agents');
if (agents === undefined) throw new Error('「智能体」页没注册上');

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

// ── 各种初始 state（顺序＝组件里 useState 的调用顺序）────────────────────
const presetData = [
	{ id: 'standard', name: 'standard', description: '标准模式：完整任务工具。', order: 1, broken: null, origin: 'builtin', originLabel: '内置', bundle: '@deepseek-ai/dsh-web-app', managed: false, writable: false, note: '标准模式：完整任务工具（bash / 文件 / 任务 / 技能…）。', plugins: 19, tools: 11 },
	{ id: 'my-review', name: '我的审查模式', description: '只读审查，不改文件。', order: 20, broken: null, origin: 'custom', originLabel: '自定义', bundle: null, managed: true, writable: true, note: '', plugins: 3, tools: 2, model: 'deepseek-flash' },
	{ id: 'broken-one', name: '坏掉的预设', description: '引用了没装的插件。', order: 30, broken: 'row 2: plugin not found: @x/y', origin: 'third-party', originLabel: '第三方 · AcidGr/dsh-preset-mobile-use', managed: true, writable: true, note: '', plugins: 2, tools: 0 },
];
const emptyState = { loading: false, presets: [], error: null, notice: null, registryError: null, model: null, store: '/Users/x/.dsh/agent-presets.json' };
const dataState = { loading: false, presets: presetData, error: null, notice: null, registryError: null, model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }, store: '/Users/x/.dsh/agent-presets.json' };
const sources = [
	{ id: 'local-shipped', label: '本机自带预设', kind: 'local', hint: '随包发布的那几个' },
	{ id: 'upstream-harness', label: 'deepseek-ai/deepseek-harness', kind: 'github', hint: '上游官方预设' },
];
const offlineOnline = { kind: 'agents', sourceId: 'local-shipped', custom: '', query: '', results: [], busy: false, error: null, limit: 24 };
const localDraft = { text: '', url: '', path: '', name: '', id: '', asCopy: false, overwrite: false, asPrompt: false, error: null };

let failures = 0;
const render = (label, args) => {
	queue = args;
	try {
		const html = renderToStaticMarkup(React.createElement(agents.C));
		console.log(`  ok   ${label} → ${text(html).slice(0, 150)}`);
		return html;
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${label} → ${error.message}`);
		return '';
	}
};

console.log('— 智能体页：列表 —');
let html = render('列表（有数据）', [dataState, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('DSH 智能体')) { failures += 1; console.log('     FAIL 缺标题'); }
if (!html.includes('内置') || !html.includes('自定义')) { failures += 1; console.log('     FAIL 缺来源徽标'); }
if (!html.includes('只读')) { failures += 1; console.log('     FAIL 内置没标只读'); }
if (!html.includes('装配失败')) { failures += 1; console.log('     FAIL broken 没标出来'); }
if (!html.includes('第三方 · AcidGr/dsh-preset-mobile-use')) { failures += 1; console.log('     FAIL 第三方来源没显示'); }
if (!html.includes('deepseek-flash')) { failures += 1; console.log('     FAIL 默认模型没显示'); }
if (!html.includes('工具 11 行')) { failures += 1; console.log('     FAIL 工具数没显示'); }
render('列表（空）', [emptyState, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
html = render('列表（空）文案', [emptyState, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('一个智能体都没读到')) { failures += 1; console.log('     FAIL 空列表文案不对'); }
html = render('搜索无结果', [dataState, 'zzz-不存在', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('没有匹配')) { failures += 1; console.log('     FAIL 搜索无结果文案不对'); }
html = render('搜索命中（按简介）', [dataState, '只读审查', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('我的审查模式') || html.includes('标准模式：完整任务工具。')) { failures += 1; console.log('     FAIL 搜索过滤没生效'); }
render('列表（注册表读不到）', [{ ...dataState, registryError: '预设服务还没就绪' }, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
render('列表（报错 + 提示）', [{ ...dataState, error: '连不上宿主', notice: '已保存「x」' }, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
html = render('列表按钮齐全', [dataState, '', { kind: 'list' }, false, sources, offlineOnline, localDraft]);
for (const label of ['新建', '编辑', '复制一份', '删除', '导出', '导入', '在线搜索', '查看', '刷新']) {
	if (!html.includes(label)) { failures += 1; console.log(`     FAIL 列表缺「${label}」按钮`); }
}

console.log('— 智能体页：查看正文 —');
html = render('查看（已读到内容）', [dataState, '', { kind: 'view', agent: presetData[1], content: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n" }, false, sources, offlineOnline, localDraft]);
if (!html.includes('正文 · 我的审查模式') || !html.includes('dsh-persona')) { failures += 1; console.log('     FAIL 正文视图不对'); }
if (!html.includes('复制一份') || !html.includes('导出这条')) { failures += 1; console.log('     FAIL 正文视图缺操作'); }
render('查看（读取中）', [dataState, '', { kind: 'view', agent: presetData[0] }, false, sources, offlineOnline, localDraft]);

console.log('— 智能体页：编辑器 —');
const newDraft = { id: '', name: '', description: '', order: '', model: '', body: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n", asPrompt: false };
html = render('新建', [dataState, '', { kind: 'edit', isNew: true, draft: newDraft }, false, sources, offlineOnline, localDraft]);
if (!html.includes('新建智能体') || !html.includes('保存')) { failures += 1; console.log('     FAIL 新建视图不对'); }
if (!/正文 \d+ 个字符/u.test(html)) { failures += 1; console.log('     FAIL 没显示正文字数'); }
if (!html.includes('标识还不合法')) { failures += 1; console.log('     FAIL 没做标识校验提示'); }
if (!html.includes('模型（可空，仅作备注）')) { failures += 1; console.log('     FAIL 编辑器缺模型字段'); }
html = render('新建（标识合法 → 校验提示消失）', [dataState, '', { kind: 'edit', isNew: true, draft: { ...newDraft, id: 'my-agent' } }, false, sources, offlineOnline, localDraft]);
if (html.includes('标识还不合法')) { failures += 1; console.log('     FAIL 合法标识仍然报不合法'); }
html = render('编辑（已有）', [dataState, '', { kind: 'edit', isNew: false, originalId: 'my-review', draft: { id: 'my-review', name: '我的审查模式', description: '只读审查', order: '20', model: 'deepseek-flash', body: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n", asPrompt: false } }, false, sources, offlineOnline, localDraft]);
if (!html.includes('编辑智能体 · my-review')) { failures += 1; console.log('     FAIL 编辑视图标题不对'); }
if (!html.includes('deepseek-flash')) { failures += 1; console.log('     FAIL 编辑视图没带上模型备注'); }
html = render('复制内置（提示来源）', [dataState, '', { kind: 'edit', isNew: true, copyFrom: 'standard', draft: { ...newDraft, id: 'standard-copy', name: 'standard（副本）' } }, false, sources, offlineOnline, localDraft]);
if (!html.includes('复制自「standard」')) { failures += 1; console.log('     FAIL 复制视图没标来源'); }
html = render('编辑器（系统提示词模式）', [dataState, '', { kind: 'edit', isNew: true, draft: { ...newDraft, id: 'zh-only', body: '你是一个只写中文的助手。', asPrompt: true } }, false, sources, offlineOnline, localDraft]);
if (!html.includes('系统提示词（会自动包成一行 persona）')) { failures += 1; console.log('     FAIL 系统提示词模式没切换标签'); }

console.log('— 智能体页：删除确认 —');
html = render('删除确认', [dataState, '', { kind: 'confirm', agent: presetData[1] }, false, sources, offlineOnline, localDraft]);
if (!html.includes('确定要删除') || !html.includes('确定删除')) { failures += 1; console.log('     FAIL 删除确认不对'); }
if (!html.includes('不能撤销')) { failures += 1; console.log('     FAIL 删除确认缺风险提示'); }

console.log('— 智能体页：导出 —');
html = render('导出（全部，JSON）', [dataState, '', { kind: 'export', format: 'json' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('导出全部自定义智能体')) { failures += 1; console.log('     FAIL 导出全部视图不对'); }
if (!html.includes('下载文件') || !html.includes('生成内容')) { failures += 1; console.log('     FAIL 导出视图缺按钮'); }
if (!html.includes('本插件 JSON') || !html.includes('DSH 补丁 YAML')) { failures += 1; console.log('     FAIL 导出视图缺格式选项'); }
html = render('导出（单条，已生成内容）', [dataState, '', { kind: 'export', format: 'yaml', id: 'my-review', content: "- insert:\n    - id: preset-my-review\n", filename: 'preset-my-review.patch.yml' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('导出智能体 · my-review') || !html.includes('preset-my-review')) { failures += 1; console.log('     FAIL 单条导出视图不对'); }

console.log('— 智能体页：导入 —');
html = render('导入（空白 + 在线搜索）', [dataState, '', { kind: 'import' }, false, sources, offlineOnline, localDraft]);
if (!html.includes('导入智能体')) { failures += 1; console.log('     FAIL 导入视图不对'); }
if (!html.includes('粘贴内容') || !html.includes('本机路径') || !html.includes('http/https 地址')) { failures += 1; console.log('     FAIL 导入视图缺来源输入'); }
if (!html.includes('或者选一个本地文件')) { failures += 1; console.log('     FAIL 导入视图缺文件选择'); }
if (!html.includes('自动改个名字') || !html.includes('覆盖同名自定义预设') || !html.includes('这段是系统提示词')) { failures += 1; console.log('     FAIL 导入视图缺选项'); }
if (!html.includes('在线搜索智能体') || !html.includes('装到本机')) { failures += 1; console.log('     FAIL 导入视图没带在线搜索'); }
html = render('导入（报错提示）', [dataState, '', { kind: 'import' }, false, sources, offlineOnline, { ...localDraft, text: 'x', error: '已经有叫「x」的预设了' }]);
if (!html.includes('已经有叫「x」的预设了')) { failures += 1; console.log('     FAIL 导入错误没显示'); }

console.log('— 智能体页：在线搜索 —');
html = render('在线搜索（有结果）', [dataState, '', { kind: 'online' }, false, sources, { ...offlineOnline, query: 'minimal', results: [{ id: 'minimal', name: 'minimal', description: '最小模式', plugins: 2, tools: 1, localPath: '/Applications/x/presets/minimal.patch.yml', sourceLabel: '本机自带' }] }, localDraft]);
if (!html.includes('在线找智能体')) { failures += 1; console.log('     FAIL 在线搜索视图不对'); }
if (!html.includes('装到本机') || !html.includes('minimal')) { failures += 1; console.log('     FAIL 在线搜索结果没渲染'); }
if (!html.includes('插件 2 · 工具 1')) { failures += 1; console.log('     FAIL 在线结果缺插件/工具数'); }
html = render('在线搜索（搜不到）', [dataState, '', { kind: 'online' }, false, sources, { ...offlineOnline, query: 'zzz', results: [] }, localDraft]);
if (!html.includes('没搜到「zzz」')) { failures += 1; console.log('     FAIL 搜不到文案不对'); }
html = render('在线搜索（搜索中）', [dataState, '', { kind: 'online' }, false, sources, { ...offlineOnline, busy: true }, localDraft]);
if (!html.includes('正在搜')) { failures += 1; console.log('     FAIL 搜索中文案不对'); }
html = render('在线搜索（加地址面板）', [dataState, '', { kind: 'online' }, false, sources, { ...offlineOnline, addOpen: true, addAddress: 'a/b' }, localDraft]);
if (!html.includes('保存地址') || !html.includes('owner/repo')) { failures += 1; console.log('     FAIL 加地址面板不对'); }
html = render('在线搜索（报错）', [dataState, '', { kind: 'online' }, false, sources, { ...offlineOnline, addError: '这个地址已经在清单里了', error: '连不上宿主' }, localDraft]);
if (!html.includes('这个地址已经在清单里了') || !html.includes('连不上宿主')) { failures += 1; console.log('     FAIL 在线搜索错误没显示'); }

// ── 顺手确认没把既有页面挤掉 ────────────────────────────────────────────
console.log('— 既有页面没被动 —');
for (const [id, order] of [['skills', 130], ['mcp', 140], ['agents', 150]]) {
	const entry = registered.find((e) => e.o.id === id);
	const ok = entry !== undefined && entry.o.order === order && typeof entry.o.label === 'string';
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id} order=${entry?.o.order} label=${entry?.o.label}`);
	if (!ok) failures += 1;
}
if (registered.some((e) => e.o.id === 'agent-presets')) { failures += 1; console.log('  FAIL 撞了自带页的 id agent-presets'); }

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
