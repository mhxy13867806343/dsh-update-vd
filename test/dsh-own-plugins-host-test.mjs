/**
 * 「我的插件」宿主半边的自测（`lib/own-plugins.js`）。
 *
 * 覆盖：
 *   1. 只挑「自己开发的 DSH 插件」：topic 命中 / 或者名字在 CURATED 里；
 *      fork、archived、无关仓库一律排除；
 *   2. 字段成形：名字 / 全名 / 仓库地址 / 简介 / star / 更新时间 / 安装命令 /
 *      市场页（只有收录过的才有）；版本号从 raw package.json 拿，拿不到就是 null；
 *   3. 排序：已收录市场的在前，然后按最近更新倒序；
 *   4. 缓存：10 分钟内第二次请求不再打 GitHub；`refresh: true` 才重新拉；
 *   5. 降级：GitHub 401/500/403/格式不对都**不许把整页带崩** ——
 *      有缓存就回缓存并标 `stale: true`，没缓存才抛错（403 给「限流」人话）；
 *   6. 路由真的接上了：`lib/index.js` 里有 `/own-plugins`，且 import 了这个模块。
 *
 * 跑法：cd <仓库根> && node test/dsh-own-plugins-host-test.mjs
 * 真联网那一段：`DSH_OWN_PLUGINS_LIVE=1 node test/dsh-own-plugins-host-test.mjs`（会消耗 GitHub 配额）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CURATED, OWNER, listOwnPlugins, resetOwnPluginsCache } from '../lib/own-plugins.js';

let failures = 0;
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

// ---------------------------------------------------------------------------
// 假 GitHub
// ---------------------------------------------------------------------------
const REPOS = [
	{
		name: 'dsh-update-vd',
		full_name: 'mhxy13867806343/dsh-update-vd',
		html_url: 'https://github.com/mhxy13867806343/dsh-update-vd',
		description: 'DSH Desktop 桌面控制中心',
		stargazers_count: 2,
		pushed_at: '2026-10-24T15:49:59Z',
		updated_at: '2026-10-24T15:49:59Z',
		topics: ['dsh-plugin'],
		archived: false,
		fork: false,
		homepage: null,
	},
	{
		name: 'dsh-sidebar-account',
		full_name: 'mhxy13867806343/dsh-sidebar-account',
		html_url: 'https://github.com/mhxy13867806343/dsh-sidebar-account',
		description: '侧栏余额与充值',
		stargazers_count: 0,
		pushed_at: '2026-10-11T03:24:53Z',
		updated_at: '2026-10-11T03:24:53Z',
		topics: ['dsh-bundle', 'dsh-plugin'],
		archived: false,
		fork: false,
		homepage: null,
	},
	{
		// 没打 topic，靠 CURATED 兜住
		name: 'my-dsh-desktop-extra',
		full_name: 'mhxy13867806343/my-dsh-desktop-extra',
		html_url: 'https://github.com/mhxy13867806343/my-dsh-desktop-extra',
		description: null,
		stargazers_count: 0,
		pushed_at: '2026-09-04T16:32:56Z',
		updated_at: '2026-09-04T16:32:56Z',
		topics: [],
		archived: false,
		fork: false,
		homepage: null,
	},
	{ name: 'unrelated-repo', full_name: 'mhxy13867806343/unrelated-repo', topics: [], fork: false, archived: false, pushed_at: '2026-10-23T00:00:00Z' },
	{ name: 'forked-plugin', full_name: 'mhxy13867806343/forked-plugin', topics: ['dsh-plugin'], fork: true, archived: false, pushed_at: '2026-10-23T00:00:00Z' },
	{ name: 'archived-plugin', full_name: 'mhxy13867806343/archived-plugin', topics: ['dsh-plugin'], fork: false, archived: true, pushed_at: '2026-10-23T00:00:00Z' },
];

const VERSIONS = {
	'mhxy13867806343/dsh-update-vd': '1.10.6',
	'mhxy13867806343/dsh-sidebar-account': '1.0.2',
	// my-dsh-desktop-extra 故意返回 404：版本号必须是 null，页面显示占位
};

/** 造一个假 fetch：按 URL 分派，记录每次请求。 */
function makeFetch(options = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push(String(url));
		const href = String(url);
		if (href.includes('/users/') && href.includes('/repos')) {
			if (options.reposStatus !== undefined && options.reposStatus !== 200) {
				return { status: options.reposStatus, async json() { return {}; } };
			}
			if (options.badShape === true) return { status: 200, async json() { return { nope: true }; } };
			if (options.networkError === true) throw new Error('getaddrinfo ENOTFOUND api.github.com');
			return { status: 200, async json() { return REPOS; } };
		}
		if (href.includes('raw.githubusercontent.com')) {
			const match = /raw\.githubusercontent\.com\/(.+)\.git/.exec(`${href}.git`) ?? [];
			const path = href.replace('https://raw.githubusercontent.com/', '').replace('/HEAD/package.json', '');
			void match;
			const version = VERSIONS[path];
			if (version === undefined) return { status: 404, async json() { return {}; } };
			return { status: 200, async json() { return { version }; } };
		}
		return { status: 404, async json() { return {}; } };
	};
	return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// 1. 正常路径
// ---------------------------------------------------------------------------
console.log('— 正常路径（假 GitHub） —');
resetOwnPluginsCache();
{
	const { fetchImpl, calls } = makeFetch();
	const data = await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	check('只留下自己开发的 3 个插件（fork / archived / 无关仓库都排除）', data.count === 3, data.items.map((item) => item.name).join(', '));
	check('名字都对', ['dsh-update-vd', 'dsh-sidebar-account', 'my-dsh-desktop-extra'].every((name) => data.items.some((item) => item.name === name)));
	check('排序：已收录的在前、按最近更新倒序', data.items.map((item) => item.name).join(',') === 'dsh-update-vd,dsh-sidebar-account,my-dsh-desktop-extra', data.items.map((item) => item.name).join(','));
	const first = data.items.find((item) => item.name === 'dsh-update-vd');
	check('字段成形：url / 简介 / star / 更新时间 / 安装命令', first?.url === 'https://github.com/mhxy13867806343/dsh-update-vd' && first.description === 'DSH Desktop 桌面控制中心' && first.stars === 2 && first.updatedAt === '2026-10-24T15:49:59Z' && first.install === 'dsh plugin --profile web add github:mhxy13867806343/dsh-update-vd', JSON.stringify(first).slice(0, 160));
	check('已收录市场：published + 市场页地址', first?.published === true && first.marketUrl === 'https://awesome-dsh-plugin.com/p/mhxy13867806343/dsh-update-vd/');
	check('版本号从 package.json 拿到', first?.version === '1.10.6', first?.version ?? 'null');
	const extra = data.items.find((item) => item.name === 'my-dsh-desktop-extra');
	check('没有简介 / 拿不到版本：description 空串、version=null（不许抛）', extra !== undefined && extra.description === '' && extra.version === null, JSON.stringify({ description: extra?.description, version: extra?.version }));
	check('topics 原样带回来（搜索用得上）', Array.isArray(first?.topics) && first.topics.includes('dsh-plugin'));
	check('一共只打了「1 次仓库清单 + 3 次版本」请求', calls.length === 4, `${String(calls.length)} 次：${calls.map((url) => url.replace('https://', '')).join(' | ')}`);
	check('owner 回的是本人', data.owner === OWNER && OWNER === 'mhxy13867806343');
	check('CURATED 里就是市场收录的那三个', CURATED.length === 3 && CURATED.includes('my-dsh-desktop-extra'));
}

// ---------------------------------------------------------------------------
// 2. 缓存
// ---------------------------------------------------------------------------
console.log('\n— 缓存 —');
{
	const { fetchImpl, calls } = makeFetch();
	const again = await listOwnPlugins({ fetch: fetchImpl });
	check('10 分钟内第二次：直接回缓存，一个请求都不打', again.cached === true && calls.length === 0, `${String(calls.length)} 次请求`);
	check('缓存里还是那 3 条', again.count === 3 && again.items[0].name === 'dsh-update-vd');
}
{
	const { fetchImpl, calls } = makeFetch();
	const refreshed = await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	check('refresh: true 才会重新拉清单', refreshed.cached === false && calls.length === 4, `${String(calls.length)} 次请求`);
}

// ---------------------------------------------------------------------------
// 3. 降级（有缓存回缓存，没缓存才抛错）
// ---------------------------------------------------------------------------
console.log('\n— 降级 —');
{
	const { fetchImpl } = makeFetch({ reposStatus: 500 });
	const stale = await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	check('GitHub 500：有缓存就回缓存并标 stale', stale.stale === true && stale.count === 3 && typeof stale.error === 'string', stale.error);
}
{
	const { fetchImpl } = makeFetch({ reposStatus: 403 });
	const stale = await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	check('403 限流：缓存还在，error 是「限流」人话', stale.stale === true && /限流/u.test(stale.error ?? ''), stale.error);
}
{
	const { fetchImpl } = makeFetch({ badShape: true });
	const stale = await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	check('返回的不是数组：回缓存，不崩', stale.stale === true && stale.count === 3, stale.error);
}
{
	resetOwnPluginsCache();
	const { fetchImpl } = makeFetch({ networkError: true });
	let message = null;
	try {
		await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	} catch (cause) {
		message = cause instanceof Error ? cause.message : String(cause);
	}
	check('没有缓存时：网络错误要明确抛出来（界面显示错误态）', message !== null && /ENOTFOUND/u.test(message), message ?? '没抛');
}
{
	resetOwnPluginsCache();
	const { fetchImpl } = makeFetch({ reposStatus: 403 });
	let message = null;
	try {
		await listOwnPlugins({ refresh: true, fetch: fetchImpl });
	} catch (cause) {
		message = cause instanceof Error ? cause.message : String(cause);
	}
	check('没有缓存时 403：给的是「限流」而不是 HTTP 403 天书', message !== null && /限流/u.test(message), message ?? '没抛');
}
resetOwnPluginsCache();

// ---------------------------------------------------------------------------
// 4. 路由接上了没有（源码级断言：宿主路由表里必须有这一条）
// ---------------------------------------------------------------------------
console.log('\n— 路由 —');
{
	const index = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');
	check('index.js 从 own-plugins.js import 了 listOwnPlugins', /import\s*\{[^}]*\blistOwnPlugins\b[^}]*\}\s*from\s*'\.\/own-plugins\.js'/u.test(index));
	check('注册了 GET /api/dsh-update-vd/own-plugins', /path: `\$\{ROUTE\}\/own-plugins`, methods: \['GET'\]/u.test(index));
	check('路由把 refresh=1 传下去（强刷缓存）', /listOwnPlugins\(\{ refresh: new URL\(request\.url\)\.searchParams\.get\('refresh'\) === '1' \}\)/u.test(index));
}

// ---------------------------------------------------------------------------
// 5. 可选：真联网（默认跳过，免得吃 GitHub 配额）
// ---------------------------------------------------------------------------
if (process.env.DSH_OWN_PLUGINS_LIVE === '1') {
	console.log('\n— 真联网（DSH_OWN_PLUGINS_LIVE=1） —');
	resetOwnPluginsCache();
	const live = await listOwnPlugins({ refresh: true });
	check('真的能拉到自己开发的插件（≥3 个）', live.count >= 3, live.items.map((item) => item.name).join(', '));
	check('dsh-update-vd 在里面且有版本号', live.items.some((item) => item.name === 'dsh-update-vd' && typeof item.version === 'string'));
} else {
	console.log('\n（跳过真联网：DSH_OWN_PLUGINS_LIVE != 1）');
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
