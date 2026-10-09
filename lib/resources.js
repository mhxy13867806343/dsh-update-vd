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

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 *   · kind:'local'    → 本机磁盘上的目录（智能体预设用：随包发布的那几个）
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
	// 智能体预设的源。地址都实测过（curl 通、且文件里真的有 @deepseek-ai/dsh-agent-preset 声明）。
	agents: [
		{ id: 'local-shipped', label: '本机自带预设', kind: 'local', hint: 'DSH 随包发布的 presets/*.patch.yml（离线可用；取用＝复制一份成自定义）' },
		{ id: 'upstream-harness', label: 'deepseek-ai/deepseek-harness', kind: 'github', repo: 'deepseek-ai/deepseek-harness', hint: '上游官方预设集合（standard / ptc / minimal / cordis）' },
		{ id: 'mobile-use', label: 'AcidGr/dsh-preset-mobile-use', kind: 'github', repo: 'AcidGr/dsh-preset-mobile-use', hint: '第三方预设：手机自动化 Agent（第三方代码，装前想清楚）' },
		{ id: 'custom', label: '自定义地址…', kind: 'custom', hint: 'owner/repo，或一个 .patch.yml / .yml 的完整 https 地址' },
	],
};

const CUSTOM_SOURCES_FILE = join(DSH_HOME, 'skill-sources.json');

/** 归一化源类别：只认这三个，其余一律当技能（保持老行为不变）。 */
export function sourceKind(input) {
	const value = input?.kind;
	return value === 'mcp' || value === 'agents' ? value : 'skills';
}

/** 读用户自己加的地址（三个模块各一份）。 */
async function readCustomSources() {
	const text = await readIfExists(CUSTOM_SOURCES_FILE);
	if (text === undefined) return { skills: [], mcp: [], agents: [] };
	try {
		const parsed = JSON.parse(text);
		return {
			skills: Array.isArray(parsed.skills) ? parsed.skills : [],
			mcp: Array.isArray(parsed.mcp) ? parsed.mcp : [],
			agents: Array.isArray(parsed.agents) ? parsed.agents : [],
		};
	} catch {
		return { skills: [], mcp: [], agents: [] };
	}
}

/** 预设 + 用户自己加的，合成下拉里能选的完整清单。 */
export async function listSources() {
	const custom = await readCustomSources();
	const builtIn = (kind) => (SEARCH_SOURCES[kind] ?? []).filter((item) => item.kind !== 'custom');
	return {
		skills: [...builtIn('skills'), ...custom.skills],
		mcp: [...builtIn('mcp'), ...custom.mcp],
		agents: [...builtIn('agents'), ...custom.agents],
	};
}

/** 把一个地址加进清单（GitHub 仓库、注册表 URL，或智能体预设的单个 .yml 地址）。 */
export async function addSource(input) {
	const kind = sourceKind(input);
	const address = String(input?.address ?? '').trim();
	if (address === '') throw new Error('地址是空的');
	const custom = await readCustomSources();
	let entry;
	if (kind === 'agents' && /^https?:\/\//u.test(address) && !/github\.com/u.test(address)) {
		// 预设源允许直接给一个 .patch.yml / .yml 的完整地址
		const url = address.replace(/\/+$/u, '');
		entry = { id: `url-${Buffer.from(url).toString('base64url').slice(0, 16)}`, label: input?.label?.trim() || new URL(url).host, kind: 'url', url, hint: url };
	} else if (kind === 'mcp' && /^https?:\/\//u.test(address) && !/github\.com/u.test(address)) {
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
	const kind = sourceKind(input);
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

// ---------------------------------------------------------------------------
// 智能体预设（Agent preset）
// ---------------------------------------------------------------------------
//
// ── DSH 里的「智能体 / 预设」到底是什么 ────────────────────────────────
// 一个预设 = 一行 `@deepseek-ai/dsh-agent-preset` 插件声明：
//
//   - id: preset-review                    # Loader 行的 id（约定 preset-<id>）
//     name: '@deepseek-ai/dsh-agent-preset'
//     config:
//       id: review                         # 预设标识（唯一）
//       name: Review                       # 可选，列表里显示的名字
//       description: ...                   # 可选，列表里的简介
//       order: 10                          # 可选，列表排序
//       plugins: [ …一串插件行… ]           # 必需，这就是「预设正文」
//
// 它由 `@deepseek-ai/dsh-agent-preset` 插件在激活时交给 `agentPresets` 服务
// （`ctx.agentPresets.register(config)`），随包发布的四个（standard / ptc /
// minimal / cordis）就是 `@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`。
//
// ── 本插件怎么加/改/删 ────────────────────────────────────────────────
// 不碰 profile 的 patch 文件（那是 DSH 自己的地盘），而是学 McpManager 的做法：
// 把自己的记录存 `~/.dsh/agent-presets.json`，运行时用 `ctx.plugin(模块, config)`
// **动态挂载**同一行声明 —— 于是注册表里立刻多出一个预设，无需重启。
// 卸载就是 dispose 那个 scope，`agentPresets` 那边会自动注销。
//
// 正文（plugins 清单）用 DSH 自己的 YAML 方言解析：`js-yaml` + `entryListSchema`
// （`@deepseek-ai/cordis-plugin-include` 导出，支持 `!!js` 表达式），跟真正的
// patch 文件走的是同一套 schema，所以 `!!js`、`disable`、分组都原样保留。

/** 本插件自己管的预设记录（只存我们加的，不动随包的）。 */
const AGENT_STORE = join(DSH_HOME, 'agent-presets.json');
/** 预设标识：小写字母数字开头，允许数字与短横线。 */
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/u;
/** 声明预设的插件包名。 */
const AGENT_PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset';
/** persona 插件包名（正文只写一段系统提示词时，用它包一层）。 */
const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona';
/** 随包发布预设的那个 bundle。 */
const SHIPPED_BUNDLE = '@deepseek-ai/dsh-web-app';
/** 我们导出文件的类型标记（导入时认它）。 */
const AGENT_EXPORT_KIND = 'dsh-update-vd/agent-presets';

/**
 * DSH 自己没给随包预设写简介，界面上就一片「（没有简介）」。
 * 这四个是官方预设，这里补一句人话（只是显示用，不写回任何存储）。
 */
export const KNOWN_PRESET_NOTES = {
	standard: '标准模式：完整任务工具（bash / 文件 / 任务 / 技能 / 目标 / 委派 / 待办 / 网页…）。',
	ptc: '标准模式 + 工具展示（PTC）：按需把工具 schema 交给模型，工具多的时候更省。',
	minimal: '最小模式：只有 persona 与一个持久 shell，最省 token。',
	cordis: '创造模式：标准工具 + Cordis 插件开发指引 + 运行时检查，用来写插件和预设。',
};

// -- 模块加载（跟 MCP 那边同一个套路：先按包名，再按 app 里的绝对路径）-------

/** 从 execPath 推当前 DSH Desktop 的 .app 路径。 */
function appRootDir() {
	const segments = (process.execPath ?? '').split('/');
	const index = segments.findIndex((segment) => segment.endsWith('.app'));
	if (index > 0) return segments.slice(0, index + 1).join('/');
	const fallback = '/Applications/DSH Desktop.app';
	return existsSync(fallback) ? fallback : undefined;
}

/** 用 app 自己的 package.json 做基准去 require.resolve（桌面版唯一可靠的办法）。 */
function appResolve(specifier) {
	const root = appRootDir();
	const bases = [];
	if (root !== undefined) bases.push(join(root, 'Contents', 'Resources', 'app', 'package.json'));
	if (typeof process.env.DSH_APP_ROOT === 'string' && process.env.DSH_APP_ROOT !== '') bases.push(join(process.env.DSH_APP_ROOT, 'package.json'));
	for (const base of bases) {
		try {
			return createRequire(base).resolve(specifier);
		} catch {}
	}
	// 最后再按「插件自己的 node_modules 链」试一次（仓库里装了依赖时走这条）
	try {
		return createRequire(import.meta.url).resolve(specifier);
	} catch {
		return undefined;
	}
}

/** 加载一个只装在 DSH 里的包（打包版里插件自己的 node_modules 是空的）。 */
async function loadAppModule(specifier) {
	const failures = [];
	const candidates = [];
	const resolved = appResolve(specifier);
	if (resolved !== undefined) candidates.push(pathToFileURL(resolved).href);
	candidates.push(specifier);
	const root = appRootDir();
	if (root !== undefined && !specifier.startsWith('.') && !specifier.startsWith('/')) {
		candidates.push(pathToFileURL(join(root, 'Contents', 'Resources', 'app', 'node_modules', specifier)).href);
	}
	for (const candidate of candidates) {
		try {
			return await import(candidate);
		} catch (error) {
			failures.push(`${candidate} → ${error?.message ?? error}`);
		}
	}
	throw new Error(`加载不了 ${specifier}（DSH 安装目录变了吗？）：${failures.join('；')}`);
}

let agentYaml;
/** 拿到「和 patch 文件同一套 schema」的 YAML 读写器。 */
async function agentYamlIo() {
	if (agentYaml !== undefined) return agentYaml;
	const yamlModule = await loadAppModule('js-yaml');
	const includeModule = await loadAppModule('@deepseek-ai/cordis-plugin-include');
	const yaml = yamlModule?.default !== undefined && typeof yamlModule.default.load === 'function' ? yamlModule.default : yamlModule;
	if (typeof yaml?.load !== 'function' || typeof yaml?.dump !== 'function') throw new Error('js-yaml 的形状不对，读不了预设 YAML');
	const schema = includeModule?.entryListSchema ?? includeModule?.default?.entryListSchema;
	if (schema === undefined) throw new Error('拿不到 entryListSchema（@deepseek-ai/cordis-plugin-include 没装全？）');
	agentYaml = { yaml, schema };
	return agentYaml;
}

/** 解析一份 YAML / JSON 文本成一个「条目清单」（与 patch 文件同一套 schema）。 */
export async function parseEntryListText(text) {
	const raw = String(text ?? '').trim();
	if (raw === '') throw new Error('内容是空的');
	const { yaml, schema } = await agentYamlIo();
	let value;
	try {
		value = yaml.load(raw, { schema });
	} catch (error) {
		throw new Error(`YAML 解析失败：${error?.reason ?? error?.message ?? error}`);
	}
	if (value === null || value === undefined) throw new Error('解析出来是空的（检查一下缩进？）');
	return value;
}

/** 把条目清单写回 YAML（与 agentPresets.readDocument 用的是同一种写法）。 */
export async function dumpEntryList(rows) {
	const { yaml, schema } = await agentYamlIo();
	return yaml.dump(rows, { schema, noRefs: true, lineWidth: -1 });
}

/** 把一个预设的正文（plugins 清单）写成界面里那段 YAML。 */
export async function dumpPresetBody(plugins) {
	return dumpEntryList(Array.isArray(plugins) ? plugins : []);
}

/** 预设标识归一化：小写、只留字母数字与短横线。 */
export function toAgentId(input, fallback = 'agent') {
	const text = String(input ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48);
	return text === '' ? fallback : text;
}

/** 一个 id 的「没被占用的」版本：x → x-2 → x-3 … */
export function uniqueAgentId(base, taken) {
	const wanted = toAgentId(base, 'agent');
	if (!taken.has(wanted)) return wanted;
	for (let index = 2; index < 200; index += 1) {
		const candidate = `${wanted}-${String(index)}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${wanted}-${Date.now().toString(36)}`;
}

/**
 * 从一份 patch / 声明文本里，按顺序抠出所有 `@deepseek-ai/dsh-agent-preset` 行。
 * 认这几种形态：顶层 `- insert: [...]`、裸的声明行、`group: true` 里嵌的清单。
 */
export function collectPresetRows(value, out = []) {
	const list = Array.isArray(value) ? value : [value];
	for (const row of list) {
		if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
		if (Array.isArray(row.insert)) {
			collectPresetRows(row.insert, out);
			continue;
		}
		if (row.name === AGENT_PRESET_PLUGIN || row.name === 'dsh-agent-preset') {
			out.push(row);
			continue;
		}
		if (row.group === true && Array.isArray(row.config)) collectPresetRows(row.config, out);
	}
	return out;
}

/** 一堆行里，是不是都长得像「插件行」（有 name 字符串）。 */
function looksLikeEntryList(value) {
	if (!Array.isArray(value) || value.length === 0) return false;
	return value.every((row) => row !== null && typeof row === 'object' && typeof row.name === 'string');
}

/**
 * 把用户给的一段文本，理解成「一个或多个预设」。
 * 依次认：本插件导出的 JSON → 带声明的 patch → 裸声明行 → 只有正文（plugins 清单）。
 * @returns {Promise<Array<{id?, name?, description?, order?, model?, plugins, bodyOnly}>>}
 */
export async function readPresetDocument(text, fallback = {}) {
	const value = await parseEntryListText(text);

	// 1) 本插件自己导出的整包 JSON
	if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === AGENT_EXPORT_KIND) {
		const rows = Array.isArray(value.presets) ? value.presets : value.preset === undefined ? [] : [value.preset];
		const presets = rows
			.filter((row) => row !== null && typeof row === 'object' && Array.isArray(row.plugins))
			.map((row) => ({
				id: typeof row.id === 'string' ? row.id : undefined,
				name: typeof row.name === 'string' ? row.name : undefined,
				description: typeof row.description === 'string' ? row.description : undefined,
				order: typeof row.order === 'number' ? row.order : undefined,
				model: typeof row.model === 'string' ? row.model : undefined,
				plugins: row.plugins,
				bodyOnly: false,
			}));
		if (presets.length === 0) throw new Error('这份导出文件里没有预设');
		return presets;
	}

	// 2) 带 @deepseek-ai/dsh-agent-preset 声明的 patch（本插件的 YAML 导出 / bundle patch 都走这条）
	const declarations = collectPresetRows(value);
	if (declarations.length > 0) {
		return declarations.map((row) => {
			const config = row.config !== null && typeof row.config === 'object' ? row.config : {};
			if (!Array.isArray(config.plugins)) throw new Error(`预设「${config.id ?? row.id ?? '?'}」的 config.plugins 不是一个清单`);
			return {
				id: typeof config.id === 'string' && config.id !== '' ? config.id : toAgentId(String(row.id ?? '').replace(/^preset-/u, '')),
				name: typeof config.name === 'string' ? config.name : undefined,
				description: typeof config.description === 'string' ? config.description : undefined,
				order: typeof config.order === 'number' ? config.order : undefined,
				model: undefined,
				plugins: config.plugins,
				bodyOnly: false,
			};
		});
	}

	// 3) 只有正文（`agentPresets.readDocument` 返回的就是这种：一串插件行）
	if (looksLikeEntryList(value)) {
		const single = value.length === 1 && value[0] !== null && typeof value[0] === 'object' && Array.isArray(value[0].plugins) ? value[0] : undefined;
		if (single !== undefined) {
			return [{ id: typeof single.id === 'string' ? single.id : fallback.id, name: undefined, description: undefined, order: undefined, model: undefined, plugins: single.plugins, bodyOnly: false }];
		}
		return [{ id: fallback.id, name: fallback.name, description: fallback.description, order: undefined, model: undefined, plugins: value, bodyOnly: true }];
	}

	// 4) 整份内容就是一段普通文字（YAML 把它读成一个标量）→ 当系统提示词
	if (typeof value === 'string' && value.trim() !== '') {
		return [{ id: fallback.id, name: fallback.name, description: fallback.description, order: undefined, model: undefined, plugins: personaPlugins(value), bodyOnly: true }];
	}

	throw new Error('认不出这份内容：既没有 @deepseek-ai/dsh-agent-preset 声明，也不是一串插件行（plugins 清单），也不是一段纯文本提示词');
}

/** 正文只填一段系统提示词时，包成一行 persona —— 这样预设至少有身份。 */
export function personaPlugins(prompt) {
	const text = String(prompt ?? '').trim();
	if (text === '') throw new Error('系统提示词不能为空');
	return [{ id: 'persona', name: PERSONA_PLUGIN, config: { prefix: text, complete: false, includeRuntimeContext: true } }];
}

/** 新建预设时的默认正文模板（persona + 常用工具里最少的那一套）。 */
export function defaultAgentBody(name) {
	return [
		{ id: 'persona', name: PERSONA_PLUGIN, config: { prefix: name === undefined ? 'You are a helpful software engineer assistant.' : String(name), complete: false, includeRuntimeContext: true } },
		{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
		{ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
		{ id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
		{ id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo' },
		{ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web' },
	];
}

/** 数一数正文里有多少插件行 / 工具行（分组会展开）。 */
export function pluginStats(plugins) {
	const names = [];
	const walk = (list) => {
		if (!Array.isArray(list)) return;
		for (const row of list) {
			if (row === null || typeof row !== 'object') continue;
			if (row.group === true) {
				walk(row.config);
				continue;
			}
			if (typeof row.name === 'string' && row.name !== '') names.push(row.name);
		}
	};
	walk(plugins);
	return { plugins: names.length, tools: names.filter((name) => name.includes('dsh-tool-')).length };
}

// -- 来源识别（内置 / 本插件 / 随哪个包装的）---------------------------------

/** 随包预设目录（`@deepseek-ai/dsh-web-app/presets`）。 */
function shippedPresetDir() {
	const candidates = [];
	const resolved = appResolve(`${SHIPPED_BUNDLE}/package.json`);
	if (resolved !== undefined) candidates.push(join(dirname(resolved), 'presets'));
	const root = appRootDir();
	if (root !== undefined) candidates.push(join(root, 'Contents', 'Resources', 'app', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets'));
	candidates.push('/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-web-app/presets');
	return candidates.find((dir) => existsSync(dir));
}

/**
 * 扫出一个「预设 id → 来源」表。
 *   1. 随包发布的 presets/*.patch.yml  → 内置
 *   2. 当前 profile 里各 bundle 的 patch → 来自 <包名>
 * 读不到就返回空表（界面上退化成「来源未知」，不影响用）。
 */
export async function presetOrigins() {
	const map = new Map();
	const dir = shippedPresetDir();
	if (dir !== undefined) {
		for (const file of await listFiles(dir, /\.patch\.ya?ml$/u)) {
			await recordOrigins(map, join(dir, file), { origin: 'builtin', label: '内置', file: join(dir, file), bundle: SHIPPED_BUNDLE });
		}
	}
	for (const profile of await profileDirs()) {
		let bundles = [];
		try {
			const parsed = JSON.parse((await readIfExists(join(profile, 'package.json'))) ?? '{}');
			bundles = Array.isArray(parsed?.dsh?.profile?.bundles) ? parsed.dsh.profile.bundles : [];
		} catch {}
		for (const bundle of bundles.slice(0, 40)) {
			if (typeof bundle !== 'string' || bundle === '' || bundle === SHIPPED_BUNDLE) continue;
			const base = join(profile, 'node_modules', bundle);
			let patch;
			try {
				const manifest = JSON.parse((await readIfExists(join(base, 'package.json'))) ?? '{}');
				patch = typeof manifest?.dsh?.bundle?.patch === 'string' ? join(base, manifest.dsh.bundle.patch.replace(/^\.\//u, '')) : join(base, 'cordis.patch.yml');
			} catch {
				patch = join(base, 'cordis.patch.yml');
			}
			if (!existsSync(patch)) continue;
			await recordOrigins(map, patch, { origin: 'bundle', label: `来自 ${bundle}`, file: patch, bundle });
		}
	}
	return map;
}

/** 读一个 patch 文件，把它声明的预设 id 记进来源表（读不懂就跳过）。 */
async function recordOrigins(map, file, info) {
	try {
		const text = await readIfExists(file);
		if (text === undefined) return;
		for (const preset of await readPresetDocument(text)) {
			if (typeof preset.id !== 'string' || preset.id === '') continue;
			if (!map.has(preset.id)) map.set(preset.id, { ...info, name: preset.name, description: preset.description });
		}
	} catch {}
}

/** 列目录里匹配的文件名（读不到就空）。 */
async function listFiles(dir, pattern) {
	try {
		return (await readdir(dir)).filter((name) => pattern.test(name)).sort();
	} catch {
		return [];
	}
}

/** 候选 profile 目录：优先环境变量指的那个，否则扫 profiles/ 下带 package.json 的。 */
async function profileDirs() {
	const explicit = process.env.DSH_PROFILE;
	const profilesRoot = join(DSH_HOME, 'profiles');
	const found = [];
	if (typeof explicit === 'string' && explicit !== '') {
		const dir = join(profilesRoot, explicit);
		if (existsSync(join(dir, 'package.json'))) found.push(dir);
	}
	try {
		const entries = await readdir(profilesRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = join(profilesRoot, entry.name);
			if (found.includes(dir)) continue;
			if (existsSync(join(dir, 'package.json'))) found.push(dir);
			if (found.length >= 4) break;
		}
	} catch {}
	return found;
}

// -- 模型（预设本身不带模型，模型是全局的）-----------------------------------

/** 全局默认模型（拿不到就 null；不影响页面）。 */
export async function agentModel(ctx) {
	try {
		const service = typeof ctx?.get === 'function' ? ctx.get('agentDefaultModel') : ctx?.agentDefaultModel;
		const selection = service?.currentSelection?.();
		if (selection === undefined || selection === null) return null;
		return {
			provider: typeof selection.provider === 'string' ? selection.provider : '',
			model: typeof selection.model === 'string' ? selection.model : '',
			reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : '',
		};
	} catch {
		return null;
	}
}

// -- 我们管的那些预设：存储 + 运行时挂载 -------------------------------------

/**
 * 本插件自己的预设管理器：记录存 `~/.dsh/agent-presets.json`，
 * 每一条都在运行时挂一行 `@deepseek-ai/dsh-agent-preset` 进去。
 * 跟 McpManager 一个套路（`ctx.plugin(模块, config)` + dispose），所以加/删立刻生效。
 */
export class AgentManager {
	constructor(ctx, log = () => {}) {
		this.ctx = ctx;
		this.log = log;
		this.records = [];
		this.mounted = new Map();
	}

	// -- 存储 ---------------------------------------------------------------

	async load() {
		const text = await readIfExists(AGENT_STORE);
		if (text === undefined) {
			this.records = [];
			return this.records;
		}
		try {
			const parsed = JSON.parse(text);
			this.records = (Array.isArray(parsed?.presets) ? parsed.presets : [])
				.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string' && Array.isArray(row.plugins))
				.map((row) => ({
					id: row.id,
					name: typeof row.name === 'string' ? row.name : '',
					description: typeof row.description === 'string' ? row.description : '',
					order: typeof row.order === 'number' ? row.order : undefined,
					model: typeof row.model === 'string' ? row.model : '',
					origin: row.origin === 'third-party' ? 'third-party' : 'custom',
					source: row.source !== null && typeof row.source === 'object' ? row.source : null,
					plugins: row.plugins,
				}));
		} catch (error) {
			this.log(`dsh-update-vd: 智能体预设清单读不动（${error?.message ?? error}），先按空处理`);
			this.records = [];
		}
		return this.records;
	}

	async persist() {
		await mkdir(dirname(AGENT_STORE), { recursive: true });
		await writeFile(AGENT_STORE, `${JSON.stringify({ version: 1, presets: this.records }, null, 2)}\n`, { mode: 0o600 });
	}

	has(id) {
		return this.records.some((record) => record.id === id);
	}

	get(id) {
		return this.records.find((record) => record.id === id);
	}

	// -- 运行时挂载 ---------------------------------------------------------

	/** 挂一行 `@deepseek-ai/dsh-agent-preset`（已挂过就跳过）。 */
	async mount(record) {
		if (this.mounted.has(record.id)) return this.mounted.get(record.id);
		const loaded = await loadAppModule(AGENT_PRESET_PLUGIN);
		// 关键：`import()` 给的是 **模块命名空间对象**，Cordis 的 ctx.plugin 只认
		// 「函数 / 有 apply 的对象」（`isApplicable()` 要求 `.apply`），传命名空间会直接
		// 抛 `invalid plugin, expect function or object with an "apply" method, received object`。
		// 所以必须取出 default（AgentPreset 类）—— 类的 `Config` / `inject` 静态字段要一起带上。
		const plugin = typeof loaded === 'function' ? loaded : loaded?.default;
		if (typeof plugin !== 'function') throw new Error(`${AGENT_PRESET_PLUGIN} 的导出形状不对（拿到 ${typeof plugin}），挂不了预设`);
		// 只放 AgentPreset.Config 认的字段（schemastery 对未知键不客气）
		const config = { id: record.id, plugins: record.plugins };
		if (typeof record.name === 'string' && record.name !== '') config.name = record.name;
		if (typeof record.description === 'string' && record.description !== '') config.description = record.description;
		if (typeof record.order === 'number' && Number.isFinite(record.order)) config.order = record.order;
		const scope = this.ctx.plugin(plugin, config);
		this.mounted.set(record.id, { scope, config });
		this.log(`dsh-update-vd: 智能体预设「${record.id}」已挂载`);
		return this.mounted.get(record.id);
	}

	unmount(id) {
		const mounted = this.mounted.get(id);
		if (mounted === undefined) return;
		this.mounted.delete(id);
		try {
			mounted.scope?.dispose?.();
		} catch (error) {
			this.log(`dsh-update-vd: 智能体预设「${id}」卸载失败：${error?.message ?? error}`);
		}
	}

	/** 按当前记录重建全部挂载（加/改/删之后调用；坏的只影响它自己）。 */
	async applyAll() {
		const wanted = new Set(this.records.map((record) => record.id));
		for (const id of [...this.mounted.keys()]) if (!wanted.has(id)) this.unmount(id);
		const results = [];
		for (const record of this.records) {
			try {
				if (this.mounted.has(record.id)) this.unmount(record.id);
				await this.mount(record);
				results.push({ id: record.id, ok: true });
			} catch (error) {
				results.push({ id: record.id, ok: false, error: String(error?.message ?? error) });
			}
		}
		return results;
	}

	/** 新增或覆盖一条记录，然后落盘 + 重建挂载。 */
	async saveRecord(record, replaceId = undefined) {
		const index = this.records.findIndex((row) => row.id === (replaceId ?? record.id));
		if (replaceId !== undefined && replaceId !== record.id) {
			// 改了标识：旧的先摘掉
			this.unmount(replaceId);
			if (index >= 0) this.records.splice(index, 1);
			this.records.push(record);
		} else if (index >= 0) {
			this.records[index] = record;
		} else {
			this.records.push(record);
		}
		await this.persist();
		return this.applyAll();
	}

	/** 删一条记录，然后落盘 + 重建挂载。 */
	async removeRecord(id) {
		const index = this.records.findIndex((row) => row.id === id);
		if (index < 0) throw new Error(`找不到「${id}」这个自定义预设`);
		this.unmount(id);
		this.records.splice(index, 1);
		await this.persist();
		const results = await this.applyAll();
		return results;
	}

	disposeAll() {
		for (const id of [...this.mounted.keys()]) this.unmount(id);
	}
}

export const AGENT_STORE_PATH = AGENT_STORE;

// -- 读注册表 + 合并我们的记录 ----------------------------------------------

/** 拿 `agentPresets` 服务（拿不到给明确提示，不崩）。 */
function agentPresetService(ctx) {
	const service = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : ctx?.agentPresets;
	if (service === undefined || service === null) throw new Error('DSH 的预设服务（agentPresets）还没就绪：这条功能要在 Agent 预设可用的 profile 里跑');
	return service;
}

/** 非本插件管的预设，正文只能问注册表要（`readDocument` 给的就是 plugins 的 YAML）。 */
const REMOTE_STATS_CACHE = new Map();
async function remotePluginStats(ctx, id) {
	const cached = REMOTE_STATS_CACHE.get(id);
	if (cached !== undefined && Date.now() - cached.at < 5000) return cached.stats;
	try {
		const document = await agentPresetService(ctx).readDocument(id);
		const parsed = await readPresetDocument(String(document?.content ?? ''), { id });
		const stats = pluginStats(parsed[0]?.plugins);
		REMOTE_STATS_CACHE.set(id, { at: Date.now(), stats });
		return stats;
	} catch {
		// 读不到就老实说 0，别编
		return { plugins: 0, tools: 0 };
	}
}

/**
 * 列出所有可用的智能体预设：以 `agentPresets` 注册表为准（内置 + 随包 + 我们挂的），
 * 再补上我们自己的记录（注册表读不到时至少还能管理自己那些）。
 */
export async function listAgents(ctx, manager) {
	const origins = await presetOrigins();
	const rows = new Map();
	let registryError = null;

	let roster = [];
	try {
		const service = agentPresetService(ctx);
		roster = await service.list();
	} catch (error) {
		registryError = String(error?.message ?? error);
	}

	for (const row of roster) {
		if (row === null || row === undefined || typeof row !== 'object') continue;
		const origin = origins.get(row.id);
		const mine = manager.get(row.id);
		// 自己的记录本地就有正文；别人的问注册表要（不然内置的全显示「插件 0」）
		const stats = mine === undefined ? await remotePluginStats(ctx, row.id) : pluginStats(mine.plugins);
		rows.set(row.id, {
			id: row.id,
			name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
			description: typeof row.description === 'string' ? row.description : '',
			order: typeof row.order === 'number' ? row.order : null,
			broken: typeof row.broken === 'string' && row.broken !== '' ? row.broken : null,
			origin: origin?.origin ?? 'unknown',
			originLabel: origin?.label ?? '来源未知',
			bundle: origin?.bundle ?? null,
			managed: mine !== undefined,
			writable: mine !== undefined,
			note: KNOWN_PRESET_NOTES[row.id] ?? '',
			...stats,
		});
	}

	// 我们自己记录里、注册表还没认出来的（挂载失败/服务没就绪时它们仍然要出现）
	for (const record of manager.records) {
		const existing = rows.get(record.id);
		const stats = pluginStats(record.plugins);
		if (existing === undefined) {
			rows.set(record.id, {
				id: record.id,
				name: record.name === '' ? record.id : record.name,
				description: record.description,
				order: typeof record.order === 'number' ? record.order : null,
				broken: registryError === null ? null : `没能从预设服务确认：${registryError}`,
				origin: record.origin,
				originLabel: record.origin === 'third-party' ? `第三方${record.source?.label === undefined ? '' : ` · ${record.source.label}`}` : '自定义',
				bundle: record.source?.repo ?? null,
				managed: true,
				writable: true,
				note: record.model === '' ? '' : `模型备注：${record.model}`,
				...stats,
			});
			continue;
		}
		rows.set(record.id, {
			...existing,
			managed: true,
			writable: true,
			description: existing.description === '' ? record.description : existing.description,
			model: record.model === '' ? undefined : record.model,
			origin: record.origin,
			originLabel: record.origin === 'third-party' ? `第三方${record.source?.label === undefined ? '' : ` · ${record.source.label}`}` : '自定义',
			...stats,
		});
	}

	const presets = [...rows.values()].map((row) => ({
		...row,
		// 内置/随包的补一句人话，免得列表里全是「（没有简介）」
		description: row.description === '' ? (KNOWN_PRESET_NOTES[row.id] ?? '') : row.description,
	}));
	presets.sort((left, right) => (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id));

	return {
		presets,
		registryError,
		store: AGENT_STORE,
		model: await agentModel(ctx),
		engine: 'agentPresets',
	};
}

/** 读一个预设的正文（plugins 清单的 YAML）。 */
export async function readAgent(ctx, manager, id) {
	const wanted = String(id ?? '').trim();
	if (wanted === '') throw new Error('没给预设标识');
	const record = manager.get(wanted);
	if (record !== undefined) {
		return {
			id: record.id,
			name: record.name === '' ? record.id : record.name,
			description: record.description,
			order: typeof record.order === 'number' ? record.order : null,
			model: record.model,
			content: await dumpPresetBody(record.plugins),
			writable: true,
			origin: record.origin,
			source: record.source,
		};
	}
	const service = agentPresetService(ctx);
	const document = await service.readDocument(wanted);
	return {
		id: document.agentPreset ?? wanted,
		name: typeof document.name === 'string' && document.name !== '' ? document.name : wanted,
		description: typeof document.description === 'string' ? document.description : (KNOWN_PRESET_NOTES[wanted] ?? ''),
		order: null,
		model: '',
		content: typeof document.content === 'string' ? document.content : '',
		writable: false,
		origin: (await presetOrigins()).get(wanted)?.origin ?? 'unknown',
		source: null,
	};
}

/** 把 input 里的正文变成 plugins 清单：优先正文文本，其次已经解析好的数组。 */
async function resolvePlugins(input) {
	const text = typeof input?.body === 'string' ? input.body.trim() : '';
	if (text !== '') {
		// 正文允许两种写法：一串插件行（真实格式），或者干脆一段系统提示词
		let parsed;
		try {
			parsed = await parseEntryListText(text);
		} catch (error) {
			if (looksLikePlainPrompt(text)) return personaPlugins(text);
			throw error;
		}
		if (looksLikeEntryList(parsed)) return parsed;
		if (looksLikePlainPrompt(text)) return personaPlugins(text);
		throw new Error('正文要写成插件行清单（YAML 列表），或者干脆一段系统提示词');
	}
	if (Array.isArray(input?.plugins)) {
		if (!looksLikeEntryList(input.plugins)) throw new Error('plugins 里每一行都要有 name');
		return input.plugins;
	}
	throw new Error('正文不能为空：给它一串插件行，或者一段系统提示词');
}

/** 这段文本看起来就是一段普通提示词（不是 YAML 清单）。 */
function looksLikePlainPrompt(text) {
	const raw = String(text ?? '').trim();
	if (raw === '') return false;
	if (raw.startsWith('-') || raw.startsWith('[') || raw.startsWith('{')) return false;
	return !/^\s*[A-Za-z_][\w.-]*\s*:/mu.test(raw);
}

/** 用的这个 id 是不是被「不归我们管」的预设占了。 */
async function conflictOf(ctx, manager, id) {
	if (manager.has(id)) return undefined;
	try {
		const service = agentPresetService(ctx);
		const roster = await service.list();
		const row = roster.find((item) => item.id === id);
		if (row === undefined) return undefined;
		const origin = (await presetOrigins()).get(id);
		return origin?.label ?? 'DSH 里已经有这个标识了';
	} catch {
		return undefined;
	}
}

/** 新建 / 修改一个自定义预设。 */
export async function saveAgent(ctx, manager, input) {
	const originalId = typeof input?.originalId === 'string' && input.originalId !== '' ? input.originalId : undefined;
	const existing = originalId === undefined ? undefined : manager.get(originalId);
	const fallbackName = typeof input?.name === 'string' && input.name.trim() !== '' ? input.name.trim() : existing?.name;
	const explicitId = typeof input?.id === 'string' ? input.id.trim() : '';
	const idSource = explicitId !== '' ? explicitId : String(fallbackName ?? '').trim();
	// 归一化之后什么都不剩（比如填了中文）→ 直接报错，别偷偷改名成「agent」
	if (idSource !== '' && toAgentId(idSource, '') === '') throw new Error('标识只能用小写字母、数字和短横线，字母或数字开头（≤48 字符）');
	const id = toAgentId(idSource, 'agent');
	if (!AGENT_ID_PATTERN.test(id)) throw new Error('标识只能用小写字母、数字和短横线，字母或数字开头（≤48 字符）');

	const plugins = await resolvePlugins(input);
	// 没给的字段沿用原来那条（编辑不该悄悄把「模型备注」抹掉）
	const pick = (value, previous) => (value === undefined || value === null ? (previous ?? '') : String(value).trim());
	const name = pick(input?.name, existing?.name);
	const description = pick(input?.description, existing?.description);
	const orderRaw = input?.order;
	const order = orderRaw === undefined || orderRaw === null || orderRaw === '' ? existing?.order : Number(orderRaw);
	if (order !== undefined && !Number.isFinite(order)) throw new Error('排序要是一个数字');
	const model = pick(input?.model, existing?.model);

	if (originalId === undefined) {
		// 不静默覆盖：撞上别人管的要给理由，撞上自己的也要显式说「覆盖」
		const conflict = await conflictOf(ctx, manager, id);
		if (conflict !== undefined) throw new Error(`已经有叫「${id}」的预设了（${conflict}）—— 换个标识，或者用「复制一份」`);
		if (manager.has(id) && input?.overwrite !== true) throw new Error(`已经有叫「${id}」的自定义预设了 —— 用列表里的「编辑」改它，或者显式勾选「覆盖同名自定义预设」`);
	}
	const record = {
		id,
		name,
		description,
		order,
		model,
		origin: existing?.origin ?? 'custom',
		source: existing?.source ?? null,
		plugins,
	};
	const results = await manager.saveRecord(record, originalId ?? (input?.overwrite === true && manager.has(id) ? id : undefined));
	const failure = results.find((result) => result.ok !== true && result.id === id);
	const listed = await listAgents(ctx, manager);
	return { id, record: { ...record, plugins: undefined, ...pluginStats(plugins) }, presets: listed.presets, error: failure === undefined ? null : failure.error, notice: failure === undefined ? null : '已保存，但装配时报了错（见上面那条提示）' };
}

/** 删一个自定义预设（内置 / 随包的删不了，只能复制）。 */
export async function deleteAgent(ctx, manager, id) {
	const wanted = String(id ?? '').trim();
	if (wanted === '') throw new Error('没给预设标识');
	if (!manager.has(wanted)) {
		const origin = (await presetOrigins()).get(wanted);
		throw new Error(`「${wanted}」${origin === undefined ? '不是本插件加的预设' : `是${origin.label}的预设`}，删不了 —— 内置/随包的只能看，想改就「复制一份」再改`);
	}
	await manager.removeRecord(wanted);
	const listed = await listAgents(ctx, manager);
	return { removed: wanted, presets: listed.presets };
}

/** 从一段文本 / 一个本机路径 / 一个 http(s) 地址导入预设。 */
export async function importAgent(ctx, manager, input) {
	const url = typeof input?.url === 'string' ? input.url.trim() : '';
	const path = typeof input?.path === 'string' ? input.path.trim() : '';
	const text = typeof input?.text === 'string' ? input.text : '';
	if (url === '' && path === '' && text.trim() === '') throw new Error('三选一：粘贴一段内容、给一个本机路径，或者给一个 http/https 地址');

	let raw = text;
	let from = null;
	let origin = 'custom';
	if (url !== '') {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error('地址不是合法的 URL');
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http/https 地址');
		const response = await fetch(parsed.href, { redirect: 'follow', headers: { 'user-agent': 'dsh-update-vd' } });
		if (response.status !== 200) throw new Error(`下载失败：HTTP ${response.status}`);
		raw = await response.text();
		from = parsed.href;
		origin = 'third-party';
	} else if (path !== '') {
		const absolute = isAbsolute(path) ? path : resolve(HOME, path.replace(/^~/u, ''));
		if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`);
		raw = await readFile(absolute, 'utf8');
		from = absolute;
	} else if (input?.origin === 'third-party') {
		origin = 'third-party';
	}

	const wantedId = typeof input?.id === 'string' && input.id.trim() !== '' ? toAgentId(input.id) : undefined;
	// 明确说了「这段是系统提示词」就直接包成 persona，不去猜 YAML
	const documents =
		input?.asPrompt === true
			? [{ id: wantedId, name: input?.name, description: input?.description, order: undefined, model: undefined, plugins: personaPlugins(raw), bodyOnly: true }]
			: await readPresetDocument(raw, { id: wantedId, name: input?.name, description: input?.description });
	const document = wantedId === undefined || documents.length === 1 ? documents[0] : (documents.find((item) => item.id === wantedId) ?? documents[0]);
	if (document === undefined) throw new Error('这份内容里没有可导入的预设');

	// 没有显式 id 就沿用内容里的；两个都没有就用文件名兜一个
	const baseId = wantedId ?? (typeof document.id === 'string' && document.id !== '' ? document.id : undefined) ?? toAgentId(typeof input?.name === 'string' ? input.name : basename(from ?? 'imported').replace(/\.(patch\.)?ya?ml$/u, ''), 'imported-agent');
	// 「自动改名」时要把注册表里已有的（内置、随包的）也算成占用，否则挂载会撞 id
	const taken = new Set(manager.records.map((record) => record.id));
	try {
		for (const row of await agentPresetService(ctx).list()) taken.add(row.id);
	} catch {}
	for (const known of (await presetOrigins()).keys()) taken.add(known);
	const asCopy = input?.asCopy === true;
	let id = toAgentId(baseId, 'imported-agent');
	if (!asCopy) {
		const conflict = await conflictOf(ctx, manager, id);
		const mine = manager.has(id);
		if (conflict !== undefined || (mine && input?.overwrite !== true)) {
			throw new Error(`已经有叫「${id}」的预设了（${conflict ?? '本插件里的自定义预设'}）—— 换个标识、勾上「覆盖同名自定义预设」，或者让它自动改个名字`);
		}
	} else {
		id = uniqueAgentId(id, taken);
	}

	const record = {
		id,
		name: String(input?.name ?? document.name ?? '').trim(),
		description: String(input?.description ?? document.description ?? '').trim(),
		order: typeof input?.order === 'number' ? input.order : document.order,
		model: String(input?.model ?? document.model ?? '').trim(),
		origin,
		source: from === null ? null : { label: origin === 'third-party' ? new URL(from).host : from, url: from.startsWith('http') ? from : undefined, path: from.startsWith('http') ? undefined : from },
		plugins: document.plugins,
	};
	const results = await manager.saveRecord(record, input?.overwrite === true && manager.has(id) ? id : undefined);
	const failure = results.find((result) => result.ok !== true && result.id === id);
	const listed = await listAgents(ctx, manager);
	return {
		id,
		from,
		renamed: id !== baseId,
		presets: listed.presets,
		error: failure === undefined ? null : failure.error,
		notice: failure === undefined ? null : '已导入，但装配时报了错（见下面那条提示）',
	};
}

/** 导出：单条或全部，本插件 JSON（可再次导入）或 DSH 补丁 YAML（可直接放进 bundle）。 */
export async function exportAgents(ctx, manager, input) {
	const format = input?.format === 'yaml' ? 'yaml' : 'json';
	const ids = Array.isArray(input?.ids) && input.ids.length > 0 ? input.ids.map((item) => String(item)) : null;
	const wanted = ids === null ? manager.records.map((record) => record.id) : ids;

	const records = [];
	for (const id of wanted) {
		const record = manager.get(id);
		if (record !== undefined) {
			records.push({
				id: record.id,
				name: record.name,
				description: record.description,
				order: record.order,
				model: record.model,
				origin: record.origin,
				source: record.source,
				plugins: record.plugins,
			});
			continue;
		}
		// 不是我们管的（内置 / 随包）：照样能导出，导出来就是一份可再导入的补丁
		const document = await readAgent(ctx, manager, id);
		records.push({ id: document.id, name: document.name, description: document.description, order: document.order ?? undefined, model: '', origin: document.origin, source: document.source, plugins: (await readPresetDocument(document.content, { id: document.id }))[0]?.plugins ?? [] });
	}
	if (records.length === 0) throw new Error('没有可导出的预设（自定义的那些还没建）');

	if (format === 'json') {
		const payload = { kind: AGENT_EXPORT_KIND, version: 1, exportedAt: new Date().toISOString(), presets: records };
		return { filename: records.length === 1 ? `agent-preset-${records[0].id}.json` : `agent-presets-${records.length}.json`, mime: 'application/json', content: `${JSON.stringify(payload, null, 2)}\n` };
	}

	const rows = records.map((record) => {
		const config = { id: record.id };
		if (typeof record.name === 'string' && record.name !== '') config.name = record.name;
		if (typeof record.description === 'string' && record.description !== '') config.description = record.description;
		if (typeof record.order === 'number' && Number.isFinite(record.order)) config.order = record.order;
		config.plugins = record.plugins;
		return { insert: [{ id: `preset-${record.id}`, name: AGENT_PRESET_PLUGIN, config }] };
	});
	const content = await dumpEntryList(rows);
	return { filename: records.length === 1 ? `preset-${records[0].id}.patch.yml` : `preset-bundle-${records.length}.patch.yml`, mime: 'application/x-yaml', content };
}

// -- 在线搜索智能体预设 ------------------------------------------------------

/** 解析智能体那一路的「源」参数。 */
async function resolveAgentSource(sourceId, custom) {
	const list = (await listSources()).agents ?? [];
	const source = list.find((item) => item.id === sourceId) ?? list[0];
	if (source === undefined) throw new Error('没有可用的搜索源');
	const text = String(custom ?? '').trim();
	if (text === '') return source;
	if (/^https?:\/\//u.test(text) && !/github\.com/u.test(text)) return { id: 'temp', label: text, kind: 'url', url: text };
	const { repo } = parseGithubTarget(text);
	return { id: 'temp', label: repo, kind: 'github', repo };
}

/** 本机自带预设目录 → 搜索结果（离线，永不失败）。 */
async function localPresetResults(query) {
	const dir = shippedPresetDir();
	if (dir === undefined) throw new Error('找不到随包预设目录（@deepseek-ai/dsh-web-app/presets）');
	const results = [];
	for (const file of await listFiles(dir, /\.patch\.ya?ml$/u)) {
		const full = join(dir, file);
		try {
			for (const preset of await readPresetDocument(await readFile(full, 'utf8'))) {
				if (typeof preset.id !== 'string') continue;
				const stats = pluginStats(preset.plugins);
				results.push({
					id: preset.id,
					name: preset.name ?? preset.id,
					description: preset.description ?? KNOWN_PRESET_NOTES[preset.id] ?? '',
					order: preset.order ?? null,
					...stats,
					kind: 'local',
					localPath: full,
					url: undefined,
					page: full,
					sourceLabel: '本机自带',
				});
			}
		} catch {}
	}
	return { source: { id: 'local-shipped', label: '本机自带预设', kind: 'local' }, results: filterResults(results, query) };
}

/** 按关键字过滤（名字 / 简介 / 标识）。 */
function filterResults(results, query) {
	const text = String(query ?? '').trim().toLowerCase();
	if (text === '') return results;
	return results.filter((item) => `${item.id ?? ''} ${item.name ?? ''} ${item.description ?? ''}`.toLowerCase().includes(text));
}

/** 从一个仓库的 tree 里挑出「可能声明了预设」的 patch 文件。 */
function presetCandidates(paths) {
	const score = (path) => {
		if (/\/presets\//u.test(path)) return 0;
		if (/(^|\/)cordis\.patch\.yml$/u.test(path)) return 1;
		if (/preset/iu.test(path)) return 2;
		return 3;
	};
	return paths
		.filter((path) => /\.patch\.ya?ml$/u.test(path) || /(^|\/)[\w.-]*preset[\w.-]*\.ya?ml$/iu.test(path))
		.sort((left, right) => score(left) - score(right) || left.localeCompare(right))
		.slice(0, 16);
}

/** 在线搜智能体预设：本机目录 / GitHub 仓库 / 单个 .yml 地址。 */
export async function searchAgents(input) {
	const source = await resolveAgentSource(input?.sourceId, input?.custom);
	const query = String(input?.query ?? '').trim();
	if (source.kind === 'local') return localPresetResults(query);

	if (source.kind === 'url') {
		const text = await fetchText(source.url);
		const results = [];
		for (const preset of await readPresetDocument(text)) {
			if (typeof preset.id !== 'string') continue;
			results.push({ id: preset.id, name: preset.name ?? preset.id, description: preset.description ?? '', order: preset.order ?? null, ...pluginStats(preset.plugins), kind: 'url', url: source.url, page: source.url, sourceLabel: source.label });
		}
		return { source, results: filterResults(results, query) };
	}

	const info = await fetchJson(`https://api.github.com/repos/${source.repo}`);
	const branch = info.default_branch ?? 'main';
	const tree = await fetchJson(`https://api.github.com/repos/${source.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
	const paths = (tree.tree ?? []).filter((item) => item.type === 'blob').map((item) => item.path);
	const candidates = presetCandidates(paths);
	const results = [];
	for (const path of candidates) {
		const url = `https://raw.githubusercontent.com/${source.repo}/${branch}/${path}`;
		try {
			for (const preset of await readPresetDocument(await fetchText(url))) {
				if (typeof preset.id !== 'string') continue;
				results.push({
					id: preset.id,
					name: preset.name ?? preset.id,
					description: preset.description ?? '',
					order: preset.order ?? null,
					...pluginStats(preset.plugins),
					kind: 'github',
					url,
					page: `https://github.com/${source.repo}/blob/${branch}/${path}`,
					sourceLabel: source.repo,
				});
			}
		} catch {}
	}
	return { source: { ...source, branch, stars: info.stargazers_count ?? 0, scanned: candidates.length }, results: filterResults(results, query) };
}

/** 带 UA 的文本抓取（在线搜索与导入共用）。 */
async function fetchText(url) {
	let parsed;
	try {
		parsed = new URL(String(url));
	} catch {
		throw new Error(`不是合法的 URL：${url}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http/https 地址');
	const response = await fetch(parsed.href, { redirect: 'follow', headers: { 'user-agent': 'dsh-update-vd' } });
	if (response.status !== 200) throw new Error(`${parsed.href} → HTTP ${response.status}`);
	return response.text();
}
