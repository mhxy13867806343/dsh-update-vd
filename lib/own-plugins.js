/**
 * `@mhxy13867806343/dsh-update-vd` — 「我的插件」的**宿主**半边。
 *
 * 干什么：设置里多一页「我的插件」，把自己开发的 DSH 插件列出来（名字 / 简介 / 版本 /
 * star / 最后更新 / 是否已收录市场），点一下能打开对应的 GitHub 页面，也能按关键字搜。
 *
 * 数据从哪来：
 *   · 仓库清单：GitHub REST 一次拿全 —— `GET /users/<owner>/repos?per_page=100&sort=updated`
 *     （未登录 60 次/小时，所以结果缓存 10 分钟，`?refresh=1` 才强刷）。
 *   · 版本号：每个仓库的 `package.json`（raw.githubusercontent，best effort；拿不到就显示 `—`，
 *     绝不让一条拿不到把整页带崩）。
 *
 * 「哪些算自己开发的插件」的判据（两条取并集）：
 *   1. 仓库打了 `dsh-plugin` / `dsh-bundle` topic（新插件加了 topic 就自动出现，不用改这里）；
 *   2. 名字在 `CURATED` 里（早期那几个没打 topic 的，市场已经收录了）。
 * 归档 / fork 的仓库直接排除。
 *
 * 缓存与降级：10 分钟内重复请求直接回缓存；GitHub 挂了 / 限流时，**有旧数据就回旧数据**
 * 并标 `stale: true`（界面显示「上次拿到的还是 x 分钟前」），没有旧数据才报错。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** GitHub 用户名（本插件作者）。 */
export const OWNER = 'mhxy13867806343';

/**
 * 早期就收录进市场、但仓库没打 topic 的那几个。
 * 加新插件不必改这里 —— 只要在仓库 About 里加 `dsh-plugin` topic 就会被自动扫到。
 */
export const CURATED = ['dsh-update-vd', 'dsh-sidebar-account', 'my-dsh-desktop-extra'];

/** 判定「这是一个 DSH 插件仓库」的 topic。 */
const PLUGIN_TOPICS = ['dsh-plugin', 'dsh-bundle'];

/** 仓库清单缓存多久（GitHub 未登录只有 60 次/小时）。 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 拉仓库清单的超时。 */
const LIST_TIMEOUT_MS = 15_000;

/** 拉单个 package.json 的超时（best effort，慢就不显示版本）。 */
const VERSION_TIMEOUT_MS = 5_000;

/** `dsh` CLI 的安装命令模板（市场索引里用的也是这个写法）。 */
const installCommand = (fullName) => `dsh plugin --profile web add github:${fullName}`;

/** 市场详情页（只有收录过的才有）。 */
const marketPage = (fullName) => `https://awesome-dsh-plugin.com/p/${fullName}/`;

// ---------------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------------

let cache = { at: 0, items: [] };

/** 测试用：清掉模块级缓存（真实调用方用 `refresh` 参数）。 */
export function resetOwnPluginsCache() {
	cache = { at: 0, items: [] };
}

// ---------------------------------------------------------------------------
// 取数
// ---------------------------------------------------------------------------

/** 带超时的 fetch（超时用 AbortSignal.timeout，不额外引依赖）。 */
async function timedFetch(url, options = {}) {
	const { fetchImpl = globalThis.fetch, timeoutMs = LIST_TIMEOUT_MS, headers = {} } = options;
	if (typeof fetchImpl !== 'function') throw new Error('这个运行环境没有 fetch，取不到 GitHub 数据');
	const response = await fetchImpl(url, {
		redirect: 'follow',
		cache: 'no-store',
		headers: { accept: 'application/json', 'user-agent': 'dsh-update-vd', ...headers },
		signal: AbortSignal.timeout(timeoutMs),
	});
	return response;
}

/** 一个仓库算不算「自己开发的 DSH 插件」。 */
function isOwnPlugin(repo) {
	if (repo === null || typeof repo !== 'object') return false;
	if (repo.archived === true || repo.fork === true) return false;
	const name = String(repo.name ?? '');
	if (CURATED.includes(name)) return true;
	const topics = Array.isArray(repo.topics) ? repo.topics.map((topic) => String(topic).toLowerCase()) : [];
	return topics.some((topic) => PLUGIN_TOPICS.includes(topic));
}

/** GitHub 的仓库对象 → 界面要的那几个字段（字段都做类型兜底，外部输入不当指令用）。 */
function toItem(repo) {
	const name = String(repo.name ?? '');
	const fullName = String(repo.full_name ?? `${OWNER}/${name}`);
	const published = CURATED.includes(name);
	return {
		name,
		fullName,
		url: typeof repo.html_url === 'string' && repo.html_url !== '' ? repo.html_url : `https://github.com/${fullName}`,
		homepage: typeof repo.homepage === 'string' && repo.homepage !== '' ? repo.homepage : null,
		description: typeof repo.description === 'string' ? repo.description : '',
		stars: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0,
		updatedAt: typeof repo.pushed_at === 'string' ? repo.pushed_at : typeof repo.updated_at === 'string' ? repo.updated_at : null,
		topics: Array.isArray(repo.topics) ? repo.topics.map((topic) => String(topic)) : [],
		published,
		marketUrl: published ? marketPage(fullName) : null,
		install: installCommand(fullName),
		version: null,
	};
}

/** 读一个仓库的 package.json 版本；拿不到就 null（不影响列表）。 */
async function readVersion(item, fetchImpl) {
	try {
		const response = await timedFetch(`https://raw.githubusercontent.com/${item.fullName}/HEAD/package.json`, {
			fetchImpl,
			timeoutMs: VERSION_TIMEOUT_MS,
		});
		if (response.status !== 200) return null;
		const data = await response.json();
		return typeof data?.version === 'string' && data.version !== '' ? data.version : null;
	} catch {
		return null;
	}
}

/**
 * 列出自己开发的 DSH 插件。
 *
 * @param options - `refresh` 强刷缓存；`fetch` 换掉 fetch（测试用）。
 * @returns `{ owner, items, count, cached, stale, checkedAt }`；GitHub 失败且无缓存时抛错。
 */
export async function listOwnPlugins(options = {}) {
	const refresh = options.refresh === true;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const now = Date.now();

	if (!refresh && cache.items.length > 0 && now - cache.at < CACHE_TTL_MS) {
		return { owner: OWNER, items: cache.items, count: cache.items.length, cached: true, stale: false, checkedAt: cache.at };
	}

	let repos;
	try {
		const response = await timedFetch(`https://api.github.com/users/${OWNER}/repos?per_page=100&sort=updated`, { fetchImpl });
		if (response.status === 403 || response.status === 429) {
			throw new Error('GitHub API 限流了（未登录 60 次/小时），过一会儿再试');
		}
		if (response.status !== 200) throw new Error(`GitHub 返回了 HTTP ${response.status}`);
		repos = await response.json();
		if (!Array.isArray(repos)) throw new Error('GitHub 返回的仓库清单格式不对');
	} catch (cause) {
		if (cache.items.length > 0) {
			return {
				owner: OWNER,
				items: cache.items,
				count: cache.items.length,
				cached: true,
				stale: true,
				checkedAt: cache.at,
				error: cause instanceof Error ? cause.message : String(cause),
			};
		}
		throw cause instanceof Error ? cause : new Error(String(cause));
	}

	const items = repos.filter(isOwnPlugin).map(toItem);
	// 版本号并发取（每个仓库 1 个请求，数量很少：目前 3 个）
	const versions = await Promise.all(items.map((item) => readVersion(item, fetchImpl)));
	items.forEach((item, index) => {
		item.version = versions[index];
	});
	items.sort((left, right) => {
		if (left.published !== right.published) return left.published ? -1 : 1;
		return String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''));
	});

	cache = { at: now, items };
	return { owner: OWNER, items, count: items.length, cached: false, stale: false, checkedAt: now };
}
