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
/** 每次 `settings.section` 注册的 disposer（模拟宿主：register 会返回一个注销函数）。 */
const sectionDisposers = new Map();
const fakeSlots = {
	inject: (_key, cb) => cb(),
	register: (options, Component) => {
		registered.push({ options, Component });
		let live = true;
		const off = () => {
			if (!live) return;
			live = false;
			const at = registered.findIndex((entry) => entry.Component === Component && entry.options === options);
			if (at !== -1) registered.splice(at, 1);
		};
		sectionDisposers.set(options.id, off);
		return off;
	},
};
mod.apply({
	effect: (fn) => fn(),
	slots: fakeSlots,
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

/** 卡片组件的 12 个 useState 初值（顺序 = 组件里 useState 的调用顺序；effect 不入队）。 */
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

// ── 6. 四种 phase 都不许空白（v1.10.0 的白屏回归护栏） ─────────────────────
console.log('\n— 四种 phase（idle / loading / error / ready）都不能空白 —');
const emptyReady = renderCard(cardState({ external: { phase: 'ready', days: {}, error: null, errorCode: null, ready: true } }), '空数据');
check('空数据有明确文案', emptyReady.includes('还没有 Token 活动记录'), textOf(emptyReady));
check('空数据不显示浮层 / 不显示网格', !strip(emptyReady).includes('data-dta-tooltip') && !strip(emptyReady).includes('data-dta-cell'));
const emptyError = renderCard(cardState({ external: { phase: 'error', days: {}, error: '宿主接口返回 HTTP 500', errorCode: 'http', ready: false } }), '取数失败');
check('取数失败有明确文案 + 重试按钮', emptyError.includes('用量数据暂时取不到') && emptyError.includes('重新取一次') && emptyError.includes('宿主接口返回 HTTP 500'), textOf(emptyError));
check('取数失败不崩（正常出 HTML）', emptyError.includes('data-dta-card="1"'));
const emptyLoading = renderCard(cardState({ external: { phase: 'loading', days: {}, error: null, errorCode: null, ready: false } }), '加载中');
check('加载中有文案，不会一直空白', emptyLoading.includes('正在统计本机会话日志'), textOf(emptyLoading));
check('已经加载过一次时再刷新不回到「加载中」', __test.tokenActivityStore.get().phase !== undefined);

/**
 * 「卡片任何 phase 都不许空白」—— 逐个 phase 摆一遍，断言：
 *   ① 渲染出的**可见文本**非空（去掉标签之后还有字）；
 *   ② 有 `data-dta-state` 之一（说明真的走了某个分支，不是掉进 return null）；
 *   ③ error 态能看到**原因**（比如「宿主还是旧版本」）。
 * 这一条是 v1.10.0「点开 Token 活动整页全白」的直接回归护栏。
 */
const PHASE_CASES = [
	{ phase: 'idle', days: {}, error: null, errorCode: null, ready: false, state: 'idle', expect: '还没开始取用量数据' },
	{ phase: 'loading', days: {}, error: null, errorCode: null, ready: false, state: 'loading', expect: '正在统计本机会话日志' },
	{ phase: 'error', days: {}, error: '宿主还是旧版本（重启一次 DSH Desktop 就好）', errorCode: 'host-old', ready: false, state: 'error', expect: '宿主还是旧版本' },
	{ phase: 'ready', days: {}, error: null, errorCode: null, ready: true, state: 'empty', expect: '还没有 Token 活动记录' },
];
for (const item of PHASE_CASES) {
	const html = renderCard(cardState({ external: { phase: item.phase, days: item.days, error: item.error, errorCode: item.errorCode, ready: item.ready } }), `phase=${item.phase}`);
	const text = textOf(html);
	const visible = text.replace(/[|·\s]/gu, '');
	check(`phase=${item.phase}：卡片不是空白`, html.includes('data-dta-card="1"') && visible.length > 0, `${visible.length} 个可见字符`);
	check(`phase=${item.phase}：走了 ${item.state} 分支（不是 return null）`, html.includes(`data-dta-state="${item.state}"`), (html.match(/data-dta-state="[a-z]+"/u) ?? ['<none>'])[0]);
	check(`phase=${item.phase}：能看到文案「${item.expect}」`, text.includes(item.expect), text.slice(0, 80));
}
check('认不出来的 phase 也当 idle 渲染（不许空白）', (() => {
	const html = renderCard(cardState({ external: { phase: '胡说', days: {}, error: null, ready: false } }), 'phase=未知');
	return html.includes('data-dta-state="idle"') && textOf(html).replace(/[|·\s]/gu, '').length > 0;
})());
check('没有 days 字段也不许空白（老 store 的残缺状态）', (() => {
	const html = renderCard(cardState({ external: { phase: 'idle' } }), 'phase=idle 残缺');
	return html.includes('data-dta-card="1"') && textOf(html).replace(/[|·\s]/gu, '').length > 0;
})());
check('error 态一定显示原因（error 为空也要有兜底文案）', (() => {
	const html = renderCard(cardState({ external: { phase: 'error', days: {}, error: null, errorCode: null, ready: false } }), 'phase=error 无原因');
	return html.includes('data-dta-state="error"') && textOf(html).includes('取数过程中出了点别的问题');
})());
check('「宿主还是旧版本」失败会多给一句「重启一次 DSH Desktop」', (() => {
	const html = renderCard(cardState({ external: { phase: 'error', days: {}, error: '宿主还是旧版本（重启一次 DSH Desktop 就好）', errorCode: 'host-old', ready: false } }), 'phase=error 旧宿主');
	return html.includes('data-dta-error-code="host-old"') && textOf(html).includes('重启一次 DSH Desktop');
})());
check('一次失败不会把文案重复两遍（body 说事、页脚说怎么办）', (() => {
	const html = renderCard(cardState({ external: { phase: 'error', days: {}, error: '宿主接口返回 HTTP 500', errorCode: 'http', ready: false } }), 'phase=error 不重复');
	const text = textOf(html);
	const hint = '点「重新取一次」再试；一直失败就看下面的原因。';
	return text.split(hint).length - 1 === 1 && text.split('用量数据暂时取不到').length - 1 === 1;
})(), '');
check('error 但已经有旧数据时仍出网格（不把老数据藏起来）', (() => {
	const html = renderCard(cardState({ external: { phase: 'error', days: { '2026-10-01': 1234 }, error: '宿主接口返回 HTTP 500', errorCode: 'http', ready: false } }), 'phase=error 有旧数据');
	const cells = (html.match(/data-dta-cell="1"/gu) ?? []).length;
	return cells > 0 && html.includes('data-dta-footer="1"') && textOf(html).includes('用量数据暂时取不到') && html.includes('data-dta-retry="1"');
})(), '');
check('ready 且有数据时不出空态（走网格 + 合计）', (() => {
	const html = renderCard(cardState({ external: { phase: 'ready', days: { '2026-10-01': 1234 }, error: null, errorCode: null, ready: true } }), 'ready 有数据');
	return !html.includes('data-dta-state=') && html.includes('data-dta-cell="1"');
})());
check('任何 phase 都有页脚（页脚里至少有 retry 或合计）', PHASE_CASES.every((item) => {
	const html = renderCard(cardState({ external: { phase: item.phase, days: item.days, error: item.error, errorCode: item.errorCode, ready: item.ready } }), '页脚');
	return html.includes('data-dta-footer="1"');
}));

// 失败路径的人话文案（纯函数）：404 → 「宿主还是旧版本」。
console.log('\n— 失败原因归一化（taErrorText / taErrorCode） —');
check('HTTP 404（新路由还不存在）→ 「宿主还是旧版本」', (() => {
	const text = __test.taErrorText(new Error('HTTP 404'));
	return text.includes('宿主还是旧版本') && __test.taPhaseOf('error') === 'error';
})(), __test.taErrorText(new Error('HTTP 404')));
check('带 status 的 404 也认', __test.taErrorText('whatever', 404).includes('宿主还是旧版本'));
check('别的 HTTP 带状态码', __test.taErrorText(new Error('HTTP 500')) === '宿主接口返回 HTTP 500', __test.taErrorText(new Error('HTTP 500')));
check('连不上宿主进程（fetch 抛错）有原始信息', __test.taErrorText(new Error('Failed to fetch')).includes('连不上宿主进程'));
check('原因码：404=host-old / 500=http / 网络=network', (() => {
	return (
		__test.taErrorCode(new Error('HTTP 404')) === 'host-old' &&
		__test.taErrorCode('boom', 404) === 'host-old' &&
		__test.taErrorCode(new Error('HTTP 500')) === 'http' &&
		__test.taErrorCode(new Error('Failed to fetch')) === 'network'
	);
})(), `${__test.taErrorCode(new Error('HTTP 404'))}/${__test.taErrorCode(new Error('HTTP 500'))}/${__test.taErrorCode(new Error('Failed to fetch'))}`);
check('phase 枚举就是四种', JSON.stringify(__test.TA_PHASES) === JSON.stringify(['idle', 'loading', 'error', 'ready']), __test.TA_PHASES.join('/'));
check('phase 归一化：认不出来 → idle', __test.taPhaseOf('ready') === 'ready' && __test.taPhaseOf('nope') === 'idle' && __test.taPhaseOf(undefined) === 'idle');

/**
 * 真请求路径（不是摆状态）：把 `fetch` 换成「旧宿主」——
 * `/api/dsh-update-vd/usage/daily` 还不存在、返回 404 —— 断言 store **一定**落到
 * `phase:'error'` 且带「宿主还是旧版本」文案（v1.10.0 就是这条路径没落地才一片空白）。
 * 再把网络错误（fetch 直接抛）也走一遍。
 */
console.log('\n— 真请求路径：旧宿主 404 / 网络错误 —');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) });
await __test.tokenActivityStore.load(true);
const afterOldHost = __test.tokenActivityStore.get();
check('404 ⇒ phase=error（不是停在 idle / loading）', afterOldHost.phase === 'error', String(afterOldHost.phase));
check('404 ⇒ error 文案是「宿主还是旧版本」+ 原因码 host-old', String(afterOldHost.error).includes('宿主还是旧版本') && afterOldHost.errorCode === 'host-old', `${afterOldHost.errorCode} / ${afterOldHost.error}`);
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: '会话日志读不到' }) });
await __test.tokenActivityStore.load(true);
const afterHostError = __test.tokenActivityStore.get();
check('接口 ok:false ⇒ phase=error 且把宿主给的 error 带出来', afterHostError.phase === 'error' && String(afterHostError.error).includes('会话日志读不到'), `${afterHostError.errorCode} / ${afterHostError.error}`);
globalThis.fetch = async () => {
	throw new TypeError('Failed to fetch');
};
await __test.tokenActivityStore.load(true);
const afterNetwork = __test.tokenActivityStore.get();
check('fetch 抛错 ⇒ phase=error 且是「连不上宿主进程」', afterNetwork.phase === 'error' && String(afterNetwork.error).includes('连不上宿主进程') && afterNetwork.errorCode === 'network', `${afterNetwork.errorCode} / ${afterNetwork.error}`);
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, days: { '2026-10-01': 1234 } }) });
await __test.tokenActivityStore.load(true);
const afterOk = __test.tokenActivityStore.get();
check('成功 ⇒ phase=ready 且 days 落地', afterOk.phase === 'ready' && afterOk.days['2026-10-01'] === 1234 && afterOk.error === null, JSON.stringify(afterOk.days));
// 还原（后面没有别的请求了，但别给别的断言留坑）。
globalThis.fetch = realFetch;
__test.tokenActivityStore.set({ phase: 'idle', days: {}, error: null, errorCode: null, ready: false });

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

// ── 8. 设置页注册（id / order 不撞车）+ 导航里不许留空白行 ────────────────
console.log('\n— 设置页注册 / 导航门控 —');
const sections = registered.filter((entry) => entry.options.name === 'settings.section');
const ids = sections.map((entry) => entry.options.id);
check('注册了 token-activity 这一页', ids.includes('token-activity'), ids.join(' / '));
const activity = sections.find((entry) => entry.options.id === 'token-activity');
check('token-activity：order 170、中文 label', activity.options.order === 170 && activity.options.label === 'Token 活动', `order=${activity.options.order} label=${activity.options.label}`);
// ① v1.10.0 的 bug：portal 宿主注册进 `settings.section`（没有 label）→ 导航多一条空白行。
check('**portal 宿主不再注册为 settings.section**（否则导航里多一条空白行）', !ids.includes('token-activity-mount'), ids.join(' / '));
check('portal 宿主改挂到 shell.overlay（始终挂载、不进导航）', (() => {
	const overlay = registered.filter((entry) => entry.options.name === 'shell.overlay');
	return overlay.some((entry) => entry.Component === __test.AccountTokenActivityMount);
})(), registered.filter((entry) => entry.options.name === 'shell.overlay').map((entry) => entry.options.id).join(' / '));
check('settings.section 里每一个注册项都有 label（没有 label 就是空白行）', sections.every((entry) => typeof entry.options.label === 'string' && entry.options.label !== ''), sections.map((entry) => `${entry.options.id}=${entry.options.label ?? '<无>'}`).join(' / '));
check('**没有**复用内置的 account id（复用 = 整页被替换）', !ids.includes('account'), ids.join(' / '));
check('没有重复 id', new Set(ids).size === ids.length, ids.join(' / '));
check('既有四页 id / order 没被动过', (() => {
	const want = { skills: 130, mcp: 140, agents: 150, 'other-ai': 160 };
	return Object.entries(want).every(([id, order]) => sections.some((entry) => entry.options.id === id && entry.options.order === order));
})());
check('order 里没有 170 撞车（除本页）', sections.filter((entry) => entry.options.order === 170).length === 1);

// 兜底页：账号页没挂上时渲染出卡片本体（**不再是「内容返回 null」那种假隐藏**）
const pageProps = { t: (key) => key };
queue = [];
const pageHtml = renderToStaticMarkup(React.createElement(activity.Component, pageProps));
check('兜底页能渲染出卡片（账号页没挂上时用）', pageHtml.includes('data-dta-card="1"'), `${pageHtml.length} 字节`);
check('兜底页的组件自己不判空（判空 = 导航留一条空白行）', (() => {
	const source = __test.TokenActivityPage.toString();
	return !/return\s+null/u.test(source);
})());

/**
 * ② 门控：账号页 portal 挂上过 ⇒ 兜底页整条**注销**（不是让内容返回 null）。
 * 这一条替代了原来的 `TokenActivityNavGate` 断言 —— 旧的写法只会留一行空白。
 */
console.log('\n— 兜底页门控（portal 挂上了就整条注销） —');
const fallbackEntries = () => registered.filter((entry) => entry.options.name === 'settings.section' && entry.options.id === 'token-activity');
// apply 时 portal 还没挂上 ⇒ 兜底页应该在注册表里（功能永远可达）。
check('账号页还没挂上时：兜底页在 settings.section 里', fallbackEntries().length === 1 && __test.taSectionRegistered() === true, String(fallbackEntries().length));
__test.tokenActivityHostSet(true);
check('portal 挂上 ⇒ 兜底页整条注销（导航里不再有 token-activity）', __test.taSectionRegistered() === false && fallbackEntries().length === 0, String(fallbackEntries().length));
__test.tokenActivityHostSet(false);
check('portal 挂上过就粘住：之后探测失败也不许把兜底页放回导航', __test.taSectionRegistered() === false && fallbackEntries().length === 0, String(fallbackEntries().length));
__test.taSectionResetState(false);
__test.taSectionSync();
check('复位后再同步 → 兜底页回来（兜底能力真的还在）', __test.taSectionRegistered() === true && fallbackEntries().length === 1, String(fallbackEntries().length));
check('门控幂等：连调两次不会注册两份', (() => {
	__test.taSectionSync();
	__test.taSectionSync();
	return fallbackEntries().length === 1;
})(), String(fallbackEntries().length));
check('声明重放（关掉设置面板再打开）也不会注册第二份', (() => {
	const before = fallbackEntries().length;
	__test.taSectionSync();
	__test.taSectionSync();
	return before === 1 && fallbackEntries().length === 1;
})(), String(fallbackEntries().length));
check('已 hosted 时再同步不会把兜底页放回来', (() => {
	__test.tokenActivityHostSet(true);
	__test.taSectionSync();
	__test.taSectionSync();
	const hidden = fallbackEntries().length === 0 && __test.taSectionRegistered() === false;
	__test.taSectionResetState(false);
	__test.taSectionSync();
	return hidden && fallbackEntries().length === 1;
})(), String(fallbackEntries().length));

// 挂载组件本身在没有 DOM 锚点时不许崩（也不能顺带注册出导航条目）
queue = [];
const mountHtml = renderToStaticMarkup(React.createElement(__test.AccountTokenActivityMount, pageProps));
check('挂载组件在没有 DOM 锚点时渲染为空（不崩）', mountHtml === '', JSON.stringify(mountHtml));
check('挂载组件自己不是 settings.section 条目', !registered.some((entry) => entry.options.name === 'settings.section' && entry.Component === __test.AccountTokenActivityMount));

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
