/**
 * 「我的插件」设置页的客户端自测（纯新增一套，不碰别的套件）。
 *
 * 覆盖：
 *   1. 三种基础状态：读取中 / 有数据 / 空清单；
 *   2. 每条都能看到：名字、`vX.Y.Z`、`已收录市场`、star、更新日期、仓库简介；
 *   3. 搜索：按名字能过滤、搜不到有「没有匹配的插件。」、多关键字是 AND；
 *   4. 失败态（`role="alert"`）与「没连上 GitHub、用缓存」的提示都渲染得出来；
 *   5. 注册：`settings.section` 里 id `own-plugins`、order 171、label「我的插件」，
 *      而且**排在 token-activity（170）后面**、没有重复 id；
 *   6. 组件**不依赖注入的 `t`**（dsh 0.2.1 起 `t` 只给声明了 locale 的条目 ——
 *      这一页刻意不用 t，省掉那层耦合）。
 *
 * 跑法：cd <仓库根> && node test/dsh-own-plugins-test.mjs
 */
import { fileURLToPath } from 'node:url';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let captured = null;
globalThis.window = {
	__ModuleLoader__: { load: (definition) => (captured = definition) },
	addEventListener: () => {},
	removeEventListener: () => {},
	open: () => {},
};
globalThis.document = {
	visibilityState: 'visible',
	addEventListener: () => {},
	removeEventListener: () => {},
	querySelector: () => null,
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, state: {} }) });

await import(CLIENT_PATH);

let queue = [];
const React2 = Object.create(React);
React2.useState = (initial) => {
	const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial;
	return React.useState(value);
};
const mod = captured.factory((id) => {
	if (id === 'react') return React2;
	throw new Error(`unexpected require(${id})`);
});

const registered = [];
const fakeSlots = {
	inject: (_key, callback) => callback(),
	register: (options, Component) => {
		registered.push({ options, Component });
		let live = true;
		return () => {
			if (!live) return;
			live = false;
			const at = registered.findIndex((entry) => entry.Component === Component && entry.options === options);
			if (at !== -1) registered.splice(at, 1);
		};
	},
};
mod.apply({
	effect: (fn) => fn(),
	slots: fakeSlots,
	locale: {
		register: () => () => {},
		getSnapshot: () => ({ active: 'zh' }),
	},
	get: () => undefined,
});

const { __test } = mod;

let failures = 0;
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

// ---------------------------------------------------------------------------
// 夹具（跟宿主 /own-plugins 的返回形状一致）
// ---------------------------------------------------------------------------
const ITEMS = [
	{
		name: 'dsh-update-vd',
		fullName: 'mhxy13867806343/dsh-update-vd',
		url: 'https://github.com/mhxy13867806343/dsh-update-vd',
		homepage: null,
		description: 'DSH Desktop 桌面控制中心：更新中心 + 技能 / MCP / 智能体 / 导入 设置页',
		stars: 3,
		updatedAt: '2026-10-24T15:49:59Z',
		topics: ['dsh-plugin'],
		published: true,
		marketUrl: 'https://awesome-dsh-plugin.com/p/mhxy13867806343/dsh-update-vd/',
		install: 'dsh plugin --profile web add github:mhxy13867806343/dsh-update-vd',
		version: '1.10.6',
	},
	{
		name: 'dsh-sidebar-account',
		fullName: 'mhxy13867806343/dsh-sidebar-account',
		url: 'https://github.com/mhxy13867806343/dsh-sidebar-account',
		homepage: null,
		description: 'DSH Desktop 侧栏余额行——余额 + 充值按钮',
		stars: 0,
		updatedAt: '2026-10-11T03:24:53Z',
		topics: ['dsh-bundle', 'dsh-plugin'],
		published: true,
		marketUrl: 'https://awesome-dsh-plugin.com/p/mhxy13867806343/dsh-sidebar-account/',
		install: 'dsh plugin --profile web add github:mhxy13867806343/dsh-sidebar-account',
		version: '1.0.2',
	},
	{
		name: 'my-dsh-desktop-extra',
		fullName: 'mhxy13867806343/my-dsh-desktop-extra',
		url: 'https://github.com/mhxy13867806343/my-dsh-desktop-extra',
		homepage: null,
		description: '',
		stars: 0,
		updatedAt: '2026-09-04T16:32:56Z',
		topics: [],
		published: true,
		marketUrl: 'https://awesome-dsh-plugin.com/p/mhxy13867806343/my-dsh-desktop-extra/',
		install: 'dsh plugin --profile web add github:mhxy13867806343/my-dsh-desktop-extra',
		version: null,
	},
];

const READY = { loading: false, items: ITEMS, error: null, stale: false, note: null };

/** 队列顺序 = `OwnPluginsPage` 里 `useState` 的调用顺序：state、query、refreshing。 */
const renderPage = (state, query = '', refreshing = false) => {
	queue = [state, query, refreshing];
	return renderToStaticMarkup(React.createElement(__test.OwnPluginsPage));
};

// ---------------------------------------------------------------------------
// 1. 三种基础状态
// ---------------------------------------------------------------------------
console.log('— 基础状态 —');
{
	const html = renderPage({ loading: true, items: [], error: null, stale: false, note: null });
	check('读取中：页面外壳在（data-own-plugins）', html.includes('data-own-plugins="1"'));
	check('读取中：有「正在读取 GitHub…」提示', html.includes('正在读取 GitHub…'));
	check('读取中：不渲染任何条目', !html.includes('data-own-plugin='));
}
{
	const html = renderPage(READY);
	check('有数据：三个插件都渲染出来', ['dsh-update-vd', 'dsh-sidebar-account', 'my-dsh-desktop-extra'].every((name) => html.includes(`data-own-plugin="${name}"`)));
	check('有数据：版本号带 v 前缀', html.includes('>v1.10.6<') && html.includes('>v1.0.2<'), '');
	check('有数据：没版本的那个不显示版本徽标', !html.includes('>vnull<') && !html.includes('>v<'));
	check('有数据：三个都标「已收录市场」', (html.match(/已收录市场/gu) ?? []).length === 3, String((html.match(/已收录市场/gu) ?? []).length));
	check('有数据：star 与更新日期都在', html.includes('★ 3') && html.includes('更新于 2026-10-24'));
	check('有数据：没有简介的那个给占位文案', html.includes('（仓库没填简介）'));
	check('有数据：GitHub / 市场页 / 复制安装命令 三个按钮都在', (html.match(/>GitHub</gu) ?? []).length === 3 && (html.match(/>市场页</gu) ?? []).length === 3 && (html.match(/>复制安装命令</gu) ?? []).length === 3);
	check('有数据：计数文案正确', html.includes('共 3 个 · 匹配 3 个'));
}
{
	const html = renderPage({ loading: false, items: [], error: null, stale: false, note: null });
	check('空清单：给「还没有自己开发的插件」并提到 topic 的自发现', html.includes('还没有自己开发的插件') && html.includes('dsh-plugin topic'));
}

// ---------------------------------------------------------------------------
// 2. 搜索（纯前端过滤）
// ---------------------------------------------------------------------------
console.log('\n— 搜索 —');
{
	const html = renderPage(READY, 'sidebar');
	check('按名字过滤：只剩 dsh-sidebar-account', html.includes('data-own-plugin="dsh-sidebar-account"') && !html.includes('data-own-plugin="dsh-update-vd"'));
	check('搜索时计数变成「匹配 1 个」', html.includes('共 3 个 · 匹配 1 个'));
}
{
	const html = renderPage(READY, '更新中心');
	check('按简介过滤（中文）：命中「更新中心」那一条', html.includes('data-own-plugin="dsh-update-vd"') && !html.includes('data-own-plugin="dsh-sidebar-account"'));
}
{
	const html = renderPage(READY, 'zzz-没这个');
	check('搜不到：给「没有匹配的插件。」', html.includes('没有匹配的插件。'));
}
{
	const html = renderPage(READY, 'dsh sidebar');
	check('多关键字是 AND（dsh + sidebar ⇒ 只命中 sidebar 那条）', html.includes('data-own-plugin="dsh-sidebar-account"') && !html.includes('data-own-plugin="dsh-update-vd"'));
}

// ---------------------------------------------------------------------------
// 3. 失败 / 缓存降级 / 复制结果
// ---------------------------------------------------------------------------
console.log('\n— 失败与降级 —');
{
	const html = renderPage({ loading: false, items: [], error: 'GitHub API 限流了（未登录 60 次/小时），过一会儿再试', stale: false, note: null });
	check('失败：错误文案可见且带 role="alert"', html.includes('role="alert"') && html.includes('GitHub API 限流了'));
}
{
	const html = renderPage({ loading: false, items: ITEMS, error: null, stale: true, note: null });
	check('缓存降级：提示「没连上 GitHub」但仍列出插件', html.includes('没连上 GitHub') && html.includes('data-own-plugin="dsh-update-vd"'));
}
{
	const html = renderPage({ loading: false, items: ITEMS, error: null, stale: false, note: '已复制安装命令：dsh plugin --profile web add github:mhxy13867806343/dsh-update-vd' });
	check('复制结果：显示「已复制安装命令」', html.includes('已复制安装命令'));
}

// ---------------------------------------------------------------------------
// 4. 纯函数
// ---------------------------------------------------------------------------
console.log('\n— 纯函数 —');
check('ownPluginMatches：空关键字全命中', __test.ownPluginMatches(ITEMS[0], '') && __test.ownPluginMatches(ITEMS[0], '   '));
check('ownPluginMatches：大小写不敏感', __test.ownPluginMatches(ITEMS[0], 'DSH-UPDATE-VD'));
check('ownPluginMatches：topic 也算（dsh-bundle 只命中 sidebar 那条）', __test.ownPluginMatches(ITEMS[1], 'dsh-bundle') && !__test.ownPluginMatches(ITEMS[0], 'dsh-bundle'));
check('ownPluginMatches：关键字全都要出现（AND）', __test.ownPluginMatches(ITEMS[1], 'dsh sidebar') && !__test.ownPluginMatches(ITEMS[1], 'dsh 不存在'));
check('ownPluginDate：ISO → 日期', __test.ownPluginDate('2026-10-24T15:49:59Z') === '2026-10-24');
check('ownPluginDate：拿不到 → —', __test.ownPluginDate(null) === '—' && __test.ownPluginDate('') === '—');

// ---------------------------------------------------------------------------
// 5. 注册（slot / order / label / 不依赖 t）
// ---------------------------------------------------------------------------
console.log('\n— 注册 —');
{
	const sections = registered.filter((entry) => entry.options.name === 'settings.section');
	const page = sections.find((entry) => entry.options.id === 'own-plugins');
	check('注册了 own-plugins 这一页', page !== undefined, sections.map((entry) => entry.options.id).join(' / '));
	check('own-plugins：order 171、label「我的插件」', page?.options.order === 171 && page?.options.label === '我的插件', page === undefined ? '没注册' : `order=${String(page.options.order)} label=${page.options.label}`);
	check('排在 token-activity（170）后面', sections.some((entry) => entry.options.id === 'token-activity' && entry.options.order === 170) && page?.options.order === 171);
	check('没有重复 id', new Set(sections.map((entry) => entry.options.id)).size === sections.length, sections.map((entry) => entry.options.id).join(' / '));
	check('组件不接受 props（不用注入的 t，也就不需要 locale）', __test.OwnPluginsPage.length === 0, String(__test.OwnPluginsPage.length));
	check('注册项没声明 locale（跟组件不接 t 一致，不会误伤 dsh 0.2.1 的 locale 规则）', page !== undefined && page.options.locale === undefined);
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
