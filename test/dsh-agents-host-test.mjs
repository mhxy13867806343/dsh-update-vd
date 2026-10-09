/**
 * 「智能体」页的**宿主侧**自测：直接 apply 宿主半边，用 mock ctx 把新路由全打一遍。
 *
 * 为什么要 mock：`agentPresets` 是宿主服务，测试进程里没有真正的 DSH 运行时，
 * 所以这里用一个假注册表模拟它（登记 = plugin() 被调用，注销 = dispose）。
 * 这样「保存 → 立刻出现在列表里 → 删掉 → 从列表消失」这条链路是真的走通了。
 *
 * 有一步是**真实联网**（在线搜索 GitHub 源）。没网时那几步会标 SKIP，不算失败。
 *
 * 跑法（先把 DSH_HOME 指到临时目录，别碰真身）：
 *   node test/dsh-agents-host-test.mjs
 */
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.DSH_HOME = '/tmp/dsh-agents-host-home';
process.env.DSH_PROFILE = process.env.DSH_PROFILE ?? 'hel';
await rm(process.env.DSH_HOME, { recursive: true, force: true });

const mod = await import(new URL('../lib/index.js', import.meta.url));
const { dumpEntryList, parseEntryListText } = await import(new URL('../lib/resources.js', import.meta.url));

// ── 假 ctx ──────────────────────────────────────────────────────────────
const routes = new Map();
/** 假注册表：id → config（模拟 DSH 的 agentPresets 服务）。 */
const registry = new Map();
// 随包的四个预设（真 DSH 里由 @deepseek-ai/dsh-web-app 的 patch 声明）
const BUILTIN_PLUGINS = [
	{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'built-in' } },
	{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
	{ id: 'group-shell', name: 'cordis:group', group: true, config: [{ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' }] },
];
for (const [id, order] of [['standard', 1], ['ptc', 2], ['minimal', 3], ['cordis', 4]]) {
	registry.set(id, { id, order, plugins: BUILTIN_PLUGINS });
}
const agentPresets = {
	async list() {
		return [...registry.values()]
			.map((row) => ({ id: row.id, ...(row.name === undefined ? {} : { name: row.name }), ...(row.description === undefined ? {} : { description: row.description }), ...(row.order === undefined ? {} : { order: row.order }) }))
			.sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity) || left.id.localeCompare(right.id));
	},
	async readDocument(id) {
		const row = registry.get(id);
		if (row === undefined) throw new Error(`Unknown agent preset: ${id}`);
		return { agentPreset: id, content: await dumpEntryList(row.plugins), ...(row.name === undefined ? {} : { name: row.name }), ...(row.description === undefined ? {} : { description: row.description }) };
	},
};

const ctx = {
	connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
	get: (name) => (name === 'agentPresets' ? agentPresets : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }) } : undefined),
	// 模拟 Cordis：挂一行 @deepseek-ai/dsh-agent-preset = 注册表里多一条
	// 这里**故意**要求 module 是函数（真实的 AgentPreset 类）—— Cordis 的 ctx.plugin
	// 只认「函数 / 有 apply 的对象」，传 import() 的命名空间对象会报
	// `invalid plugin, expect function or object with an "apply" method, received object`。
	// 少写一个 `.default` 就会被这条断言抓住。
	plugin: (module_, config) => {
		if (typeof module_ !== 'function') throw new Error(`invalid plugin, expect function or object with an "apply" method, received ${typeof module_}`);
		if (typeof module_.Config === 'undefined' || !Array.isArray(module_.inject)) throw new Error('拿到的不是 AgentPreset 类（缺 Config / inject 静态字段）');
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

const P = '/api/dsh-update-vd';
const NEW_PLUGINS = [
	{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You review code.' } },
	{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
	{ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
];

// ── 1. 路由注册 ─────────────────────────────────────────────────────────
console.log('— 路由 —');
for (const path of ['/agents', '/agents/read', '/agents/save', '/agents/delete', '/agents/import', '/agents/export', '/agents/search']) {
	check(`注册了 ${path}`, routes.has(`${P}${path}`));
}
check('既有路由没被动过', ['/skills', '/mcp', '/sources', '/import/local'].every((p) => routes.has(`${P}${p}`)));

// ── 2. 搜索源清单里多了 agents ──────────────────────────────────────────
console.log('— 搜索源 —');
const sources = await call(`${P}/sources`);
check('sources.agents 有预设源', Array.isArray(sources.data.sources.agents) && sources.data.sources.agents.length === 3, sources.data.sources.agents.map((item) => item.label).join(' | '));
check('sources.skills / mcp 行为不变', sources.data.sources.skills.length === 2 && sources.data.sources.mcp.length === 2, `skills=${sources.data.sources.skills.length} mcp=${sources.data.sources.mcp.length}`);
const addSource = await call(`${P}/sources/add`, { kind: 'agents', address: 'https://example.com/presets/cordis.patch.yml', label: '某人的预设' });
check('能给 agents 加自定义地址', addSource.data.ok === true, addSource.data.entry?.label);
const dupSource = await call(`${P}/sources/add`, { kind: 'agents', address: 'https://example.com/presets/cordis.patch.yml' });
check('同地址重复加被拒', dupSource.data.ok === false, dupSource.data.error);
const dropSource = await call(`${P}/sources/remove`, { kind: 'agents', id: addSource.data.entry.id });
check('能删掉自定义地址', dropSource.data.ok === true && dropSource.data.sources.agents.length === 3);
const keepSource = await call(`${P}/sources/remove`, { kind: 'agents', id: 'local-shipped' });
check('预设源删不掉（有提示）', keepSource.data.ok === false, keepSource.data.error);

// ── 3. 列表 ─────────────────────────────────────────────────────────────
console.log('— 列表 —');
const list0 = await call(`${P}/agents`);
check('列出注册表里的预设', list0.data.ok === true && list0.data.presets.length === 4, list0.data.presets.map((item) => item.id).join(', '));
check('内置被标成只读', list0.data.presets.every((item) => item.writable === false && item.origin === 'builtin'), list0.data.presets.map((item) => `${item.id}:${item.originLabel}`).join(' | '));
check('拿到了全局默认模型', list0.data.model?.model === 'deepseek-flash', JSON.stringify(list0.data.model));
check('内置补了人话简介', list0.data.presets.every((item) => item.description.length > 0));
check('数出了插件/工具行（含内置的、分组会展开）', list0.data.presets.every((item) => item.plugins === 3 && item.tools === 2), list0.data.presets.map((item) => `${item.id}:插件${item.plugins}/工具${item.tools}`).join(' | '));

// ── 4. 新建 ─────────────────────────────────────────────────────────────
console.log('— 新建 / 修改 —');
const body = await dumpEntryList(NEW_PLUGINS);
const created = await call(`${P}/agents/save`, { id: 'my-review', name: '我的审查模式', description: '只读审查', order: 20, model: 'deepseek-flash', body });
check('新建成功', created.data.ok === true, JSON.stringify(created.data.error ?? created.data.id));
check('新建后注册表里真的有（无需重启）', registry.has('my-review'));
check('新建后立刻出现在列表里', created.data.presets.some((item) => item.id === 'my-review' && item.writable === true && item.origin === 'custom'));
check('新预设的工具数数得对', created.data.presets.find((item) => item.id === 'my-review')?.tools === 2);
const clashBuiltin = await call(`${P}/agents/save`, { id: 'cordis', name: '想覆盖内置', body });
check('撞内置 id 明确报错（不静默覆盖）', clashBuiltin.data.ok === false, clashBuiltin.data.error);
check('内置确实没被改', registry.get('cordis').name === undefined);
const clashMine = await call(`${P}/agents/save`, { id: 'my-review', name: '不小心重名', body });
check('撞自己的 id 也报错（要显式走编辑）', clashMine.data.ok === false, clashMine.data.error);
const badId = await call(`${P}/agents/save`, { id: '有中文的名字', body });
check('非法标识被拒', badId.data.ok === false, badId.data.error);
const emptyBody = await call(`${P}/agents/save`, { id: 'empty-one', name: '空气', body: '' });
check('空正文被拒', emptyBody.data.ok === false, emptyBody.data.error);
const edited = await call(`${P}/agents/save`, { originalId: 'my-review', id: 'my-review', name: '我的审查模式 v2', description: '改过了', body });
check('编辑（改名字/简介）成功', edited.data.ok === true && registry.get('my-review').name === '我的审查模式 v2', registry.get('my-review')?.name);
const renamed = await call(`${P}/agents/save`, { originalId: 'my-review', id: 'my-review-2', name: '我的审查模式 v2', body });
check('改标识 = 旧的下线、新的上线', renamed.data.ok === true && !registry.has('my-review') && registry.has('my-review-2'));

// ── 5. 读正文 ───────────────────────────────────────────────────────────
console.log('— 读正文 —');
const readBuiltin = await call(`${P}/agents/read`, { id: 'standard' });
check('内置的正文读得到、且只读', readBuiltin.data.ok === true && readBuiltin.data.writable === false && readBuiltin.data.content.includes('dsh-persona'), readBuiltin.data.content?.split('\n')[0]);
const readMine = await call(`${P}/agents/read`, { id: 'my-review-2' });
check('自定义的正文可编辑', readMine.data.ok === true && readMine.data.writable === true && readMine.data.model === 'deepseek-flash');
const readMissing = await call(`${P}/agents/read`, { id: '不存在的东西' });
check('读不存在的给明确报错', readMissing.data.ok === false, readMissing.data.error);

// ── 6. 导出 ─────────────────────────────────────────────────────────────
console.log('— 导出 —');
const exportJson = await call(`${P}/agents/export`, { ids: ['my-review-2'], format: 'json' });
check('单条导出 JSON', exportJson.data.ok === true && exportJson.data.content.includes('my-review-2'), exportJson.data.filename);
const exportYaml = await call(`${P}/agents/export`, { ids: ['my-review-2'], format: 'yaml' });
check('单条导出 DSH 补丁 YAML', exportYaml.data.ok === true && exportYaml.data.content.includes('@deepseek-ai/dsh-agent-preset'), exportYaml.data.filename);
const exportAll = await call(`${P}/agents/export`, { format: 'json' });
const exportedAll = exportAll.data.ok === true ? JSON.parse(exportAll.data.content).presets.map((item) => item.id) : [];
check('全部导出（只含本插件自己管的那些）', exportAll.data.ok === true && exportedAll.includes('my-review-2') && !exportedAll.includes('standard'), exportedAll.join(', '));
const exportBuiltin = await call(`${P}/agents/export`, { ids: ['minimal'], format: 'yaml' });
check('内置的也能导成补丁', exportBuiltin.data.ok === true && exportBuiltin.data.content.includes('id: minimal'), exportBuiltin.data.filename);

// ── 7. 导入（粘贴 / 文件 / 地址）────────────────────────────────────────
console.log('— 导入 —');
const importDup = await call(`${P}/agents/import`, { text: exportJson.data.content });
check('导入重名明确报错（不静默覆盖）', importDup.data.ok === false, importDup.data.error);
const importCopy = await call(`${P}/agents/import`, { text: exportJson.data.content, asCopy: true });
check('勾「自动改名」能导入成副本', importCopy.data.ok === true && importCopy.data.renamed === true && registry.has(importCopy.data.id), `${importCopy.data.id}`);
const importOverwrite = await call(`${P}/agents/import`, { text: exportYaml.data.content, id: 'my-review-2', overwrite: true });
check('显式覆盖同名自定义预设', importOverwrite.data.ok === true, importOverwrite.data.error);
const importBuiltinId = await call(`${P}/agents/import`, { text: exportBuiltin.data.content, overwrite: true });
check('不许覆盖内置（即使写了 overwrite）', importBuiltinId.data.ok === false, importBuiltinId.data.error);
const importPlainPrompt = await call(`${P}/agents/import`, { text: '你是一个只写中文的助手。', id: 'zh-only', asCopy: true });
check('纯提示词文本也能导入（自动包成 persona）', importPlainPrompt.data.ok === true && JSON.stringify(registry.get('zh-only')?.plugins).includes('dsh-persona'), importPlainPrompt.data.error);
const importAsPrompt = await call(`${P}/agents/import`, { text: 'You review: be terse.', id: 'terse-review', asCopy: true, asPrompt: true });
check('显式声明「这是系统提示词」时带冒号也不怕', importAsPrompt.data.ok === true && registry.get('terse-review')?.plugins?.[0]?.config?.prefix === 'You review: be terse.', importAsPrompt.data.error);
const importGarbage = await call(`${P}/agents/import`, { text: '名字: 你好\n值: 3' });
check('认不出的内容给明确报错', importGarbage.data.ok === false, importGarbage.data.error);
const importNoSource = await call(`${P}/agents/import`, {});
check('什么都没给时报错', importNoSource.data.ok === false, importNoSource.data.error);

// ── 8. 删除 ─────────────────────────────────────────────────────────────
console.log('— 删除 —');
const delBuiltin = await call(`${P}/agents/delete`, { id: 'cordis' });
check('内置删不掉（提示去复制一份）', delBuiltin.data.ok === false && registry.has('cordis'), delBuiltin.data.error);
const delMine = await call(`${P}/agents/delete`, { id: 'my-review-2' });
check('自己的能删', delMine.data.ok === true && !registry.has('my-review-2') && !delMine.data.presets.some((item) => item.id === 'my-review-2'));

// ── 9. 在线搜索：本机源（离线）──────────────────────────────────────────
console.log('— 在线搜索（本机自带，离线）—');
const localSearch = await call(`${P}/agents/search`, { sourceId: 'local-shipped', query: '' });
check('本机源列出随包预设', localSearch.data.ok === true && localSearch.data.results.length === 4, localSearch.data.results.map((item) => item.id).join(', '));
check('本机结果带真实文件路径', localSearch.data.results.every((item) => typeof item.localPath === 'string' && item.localPath.endsWith('.patch.yml')), localSearch.data.results[0]?.localPath);
check('能按关键字过滤', (await call(`${P}/agents/search`, { sourceId: 'local-shipped', query: 'minimal' })).data.results.length === 1);
check('过滤不到时是空数组', (await call(`${P}/agents/search`, { sourceId: 'local-shipped', query: 'zzz-nope' })).data.results.length === 0);
const installLocal = await call(`${P}/agents/import`, { path: localSearch.data.results.find((item) => item.id === 'minimal').localPath, asCopy: true });
check('一键取用本机预设（复制成自定义）', installLocal.data.ok === true && installLocal.data.id === 'minimal-2', installLocal.data.error ?? installLocal.data.id);

// ── 10. 在线搜索：GitHub 源（真实联网）──────────────────────────────────
console.log('— 在线搜索（GitHub，真实联网）—');
let online = 0;
for (const [sourceId, expectId] of [['upstream-harness', 'standard'], ['mobile-use', 'mobile-use']]) {
	try {
		const result = await call(`${P}/agents/search`, { sourceId, query: '' });
		if (result.data.ok !== true) throw new Error(result.data.error);
		const ids = result.data.results.map((item) => item.id);
		check(`${sourceId} 搜到预设`, ids.length > 0, `扫了 ${result.data.source?.scanned} 个 patch 文件，命中：${ids.join(', ')}`);
		if (ids.length > 0) {
			online += 1;
			check(`${sourceId} 里有 ${expectId}`, ids.includes(expectId), ids.join(', '));
			const install = await call(`${P}/agents/import`, { url: result.data.results.find((item) => item.id === (ids.includes(expectId) ? expectId : ids[0])).url, asCopy: true });
			check(`从 ${sourceId} 一键安装`, install.data.ok === true && registry.has(install.data.id), install.data.error ?? `装成 ${install.data.id}`);
		}
	} catch (error) {
		check(`${sourceId} 联网搜索`, 'skip', String(error?.message ?? error).slice(0, 120));
	}
}
if (online === 0) console.log('  （两个在线源都没通 —— 可能是没网/被墙，这几步记 SKIP）');

console.log(failures === 0 ? `\n全部通过（跳过 ${skipped} 项）` : `\n${failures} 项失败（跳过 ${skipped} 项）`);
await rm(process.env.DSH_HOME, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
