import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/**
 * 渲染测试：「智能体」页里的**「从其它 AI 导入」独立视图**。
 *
 * 跟别的渲染测试一个套路：`renderToStaticMarkup` ＋ 受控 `useState` 队列，
 * 把每种初始 state 直接喂进组件 —— 因为 SSR 不跑 state 变化、也不跑 useEffect
 * （所以这个视图的 useEffect 拉数据不会发请求，渲染的就是喂进去的那份 state）。
 *
 * 队列顺序 = `AgentsPage` 里 `useState` 的调用顺序（**9 个**，前 7 个是这页早就有的）：
 *   state, query, mode, busy, sources, online, draft, ai, aiBusy, aiOpt
 * 最后三个是「从其它 AI 导入」新增的，所以这里必须喂满 9 个，否则队列会串位。
 *
 * 覆盖：来源列表的「装了 / 没装」两态、未装的官网链接（window.open 新窗口）、
 * 装了能列出可导入项、「已导入」标记、导入重名提示、加/删第三方来源、返回按钮、
 * 以及列表页上那个新入口按钮。
 */
import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? '/tmp/dsudep9/package.json');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** 记录 window.open 的调用（未装的来源要靠它跳官网）。 */
const opened = [];
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {}, open: (...args) => opened.push(args) };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ style: {}, click: () => {}, remove: () => {} }), body: { appendChild: () => {} } };
globalThis.URL = globalThis.URL ?? {};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, presets: [], servers: [], skills: [], roots: [], sources: {} }) });

await import(CLIENT_PATH);
const mod = captured.factory((id) => {
	if (id === 'react') return React;
	throw new Error(`unexpected require(${id})`);
});

const registered = [];
let queue = [];
const React2 = Object.create(React);
React2.useState = (initial) => {
	const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial;
	return React.useState(value);
};
const mod2 = captured.factory((id) => {
	if (id === 'react') return React2;
	throw new Error(`unexpected require(${id})`);
});
mod2.apply({
	effect: (fn) => fn(),
	slots: { inject: (_k, cb) => cb(), register: (o, C) => registered.push({ o, C }) },
	locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) },
});

const agents = registered.find((e) => e.o.id === 'agents');
if (agents === undefined) throw new Error('「智能体」页没注册上');

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

let failures = 0;
const render = (label, args) => {
	queue = args;
	try {
		const html = renderToStaticMarkup(React.createElement(agents.C));
		console.log(`  ok   ${label} → ${text(html).slice(0, 160)}`);
		return html;
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${label} → ${error.message}`);
		return '';
	}
};
const expect = (html, label, needle) => {
	if (!html.includes(needle)) {
		failures += 1;
		console.log(`     FAIL ${label} 里缺「${needle}」`);
	}
};
const expectNot = (html, label, needle) => {
	if (html.includes(needle)) {
		failures += 1;
		console.log(`     FAIL ${label} 里不该有「${needle}」`);
	}
};

// ── 各种初始 state ───────────────────────────────────────────────────────
const emptyState = { loading: false, presets: [], error: null, notice: null, registryError: null, model: null, store: '/Users/x/.dsh/agent-presets.json' };
const presetData = [
	{ id: 'standard', name: 'standard', description: '标准模式', order: 1, broken: null, origin: 'builtin', originLabel: '内置', bundle: '@deepseek-ai/dsh-web-app', managed: false, writable: false, note: '', plugins: 19, tools: 11 },
	{ id: 'codex-agents', name: 'AGENTS.md（全局指令）', description: 'Codex 的全局指令文件', order: null, broken: null, origin: 'custom', originLabel: '其它 AI · Codex', bundle: null, external: { via: 'codex', toolkit: 'Codex', item: 'codex:agents-md:agents', path: '/Users/x/.codex/AGENTS.md' }, managed: true, writable: true, note: '', plugins: 1, tools: 0 },
];
const dataState = { loading: false, presets: presetData, error: null, notice: null, registryError: null, model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }, store: '/Users/x/.dsh/agent-presets.json' };
/** 在线搜索那两个下拉源（这页老代码用得到，缺了会渲染不出 AgentSource）。 */
const sources = [
	{ id: 'local-shipped', label: '本机自带预设', kind: 'local', hint: '随包发布的那几个' },
	{ id: 'upstream-harness', label: 'deepseek-ai/deepseek-harness', kind: 'github', hint: '上游官方预设' },
];
const online = { kind: 'agents', sourceId: 'local-shipped', custom: '', query: '', results: [], busy: false, error: null, limit: 24 };
const draft = { text: '', url: '', path: '', name: '', id: '', asCopy: false, overwrite: false, asPrompt: false, error: null };
const noAi = { loading: false, toolkits: [], error: null, notice: null, addOpen: false, addAddress: '', addLabel: '', addBusy: false, addError: null };

/** 来源清单：codex / workbuddy 装了，claude 装了但没内容，trae 没装（只有配置残渣），外加一个自定义来源。 */
const toolkits = [
	{
		id: 'codex', label: 'Codex', homepage: 'https://developers.openai.com/codex/', homepageLabel: 'developers.openai.com/codex',
		probeNote: '看 ~/.codex 是否存在（配置目录）', foundPaths: ['~/.codex'], appPaths: [], binaries: [],
		installed: true, partial: false, importable: true, format: '全局指令文件 AGENTS.md、自定义提示词（~/.codex/prompts/*.md）',
		hint: 'Codex 没有「子代理」这个概念。', builtin: true, custom: false, deletable: false, error: null,
		items: [
			{ key: 'codex:agents-md:agents', kind: 'prompt', name: 'AGENTS.md（全局指令）', description: 'Codex 的全局指令文件，整份就是它的行为准则', path: '/Users/x/.codex/AGENTS.md', chars: 11887, badge: '全局指令' },
		],
	},
	{
		id: 'claude', label: 'Claude Code', homepage: 'https://claude.com/product/claude-code', homepageLabel: 'claude.com/product/claude-code',
		probeNote: '看 ~/.claude/agents 或 ~/.claude 是否存在', foundPaths: ['~/.claude/agents'], appPaths: [], binaries: [],
		installed: true, partial: false, importable: true, format: '子代理 ~/.claude/agents/*.md、命令 ~/.claude/commands/*.md',
		builtin: true, custom: false, deletable: false, error: null, items: [],
	},
	{
		id: 'trae', label: 'TRAE', homepage: 'https://www.trae.cn/', homepageLabel: 'trae.cn',
		probeNote: '看 /Applications/Trae.app 或 trae CLI 是否存在 —— 光有 ~/.trae 配置残渣不算装了', foundPaths: ['~/.trae'], appPaths: [], binaries: [],
		installed: false, partial: true, importable: true, format: '自定义技能 ~/.trae/skills/*/SKILL.md、记忆里的用户偏好',
		hint: 'TRAE 本体没装时只显示下载入口。', builtin: true, custom: false, deletable: false, error: null, items: [],
	},
	{
		id: 'workbuddy', label: 'WorkBuddy', homepage: 'https://www.workbuddy.ai/', homepageLabel: 'workbuddy.ai',
		probeNote: '看 ~/.workbuddy 是否存在（工作区）', foundPaths: ['~/.workbuddy'], appPaths: [], binaries: [],
		installed: true, partial: false, importable: true, format: '人格文件 SOUL.md、身份卡 IDENTITY.md、自定义技能 ~/.workbuddy/skills/*/SKILL.md',
		builtin: true, custom: false, deletable: false, error: null,
		items: [
			{ key: 'workbuddy:soul:soul', kind: 'prompt', name: 'SOUL.md（人格总纲）', description: 'WorkBuddy 的人格与行为总纲', path: '/Users/x/.workbuddy/SOUL.md', chars: 1664, badge: '人格' },
			{ key: 'workbuddy:skill:godot-dev', kind: 'skill', name: 'godot-dev', description: 'Godot 开发技能', path: '/Users/x/.workbuddy/skills/godot-dev/SKILL.md', chars: 900, badge: '技能' },
		],
	},
	{
		id: 'oai-path-abc', label: '我的小仓库', homepage: undefined, homepageLabel: '/Users/x/my-agents',
		probeNote: '本机路径：/Users/x/my-agents', foundPaths: ['/Users/x/my-agents'], appPaths: [], binaries: [],
		installed: true, partial: false, importable: true, format: '这个路径下的 md 文件 / SKILL.md（一文件＝一个提示词）',
		hint: '你自己加的来源。', builtin: false, custom: true, deletable: true, error: null,
		items: [{ key: 'oai-path-abc:file:helper', kind: 'prompt', name: 'helper', description: '我的助手', path: '/Users/x/my-agents/helper.md', chars: 120, badge: '文件' }],
	},
];
const aiData = { ...noAi, toolkits };
/** 装了但自己没内容 + 一个读不动的自定义来源（错误要显示出来）。 */
const aiPartial = {
	...noAi,
	toolkits: [toolkits[0], { ...toolkits[1], items: [] }, { ...toolkits[4], id: 'oai-url-zzz', label: '坏掉的地址', custom: true, installed: false, items: [], error: '下载失败：HTTP 404' }],
};

// ── 1. 独立视图的基本形态 ────────────────────────────────────────────────
console.log('— 「从其它 AI 导入」视图 —');
let html = render('独立视图（4 个默认来源 + 1 个自定义）', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, aiData, '', {}]);
expect(html, '独立视图', '从其它 AI 导入');
expect(html, '独立视图', '返回');
expect(html, '独立视图', '重新探测');
expect(html, '独立视图', '只读探测本机的其它 AI 工具');
expect(html, '独立视图', '4 / 5 个来源已装');
expect(html, '独立视图', '重名自动改名');

// ── 2. 装了的两态 ────────────────────────────────────────────────────────
console.log('— 装了 / 没装两态 —');
expect(html, '装了', '已检测到安装');
expect(html, '装了', '未检测到');
// 「只有配置残渣」只能出现在 TRAE 那条上（别的地方都不该有）
{
	const residues = [...html.matchAll(/只有配置残渣/gu)].length;
	const traeCards = [...html.matchAll(/TRAE/gu)].length;
	if (residues !== 1 || traeCards < 1) {
		failures += 1;
		console.log(`     FAIL 「只有配置残渣」该只出现 1 次（实际 ${residues} 次）`);
	}
}
expect(html, '装了', 'Codex');
expect(html, '装了', 'Claude Code');
expect(html, '装了', 'TRAE');
expect(html, '装了', 'WorkBuddy');
// 没装的来源**不能藏**：要有下载提示 + 官网按钮
expect(html, '没装', '没检测到 TRAE');
expect(html, '没装', '去官网下载安装（trae.cn）');
expect(html, '没装', '只有配置残渣');
expect(html, '没装', '看 /Applications/Trae.app 或 trae CLI 是否存在');
// 装了的不该出现下载按钮
if ((html.match(/去官网下载安装/gu) ?? []).length !== 1) {
	failures += 1;
	console.log('     FAIL 官网下载按钮只该出现在没装的那一条上');
}

// ── 3. 装了能列出可导入项 ────────────────────────────────────────────────
console.log('— 可导入项 —');
expect(html, '可导入项', 'AGENTS.md（全局指令）');
expect(html, '可导入项', '全局指令');
expect(html, '可导入项', '11887 字');
expect(html, '可导入项', '/Users/x/.codex/AGENTS.md');
expect(html, '可导入项', 'SOUL.md（人格总纲）');
expect(html, '可导入项', 'godot-dev');
expect(html, '可导入项', '导入成 DSH 智能体');
expect(html, '可导入项', 'Codex 的全局指令文件，整份就是它的行为准则');
// 已经导过的那个显示「已导入」，且按钮换成「重新导入」
expect(html, '已导入标记', '已导入');
expect(html, '已导入标记', '重新导入');
// 装了但没内容的那一条要说清楚
expect(html, '空内容', '装是装了，但它自己还没存任何可导入的智能体/提示词');

// ── 4. 第三方来源（加 / 删）──────────────────────────────────────────────
console.log('— 第三方来源 —');
expect(html, '第三方', '添加第三方来源');
expect(html, '第三方', '保存来源');
expect(html, '第三方', '~/my-agents，或 https://github.com/owner/repo');
expect(html, '第三方', '第三方来源');
expect(html, '第三方', '我的小仓库');
expect(html, '第三方', '删除这个来源');
// 内置的 4 个不许有「删除这个来源」
if ((html.match(/删除这个来源/gu) ?? []).length !== 1) {
	failures += 1;
	console.log('     FAIL 「删除这个来源」只该出现在自己加的那条上');
}

// ── 5. 报错与状态行 ──────────────────────────────────────────────────────
console.log('— 报错 / 加载 / 空 —');
html = render('读不动的第三方来源', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, aiPartial, '', {}]);
expect(html, '来源报错', '下载失败：HTTP 404');
html = render('探测中', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, { ...noAi, loading: true }, '', {}]);
expect(html, '探测中', '正在探测本机…');
expect(html, '探测中', '探测中…');
html = render('一个来源都没有', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, noAi, '', {}]);
expect(html, '来源空', '一个来源都没有');
html = render('宿主报错 + 导入提示', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, { ...aiData, error: '连不上宿主', notice: '已导入「codex-agents」' }, '', {}]);
expect(html, '宿主报错', '连不上宿主');
expect(html, '导入提示', '已导入「codex-agents」');
html = render('加来源报错', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, { ...aiData, addError: '本机路径不存在：/x/y' }, '', {}]);
expect(html, '加来源报错', '本机路径不存在：/x/y');
html = render('导入中（按钮禁用 + 文案）', [dataState, '', { kind: 'otherAi' }, false, sources, online, draft, aiData, 'codex:agents-md:agents', {}]);
expect(html, '导入中', '导入中…');
expect(html, '导入中', 'disabled');

// ── 6. window.open 只在新窗口、且带 noopener ─────────────────────────────
console.log('— 官网跳转 —');
// window.open 是渲染时挂的 onClick，SSR 不会真的点；这里直接验证按钮绑的是 window.open
// （组件里写死了 window.open(homepage, '_blank', 'noopener,noreferrer')，用源码断言 + 不崩）
if (opened.length !== 0) {
	failures += 1;
	console.log('     FAIL 渲染阶段不该真的打开窗口');
}
{
	const source = (await import('node:fs/promises')).readFile;
	const code = await source(CLIENT_PATH, 'utf8');
	if (!code.includes("window.open(toolkit.homepage, '_blank', 'noopener,noreferrer')")) {
		failures += 1;
		console.log('     FAIL 官网按钮没走 window.open 新窗口');
	}
	if (code.includes('location.href = toolkit.homepage')) {
		failures += 1;
		console.log('     FAIL 官网按钮不该用 location.href');
	}
}

// ── 7. 列表页上那个入口还在（同一次注册的同一个组件）────────────────────
console.log('— 列表入口 —');
html = render('列表页入口按钮', [dataState, '', { kind: 'list' }, false, sources, online, draft, aiData, '', {}]);
expect(html, '列表入口', '从其它 AI 导入');
expect(html, '列表入口', '在线搜索');
expect(html, '列表入口', '新建');

// ── 8. 顺手确认没把既有页面挤掉 ─────────────────────────────────────────
console.log('— 既有页面没被动 —');
for (const [id, order] of [['skills', 130], ['mcp', 140], ['agents', 150]]) {
	const entry = registered.find((e) => e.o.id === id);
	const ok = entry !== undefined && entry.o.order === order && typeof entry.o.label === 'string';
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id} order=${entry?.o.order} label=${entry?.o.label}`);
	if (!ok) failures += 1;
}
if (registered.some((e) => e.o.id === 'agent-presets')) {
	failures += 1;
	console.log('  FAIL 撞了自带页的 id agent-presets');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
