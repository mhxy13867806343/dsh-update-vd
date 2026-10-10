import { fileURLToPath } from 'node:url';
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/**
 * 渲染测试：设置里独立的一页「导入」→**「对话记录」页签**。
 *
 * 跟别的渲染测试一个套路：`renderToStaticMarkup` ＋ 受控 `useState` 队列。
 * SSR 不跑 state 变化、也不跑 useEffect，所以这一页渲染的就是喂进去的那份 state。
 *
 * 队列顺序 = `OtherAiPage` 里 `useState` 的调用顺序（**15 个**）：
 *   presets, busy, ai, aiBusy, aiOpt, aiTab, conv, convQuery, convSource,
 *   convRows, convPageSize, convPage, convPicked, convResult, convCwd
 * 只喂前面一部分的话，后面那些会退化成默认值 —— 所以「对话」相关的用例必须喂满
 * （第 6 个 `aiTab` 决定渲染哪一个页签：`'agents'` 还是 `'conversations'`）。
 *
 * 覆盖：两个页签切换、来源清单（装了 / 没装 / 不支持解析）、列表有数据 / 空 / 搜不到、
 * 分页（每页条数 + 页码 + 上一页/下一页）、多选与全选本页 / 全选全部、导入中的按钮文案、
 * 导入结果逐条报错、导出 Markdown / 插入到输入框两条轻量备选、以及新页的 slot 注册。
 */
import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? '/tmp/dsudep9/package.json');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** window.open 要能被记录（未装的来源靠它跳官网）。 */
const opened = [];
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {}, open: (...args) => opened.push(args) };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ style: {}, click: () => {}, remove: () => {} }), body: { appendChild: () => {} }, querySelectorAll: () => [] };
globalThis.URL = globalThis.URL ?? {};
// 这一页的按钮点了会发请求；SSR 里不点，所以这里只提供一个不会炸的壳
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

await import(CLIENT_PATH);
const mod = captured.factory((id) => {
	if (id === 'react') return React;
	throw new Error(`unexpected require(${id})`);
});
void mod;

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

const otherAi = registered.find((entry) => entry.o.id === 'other-ai');
if (otherAi === undefined) throw new Error('「导入」页（other-ai）没注册上');

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

let failures = 0;
const render = (label, args) => {
	queue = args;
	try {
		const html = renderToStaticMarkup(React.createElement(otherAi.C));
		console.log(`  ok   ${label} → ${text(html).slice(0, 150)}`);
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

// ── 喂 state 的素材 ──────────────────────────────────────────────────────
const emptyState = { loading: false, presets: [], error: null, notice: null, registryError: null, model: null, store: '/Users/x/.dsh/agent-presets.json' };
const noAi = { loading: false, toolkits: [], error: null, notice: null, addOpen: false, addAddress: '', addLabel: '', addBusy: false, addError: null };

/** 对话来源清单：codex / claude / workbuddy 装了，trae 支持不了解析。 */
const convToolkits = [
	{ id: 'codex', label: 'Codex', installed: true, supported: true, count: 117, note: '~/.codex/sessions（按 YYYY/MM/DD 分目录的 rollout-*.jsonl）与 ~/.codex/archived_sessions', dirs: ['/Users/x/.codex/sessions'], hint: '已扫到 117 个对话（只读）。', error: null },
	{ id: 'claude', label: 'Claude Code', installed: true, supported: true, count: 22, note: '~/.claude/projects/<项目目录转义名>/<session-uuid>.jsonl', dirs: ['/Users/x/.claude/projects'], hint: '已扫到 22 个对话（只读）。', error: null },
	{ id: 'trae', label: 'TRAE', installed: false, supported: false, count: 0, note: '暂不支持解析这个工具的对话格式：本机探明 ~/.trae/assistant 与 ~/.trae-cn/assistant 都是空目录，对话不在文件里。', hint: '这个工具的对话不落地成文件，所以导不进来。', homepage: 'https://www.trae.cn/', homepageLabel: 'trae.cn' },
	{ id: 'workbuddy', label: 'WorkBuddy', installed: true, supported: true, count: 213, note: '~/.workbuddy/projects/<项目目录转义名>/<conversation-uuid>.jsonl', dirs: ['/Users/x/.workbuddy/projects'], hint: '已扫到 213 个对话（只读）。', error: null },
];
const convData = { loading: false, toolkits: convToolkits, probe: '只读扫描：递归列 Codex 的 sessions 目录…', error: null, notice: null };

/** 12 个对话，用来验分页（每页 10 → 2 页）。 */
const convRows = Array.from({ length: 12 }, (_unused, index) => ({
	key: `codex:0000000${String(index).padStart(2, '0')}-aaaa-bbbb-cccc-dddddddddd`,
	sourceId: index >= 10 ? 'claude' : 'codex',
	sourceLabel: index >= 10 ? 'Claude Code' : 'Codex',
	id: `0000000${String(index).padStart(2, '0')}-1111-2222-3333-4444444444${String(index).padStart(2, '0')}`,
	title: `第 ${String(index + 1)} 个对话：实现一个 GBA 坦克小游戏`,
	firstUser: `帮我实现第 ${String(index + 1)} 个功能`,
	createdAt: `2026-03-0${String((index % 9) + 1)}T10:00:00.000Z`,
	updatedAt: `2026-03-0${String((index % 9) + 1)}T11:00:00.000Z`,
	messages: index + 1,
	cwd: '/Users/x/Desktop/demo',
}));

/**
 * 15 个 state 的快捷构造（顺序＝ `OtherAiPage` 里 `useState` 的顺序）。
 * 这一套用例默认把 `aiTab` 设成 `'conversations'`。
 */
const args = (patch = {}) => [
	patch.presets ?? emptyState.presets,
	patch.busy ?? false,
	patch.ai ?? noAi,
	patch.aiBusy ?? '',
	patch.aiOpt ?? {},
	patch.aiTab ?? 'conversations',
	patch.conv ?? convData,
	patch.convQuery ?? '',
	patch.convSource ?? '',
	patch.convRows ?? convRows,
	patch.convPageSize ?? 10,
	patch.convPage ?? 1,
	patch.convPicked ?? [],
	patch.convResult ?? null,
	patch.convCwd ?? '',
];

// ── 1. 两个页签 ──────────────────────────────────────────────────────────
console.log('— 页签切换 —');
let html = render('默认进「智能体预设」（老行为）', args({ aiTab: 'agents' }));
expect(html, '智能体预设页签', '从其它 AI 导入');
expect(html, '智能体预设页签', '智能体预设');
expect(html, '智能体预设页签', '对话记录');
expect(html, '智能体预设页签', '只读探测本机的其它 AI 工具');
expectNot(html, '智能体预设页签', '全选本页');
expectNot(html, '智能体预设页签', '导入成 DSH 会话');
// 它现在是设置里的独立一页，不再有「返回智能体列表」
expectNot(html, '智能体预设页签', '返回');

html = render('切到「对话记录」', args());
expect(html, '对话记录页签', '对话记录');
expect(html, '对话记录页签', '智能体预设');
expectNot(html, '对话记录页签', '只读探测本机的其它 AI 工具');
expectNot(html, '对话记录页签', '返回');
// 页签按钮带 data-ai-tab，测试与用户都能一眼看出当前在哪个页签
expect(html, '对话记录页签', 'data-ai-tab="agents"');
expect(html, '对话记录页签', 'data-ai-tab="conversations"');

// ── 2. 来源清单三态 ──────────────────────────────────────────────────────
console.log('— 来源清单（装了 / 没装 / 解析不了）—');
expect(html, '来源清单', 'Codex');
expect(html, '来源清单', 'Claude Code');
expect(html, '来源清单', 'WorkBuddy');
expect(html, '来源清单', '已检测到安装');
expect(html, '来源清单', '117 个对话');
expect(html, '来源清单', '213 个对话');
// TRAE：明说解析不了 + 未装要给官网按钮
expect(html, '来源清单', '未检测到');
expect(html, '来源清单', '暂不支持解析这个工具的对话格式');
expect(html, '来源清单', '去官网下载安装（trae.cn）');
if (opened.length === 0) console.log('     （官网按钮存在但没点，window.open 未调用属正常）');

// ── 3. 列表：有数据 / 空 / 搜不到 ─────────────────────────────────────────
console.log('— 列表 —');
expect(html, '列表有数据', '第 1 个对话：实现一个 GBA 坦克小游戏');
expect(html, '列表有数据', '帮我实现第 1 个功能');
expect(html, '列表有数据', '1 条消息');
// 来源徽标：那条对话的标题旁边要有一个「Codex」徽标（badgeBuiltin）
expect(html, '列表有数据', '>Codex</span>');
expect(html, '列表有数据', 'data-picked="false"');
expect(html, '列表有数据', '全选本页（10 条）');
expect(html, '列表有数据', '全选全部 12 条');
expect(html, '列表有数据', '已选 0 条');
expect(html, '列表有数据', '第 1/2 页');
// 第 2 页只有 2 条（12 条 / 每页 10）
html = render('第 2 页（只剩 2 条）', args({ convPage: 2 }));
expect(html, '第 2 页', '第 2/2 页');
expect(html, '第 2 页', '第 11 个对话：实现一个 GBA 坦克小游戏');
expect(html, '第 2 页', '全选本页（2 条）');
expectNot(html, '第 2 页', '第 1 个对话：实现一个 GBA 坦克小游戏');
// 每页 100 → 只有 1 页
html = render('每页 100 条', args({ convPageSize: 100 }));
expect(html, '每页 100', '第 1/1 页');
expect(html, '每页 100', '全选本页（12 条）');
// 空：一行都没有
html = render('空列表', args({ convRows: [] }));
expect(html, '空列表', '没扫到任何对话');
expect(html, '空列表', '全选本页（0 条）');
// 搜不到
html = render('搜不到', args({ convQuery: '这个词根本不存在' }));
expect(html, '搜不到', '没有匹配的对话');
expect(html, '搜不到', '全选全部 0 条');
// 搜索命中：输入框的值要回填进去
html = render('搜索命中', args({ convQuery: '第 3 个功能' }));
expect(html, '搜索命中', '第 3 个功能');
expect(html, '搜索命中', '全选全部 1 条');

// ── 4. 多选与全选本页 ────────────────────────────────────────────────────
console.log('— 多选 / 全选 —');
html = render('选了 2 条', args({ convPicked: [convRows[0].key, convRows[3].key] }));
expect(html, '多选', '已选 2 条');
expect(html, '多选', '导入成 DSH 会话（2 条）');
expect(html, '多选', 'data-picked="true"');
// 选中了东西 → 三个动作按钮都可用（不能是 disabled）
{
	const importButton = /<button[^>]*>导入成 DSH 会话（2 条）<\/button>/u.exec(html);
	if (importButton === null || /disabled/u.test(importButton[0])) {
		failures += 1;
		console.log('     FAIL 选中 2 条时「导入成 DSH 会话」按钮不该是 disabled');
	}
}
// 两页都选上 = 全选本页那个勾是「半选/未满」状态：这里只断言不会把两页之外的算进来
html = render('第 2 页全选 2 条', args({ convPage: 2, convPicked: [convRows[10].key, convRows[11].key] }));
expect(html, '第 2 页全选', '已选 2 条');
expect(html, '第 2 页全选', '全选本页（2 条）');

// ── 5. 导入中 / 导入结果逐条报错 ─────────────────────────────────────────
console.log('— 导入 —');
html = render('导入中（按钮文案）', args({ convPicked: [convRows[0].key], conv: { ...convData, loading: true } }));
expect(html, '导入中', '导入中…');
expect(html, '导入中', '扫描中…');

html = render('导入结果：成功 / 跳过 / 失败逐条报错', args({
	convPicked: [convRows[0].key],
	conv: { ...convData, notice: '导入完成：成功 1 · 跳过 1 · 失败 1。' },
	convResult: {
		imported: 1,
		skipped: 1,
		failed: 1,
		results: [
			{ key: 'codex:aaa', ok: true, skipped: false, sessionId: 'session-import-codex-aaa', title: 'A', messages: 12, truncated: 0, via: 'sessionPersistence' },
			{ key: 'codex:bbb', ok: true, skipped: true, sessionId: 'session-import-codex-bbb', title: 'B', reason: '同一个对话（内容没变）已经导过了，跳过。' },
			{ key: 'claude:ccc', ok: false, error: '在这个来源里找不到对话「ccc」（可能被删了，点「重新扫描」再试）' },
		],
	},
}));
expect(html, '导入结果', '导入完成：成功 1 · 跳过 1 · 失败 1');
expect(html, '导入结果', 'data-import-row="ok"');
expect(html, '导入结果', 'data-import-row="fail"');
expect(html, '导入结果', '已导入');
expect(html, '导入结果', '跳过');
expect(html, '导入结果', '失败');
expect(html, '导入结果', 'session-import-codex-aaa');
expect(html, '导入结果', '同一个对话（内容没变）已经导过了，跳过。');
expect(html, '导入结果', '在这个来源里找不到对话「ccc」');
expect(html, '导入结果', '（官方存储服务）');

// ── 6. 轻量备选 + 报错行 ─────────────────────────────────────────────────
console.log('— 轻量备选 —');
html = render('导出 Markdown / 插入到输入框', args({ convPicked: [convRows[0].key] }));
expect(html, '轻量备选', '导出 Markdown');
expect(html, '轻量备选', '插入到输入框');
expect(html, '轻量备选', '复制 Markdown');
expect(html, '轻量备选', '导入后的会话在左侧会话列表里打开');
html = render('报错行', args({ conv: { ...convData, error: '没有这个对话来源：typo' } }));
expect(html, '报错行', '没有这个对话来源：typo');

// ── 7. slot 注册（独立一页，排在「智能体」下面）───────────────────────────
console.log('— slot —');
if (registered.filter((entry) => entry.o.id === 'other-ai').length !== 1) {
	failures += 1;
	console.log('     FAIL 「导入」页注册了不止一次');
}
if (registered.filter((entry) => entry.o.id === 'agents').length !== 1) {
	failures += 1;
	console.log('     FAIL 「智能体」页注册了不止一次');
}
const order = Object.fromEntries(registered.map((entry) => [entry.o.id, entry.o.order]));
if (order.agents !== 150) {
	failures += 1;
	console.log(`     FAIL agents 的 order 不是 150（实际 ${String(order.agents)}）`);
}
if (order['other-ai'] !== 160) {
	failures += 1;
	console.log(`     FAIL other-ai 的 order 不是 160（实际 ${String(order['other-ai'])}）`);
}
{
	const entry = registered.find((e) => e.o.id === 'other-ai');
	if (entry?.o.name !== 'settings.section' || entry?.o.label !== '导入') {
		failures += 1;
		console.log(`     FAIL other-ai 的 name/label 不对（${String(entry?.o.name)} / ${String(entry?.o.label)}）`);
	}
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
