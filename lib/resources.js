/**
 * 技能 / MCP 的资源管理（宿主半边，被 index.js 的路由调用）。
 *
 * ── 技能 ─────────────────────────────────────────────────────────────
 * DSH 的技能就是磁盘上的 Markdown：`<root>/<名字>/SKILL.md`（目录式）或
 * `<root>/<名字>.md`（扁平式），开头一段 YAML frontmatter 带 name / description。
 * 可写的根目录（`dsh-skill-filesystem` 认的）：
 *   · `~/.dsh/skills`        （user-dsh）
 *   · `~/.agents/skills`     （user-agents）
 * 另外还有项目级 `.dsh/skills` / `.agents/skills` 与随包发布的 bundled 技能 ——
 * 那些只展示、不在本插件里改写（`writable:false`）。
 *
 * ── MCP ──────────────────────────────────────────────────────────────
 * DSH 里每个 MCP 服务器 = 一行 `@deepseek-ai/dsh-mcp-client` 插件：
 *   · stdio            → { transport:'stdio', serverName, command, args, env, cwd }
 *   · streamable-http  → { transport:'streamable-http', serverName, url, headers }
 * 本插件把服务器清单存在 `~/.dsh/mcp-servers.json`，并在运行时**动态挂载**这些行
 * （`ctx.plugin(模块, config)`）—— 这样加/改/删立刻生效，不用手改 profile 的 patch。
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME ?? join(HOME, '.dsh');

/** 可写的技能根（按优先级，先 user-dsh）。 */
export const SKILL_ROOTS = [
	{ id: 'user-dsh', dir: join(DSH_HOME, 'skills'), label: '~/.dsh/skills' },
	{ id: 'user-agents', dir: join(HOME, '.agents', 'skills'), label: '~/.agents/skills' },
];

/** MCP 服务器清单。 */
const MCP_STORE = join(DSH_HOME, 'mcp-servers.json');
/** 技能/服务器名：字母数字开头，允许 . _ -。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
/** MCP 的 serverName 还要能进工具名（`mcp__<name>__<tool>`）。 */
const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** YAML 标量：含特殊字符就加单引号。 */
function yamlScalar(value) {
	const text = String(value ?? '').replace(/\r?\n/gu, ' ').trim();
	return /[:#]|^[\s>|&*!%@`{}[\],'-]/u.test(text) ? `'${text.replace(/'/gu, "''")}'` : text;
}

/** 把用户输入收敛成合法名字。 */
export function toName(input, fallback = 'skill') {
	const text = String(input ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[-._]+|[-._]+$/gu, '').slice(0, 64);
	return text === '' ? fallback : text;
}

/** 读一个文件，不存在返回 undefined。 */
async function readIfExists(path) {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
}

async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * 解析 SKILL.md：frontmatter + 正文。
 * 认 `key: value`，也认块标量（`description: >-` / `|` 后面缩进的那几行）——
 * 官方技能库就是这种写法，只认单行的话会把描述读成一个 `>`。
 */
export function parseSkill(text) {
	const lines = String(text ?? '').split(/\r?\n/u);
	let body = String(text ?? '');
	const front = {};
	if (lines[0]?.trim() === '---') {
		let end = -1;
		for (let index = 1; index < lines.length; index += 1) {
			if (lines[index].trim() === '---') {
				end = index;
				break;
			}
		}
		if (end > 0) {
			body = lines.slice(end + 1).join('\n');
			let index = 1;
			while (index < end) {
				const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/u.exec(lines[index]);
				if (pair === null) {
					index += 1;
					continue;
				}
				const key = pair[1];
				let value = pair[2].trim();
				index += 1;
				if (/^[>|][+-]?$/u.test(value)) {
					const folded = value.startsWith('>');
					const block = [];
					while (index < end && (/^\s+\S/u.test(lines[index]) || lines[index].trim() === '')) {
						block.push(lines[index].trim());
						index += 1;
					}
					while (block.length > 0 && block[block.length - 1] === '') block.pop();
					value = (folded ? block.join(' ') : block.join('\n')).trim();
				}
				front[key] = value.replace(/^'(.*)'$/u, '$1').replace(/^"(.*)"$/u, '$1').replace(/''/gu, "'");
			}
		}
	}
	return { front, body: body.replace(/^\s*\n+/u, '') };
}

/** 生成 SKILL.md 文本。 */
export function renderSkill(name, description, body) {
	return `---\nname: ${name}\ndescription: ${yamlScalar(description)}\n---\n\n${String(body ?? '').replace(/^\s*\n+/u, '').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// 技能：扫描 / 读 / 写 / 删 / 导入
// ---------------------------------------------------------------------------

/** 扫一个根目录，返回 [{name, description, path, flat}]。 */
async function scanRoot(dir) {
	const found = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		try {
			if (entry.isDirectory()) {
				const path = join(dir, entry.name, 'SKILL.md');
				const text = await readIfExists(path);
				if (text === undefined) continue;
				found.push({ name: parseSkill(text).front.name ?? entry.name, description: parseSkill(text).front.description ?? '', path, flat: false, dir: join(dir, entry.name) });
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				const path = join(dir, entry.name);
				const text = await readIfExists(path);
				if (text === undefined) continue;
				const parsed = parseSkill(text);
				found.push({ name: parsed.front.name ?? entry.name.replace(/\.md$/u, ''), description: parsed.front.description ?? '', path, flat: true, dir: undefined });
			}
		} catch {}
	}
	return found;
}

/** 该路径是否落在某个可写根里。 */
function writableRootOf(path) {
	if (typeof path !== 'string' || path === '') return undefined;
	return SKILL_ROOTS.find((root) => path === root.dir || path.startsWith(`${root.dir}/`));
}

/**
 * 列技能：以 `ctx.skills` 的注册表结果为准（含 bundled / project / custom），
 * 再补上可写根里注册表还没发现的；同名去重（可写根的优先标成可写）。
 */
export async function listSkills(ctx) {
	const byName = new Map();
	try {
		// 用 ctx.get 拿服务：拿不到就当注册表为空，磁盘扫描照常（不要因为服务还没就绪整页报错）
		const service = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills;
		if (service === undefined) throw new Error('技能服务还没就绪');
		const listed = await service.list({});
		for (const skill of listed) {
			const path = typeof skill.path === 'string' ? skill.path : null;
			const root = writableRootOf(path);
			byName.set(skill.name, {
				name: skill.name,
				description: skill.description ?? '',
				path,
				rootId: root?.id ?? null,
				rootLabel: root?.label ?? (skill.source ?? 'registry'),
				writable: root !== undefined,
				source: skill.source ?? skill.provider ?? 'registry',
			});
		}
	} catch (error) {
		// 注册表读不到也要能管理磁盘上的技能
		byName.set('__error__', { name: '__error__', description: String(error?.message ?? error), writable: false, error: true });
	}
	for (const root of SKILL_ROOTS) {
		for (const found of await scanRoot(root.dir)) {
			if (byName.has(found.name)) {
				const existing = byName.get(found.name);
				// 注册表里那条如果指向别处（比如 bundled 同名），磁盘这份也留一条，别丢
				if (existing.path !== found.path && existing.writable === false) {
					byName.set(`${found.name}@${root.id}`, { name: found.name, description: found.description, path: found.path, rootId: root.id, rootLabel: root.label, writable: true, source: root.label });
				}
				continue;
			}
			byName.set(found.name, { name: found.name, description: found.description, path: found.path, rootId: root.id, rootLabel: root.label, writable: true, source: root.label });
		}
	}
	const skills = [...byName.values()].filter((skill) => skill.error !== true);
	return { skills: skills.sort((left, right) => left.name.localeCompare(right.name)), roots: SKILL_ROOTS.map(({ id, dir, label }) => ({ id, dir, label })) };
}

/** 读一个技能的完整内容。 */
export async function readSkill(ctx, name) {
	const { skills } = await listSkills(ctx);
	const summary = skills.find((skill) => skill.name === name) ?? skills.find((skill) => skill.name.toLowerCase() === String(name ?? '').toLowerCase());
	if (summary === undefined) throw new Error(`找不到技能「${name}」`);
	if (typeof summary.path !== 'string') throw new Error(`技能「${name}」没有磁盘文件（可能是别的 provider 提供的），无法编辑`);
	const text = (await readIfExists(summary.path)) ?? '';
	const parsed = parseSkill(text);
	return { name: summary.name, description: parsed.front.description ?? summary.description ?? '', body: parsed.body, path: summary.path, writable: summary.writable === true, rootId: summary.rootId ?? null };
}

/** 新建或保存技能（默认写到 `~/.dsh/skills/<名字>/SKILL.md`）。 */
export async function saveSkill(ctx, input) {
	const name = toName(input?.name);
	if (!NAME_PATTERN.test(name)) throw new Error('名字只能用字母数字开头，允许 . _ -（≤64 字符）');
	const root = SKILL_ROOTS.find((item) => item.id === (input?.rootId ?? 'user-dsh')) ?? SKILL_ROOTS[0];
	let target;
	if (typeof input?.path === 'string' && input.path !== '') {
		if (writableRootOf(input.path) === undefined) throw new Error('只能改可写根目录（~/.dsh/skills、~/.agents/skills）里的技能');
		target = input.path;
	} else {
		const existing = (await listSkills(ctx)).skills.find((skill) => skill.name === input?.originalName || skill.name === name);
		target = existing?.path ?? join(root.dir, name, 'SKILL.md');
	}
	if (writableRootOf(target) === undefined) throw new Error(`目标不在可写根目录里：${target}`);
	const description = String(input?.description ?? '').trim();
	if (description === '') throw new Error('description 不能为空（技能靠它被模型选中）');
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, renderSkill(name, description, input?.body ?? ''), 'utf8');
	return { path: target, name };
}

/** 删技能（只删文件/目录本身，且必须在可写根里）。 */
export async function deleteSkill(ctx, name) {
	const { skills } = await listSkills(ctx);
	const summary = skills.find((skill) => skill.name === name);
	if (summary === undefined) throw new Error(`找不到技能「${name}」`);
	if (summary.writable !== true || typeof summary.path !== 'string') throw new Error(`技能「${name}」是只读的（${summary.rootLabel ?? summary.source}），不能删`);
	if (writableRootOf(summary.path) === undefined) throw new Error('只能删可写根目录里的技能');
	const flat = summary.path.endsWith('.md') && basename(dirname(summary.path)) !== summary.name;
	await rm(flat ? summary.path : dirname(summary.path), { recursive: true, force: true });
	return { removed: summary.path };
}

/**
 * 导入技能。两种来源：
 *   · url  —— http(s) 地址，抓正文（可以是 SKILL.md，也可以是一个技能目录里的单个 md）
 *   · path —— 本机路径：目录（整份复制）或 .md 文件
 */
export async function importSkill(ctx, input) {
	const root = SKILL_ROOTS.find((item) => item.id === (input?.rootId ?? 'user-dsh')) ?? SKILL_ROOTS[0];
	const url = typeof input?.url === 'string' ? input.url.trim() : '';
	const source = typeof input?.path === 'string' ? input.path.trim() : '';
	if (url === '' && source === '') throw new Error('要么给一个地址（http/https），要么给一个本机路径');

	if (url !== '') {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error('地址不是合法的 URL');
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http/https 地址');
		const response = await fetch(parsed.href, { redirect: 'follow' });
		if (response.status !== 200) throw new Error(`下载失败：HTTP ${response.status}`);
		const text = await response.text();
		if (text.trim() === '') throw new Error('抓到的是空内容');
		const parsedSkill = parseSkill(text);
		const fallback = basename(parsed.pathname).replace(/\.md$/u, '') || 'imported-skill';
		const name = toName(input?.name ?? parsedSkill.front.name ?? fallback, 'imported-skill');
		const description = String(input?.description ?? parsedSkill.front.description ?? '').trim() || `Imported from ${parsed.host}`;
		const target = join(root.dir, name, 'SKILL.md');
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, renderSkill(name, description, parsedSkill.body), 'utf8');
		return { name, path: target, from: parsed.href };
	}

	const absolute = isAbsolute(source) ? source : resolve(HOME, source.replace(/^~/u, ''));
	if (!(await isDirectory(absolute)) && (await readIfExists(absolute)) === undefined) throw new Error(`路径不存在：${absolute}`);
	if (await isDirectory(absolute)) {
		const name = toName(input?.name ?? basename(absolute));
		const target = join(root.dir, name);
		if (resolve(target) === resolve(absolute)) throw new Error(`来源和目标就是同一个目录：${target}`);
		if (await isDirectory(target)) throw new Error(`目标已存在：${target}（换个名字，或先删掉它）`);
		await mkdir(dirname(target), { recursive: true });
		await cp(absolute, target, { recursive: true, force: true });
		if ((await readIfExists(join(target, 'SKILL.md'))) === undefined) throw new Error('复制过来了，但目录里没有 SKILL.md —— 这不是一个技能目录');
		return { name, path: join(target, 'SKILL.md'), from: absolute };
	}
	const text = (await readIfExists(absolute)) ?? '';
	const parsedSkill = parseSkill(text);
	const name = toName(input?.name ?? parsedSkill.front.name ?? basename(absolute).replace(/\.md$/u, ''), 'imported-skill');
	const description = String(input?.description ?? parsedSkill.front.description ?? '').trim() || `Imported from ${basename(absolute)}`;
	const target = join(root.dir, name, 'SKILL.md');
	if ((await readIfExists(target)) !== undefined) throw new Error(`已存在同名技能「${name}」（换个名字，或先删掉它）`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, renderSkill(name, description, parsedSkill.body), 'utf8');
	return { name, path: target, from: absolute };
}

// ---------------------------------------------------------------------------
// MCP：清单 + 运行时挂载
// ---------------------------------------------------------------------------

/** MCP 客户端模块的绝对路径兜底（从运行中的 app 路径推）。 */
function mcpAbsoluteEntry() {
	const segments = (process.execPath ?? '').split('/');
	const index = segments.findIndex((segment) => segment.endsWith('.app'));
	if (index <= 0) return undefined;
	const app = segments.slice(0, index + 1).join('/');
	return `${app}/Contents/Resources/app/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js`;
}

let mcpModule;
/** 加载 `@deepseek-ai/dsh-mcp-client`：先按包名，再按几个绝对路径兜底。 */
async function importMcpClient() {
	if (mcpModule !== undefined) return mcpModule;
	const candidates = [
		'@deepseek-ai/dsh-mcp-client',
		typeof process.env.DSH_MCP_CLIENT_ENTRY === 'string' && process.env.DSH_MCP_CLIENT_ENTRY !== '' ? process.env.DSH_MCP_CLIENT_ENTRY : undefined,
		mcpAbsoluteEntry(),
		'/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js',
	];
	const failures = [];
	for (const specifier of candidates) {
		if (typeof specifier !== 'string' || specifier === '') continue;
		try {
			mcpModule = await import(specifier);
			return mcpModule;
		} catch (error) {
			failures.push(`${specifier} → ${error?.message ?? error}`);
		}
	}
	throw new Error(`加载不了 @deepseek-ai/dsh-mcp-client：${failures.join('；')}`);
}

/** 把一条服务器记录变成 mcp-client 的 Config。 */
export function mcpConfigOf(server) {
	const name = toName(server?.name).replace(/[^a-z0-9-]/gu, '-').slice(0, 32) || 'server';
	if (!MCP_NAME_PATTERN.test(name)) throw new Error('服务器名只能是字母数字和短横线（≤32 字符）');
	if (server?.transport === 'stdio') {
		const command = String(server.command ?? '').trim();
		if (command === '') throw new Error('stdio 模式必须给 command');
		const args = Array.isArray(server.args) ? server.args.map((item) => String(item)) : String(server.args ?? '').split(/\s+/u).filter((item) => item !== '');
		const env = server.env !== undefined && server.env !== null && typeof server.env === 'object' && !Array.isArray(server.env) ? Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, String(v)])) : {};
		return { transport: 'stdio', serverName: name, command, args, env, cwd: typeof server.cwd === 'string' ? server.cwd : '', failOnStartupError: false };
	}
	const url = String(server?.url ?? '').trim();
	if (url === '') throw new Error('streamable-http 模式必须给 url');
	const headers = server.headers !== undefined && server.headers !== null && typeof server.headers === 'object' && !Array.isArray(server.headers) ? Object.fromEntries(Object.entries(server.headers).map(([k, v]) => [k, String(v)])) : {};
	return { transport: 'streamable-http', serverName: name, url, headers, failOnStartupError: false };
}

/** MCP 服务器清单 + 运行时挂载。 */
export class McpManager {
	constructor(ctx, log = () => {}) {
		this.ctx = ctx;
		this.log = log;
		this.servers = [];
		this.mounted = new Map();
	}

	/** 读清单（没有就空着）。 */
	async load() {
		const text = await readIfExists(MCP_STORE);
		if (text === undefined) {
			this.servers = [];
			return this.servers;
		}
		try {
			const parsed = JSON.parse(text);
			this.servers = Array.isArray(parsed?.servers) ? parsed.servers.filter((item) => item !== null && typeof item === 'object') : [];
		} catch {
			this.servers = [];
		}
		return this.servers;
	}

	async persist() {
		await mkdir(dirname(MCP_STORE), { recursive: true });
		await writeFile(MCP_STORE, `${JSON.stringify({ version: 1, servers: this.servers }, null, 2)}\n`, { mode: 0o600 });
	}

	/** 挂载一个服务器（已挂过就跳过）。 */
	async mount(server) {
		if (this.mounted.has(server.id)) return this.mounted.get(server.id);
		const module_ = await importMcpClient();
		const config = mcpConfigOf(server);
		const scope = this.ctx.plugin(module_, config);
		const record = { scope, config };
		this.mounted.set(server.id, record);
		this.log(`dsh-update-vd: MCP「${server.name}」已挂载（${config.transport}）`);
		return record;
	}

	/** 卸载一个服务器。 */
	unmount(id) {
		const record = this.mounted.get(id);
		if (record === undefined) return;
		this.mounted.delete(id);
		try {
			record.scope?.dispose?.();
		} catch (error) {
			this.log(`dsh-update-vd: MCP 卸载失败：${error?.message ?? error}`);
		}
	}

	/** 按清单重建全部挂载（加/改/删之后调用；逐个隔离，坏的只影响自己）。 */
	async applyAll() {
		const wanted = new Set(this.servers.filter((server) => server.enabled !== false).map((server) => server.id));
		for (const id of [...this.mounted.keys()]) if (!wanted.has(id)) this.unmount(id);
		const results = [];
		for (const server of this.servers) {
			if (server.enabled === false) continue;
			try {
				if (this.mounted.has(server.id)) this.unmount(server.id);
				await this.mount(server);
				results.push({ id: server.id, name: server.name, ok: true });
			} catch (error) {
				results.push({ id: server.id, name: server.name, ok: false, error: String(error?.message ?? error) });
			}
		}
		return results;
	}

	/** 对外展示的清单（不含 scope）。 */
	list() {
		return this.servers.map((server) => ({
			id: server.id,
			name: server.name,
			transport: server.transport === 'stdio' ? 'stdio' : 'streamable-http',
			url: server.url ?? '',
			command: server.command ?? '',
			args: Array.isArray(server.args) ? server.args.join(' ') : String(server.args ?? ''),
			headers: server.headers ?? {},
			env: server.env ?? {},
			cwd: server.cwd ?? '',
			enabled: server.enabled !== false,
			mounted: this.mounted.has(server.id),
		}));
	}

	/** 新增或修改一条。 */
	async save(input) {
		const id = typeof input?.id === 'string' && input.id !== '' ? input.id : `mcp-${Date.now().toString(36)}`;
		const name = toName(input?.name);
		if (name === '') throw new Error('要给服务器起个名字（会变成 mcp__<名字>__<工具>）');
		const record = {
			id,
			name,
			transport: input?.transport === 'stdio' ? 'stdio' : 'streamable-http',
			url: String(input?.url ?? '').trim(),
			command: String(input?.command ?? '').trim(),
			args: typeof input?.args === 'string' ? input.args.split(/\s+/u).filter((item) => item !== '') : Array.isArray(input?.args) ? input.args : [],
			headers: input?.headers ?? {},
			env: input?.env ?? {},
			cwd: String(input?.cwd ?? '').trim(),
			enabled: input?.enabled !== false,
		};
		mcpConfigOf(record); // 先校验，坏配置不落盘
		const index = this.servers.findIndex((server) => server.id === id);
		if (index >= 0) this.servers[index] = record;
		else {
			if (this.servers.some((server) => server.name === name)) throw new Error(`已经有叫「${name}」的服务器了`);
			this.servers.push(record);
		}
		await this.persist();
		const results = await this.applyAll();
		return { servers: this.list(), results };
	}

	/** 删除一条。 */
	async remove(id) {
		const index = this.servers.findIndex((server) => server.id === id);
		if (index < 0) throw new Error('找不到这个服务器');
		this.unmount(id);
		this.servers.splice(index, 1);
		await this.persist();
		return { servers: this.list(), results: await this.applyAll() };
	}

	/** 启用 / 停用。 */
	async toggle(id, enabled) {
		const server = this.servers.find((item) => item.id === id);
		if (server === undefined) throw new Error('找不到这个服务器');
		server.enabled = enabled !== false;
		await this.persist();
		return { servers: this.list(), results: await this.applyAll() };
	}

	/** 关掉所有挂载（插件卸载时）。 */
	disposeAll() {
		for (const id of [...this.mounted.keys()]) this.unmount(id);
	}
}

export const MCP_STORE_PATH = MCP_STORE;

// ---------------------------------------------------------------------------
// 在线搜索：多个可选的源地址
// ---------------------------------------------------------------------------

/**
 * 搜索源清单（界面上「源」下拉里能选的）。每一条都是一个**地址**：
 *   · kind:'github'   → owner/repo，按 git tree 找 SKILL.md
 *   · kind:'registry' → MCP 官方注册表（一个 URL）
 *   · kind:'custom'   → 让用户自己填地址
 */
export const SEARCH_SOURCES = {
	skills: [
		{ id: 'anthropics-skills', label: 'Anthropic 官方技能库', kind: 'github', repo: 'anthropics/skills', hint: 'anthropics/skills · 官方示例技能' },
		{ id: 'superpowers', label: 'obra/superpowers', kind: 'github', repo: 'obra/superpowers', hint: 'obra/superpowers · 社区技能合集' },
		{ id: 'custom', label: '自定义地址…', kind: 'custom', hint: '填 owner/repo 或完整 https://github.com/owner/repo' },
	],
	mcp: [
		{ id: 'mcp-registry', label: 'MCP 官方注册表', kind: 'registry', url: 'https://registry.modelcontextprotocol.io/v0/servers', hint: 'registry.modelcontextprotocol.io · 上千个服务器，带远程 URL' },
		{ id: 'mcp-servers', label: 'modelcontextprotocol/servers', kind: 'github', repo: 'modelcontextprotocol/servers', prefix: '@modelcontextprotocol/server-', hint: '官方参考实现（stdio，npx -y）' },
		{ id: 'custom', label: '自定义地址…', kind: 'custom', hint: '注册表 URL，或 owner/repo' },
	],
};

const CUSTOM_SOURCES_FILE = join(DSH_HOME, 'skill-sources.json');

/** 读用户自己加的地址（两个模块各一份）。 */
async function readCustomSources() {
	const text = await readIfExists(CUSTOM_SOURCES_FILE);
	if (text === undefined) return { skills: [], mcp: [] };
	try {
		const parsed = JSON.parse(text);
		return { skills: Array.isArray(parsed.skills) ? parsed.skills : [], mcp: Array.isArray(parsed.mcp) ? parsed.mcp : [] };
	} catch {
		return { skills: [], mcp: [] };
	}
}

/** 预设 + 用户自己加的，合成下拉里能选的完整清单。 */
export async function listSources() {
	const custom = await readCustomSources();
	return {
		skills: [...SEARCH_SOURCES.skills.filter((item) => item.kind !== 'custom'), ...custom.skills],
		mcp: [...SEARCH_SOURCES.mcp.filter((item) => item.kind !== 'custom'), ...custom.mcp],
	};
}

/** 把一个地址加进清单（GitHub 仓库或注册表 URL），下次就能直接选。 */
export async function addSource(input) {
	const kind = input?.kind === 'mcp' ? 'mcp' : 'skills';
	const address = String(input?.address ?? '').trim();
	if (address === '') throw new Error('地址是空的');
	const custom = await readCustomSources();
	let entry;
	if (kind === 'mcp' && /^https?:\/\//u.test(address) && !/github\.com/u.test(address)) {
		const url = address.replace(/\/+$/u, '');
		entry = { id: `url-${Buffer.from(url).toString('base64url').slice(0, 16)}`, label: input?.label?.trim() || new URL(url).host, kind: 'registry', url, hint: url };
	} else {
		const { repo } = parseGithubTarget(address);
		entry = { id: `gh-${repo.replace(/[^\w.-]/gu, '-')}`, label: input?.label?.trim() || repo, kind: 'github', repo, hint: repo };
	}
	// 按「地址本身」去重：同一仓库/同一 URL 换个显示名也不许重复加
	const existing = (await listSources())[kind] ?? [];
	const same = (item) => (entry.repo !== undefined && item.repo === entry.repo) || (entry.url !== undefined && item.url === entry.url);
	const clash = existing.find(same);
	if (clash !== undefined) throw new Error(`这个地址已经在清单里了：${clash.label}`);
	custom[kind] = [...custom[kind], entry];
	await mkdir(dirname(CUSTOM_SOURCES_FILE), { recursive: true });
	await writeFile(CUSTOM_SOURCES_FILE, `${JSON.stringify(custom, null, 2)}\n`, 'utf8');
	return { entry, sources: await listSources() };
}

/** 删掉一个自己加的地址（预设的删不掉）。 */
export async function removeSource(input) {
	const kind = input?.kind === 'mcp' ? 'mcp' : 'skills';
	const custom = await readCustomSources();
	const before = custom[kind].length;
	custom[kind] = custom[kind].filter((item) => item.id !== input?.id);
	if (custom[kind].length === before) throw new Error('没找到这个地址（预设源不能删）');
	await writeFile(CUSTOM_SOURCES_FILE, `${JSON.stringify(custom, null, 2)}\n`, 'utf8');
	return { sources: await listSources() };
}

/** 带 UA 的 JSON 请求（GitHub 与注册表都要求/偏好有 UA）。 */
async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		redirect: 'follow',
		headers: { accept: 'application/json', 'user-agent': 'dsh-update-vd' },
		...options,
	});
	if (response.status !== 200) throw new Error(`${url} → HTTP ${response.status}`);
	return response.json();
}

/** owner/repo 或 github 链接 → {repo, branch?}。 */
function parseGithubTarget(text) {
	const value = String(text ?? '').trim();
	const match = /(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#]|$)/u.exec(value.replace(/^https?:\/\//u, ''));
	if (match === null) throw new Error(`认不出这个 GitHub 地址：${value}（写成 owner/repo 或 https://github.com/owner/repo）`);
	return { repo: `${match[1]}/${match[2]}` };
}

const TREE_CACHE = new Map();
/** 拉一个仓库的 git tree，挑出 SKILL.md（带 10 分钟缓存，别把 GitHub 配额烧了）。 */
async function githubSkillList(repo) {
	const cached = TREE_CACHE.get(repo);
	if (cached !== undefined && Date.now() - cached.at < 10 * 60 * 1000) return cached;
	const info = await fetchJson(`https://api.github.com/repos/${repo}`);
	const branch = info.default_branch ?? 'main';
	const tree = await fetchJson(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
	const paths = (tree.tree ?? [])
		.filter((item) => item.type === 'blob' && /(^|\/)SKILL\.md$/iu.test(item.path))
		.map((item) => item.path);
	const value = { at: Date.now(), branch, paths, stars: info.stargazers_count ?? 0 };
	TREE_CACHE.set(repo, value);
	return value;
}

/** 抓一个 SKILL.md 的 description（失败就算了，不挡住搜索结果）。 */
async function rawDescription(url) {
	try {
		const response = await fetch(url, { redirect: 'follow' });
		if (response.status !== 200) return '';
		const parsed = parseSkill(await response.text());
		return parsed.front.description ?? '';
	} catch {
		return '';
	}
}

/** 解析「源」参数，返回 {kind, ...}。 */
async function resolveSourceAsync(kind, sourceId, custom) {
	const list = (await listSources())[kind] ?? [];
	const source = list.find((item) => item.id === sourceId) ?? list[0];
	if (source === undefined) throw new Error('没有可用的搜索源');
	const text = String(custom ?? '').trim();
	if (text === '') return source;               // 没填临时地址就用选中的那个
	if (kind === 'mcp' && /^https?:\/\//u.test(text) && !/github\.com/u.test(text)) return { id: 'temp', label: text, kind: 'registry', url: text };
	const parsed = parseGithubTarget(text);
	return { ...parsed, id: 'temp', label: parsed.repo, kind: 'github' };
}

/**
 * 在线搜技能：从选中的源（GitHub 仓库）里找出匹配 query 的 SKILL.md。
 * @returns {{source: object, results: Array}} results 每项带可直接导入的 raw url。
 */
export async function searchSkills(input) {
	const source = await resolveSourceAsync('skills', input?.sourceId, input?.custom);
	const query = String(input?.query ?? '').trim().toLowerCase();
	const limit = Math.min(Math.max(Number(input?.limit) || 24, 1), 60);
	const { branch, paths, stars } = await githubSkillList(source.repo);
	const matched = paths
		.filter((path) => query === '' || path.toLowerCase().includes(query))
		.slice(0, limit)
		.map((path) => {
			const segments = path.split('/');
			const folder = segments.length >= 2 ? segments[segments.length - 2] : segments[0].replace(/\.md$/iu, '');
			const file = segments[segments.length - 1];
			return {
				name: folder === file ? folder.replace(/\.md$/iu, '') : folder,
				path,
				url: `https://raw.githubusercontent.com/${source.repo}/${branch}/${path}`,
				page: `https://github.com/${source.repo}/blob/${branch}/${path}`,
			};
		});
	// 给前 10 条补 description（并行抓 raw，够界面看了）
	const withDescriptions = await Promise.all(
		matched.map(async (item, index) => (index < 10 ? { ...item, description: await rawDescription(item.url) } : { ...item, description: '' })),
	);
	return { source: { ...source, branch, stars, total: paths.length }, results: withDescriptions };
}

/** 官方注册表条目 → 我们这份 MCP 记录。 */
function mcpFromRegistry(entry) {
	const server = entry?.server ?? entry ?? {};
	const last = String(server.name ?? '').split('/').pop();
	const name = last.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 32);
	const remote = (server.remotes ?? [])[0];
	const pkg = (server.packages ?? [])[0];
	const description = String(server.description ?? '').slice(0, 300);
	if (remote !== undefined && typeof remote.url === 'string' && remote.url !== '') return { name, description, transport: 'streamable-http', url: remote.url, headers: {} };
	if (pkg !== undefined && typeof pkg.identifier === 'string') {
		const runtime = typeof pkg.runtimeHint === 'string' && pkg.runtimeHint !== '' ? pkg.runtimeHint : pkg.registryType === 'pypi' ? 'uvx' : 'npx';
		const args = [...(pkg.runtimeArguments ?? []).map((item) => item?.value), ...(pkg.packageArguments ?? []).map((item) => item?.value), pkg.identifier].filter((item) => typeof item === 'string' && item !== '');
		return { name, description, transport: 'stdio', command: runtime, args, env: {} };
	}
	return null;
}

/** 在线搜 MCP 服务器：注册表（按关键字）或 GitHub 仓库（列目录）。 */
export async function searchMcp(input) {
	const source = await resolveSourceAsync('mcp', input?.sourceId, input?.custom);
	const query = String(input?.query ?? '').trim();
	const limit = Math.min(Math.max(Number(input?.limit) || 20, 1), 50);

	if (source.kind === 'registry') {
		const url = `${source.url}${source.url.includes('?') ? '&' : '?'}search=${encodeURIComponent(query)}&limit=${String(limit)}`;
		const data = await fetchJson(url);
		const byName = new Map();
		for (const entry of data.servers ?? []) {
			const mapped = mcpFromRegistry(entry);
			if (mapped === null || mapped.name === '') continue;
			if (!byName.has(mapped.name)) byName.set(mapped.name, mapped);
		}
		return { source, results: [...byName.values()] };
	}

	const info = await fetchJson(`https://api.github.com/repos/${source.repo}`);
	const branch = info.default_branch ?? 'main';
	const listing = await fetchJson(`https://api.github.com/repos/${source.repo}/contents/src?ref=${encodeURIComponent(branch)}`);
	const prefix = typeof source.prefix === 'string' ? source.prefix : '';
	const results = (Array.isArray(listing) ? listing : [])
		.filter((item) => item.type === 'dir')
		.map((item) => ({
			name: item.name.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').slice(0, 32),
			description: `${source.repo} 的参考实现（stdio）`,
			transport: 'stdio',
			command: 'npx',
			args: ['-y', `${prefix}${item.name}`],
			env: {},
		}))
		.filter((item) => query === '' || `${item.name} ${item.args.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
		.slice(0, limit);
	return { source: { ...source, branch }, results };
}

// ---------------------------------------------------------------------------
// 从本机其它 AI 工具导入（Codex / Claude Code / Cursor / Windsurf / Gemini / OpenCode / Continue）
// ---------------------------------------------------------------------------

/** 这些工具把技能放在哪（都是 SKILL.md 目录式）。 */
export const LOCAL_SKILL_DIRS = [
	{ id: 'codex', label: 'Codex CLI', dir: join(HOME, '.codex', 'skills') },
	{ id: 'claude', label: 'Claude Code', dir: join(HOME, '.claude', 'skills') },
	{ id: 'agents', label: '通用 .agents', dir: join(HOME, '.agents', 'skills') },
];

/** 这些工具的 MCP 配置在哪。 */
export const LOCAL_MCP_FILES = [
	{ id: 'codex', label: 'Codex CLI', kind: 'codex-toml', path: join(HOME, '.codex', 'config.toml') },
	{ id: 'claude', label: 'Claude Code', kind: 'json', key: 'mcpServers', path: join(HOME, '.claude.json') },
	{ id: 'cursor', label: 'Cursor', kind: 'json', key: 'mcpServers', path: join(HOME, '.cursor', 'mcp.json') },
	{ id: 'windsurf', label: 'Windsurf', kind: 'json', key: 'mcpServers', path: join(HOME, '.windsurf', 'mcp.json') },
	{ id: 'gemini', label: 'Gemini CLI', kind: 'json', key: 'mcpServers', path: join(HOME, '.gemini', 'settings.json') },
	{ id: 'opencode', label: 'OpenCode', kind: 'json', key: 'mcp', path: join(HOME, '.config', 'opencode', 'opencode.json') },
	{ id: 'continue', label: 'Continue', kind: 'json', key: 'mcpServers', path: join(HOME, '.continue', 'config.json') },
];

function unquote(text) {
	return String(text ?? '').trim().replace(/^"(.*)"$/u, '$1').replace(/^'(.*)'$/u, '$1');
}

/** 极简 TOML 值解析：只支持这个场景用得到的字符串 / 字符串数组 / 布尔 / 内联表。 */
function parseTomlValue(raw) {
	const text = String(raw ?? '').trim();
	if (text.startsWith('[')) {
		const inner = text.replace(/^\[/u, '').replace(/\]$/u, '').trim();
		if (inner === '') return [];
		return inner.split(',').map((item) => unquote(item)).filter((item) => item !== '');
	}
	if (text.startsWith('{')) return {};
	if (text === 'true') return true;
	if (text === 'false') return false;
	return unquote(text);
}

/** 读 Codex 的 config.toml，取 [mcp_servers.X] 与 [mcp_servers.X.env]。 */
export function parseCodexServers(text) {
	const servers = new Map();
	let current = null;
	for (const raw of String(text ?? '').split(/\r?\n/u)) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) continue;
		const table = /^\[([^\]]+)\]$/u.exec(line);
		if (table !== null) {
			const parts = table[1].split('.').map((item) => unquote(item));
			if (parts[0] !== 'mcp_servers' || parts[1] === undefined || parts[1] === '') {
				current = null;
				continue;
			}
			if (!servers.has(parts[1])) servers.set(parts[1], { name: parts[1], command: '', args: [], env: {}, cwd: '', url: '', enabled: true });
			current = { name: parts[1], env: parts[2] === 'env' };
			continue;
		}
		if (current === null) continue;
		const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/u.exec(line);
		if (pair === null) continue;
		const server = servers.get(current.name);
		const value = parseTomlValue(pair[2]);
		if (current.env) {
			server.env[pair[1]] = String(value);
			continue;
		}
		if (pair[1] === 'command') server.command = String(value);
		else if (pair[1] === 'args') server.args = Array.isArray(value) ? value.map(String) : [];
		else if (pair[1] === 'cwd') server.cwd = String(value);
		else if (pair[1] === 'url') server.url = String(value);
		else if (pair[1] === 'enabled') server.enabled = value !== false;
	}
	return [...servers.values()];
}

/** 各种 JSON 配置里的一个条目 → 我们的服务器记录（形状不一，尽量都认）。 */
function mcpFromForeign(name, config) {
	const record = { name: String(name).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 32), command: '', args: [], env: {}, cwd: '', url: '', enabled: true };
	if (typeof config?.url === 'string' && config.url !== '') {
		return { ...record, transport: 'streamable-http', url: config.url, headers: config.headers !== undefined && typeof config.headers === 'object' && !Array.isArray(config.headers) ? config.headers : {} };
	}
	const command = Array.isArray(config?.command) ? config.command[0] : config?.command;
	const rest = Array.isArray(config?.command) ? config.command.slice(1) : [];
	const args = Array.isArray(config?.args) ? config.args.map(String) : [];
	return {
		...record,
		transport: 'stdio',
		command: typeof command === 'string' ? command : '',
		args: [...rest.map(String), ...args],
		env: config?.env !== undefined && typeof config.env === 'object' && !Array.isArray(config.env) ? Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, String(value)])) : {},
		cwd: typeof config?.cwd === 'string' ? config.cwd : '',
		enabled: config?.enabled !== false && config?.disabled !== true,
	};
}

/**
 * 扫本机：能从别的 AI 工具里导什么。
 * @returns {{skills: Array, mcp: Array}} 每项带 tool（来源工具）与 already（同名已有）。
 */
export async function detectLocalImports(ctx) {
	const installed = new Set(((await listSkills(ctx)).skills ?? []).map((skill) => skill.name.toLowerCase()));
	const skills = [];
	for (const source of LOCAL_SKILL_DIRS) {
		for (const found of await scanRoot(source.dir)) {
			skills.push({
				name: found.name,
				description: found.description,
				path: found.dir ?? found.path,
				file: found.path,
				tool: source.label,
				toolId: source.id,
				already: installed.has(found.name.toLowerCase()),
			});
		}
	}
	const mcp = [];
	for (const source of LOCAL_MCP_FILES) {
		const text = await readIfExists(source.path);
		if (text === undefined || text.trim() === '') continue;
		let servers = [];
		if (source.kind === 'codex-toml') servers = parseCodexServers(text);
		else {
			try {
				const parsed = JSON.parse(text);
				const table = parsed?.[source.key];
				if (table !== null && typeof table === 'object' && !Array.isArray(table)) servers = Object.entries(table).map(([name, config]) => ({ raw: mcpFromForeign(name, config), config }));
			} catch {
				continue;
			}
			servers = servers.map((item) => ({ ...item.raw, enabled: item.raw.enabled !== false }));
		}
		for (const server of servers) {
			const mapped = source.kind === 'codex-toml' ? (server.url !== '' ? { name: server.name, transport: 'streamable-http', url: server.url, headers: {}, enabled: server.enabled !== false } : { name: server.name, transport: 'stdio', command: server.command, args: server.args, env: server.env, cwd: server.cwd, enabled: server.enabled !== false }) : server;
			if (mapped.name === '' || (mapped.transport === 'stdio' && mapped.command === '') || (mapped.transport === 'streamable-http' && mapped.url === '')) continue;
			mcp.push({ ...mapped, tool: source.label, toolId: source.id, configPath: source.path });
		}
	}
	return { skills: skills.sort((a, b) => a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name)), mcp: mcp.sort((a, b) => a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name)) };
}

/** 真导入一批：技能按目录复制，MCP 写进清单并挂载。 */
export async function applyLocalImports(ctx, mcpManager, input) {
	const skills = [];
	for (const item of input?.skills ?? []) {
		try {
			const result = await importSkill(ctx, { path: item.path, rootId: 'user-dsh' });
			skills.push({ name: item.name, ok: true, target: result.path });
		} catch (error) {
			skills.push({ name: item.name, ok: false, error: String(error?.message ?? error) });
		}
	}
	const mcp = [];
	for (const item of input?.mcp ?? []) {
		try {
			if (mcpManager.servers.some((server) => server.name === item.name)) {
				mcp.push({ name: item.name, ok: false, error: '已经有同名的 MCP 服务器（先删掉或改名）' });
				continue;
			}
			const saved = await mcpManager.save({ name: item.name, transport: item.transport, url: item.url, command: item.command, args: item.args, env: item.env, cwd: item.cwd, enabled: item.enabled !== false });
			const failure = (saved?.results ?? []).find((result) => result.ok !== true && result.name === item.name);
			mcp.push(failure === undefined ? { name: item.name, ok: true, connected: true } : { name: item.name, ok: true, connected: false, error: failure.error });
		} catch (error) {
			mcp.push({ name: item.name, ok: false, error: String(error?.message ?? error) });
		}
	}
	return { skills, mcp, servers: mcpManager.list() };
}
