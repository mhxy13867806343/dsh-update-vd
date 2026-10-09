/**
 * 「从其它 AI 导入」的**宿主侧**自测。分两段，边界很清楚：
 *
 *  ① **只读探测**（主进程）：用**真实的 `HOME`**（不设 `DSH_HOME`）跑
 *     `detectOtherAiToolkits()`，只 `existsSync` / `readdir`，**一个字节都不写**。
 *     允许的观测结果就是「本机装了 Codex / Claude Code / WorkBuddy，TRAE 未装」这类事实，
 *     所以断言写的是**结构**（默认 4 个来源、每条都有 probeNote/homepage、装了才可能有
 *     items、TRAE 只有配置残渣时 partial=true 且 installed=false），不写死「一定装了谁」。
 *
 *  ② **写操作**（**子进程**）：`DSH_HOME` 指到 `/tmp/dsh-other-ai-home`，再用假 ctx
 *     （`connection.fetch.register` 收路由、`get('agentPresets')` 给假注册表、`plugin()`
 *     模拟「挂一行 = 注册表多一条」）把 `/other-ai`、`/other-ai/read`、`/other-ai/import`
 *     与 `other-ai` 那一类 `/sources*` 全打一遍，跑完删掉临时目录。
 *
 * **为什么写操作必须走子进程**：`lib/resources.js` 在**模块加载时**就把
 * `DSH_HOME` / `AGENT_STORE` / `skill-sources.json` 的路径算成常量了 —— 主进程要是先
 * 在真实 HOME 下 `import` 过它，后面再改 `process.env.DSH_HOME` 也没用，写操作会落进
 * **真实的** `~/.dsh/`。所以：主进程只读、子进程（带着临时 DSH_HOME 启动）才写。
 * 验收标准之一就是「跑完真实的 ~/.dsh/agent-presets.json 必须没被动过」。
 *
 * 跑法：node test/dsh-other-ai-host-test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMP_HOME = '/tmp/dsh-other-ai-home';
const SELF = fileURLToPath(import.meta.url);

let failures = 0;
let skipped = 0;
const check = (label, ok, detail) => {
	if (ok === 'skip') {
		skipped += 1;
		console.log(`  SKIP ${label}${detail === undefined ? '' : ` — ${detail}`}`);
		return;
	}
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

/** 真实 store 的时间戳（跑完要证明它没被动过）。 */
const REAL_STORE = join(homedir(), '.dsh', 'agent-presets.json');
const stamp = async (path) => {
	try {
		const info = await stat(path);
		return `${String(info.mtimeMs)}:${String(info.size)}`;
	} catch {
		return 'missing';
	}
};

// ═══════════════════════════════════════════════════════════════════════════
// 子进程那一半：临时 DSH_HOME 上的写操作
// ═══════════════════════════════════════════════════════════════════════════
if (process.env.DSH_OTHER_AI_PHASE === 'write') {
	const { mkdir, writeFile, readFile } = await import('node:fs/promises');
	const mod = await import('../lib/index.js');
	const P = '/api/dsh-update-vd';
	const storePath = join(process.env.DSH_HOME, 'agent-presets.json');
	const sourcePath = join(process.env.DSH_HOME, 'skill-sources.json');
	check('临时 DSH_HOME 生效（AGENT_STORE 不在真实 ~/.dsh 里）', !storePath.startsWith(join(homedir(), '.dsh')), storePath);

	const routes = new Map();
	const registry = new Map();
	for (const [id, order] of [['standard', 1], ['ptc', 2]]) registry.set(id, { id, order, plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona' }] });
	const agentPresets = {
		async list() {
			return [...registry.values()].map((row) => ({ id: row.id, order: row.order }));
		},
		async readDocument(id) {
			const row = registry.get(id);
			if (row === undefined) throw new Error(`Unknown agent preset: ${id}`);
			return { agentPreset: id, content: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n" };
		},
	};
	const ctx = {
		connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
		get: (name) => (name === 'agentPresets' ? agentPresets : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }) } : undefined),
		plugin: (module_, config) => {
			if (typeof module_ !== 'function') throw new Error(`invalid plugin, expect function or object with an "apply" method, received ${typeof module_}`);
			if (config === null || typeof config !== 'object' || typeof config.id !== 'string') throw new Error('bad config');
			if (registry.has(config.id)) throw new Error(`Duplicate agent preset: ${config.id}`);
			registry.set(config.id, { ...config });
			return { dispose: () => registry.delete(config.id) };
		},
		logger: { info: () => {} },
		effect: (fn) => { fn(); return () => {}; },
		inject: (_deps, callback) => { callback(ctx); return () => {}; },
	};
	mod.apply(ctx);
	await new Promise((resolve) => setTimeout(resolve, 200));

	const call = async (path, body) => {
		const route = routes.get(path);
		if (route === undefined) throw new Error(`路由没注册：${path}`);
		const request = new Request(`http://x${path}`, body === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
		const response = await route.fetch(request);
		return { status: response.status, data: await response.json().catch(() => null) };
	};

	console.log('— 路由 —');
	for (const path of ['/other-ai', '/other-ai/read', '/other-ai/import']) check(`注册了 ${path}`, routes.has(`${P}${path}`));
	check('既有路由没被动过', ['/agents', '/agents/search', '/skills', '/mcp', '/sources', '/sources/add', '/sources/remove', '/import/local'].every((path) => routes.has(`${P}${path}`)));

	console.log('— /other-ai —');
	const listing = await call(`${P}/other-ai`);
	check('/other-ai 通', listing.data.ok === true, listing.data.error);
	check('内置 4 个 + 0 个自定义（还没加）', listing.data.toolkits.length === 4, listing.data.toolkits.map((toolkit) => `${toolkit.id}:${toolkit.installed ? '装了' : '没装'}`).join(' '));
	check('builtinIds 是那 4 个', JSON.stringify(listing.data.builtinIds) === JSON.stringify(['codex', 'claude', 'trae', 'workbuddy']), JSON.stringify(listing.data.builtinIds));
	check('列表响应里不带 content（太重，要正文走 /other-ai/read）', listing.data.toolkits.every((toolkit) => toolkit.items.every((item) => item.content === undefined && typeof item.chars === 'number')));
	check('/other-ai 响应没被正文撑肥', JSON.stringify(listing.data).length < 60000, `${String(JSON.stringify(listing.data).length)} 字节`);

	const installed = listing.data.toolkits.filter((toolkit) => toolkit.installed === true);
	const hostItems = installed.flatMap((toolkit) => toolkit.items.map((item) => ({ toolkit, item })));

	console.log('— /other-ai/read —');
	if (installed.length > 0) {
		const one = await call(`${P}/other-ai/read`, { toolkitId: installed[0].id });
		check('按 id 读一个来源（这一条带正文）', one.data.ok === true && one.data.id === installed[0].id && (one.data.items ?? []).every((item) => typeof item.content === 'string' && item.content !== ''), one.data.error ?? `${String(one.data.items?.length ?? 0)} 项，都有正文`);
		const missing = await call(`${P}/other-ai/read`, { toolkitId: 'zzz-nope' });
		check('读不存在的来源给明确报错', missing.data.ok === false, missing.data.error);
	} else {
		check('/other-ai/read', 'skip', '这台机器一个都没装');
	}

	console.log('— /other-ai/import —');
	if (hostItems.length > 0) {
		const first = hostItems[0];
		const imported = await call(`${P}/other-ai/import`, { toolkitId: first.toolkit.id, key: first.item.key });
		check('一键导入成 DSH 预设', imported.data.ok === true && registry.has(imported.data.id), imported.data.error ?? `→ ${imported.data.id}`);
		const record = registry.get(imported.data.id);
		check('导入的是「一行 persona」的预设', Array.isArray(record?.plugins) && record.plugins[0]?.name === '@deepseek-ai/dsh-persona' && typeof record.plugins[0]?.config?.prefix === 'string' && record.plugins[0].config.prefix.length > 0, `${String(record?.plugins?.[0]?.name ?? '')} · prefix ${String(record?.plugins?.[0]?.config?.prefix ?? '').length} 字`);
		check('名字来自来源内容（不是空的）', typeof record?.name === 'string' && record.name !== '', `${String(record?.name ?? '')} / ${String(record?.description ?? '').slice(0, 40)}`);
		// 注意：`registry` 里存的是**传给插件的 config**（只有 id/name/description/order/plugins），
		// 溯源信息在 AgentManager 的记录里 → 下面用 `/agents` 的响应来断言。

		const again = await call(`${P}/other-ai/import`, { toolkitId: first.toolkit.id, key: first.item.key });
		check('同一项再导一次是幂等刷新（不报错）', again.data.ok === true && again.data.id === imported.data.id, again.data.error);

		const clash = await call(`${P}/other-ai/import`, { toolkitId: first.toolkit.id, key: first.item.key, id: 'standard' });
		check('撞内置 id 明确报错（不静默覆盖）', clash.data.ok === false && registry.get('standard').plugins.length === 1, clash.data.error);

		const others = hostItems.filter((row) => !(row.toolkit.id === first.toolkit.id && row.item.key === first.item.key));
		if (others.length > 0) {
			const clashMine = await call(`${P}/other-ai/import`, { toolkitId: others[0].toolkit.id, key: others[0].item.key, id: imported.data.id });
			check('撞自己那几条也要显式 overwrite', clashMine.data.ok === false, clashMine.data.error);
			const asCopy = await call(`${P}/other-ai/import`, { toolkitId: others[0].toolkit.id, key: others[0].item.key, asCopy: true });
			check('勾「重名自动改名」能导成副本', asCopy.data.ok === true && registry.has(asCopy.data.id), asCopy.data.error ?? `→ ${String(asCopy.data.id)}`);
		} else {
			check('撞自己那几条 / 自动改名', 'skip', '本机只扫出一项');
		}

		const listed = await call(`${P}/agents`);
		const row = listed.data.presets.find((preset) => preset.id === imported.data.id);
		check('导完立刻出现在 /agents 列表里', row !== undefined, imported.data.id);
		check('列表里标成「其它 AI · <来源>」且可写', row?.originLabel === `其它 AI · ${first.toolkit.label}` && row?.writable === true && row?.external?.via === first.toolkit.id, `${String(row?.originLabel ?? '')} external=${JSON.stringify(row?.external?.via)}`);
		check('落盘真的写到临时 DSH_HOME', existsSync(storePath), storePath);
	} else {
		check('/other-ai/import', 'skip', '这台机器一个都没装');
	}

	console.log('— 没装的来源不能导 —');
	{
		const notInstalled = listing.data.toolkits.find((toolkit) => toolkit.installed !== true);
		if (notInstalled === undefined) {
			check('未安装的来源导入被拒', 'skip', '4 个全装了');
		} else {
			const denied = await call(`${P}/other-ai/import`, { toolkitId: notInstalled.id, key: 'whatever' });
			check('未安装的来源导入被拒（提示去官网装）', denied.data.ok === false && String(denied.data.error).includes('没检测到安装'), denied.data.error);
		}
	}

	console.log('— other-ai 这一类 /sources（加 / 删第三方来源）—');
	const mineDir = join(process.env.DSH_HOME, 'my-agents');
	await mkdir(mineDir, { recursive: true });
	await writeFile(join(mineDir, 'helper.md'), '你是一个只写中文的助手。\n', 'utf8');
	await writeFile(join(mineDir, 'reporter.md'), '---\nname: 报表员\ndescription: 专门做报表\n---\n\n你只输出 Markdown 表格。\n', 'utf8');

	const before = await call(`${P}/sources`);
	// `listSources()` 老约定：kind:'custom' 的那个「自定义地址…」占位不出现（skills/mcp/agents 都一样）
	check('sources.other-ai 一开始是空的（和 skills/mcp/agents 同一套约定）', before.data.sources['other-ai'].length === 0, JSON.stringify(before.data.sources['other-ai']));
	check('sources.skills / mcp / agents 行为不变', before.data.sources.skills.length === 2 && before.data.sources.mcp.length === 2 && before.data.sources.agents.length === 3, `skills=${before.data.sources.skills.length} mcp=${before.data.sources.mcp.length} agents=${before.data.sources.agents.length}`);

	const added = await call(`${P}/sources/add`, { kind: 'other-ai', address: mineDir, label: '我的小仓库' });
	check('能给 other-ai 加一个本机路径来源', added.data.ok === true && added.data.entry.kind === 'path', added.data.error ?? `${String(added.data.entry?.label ?? '')} → ${String(added.data.entry?.path ?? '')}`);
	check('加完 sources.other-ai 多一条', added.data.sources['other-ai'].length === 1, added.data.sources['other-ai'].map((item) => item.label).join(' | '));
	const dupAdd = await call(`${P}/sources/add`, { kind: 'other-ai', address: mineDir });
	check('同路径重复加被拒', dupAdd.data.ok === false, dupAdd.data.error);
	const badPath = await call(`${P}/sources/add`, { kind: 'other-ai', address: '/no/such/dir/here' });
	check('不存在的本机路径被拒（带原因）', badPath.data.ok === false, badPath.data.error);
	const urlAdd = await call(`${P}/sources/add`, { kind: 'other-ai', address: 'https://example.com/agents/bot.md', label: '某人的 bot' });
	check('能给 other-ai 加一个 http 地址来源', urlAdd.data.ok === true && urlAdd.data.entry.kind === 'url', urlAdd.data.error ?? String(urlAdd.data.entry?.url ?? ''));

	const withCustom = await call(`${P}/other-ai`);
	const custom = withCustom.data.toolkits.find((toolkit) => toolkit.custom === true && toolkit.id === added.data.entry.id);
	check('自定义来源出现在 /other-ai 里（排在 4 个内置后面）', withCustom.data.toolkits.length === 6 && withCustom.data.toolkits[4].id === added.data.entry.id && withCustom.data.toolkits[5].id === urlAdd.data.entry.id, withCustom.data.toolkits.map((toolkit) => toolkit.id).join(', '));
	const customItems = custom?.items ?? [];
	check('自定义来源可删 + 列出目录里的 md', custom?.deletable === true && customItems.length === 2, customItems.map((item) => `${item.name}(${String(item.chars)}字)`).join(' / ') || custom?.error || '(无)');
	check('自定义来源的 frontmatter 被认出来了', customItems.some((item) => item.name === '报表员' && item.description === '专门做报表'), customItems.map((item) => item.name).join(', '));
	if (customItems.length === 0) {
		check('从自定义来源也能导入', 'skip', '上面没列出任何项，跳过');
	} else {
		const customImport = await call(`${P}/other-ai/import`, { toolkitId: added.data.entry.id, key: customItems.find((item) => item.name === '报表员').key });
		check('从自定义来源也能导入', customImport.data.ok === true && registry.has(customImport.data.id), customImport.data.error ?? `→ ${String(customImport.data.id)}`);
		check('自定义来源导进来的也带 other-ai 溯源（看 /agents）', (await call(`${P}/agents`)).data.presets.find((preset) => preset.id === customImport.data.id)?.external?.via === added.data.entry.id, JSON.stringify(registry.get(customImport.data.id)?.plugins?.length ?? null));
	}

	const remote = withCustom.data.toolkits.find((toolkit) => toolkit.id === urlAdd.data.entry.id);
	check('打不到网的远程来源只是标 error，不崩（也不带崩整套接口）', remote !== undefined && (remote.error === null || typeof remote.error === 'string'), remote?.error ?? '(居然读到了)');

	const dropped = await call(`${P}/sources/remove`, { kind: 'other-ai', id: added.data.entry.id });
	check('能删掉自己加的来源', dropped.data.ok === true && dropped.data.sources['other-ai'].length === 1, dropped.data.error);
	const keepBuiltin = await call(`${P}/sources/remove`, { kind: 'other-ai', id: 'codex' });
	check('内置 4 个来源删不掉（有提示）', keepBuiltin.data.ok === false, keepBuiltin.data.error);
	await call(`${P}/sources/remove`, { kind: 'other-ai', id: urlAdd.data.entry.id });

	// 别把 skills/mcp/agents 那三个老键踩坏：加一条老 kind 的技能源，看看另一边还在不在
	const skillAdd = await call(`${P}/sources/add`, { kind: 'skills', address: 'someone-demo/ai-rules' });
	check('skills 那一类照旧能加（老行为）', skillAdd.data.ok === true, skillAdd.data.error ?? JSON.stringify(skillAdd.data.entry));
	const mixed = JSON.parse(await readFile(sourcePath, 'utf8'));
	check('skill-sources.json 里三个老键原样保留', Array.isArray(mixed.skills) && Array.isArray(mixed.mcp) && Array.isArray(mixed.agents), Object.keys(mixed).join(', '));
	check('other-ai 的键写成 otherAi（不跟别的读者打架）', Array.isArray(mixed.otherAi) && mixed['other-ai'] === undefined, Object.keys(mixed).join(', '));
	check('skills 那条真的写进去了（加了个老 kind 之后别的键没被清空）', mixed.skills.length === 1 && JSON.stringify(mixed.skills).includes('someone-demo/ai-rules'), JSON.stringify(mixed.skills));

	console.log(failures === 0 ? `\n（子进程）全部通过（跳过 ${skipped} 项）` : `\n（子进程）${failures} 项失败（跳过 ${skipped} 项）`);
	process.exit(failures === 0 ? 0 : 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 主进程：真实 HOME 只读探测
// ═══════════════════════════════════════════════════════════════════════════
console.log('— ① 真实 HOME 只读探测（不写任何东西）—');
const beforeStamp = await stamp(REAL_STORE);
{
	delete process.env.DSH_HOME; // 明确用真实 HOME，确保探测走的是真机器
	const resources = await import('../lib/resources.js');
	check('homedir() 就是真实 home', homedir() === process.env.HOME, `${homedir()}`);
	check('没设 DSH_HOME（这一段不碰任何本插件存储）', process.env.DSH_HOME === undefined);

	const scanned = await resources.detectOtherAiToolkits();
	check('正好 4 个默认来源', scanned.length === 4, scanned.map((toolkit) => toolkit.id).join(', '));
	check('默认来源 = Codex / Claude Code / TRAE / WorkBuddy', scanned.map((toolkit) => toolkit.id).join(',') === 'codex,claude,trae,workbuddy', scanned.map((toolkit) => toolkit.label).join(' / '));
	check('每个都有探测判据（probeNote）与官网', scanned.every((toolkit) => typeof toolkit.probeNote === 'string' && toolkit.probeNote !== '' && /^https:\/\//u.test(toolkit.homepage)), scanned.map((toolkit) => `${toolkit.id}→${toolkit.homepage}`).join(' | '));
	check('每个都说了「能导入什么」', scanned.every((toolkit) => typeof toolkit.format === 'string' && toolkit.format !== ''));
	check('每个都有 foundPaths / items / error 字段且 error 为 null', scanned.every((toolkit) => Array.isArray(toolkit.foundPaths) && Array.isArray(toolkit.items) && toolkit.error === null));
	check('内置 4 个都不可删（builtin=true / custom=false / deletable=false）', scanned.every((toolkit) => toolkit.deletable === false && toolkit.builtin === true && toolkit.custom === false));

	const trae = scanned.find((toolkit) => toolkit.id === 'trae');
	const traeHasConfig = existsSync(join(homedir(), '.trae')) || existsSync(join(homedir(), '.trae-cn'));
	const traeHasApp = existsSync('/Applications/Trae.app') || existsSync('/Applications/Trae CN.app');
	if (traeHasConfig && !traeHasApp) {
		check('TRAE 只有配置残渣 → 未装 + partial（用户要求的判据）', trae.installed === false && trae.partial === true, `installed=${String(trae.installed)} partial=${String(trae.partial)}`);
	} else {
		check('TRAE 探测结果自洽', trae.installed === (traeHasConfig && traeHasApp), `installed=${String(trae.installed)} 配置=${String(traeHasConfig)} 应用=${String(traeHasApp)}`);
	}

	check('没装的来源不会给出可导入项', scanned.filter((toolkit) => toolkit.installed !== true).every((toolkit) => toolkit.items.length === 0));
	for (const toolkit of scanned.filter((row) => row.installed === true)) {
		console.log(`       ${toolkit.id}: 装了，列出 ${String(toolkit.items.length)} 项${toolkit.items.length === 0 ? '（它自己还没存内容）' : `：${toolkit.items.map((item) => item.name).join(' / ')}`}`);
		check(`${toolkit.id} 的每一项都带正文与来源路径`, toolkit.items.every((item) => typeof item.content === 'string' && item.content.trim() !== '' && typeof item.path === 'string' && item.path !== '' && typeof item.key === 'string'));
	}

	// 本机实测命中：文件在就必须扫得出来（这几条是真机证据）
	const codexAgents = join(homedir(), '.codex', 'AGENTS.md');
	if (existsSync(codexAgents)) {
		const item = scanned.find((toolkit) => toolkit.id === 'codex').items.find((row) => row.path === codexAgents);
		check('Codex 的 ~/.codex/AGENTS.md 被扫出来了（单文件也认）', item !== undefined && item.chars > 0, item === undefined ? '没扫到' : `${item.name} · ${String(item.chars)} 字`);
	} else {
		check('Codex AGENTS.md', 'skip', '本机没有这个文件');
	}
	const claudeAgents = join(homedir(), '.claude', 'agents');
	if (existsSync(claudeAgents)) {
		const claude = scanned.find((toolkit) => toolkit.id === 'claude');
		check('Claude Code 的子代理被扫出来了（frontmatter 的 name/description 生效）', claude.items.length > 0 && claude.items.every((item) => typeof item.name === 'string' && item.name !== ''), claude.items.map((item) => item.name).join(', ') || '(空)');
	} else {
		check('Claude 子代理', 'skip', '本机没有这个目录');
	}
	const wbSoul = join(homedir(), '.workbuddy', 'SOUL.md');
	if (existsSync(wbSoul)) {
		const wb = scanned.find((toolkit) => toolkit.id === 'workbuddy');
		check('WorkBuddy 的 SOUL.md / IDENTITY.md / USER.md 都被扫出来了', ['SOUL', 'IDENTITY', 'USER'].every((name) => wb.items.some((item) => item.path.endsWith(`${name}.md`))), wb.items.map((item) => item.name).join(' / '));
	} else {
		check('WorkBuddy 人格文件', 'skip', '本机没有 ~/.workbuddy/SOUL.md');
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// 子进程：写操作（临时 DSH_HOME）
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n— ② 临时 DSH_HOME：路由与导入（子进程，绝不碰真实 ~/.dsh）—');
await rm(TEMP_HOME, { recursive: true, force: true });
// 显式拼一份干净的环境（别让外部 shell 里的 DSH_HOME 漏进子进程 —— 那会写错地方）
const childEnv = { ...process.env, DSH_HOME: TEMP_HOME, DSH_OTHER_AI_PHASE: 'write' };
const child = spawn(process.execPath, [SELF], { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
const code = await new Promise((resolve) => child.on('exit', (value) => resolve(value ?? 1)));
if (code !== 0) failures += 1;
check('子进程（写操作那一段）退出码为 0', code === 0, `exit=${String(code)}`);

console.log('\n— 收尾：真实 ~/.dsh 必须没被动过 —');
const afterStamp = await stamp(REAL_STORE);
check('真实的 ~/.dsh/agent-presets.json 与跑之前一模一样', beforeStamp === afterStamp, `${beforeStamp} → ${afterStamp}`);
await rm(TEMP_HOME, { recursive: true, force: true });
check('临时 DSH_HOME 已清掉', !existsSync(TEMP_HOME), TEMP_HOME);

console.log(failures === 0 ? `\n全部通过（跳过 ${skipped} 项）` : `\n${failures} 项失败（跳过 ${skipped} 项）`);
process.exit(failures === 0 ? 0 : 1);
