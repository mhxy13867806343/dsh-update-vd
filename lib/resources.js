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

/** 解析 SKILL.md：frontmatter（只认 `key: value`）+ 正文。 */
export function parseSkill(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(String(text ?? ''));
	const front = {};
	let body = String(text ?? '');
	if (match !== null) {
		body = body.slice(match[0].length);
		for (const line of match[1].split(/\r?\n/gu)) {
			const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/u.exec(line);
			if (pair !== null) front[pair[1]] = pair[2].trim().replace(/^'(.*)'$/u, '$1').replace(/^"(.*)"$/u, '$1').replace(/''/gu, "'");
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
		const listed = await ctx.skills.list({});
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
/** 加载 `@deepseek-ai/dsh-mcp-client`（先按包名，失败再按绝对路径）。 */
async function importMcpClient() {
	if (mcpModule !== undefined) return mcpModule;
	const failures = [];
	for (const specifier of ['@deepseek-ai/dsh-mcp-client', mcpAbsoluteEntry()]) {
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
