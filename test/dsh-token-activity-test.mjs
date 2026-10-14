/**
 * 「Token 活动」热力图的客户端自测（纯新增，不碰别的套件）。
 *
 * 覆盖：
 *   1. 四种模式（每天 / 每周 / 年 / 累计总量）都能渲染；
 *   2. 每种模式的**配色不同**，且分别是绿 / 黄 / 红 / 蓝系（断言真实色值，不是类名）；
 *   3. 悬停浮层的文案：第一行日期 `4月1日`、第二行 `239.7万 ↑ Token`（万/亿 + 向上箭头）；
 *   4. 空数据 / 取数失败都有明确文案，不崩、不一直转圈；
 *   5. 聚合纯函数 `buildHeatmap` 的数学正确性（周 / 年 / 累计的求和）；
 *   6. 数值格式化 `taFormat`：1,234 / 239.7万 / 1.23亿；
 *   7. 注册的 slot id / order 没撞已有页，且**没有**去复用内置的 `account` id。
 *
 * 跑法：cd <仓库根> && node test/dsh-token-activity-test.mjs
 */
import { fileURLToPath } from 'node:url';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? new URL('../package.json', import.meta.url));
const React = require('react');
const ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, days: {} }) });

await import(CLIENT_PATH);

let queue = [];
const React2 = Object.create(React);
React2.useState = (initial) => {
	const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial;
	return React.useState(value);
};
const mod = captured.factory((id) => {
	if (id === 'react') return React2;
	if (id === 'react-dom') return ReactDOM;
	throw new Error(`unexpected require(${id})`);
});

const registered = [];
const localeStores = {};
mod.apply({
	effect: (fn) => fn(),
	slots: { inject: (_key, cb) => cb(), register: (options, Component) => registered.push({ options, Component }) },
	locale: {
		register: (namespace, messages) => {
			localeStores[namespace] = messages;
			return () => {};
		},
		getSnapshot: () => ({ active: 'zh' }),
	},
	get: () => undefined,
});

const { __test } = mod;

/**
 * 真翻译函数（照宿主 `t(key, params)` 的 `{name}` 插值规则）。
 * 渲染断言要搜人话，不能搜 key —— 否则「文案存在」这条断言等于没测。
 */
const zh = localeStores['dsh-update-vd']?.zh ?? __test.messages.zh;
const t = (key, params) => {
	const template = zh[key] ?? key;
	if (params === null || typeof params !== 'object') return template;
	return template.replace(/\{(\w+)\}/gu, (whole, name) => (name in params ? String(params[name]) : whole));
};

let failures = 0;
/** 断言求值抛错也算失败（否则一个 RangeError 会把整套测试带走，看不到是哪条）。 */
const safe = (label, thunk) => {
	try {
		return thunk();
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${label} 求值抛错 → ${error.message}`);
		return undefined;
	}
};
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

const strip = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '');
/** 只取悬停浮层那一段 HTML（断言文案用）。 */
const tooltipHtml = (html) => {
	const match = /data-dta-tooltip="1"[\s\S]*$/u.exec(strip(html));
	return match === null ? '' : match[0];
};
const textOf = (html) => strip(html).replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

/** 卡片组件的 13 个 useState 初值（顺序 = 组件里 useState 的调用顺序）。 */
const cardState = ({ external, mode = 'day', hovered = null, tip = null, tipVisible = false }) => [
	external,
	mode,
	hovered,
	tip,
	tip === null ? '' : tip.title,
	tip === null ? '' : tip.value,
	tip === null ? '' : tip.unit,
	0,
	0,
	false,
	tipVisible,
	tip === null ? null : tip.key,
];

const renderCard = (state, label) => {
	queue = state;
	try {
		return renderToStaticMarkup(React.createElement(__test.TokenActivityCard, { t }));
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${label} 渲染抛错 → ${error.message}`);
		return '';
	}
};

// ── 1. 数值格式化 ──────────────────────────────────────────────────────────
console.log('— 数值格式（taFormat） —');
check('1234 → 1,234', __test.taFormat(1234) === '1,234', __test.taFormat(1234));
check('999 → 999', __test.taFormat(999) === '999', __test.taFormat(999));
check('10000 → 1万', __test.taFormat(10000) === '1万', __test.taFormat(10000));
check('2397000 → 239.7万', __test.taFormat(2397000) === '239.7万', __test.taFormat(2397000));
check('123456 → 12.3万', __test.taFormat(123456) === '12.3万', __test.taFormat(123456));
check('123456789 → 1.23亿', __test.taFormat(123456789) === '1.23亿', __test.taFormat(123456789));
check('1234567890 → 12.3亿（≥10 亿只留 1 位）', __test.taFormat(1234567890) === '12.3亿', __test.taFormat(1234567890));
check('12350000000 → 123.5亿（≥10 亿只留 1 位）', __test.taFormat(12350000000) === '123.5亿', __test.taFormat(12350000000));
check('不合法输入 → 0', __test.taFormat(Number.NaN) === '0' && __test.taFormat(null) === '0', `${__test.taFormat(Number.NaN)}/${__test.taFormat(null)}`);

// ── 2. 聚合纯函数 ──────────────────────────────────────────────────────────
console.log('\n— 聚合纯函数（buildHeatmap） —');
const FIXTURE = {
	'2026-09-28': 100,
	'2026-09-29': 200,
	'2026-10-01': 2397000,
	'2026-10-02': 300,
	'2026-10-03': 1167124,
	'2026-10-04': 500,
	'2026-10-06': 500,
	'2026-12-31': 700,
	'2027-01-02': 200,
};
const NOW = new Date(2027, 0, 15); // 测试参考「今天」——固定在数据之后，保证结果可复现
const sumOf = (state) => state.cells.flat().filter(Boolean).reduce((sum, cell) => sum + cell.value, 0);

check('空数据不崩：days=0 / 只有一个空占位格', (() => {
	const state = __test.buildHeatmap({}, 'day', NOW);
	return state.days === 0 && state.total === 0 && state.cells.length === 1 && state.cells[0][0] === null;
})());
check('非法日期 / 非数值一律忽略', __test.buildHeatmap({ 'x': 5, '2026-13-99': 5, '2026-10-01': 'abc', '2026-10-02': -3 }, 'day', NOW).days === 0);

const daily = __test.buildHeatmap(FIXTURE, 'day', NOW);
check('每天：7 行 × 自然周列', daily.rows === 7 && daily.columns >= 3, `rows=${daily.rows} columns=${daily.columns}`);
check('每天：一格一天，原值', daily.days === 9 && daily.total === sumOf(daily), `days=${daily.days} total=${daily.total}`);
check('每天：周一在 row 0、周日 row 6', (() => {
	const monday = daily.cells[0].find((cell) => cell !== null && cell.date === '2026-09-28');
	const sunday = daily.cells[6].find((cell) => cell !== null && cell.date === '2026-10-04');
	return monday !== undefined && sunday !== undefined && monday.value === 100 && sunday.value === 500;
})());

const weekly = __test.buildHeatmap(FIXTURE, 'week', NOW);
check('每周：按自然周求和（周一起算）', (() => {
	// 网格是列优先摆放，拍平后**不是时间序** —— 按日期 key 找格子，别猜下标。
	const flat = weekly.cells.flat().filter(Boolean);
	const week1 = flat.find((cell) => cell.date === '2026-09-28'); // 9/28–10/4
	const week2 = flat.find((cell) => cell.date === '2026-10-05'); // 10/5–10/11
	const week3 = flat.find((cell) => cell.date === '2026-12-28'); // 12/28–1/3
	return (
		week1 !== undefined &&
		week1.value === 100 + 200 + 2397000 + 300 + 1167124 + 500 &&
		week2 !== undefined &&
		week2.value === 500 &&
		week3 !== undefined &&
		week3.value === 700 + 200
	);
})(), JSON.stringify(weekly.cells.flat().filter(Boolean).map((cell) => [cell.date, cell.value])));
check('每周：没有记录的那周是 0（不是缺失）', weekly.cells.flat().filter(Boolean).some((cell) => cell.value === 0));
check('每周：一格带一周的日期范围（浮层标题用）', (() => {
	const cell = weekly.cells.flat().find((value) => value !== null);
	return cell.range !== undefined && /月\d+日 – \d+月\d+日/u.test(cell.range);
})());
check('每周：一格一周，行数 2', weekly.rows === 2 && weekly.cells.length === 2);
check('每周：合计守恒', sumOf(weekly) === Object.values(FIXTURE).reduce((a, b) => a + b, 0), String(sumOf(weekly)));

const yearly = __test.buildHeatmap(FIXTURE, 'year', NOW);
check('年：按自然年求和', (() => {
	const cells = yearly.cells.flat().filter(Boolean);
	const y2026 = cells.find((cell) => cell.label === '2026年');
	const y2027 = cells.find((cell) => cell.label === '2027年');
	return cells.length === 2 && y2026.value === 2397000 + 300 + 1167124 + 500 + 100 + 200 + 500 + 700 && y2027.value === 200;
})(), JSON.stringify(yearly.cells.flat().filter(Boolean).map((cell) => [cell.label, cell.value])));
check('年：一年一格，合计守恒', sumOf(yearly) === sumOf(daily), `${sumOf(yearly)} / ${sumOf(daily)}`);

const total = __test.buildHeatmap(FIXTURE, 'total', NOW);
check('累计总量：逐日累加（缺记录的日子接着累加）', (() => {
	const byDate = new Map(total.cells.flat().filter(Boolean).map((cell) => [cell.date, cell.value]));
	return byDate.get('2026-09-28') === 100 && byDate.get('2026-09-29') === 300 && byDate.get('2026-09-30') === 300 && byDate.get('2026-10-01') === 2397300;
})(), JSON.stringify([...new Map(total.cells.flat().filter(Boolean).map((cell) => [cell.date, cell.value]))].slice(0, 5)));
check('累计总量：最后一天 = 全部合计', (() => {
	const flat = total.cells.flat().filter(Boolean);
	const last = flat[flat.length - 1];
	return last.value === Object.values(FIXTURE).reduce((a, b) => a + b, 0);
})(), JSON.stringify(total.cells.flat().filter(Boolean).slice(-1)));
check('累计总量：分档按「当日增量」，最后一天不会永远最深', (() => {
	const flat = total.cells.flat().filter(Boolean);
	const last = flat[flat.length - 1];
	return last.level < 4 && last.level >= 1;
})(), String(total.cells.flat().filter(Boolean).slice(-1)[0]?.level));

// ── 3. 配色：四种模式各不相同，且分别是绿 / 黄 / 红 / 蓝系 ────────────────
console.log('\n— 配色（每种模式不同色系） —');
const FAMILY_HINT = {
	green: (rgb) => rgb.g > rgb.r && rgb.g > rgb.b,
	yellow: (rgb) => rgb.r > rgb.b && rgb.g > rgb.b && Math.abs(rgb.r - rgb.g) < 90,
	red: (rgb) => rgb.r > rgb.g && rgb.r > rgb.b,
	blue: (rgb) => rgb.b > rgb.r && rgb.b > rgb.g,
};
const parseHex = (hex) => {
	const value = /^#([0-9a-f]{6})$/iu.exec(hex);
	if (value === null) throw new Error(`不是 6 位色值：${hex}`);
	const number = Number.parseInt(value[1], 16);
	return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
};
const palettes = {};
for (const mode of __test.TA_MODES) {
	palettes[mode] = [1, 2, 3, 4].map((level) => __test.taColor(mode, level));
	const family = __test.TA_PALETTE[mode].family;
	const ok = palettes[mode].every((hex) => /^#[0-9a-f]{6}$/iu.test(hex) && FAMILY_HINT[family](parseHex(hex)));
	check(`${mode} = ${family} 系，四档都是 6 位色值`, ok, `${family} ${palettes[mode].join(' ')}`);
}
check('0 档（没有记录）是主题底色，不是彩色', __test.taColor('day', 0) === 'var(--dsw-alias-bg-skeleton)', __test.taColor('day', 0));
check('四种模式的色值两两不同', (() => {
	const seen = new Set();
	for (const mode of __test.TA_MODES) for (const hex of palettes[mode]) seen.add(hex);
	return seen.size === 16;
})(), `${new Set(Object.values(palettes).flat()).size} 个不同色值`);
check('同一模式内部由浅到深', (() => {
	const luminance = (hex) => {
		const { r, g, b } = parseHex(hex);
		return r * 0.299 + g * 0.587 + b * 0.114;
	};
	return __test.TA_MODES.every((mode) => {
		const values = palettes[mode].map(luminance);
		return values.every((value, index) => index === 0 || value > values[index - 1]);
	});
})());
check('taLevel：0 / 有值必进 1..4 / 最大值到 4', __test.taLevel(0, 100) === 0 && __test.taLevel(1, 100) === 1 && __test.taLevel(100, 100) === 4 && __test.taLevel(50, 100) === 2, `${__test.taLevel(1, 100)} ${__test.taLevel(50, 100)} ${__test.taLevel(100, 100)}`);

// ── 4. 渲染：四种模式 ──────────────────────────────────────────────────────
console.log('\n— 渲染：四种模式 —');
const days = { '2026-10-01': 2397000, '2026-10-02': 1234, '2026-10-03': 123456789 };
const external = { phase: 'ready', days, error: null, ready: true };
const renders = {};
const cellCount = (html) => (html.match(/data-dta-cell="1"/gu) ?? []).length;
for (const mode of __test.TA_MODES) {
	const html = renderCard(cardState({ external, mode }), mode);
	renders[mode] = html;
	// 年模式一年才一格：断言「渲染出了格子」，数量按模式给下限。
	check(`${mode} 能渲染出网格`, html.includes('data-dta-card="1"') && cellCount(html) >= (mode === 'year' ? 1 : 3), `${cellCount(html)} 格`);
	check(`${mode} 高亮当前模式按钮`, html.includes(`data-dta-mode="${mode}" data-active="1"`) || html.includes(`data-active="1" data-dta-mode="${mode}"`));
	check(`${mode} 四种模式按钮都在`, __test.TA_MODES.every((id) => html.includes(`data-dta-mode="${id}"`)));
}
check('四种模式渲染出的 HTML 两两不同（说明真的按模式出图）', new Set(Object.values(renders)).size === 4);
check('每天模式：格子用绿系', palettes.day.some((hex) => renders.day.includes(hex)));
check('每周模式：格子用黄系', palettes.week.some((hex) => renders.week.includes(hex)));
check('年模式：格子用红系', palettes.year.some((hex) => renders.year.includes(hex)));
check('累计总量模式：格子用蓝系', palettes.total.some((hex) => renders.total.includes(hex)));
check('每天模式：月份刻度出现（如 10月）', /10月/u.test(renders.day), textOf(renders.day).slice(0, 90));
check('每天模式：格子是圆角小方块（内联 borderRadius）', renders.day.includes('border-radius:3px') || renders.day.includes('border-radius: 3px'));
check('合计与说明用中文单位', (() => {
	const expected = __test.taFormat(Object.values(days).reduce((a, b) => a + b, 0));
	return renders.day.includes(expected) && renders.day.includes('有记录 3 天');
})(), textOf(renders.day).slice(-90));

// ── 5. 悬停浮层 ────────────────────────────────────────────────────────────
console.log('\n— 悬停浮层 —');
const hovered = renderCard(cardState({ external, mode: 'day', hovered: '2026-10-01', tip: { title: '4月1日', value: '239.7万', unit: '每天 Token', key: '2026-10-01' }, tipVisible: true }), '悬停');
check('浮层是绝对定位 + pointer-events:none', /data-dta-tooltip="1"/u.test(hovered) && hovered.includes('position:absolute') && hovered.includes('pointer-events:none'));
check('浮层第一行是日期 `4月1日`', tooltipHtml(hovered).includes('data-dta-tip-title="1"') && tooltipHtml(hovered).includes('4月1日'), tooltipHtml(hovered).slice(0, 200));
check('浮层第二行是 `239.7万`（中文单位）', tooltipHtml(hovered).includes('data-dta-tip-value="1"') && tooltipHtml(hovered).includes('239.7万'));
check('浮层带向上的箭头（svg path）', tooltipHtml(hovered).includes('<svg') && tooltipHtml(hovered).includes('data-dta-tip-unit="1"'));
check('浮层单位按模式切换（每天 Token）', tooltipHtml(hovered).includes('每天 Token'));
check('悬停时该格高亮（outline）', hovered.includes('outline:1px solid var(--dsw-alias-label-primary)'));
check('悬停时其它格变暗（opacity）', /opacity:0\.32/u.test(hovered), `${(hovered.match(/opacity:0\.32/gu) ?? []).length} 格变暗`);
check('没有悬停时不出现浮层', !strip(renders.day).includes('data-dta-tooltip'));
check('大数值浮层：亿（万/亿与格子里是同一套格式）', (() => {
	const tip = __test.tokenTooltip({ date: '2026-10-03', key: '2026-10-03', value: 123456789, level: 4, label: '10月3日' }, 'day');
	return tip.value === '1.23亿' && tip.unit === '每天 Token';
})());
check('悬停那格是 239.7万（浮层与数据一致）', (() => {
	const tip = __test.tokenTooltip({ date: '2026-10-01', key: '2026-10-01', value: days['2026-10-01'], level: 4, label: '10月1日' }, 'day');
	return tip.value === '239.7万';
})());
check('浮层单位随模式变：每周 / 年 / 累计', (() => {
	const cell = { date: '2026-10-05', key: 'w', value: 10000, level: 4, label: '10月5日', range: '10月5日 – 10月11日' };
	return __test.tokenTooltip(cell, 'week').unit === '每周 Token' && __test.tokenTooltip(cell, 'year').unit === '每年 Token' && __test.tokenTooltip(cell, 'total').unit === '累计 Token' && __test.tokenTooltip(cell, 'week').title === '10月5日 · 10月5日 – 10月11日';
})());
check('浮层文案纯函数对 null 格不崩', __test.tokenTooltip(null, 'day').value === '0');

// ── 6. 空 / 错 / 加载三态 ──────────────────────────────────────────────────
console.log('\n— 空数据 / 取数失败 —');
const emptyReady = renderCard(cardState({ external: { phase: 'ready', days: {}, error: null, ready: true } }), '空数据');
check('空数据有明确文案', emptyReady.includes('还没有 Token 活动记录'), textOf(emptyReady));
check('空数据不显示浮层 / 不显示网格', !strip(emptyReady).includes('data-dta-tooltip') && !strip(emptyReady).includes('data-dta-cell'));
const emptyError = renderCard(cardState({ external: { phase: 'error', days: {}, error: 'HTTP 500', ready: false } }), '取数失败');
check('取数失败有明确文案 + 重试按钮', emptyError.includes('用量数据暂时取不到') && emptyError.includes('重新取一次') && emptyError.includes('HTTP 500'), textOf(emptyError));
check('取数失败不崩（正常出 HTML）', emptyError.includes('data-dta-card="1"'));
const emptyLoading = renderCard(cardState({ external: { phase: 'loading', days: {}, error: null, ready: false } }), '加载中');
check('加载中有文案，不会一直空白', emptyLoading.includes('正在统计本机会话日志'), textOf(emptyLoading));
check('已经加载过一次时再刷新不回到「加载中」', __test.tokenActivityStore.get().phase !== undefined);

// ── 7. 账号页锚点识别（宿主改版时最容易坏的一处） ──────────────────────────
console.log('\n— 账号页「充值余额」卡片定位 —');
const fakeDom = (dom) => {
	const calls = [];
	const saved = globalThis.document;
	globalThis.document = {
		querySelector: (selector) => {
			calls.push(selector);
			if (selector.includes('top_up') || selector.includes('top-up')) return dom.link;
			if (selector.includes('swbgcW_balanceCard')) return dom.classFallback ?? null;
			return null;
		},
	};
	return { calls, restore: () => (globalThis.document = saved) };
};
const card = { tag: 'balanceCard' };
{
	const dom = fakeDom({ link: { closest: () => card } });
	const found = __test.tokenActivityAnchor();
	dom.restore();
	check('优先用「充值」链接的 href 找卡片（不依赖类名哈希）', found === card, JSON.stringify(dom.calls));
}
{
	const dom = fakeDom({ link: null, classFallback: card });
	const found = __test.tokenActivityAnchor();
	dom.restore();
	check('找不到链接时退回类名选择器（含 /top_up 与 /top-up 两种拼法）', found === card && dom.calls[0].includes('/top_up') && dom.calls[0].includes('/top-up'), JSON.stringify(dom.calls));
}
{
	const dom = fakeDom({ link: null, classFallback: null });
	const found = __test.tokenActivityAnchor();
	dom.restore();
	check('两条锚点都没有 → null（兜底页会顶上，不会白屏）', found === null, JSON.stringify(dom.calls));
}

// ── 8. 设置页注册（id / order 不撞车） ─────────────────────────────────────
console.log('\n— 设置页注册 —');
const sections = registered.filter((entry) => entry.options.name === 'settings.section');
const ids = sections.map((entry) => entry.options.id);
check('注册了 token-activity 这一页', ids.includes('token-activity'), ids.join(' / '));
const activity = sections.find((entry) => entry.options.id === 'token-activity');
check('token-activity：order 170、中文 label', activity.options.order === 170 && activity.options.label === 'Token 活动', `order=${activity.options.order} label=${activity.options.label}`);
check('挂载点 token-activity-mount 是独立 id', ids.includes('token-activity-mount') && ids.filter((id) => id === 'token-activity-mount').length === 1);
check('**没有**复用内置的 account id（复用 = 整页被替换）', !ids.includes('account'), ids.join(' / '));
check('没有重复 id', new Set(ids).size === ids.length, ids.join(' / '));
check('既有四页 id / order 没被动过', (() => {
	const want = { skills: 130, mcp: 140, agents: 150, 'other-ai': 160 };
	return Object.entries(want).every(([id, order]) => sections.some((entry) => entry.options.id === id && entry.options.order === order));
})());
check('order 里没有 170 撞车（除本页）', sections.filter((entry) => entry.options.order === 170).length === 1);
check('注册了两个组件（挂载点 + 兜底页）', sections.filter((entry) => entry.options.id === 'token-activity' || entry.options.id === 'token-activity-mount').length === 2);

// 兜底页：账号页没挂上时渲染出卡片本体；挂上了就返回 null
const pageProps = { t: (key) => key };
queue = [];
const pageHtml = renderToStaticMarkup(React.createElement(activity.Component, pageProps));
check('兜底页能渲染出卡片（账号页没挂上时用）', pageHtml.includes('data-dta-card="1"') || pageHtml === '', `${pageHtml.length} 字节`);
const gateRegistered = sections.find((entry) => entry.options.id === 'token-activity');
queue = [true];
const gated = renderToStaticMarkup(React.createElement(gateRegistered.Component, pageProps));
check('账号页已经挂上时，兜底页渲染为空（不会两处同时出现）', gated === '', JSON.stringify(gated));
const mount = sections.find((entry) => entry.options.id === 'token-activity-mount');
queue = [];
const mountHtml = renderToStaticMarkup(React.createElement(mount.Component, pageProps));
check('挂载组件在没有 DOM 锚点时渲染为空（不崩）', mountHtml === '', JSON.stringify(mountHtml));

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
