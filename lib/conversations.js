/**
 * 对话记录导入（宿主半边）—— 「智能体」页里「从其它 AI 导入 → 对话记录」。
 *
 * 干什么：只读扫本机 Codex / Claude Code / TRAE / WorkBuddy 的**历史对话**，
 * 列出来（标题 / 时间 / 消息条数 / 来源），再把手选的那些**导成真正的 DSH 会话**，
 * 于是能在左侧会话列表里打开、能接着聊。
 *
 * 三条边界：
 *  1. **探测/解析全只读**：一个字节都不往别人的配置目录里写；
 *  2. **导入先走官方存储服务** `ctx.sessionPersistence`（jsonl 后端）；
 *     服务拿不到时才退回「自己按同一套格式写 session.v4.jsonl.zstd」，
 *     编码规则抄自 dsh-session-persistence-jsonl（projectKey / sessionDir / 每帧一条记录）；
 *  3. **幂等**：同一个来源 + 同一个 session id + 同一份内容只导一次；
 *     内容变了就追加一个 `-2` `-3` 的新会话，绝不覆盖已有会话。
 *
 * 纯新增：不动本插件既有的更新 / 笔记 / 技能 / MCP / 智能体导入那几条路。
 */

import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, basename, isAbsolute } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** DSH home（与 resources.js 同一套约定）。 */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');

/** 会话日志根：默认 `<DSH_HOME>/sessions`，可用环境变量覆盖（测试里用）。 */
export const SESSION_STORE_ROOT = process.env.DSH_UPDATER_SESSION_ROOT ?? join(DSH_HOME, 'sessions');

/** DSH 会话日志格式版本（与宿主 dsh-session 的 SESSION_FORMAT_VERSION 一致）。 */
const SESSION_FORMAT_VERSION = 4;

/** 一次导入最多带进来的消息条数（再多就不是「导个对话」而是搬档案了）。 */
const MAX_MESSAGES = 400;

/** 单条消息最多多少字（超了截断并注明）。 */
const MAX_MESSAGE_CHARS = 20000;

/** 列表里为「首条用户消息摘要」最多读源文件的多少字节。 */
const HEAD_BYTES = 2 * 1024 * 1024;

/** 单行 JSONL 超过这个长度就当噪声跳过（Codex 里有超大 base64 行）。 */
const MAX_LINE_BYTES = 512 * 1024;

/** 列表缓存时长：Codex 一个文件几十 MB，开一次视图别把 home 读穿。 */
const LIST_CACHE_TTL_MS = 60 * 1000;

/** 支持的对话来源（与 resources.js 的 OTHER_AI_TOOLKITS 同 id）。 */
export const CONVERSATION_TOOLKIT_IDS = ['codex', 'claude', 'trae', 'workbuddy'];

/**
 * 每个来源的对话位置与解析能力。
 *   roots    —— 对话文件在哪些目录（展开 ~，不存在就当空）
 *   depth    —— 递归层数（Codex 是 `YYYY/MM/DD/*.jsonl`，要 4 层）
 *   parse    —— 解析器的名字（吃到嘴里才算支持）
 *   note     —— 界面上实话实说的说明
 */
const SOURCES = {
	codex: {
		id: 'codex',
		label: 'Codex',
		mode: 'jsonl-tree',
		parser: 'codex',
		roots: ['~/.codex/sessions', '~/.codex/archived_sessions'],
		depth: 4,
		filePattern: /\.jsonl$/iu,
		note: '~/.codex/sessions（按 YYYY/MM/DD 分目录的 rollout-*.jsonl）与 ~/.codex/archived_sessions',
	},
	claude: {
		id: 'claude',
		label: 'Claude Code',
		mode: 'jsonl-tree',
		parser: 'claude',
		roots: ['~/.claude/projects'],
		depth: 2,
		filePattern: /\.jsonl$/iu,
		note: '~/.claude/projects/<项目目录转义名>/<session-uuid>.jsonl',
	},
	workbuddy: {
		id: 'workbuddy',
		label: 'WorkBuddy',
		mode: 'jsonl-tree',
		parser: 'workbuddy',
		roots: ['~/.workbuddy/projects'],
		depth: 2,
		filePattern: /\.jsonl$/iu,
		note: '~/.workbuddy/projects/<项目目录转义名>/<conversation-uuid>.jsonl（标题另从 ~/.workbuddy/workbuddy.db 的 sessions 表补）',
	},
	trae: {
		id: 'trae',
		label: 'TRAE',
		mode: 'unsupported',
		roots: [],
		note: '暂不支持解析这个工具的对话格式：本机探明 ~/.trae/assistant 与 ~/.trae-cn/assistant 都是空目录，对话不在文件里（走它自己的云端 / 应用内数据库），没有稳定的本地文件可读。',
	},
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** `~` → home（每次现算，测试里换 HOME 也生效）。 */
function expandHome(path) {
	const text = String(path ?? '').trim();
	if (text === '') return text;
	if (text === '~') return homedir();
	if (text.startsWith('~/')) return join(homedir(), text.slice(2));
	return text;
}

/** 这个路径存不存在（目录/文件都算；不抛）。 */
function exists(path) {
	try {
		return existsSync(expandHome(path));
	} catch {
		return false;
	}
}

/** 时间戳 → ISO（认数字毫秒、数字秒、字符串）。 */
function toIso(value) {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'number' && Number.isFinite(value)) {
		const ms = value < 1e11 ? value * 1000 : value;
		const date = new Date(ms);
		return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
	}
	if (typeof value === 'string' && value !== '') {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
	}
	return undefined;
}

/** 压成一行能看的摘要。 */
function summarize(text, limit = 120) {
	const flat = String(text ?? '')
		.replace(/\s+/gu, ' ')
		.trim();
	if (flat === '') return '';
	return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** 去掉注入进去的「系统提醒」块（WorkBuddy / Claude 会把上下文塞进用户消息里）。 */
function stripInjected(text) {
	return String(text ?? '')
		.replace(/<system-reminder[\s\S]*?<\/system-reminder>/giu, '')
		.replace(/^#\s*AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>/iu, '')
		.replace(/<user_info>[\s\S]*?<\/user_info>/giu, '')
		.replace(/<identity_context>[\s\S]*?<\/identity_context>/giu, '')
		.replace(/^\s*<recommended_plugins>[\s\S]*?<\/recommended_plugins>\s*/iu, '')
		.replace(/^\s*<user_query>\s*([\s\S]*?)\s*<\/user_query>\s*/iu, '$1')
		.trim();
}

/** 一段文字像不像「工具调用 / 环境上下文」这类噪声（列表摘要时跳掉）。 */
const SYNTHETIC_TAGS = [
	'permissions instructions', 'environment_context', 'user_instructions', 'instructions',
	'recommended_plugins', 'user_query', 'external_codex_apps_open_page', 'external_codex_apps',
	'system-reminder', 'user_info', 'identity_context', 'review_examples', 'project_doc',
];

function looksNoisy(text) {
	const flat = String(text ?? '').trim();
	if (flat === '') return true;
	if (/^#\s*AGENTS\.md instructions/iu.test(flat)) return true;
	if (/^\[(?:tool|system)\]/iu.test(flat)) return true;
	const tag = /^<([a-z][\w:-]*)/iu.exec(flat);
	if (tag !== null) {
		const name = tag[1].toLowerCase();
		// ① 已知的上游合成包装标签（Codex / WorkBuddy 都会往用户消息里塞）
		if (SYNTHETIC_TAGS.includes(name)) return true;
		// ② 一段不长的完整壳：<xxx>…</xxx>
		if (flat.length < 2000 && flat.includes('</')) return true;
		// ③ 很长的标签开头：整份注入的上下文，不是用户的话
		if (flat.length > 400) return true;
	}
	return false;
}

/** 这条消息整份就是上游塞进来的合成标签块吗（标签开头 + 又长 = 注入上下文，不是用户的话）。 */
function syntheticBlock(text) {
	const flat = String(text ?? '').trim();
	if (!/^<[a-z][\w:-]*>/iu.test(flat)) return false;
	if (flat.length <= 400) return false;
	return true;
}

/** 一段「像标题的文本」是不是其实是噪声（Codex 的 <external_*> 壳、环境上下文都算）。 */
function looksNoisyTitle(text) {
	const flat = String(text ?? '').trim();
	if (flat === '') return true;
	if (looksNoisy(flat)) return true;
	if (flat.length >= 200) return false;
	// 上游塞进来的「合成标签」开头：整段就是一个壳，不长；
	// 比如 Codex 的 <external_codex_apps_open_page>{"page_id":null}</...>、
	// <recommended_plugins> Here is a list of plugins…、<environment_context> …
	// 判据：① 有配对闭合标签；② 开头标签名带下划线（真人不会这么打）；
	//       ③ 标签名后紧跟 `{`（就是一段 JSON 外壳）。
	const opening = /^<([a-z][\w:-]*)>(?:[\s\S]*<\/[a-z][\w:-]*>)?$/iu.exec(flat);
	if (opening !== null && flat.includes('</')) return true;
	const name = /^<([a-z][\w:-]*)>/iu.exec(flat);
	if (name !== null && name[1].includes('_')) return true;
	if (name !== null && flat.slice(name[0].length).startsWith('{')) return true;
	return false;
}

/** 内容块数组 → 纯文本（认 Codex / Claude / WorkBuddy 三家常见的块形状）。 */
function blocksToText(content) {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	const parts = [];
	for (const block of content) {
		if (typeof block === 'string') {
			parts.push(block);
			continue;
		}
		if (block === null || typeof block !== 'object') continue;
		const type = String(block.type ?? '');
		if (type === 'text' || type === 'input_text' || type === 'output_text') {
			if (typeof block.text === 'string') parts.push(block.text);
			continue;
		}
		if (type === 'thinking' || type === 'reasoning') {
			if (typeof block.thinking === 'string') parts.push(`（思考）${block.thinking}`);
			else if (typeof block.text === 'string') parts.push(`（思考）${block.text}`);
			continue;
		}
		if (type === 'tool_use' || type === 'tool_call' || type === 'function_call') {
			const name = block.name ?? block.toolName ?? '工具';
			const input = block.input ?? block.arguments ?? block.args;
			let args = '';
			try {
				args = typeof input === 'string' ? input : JSON.stringify(input ?? {});
			} catch {
				args = '';
			}
			parts.push(`[调用工具 ${String(name)}] ${summarize(args, 300)}`);
			continue;
		}
		if (type === 'tool_result' || type === 'function_call_output') {
			const inner = blocksToText(block.content ?? block.output ?? block.result);
			if (inner.trim() !== '') parts.push(`[工具结果] ${inner}`);
			continue;
		}
		if (type === 'image' || type === 'image_blob_ref' || type === 'input_image') {
			parts.push('[图片]');
			continue;
		}
	}
	return parts.join('\n').trim();
}

/** 只读读一小段文件（列表摘要用；超长就截断，不整份读）。 */
async function readHead(path, bytes = HEAD_BYTES) {
	let handle;
	try {
		handle = await open(path, 'r');
		const buffer = Buffer.alloc(bytes);
		const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
		return buffer.subarray(0, bytesRead).toString('utf8');
	} catch {
		return '';
	} finally {
		try {
			await handle?.close();
		} catch {}
	}
}

/**
 * 按行切 JSONL，逐行回调；单行太大就跳过（保留一个占位符让解析器知道断了）。
 * 只读前 `maxBytes` 字节；最后一行可能被截断，丢掉。
 * @param {string} text - 已读到的文本
 * @param {(record: object) => void} onRecord - 每一条能解析出来的 JSON
 */
function eachRecord(text, onRecord) {
	const lines = String(text ?? '').split('\n');
	// 最后一行没换行符收尾 = 被截断了，丢掉
	if (lines.length > 0) lines.pop();
	for (const raw of lines) {
		const line = raw.trim();
		if (line === '' || line.length > MAX_LINE_BYTES) continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record !== null && typeof record === 'object') onRecord(record);
	}
}

// ---------------------------------------------------------------------------
// 三家对话格式的解析器
// ---------------------------------------------------------------------------

/**
 * Codex `rollout-*.jsonl`：
 *   第 1 行 `type:"session_meta"`，payload 里有 session_id / cwd / timestamp；
 *   正文每条 `type:"response_item"`，payload.type 为 `message`（role user/assistant/developer）
 *   或 `reasoning` / `function_call` / `function_call_output`；
 *   还有一堆 `event_msg`（token_count 之类）——没有正文，全部跳过。
 */

/** 从文件路径里抠出 rollout 文件名上的时间（`rollout-2026-03-05T18-25-59-<uuid>.jsonl`）。 */
function codexIdFromPath(path) {
	const name = basename(String(path ?? '')).replace(/\.jsonl$/iu, '');
	const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu.exec(name);
	if (uuid !== null) return uuid[1];
	const stamp = /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/u.exec(name);
	if (stamp !== null) return `codex-${stamp[1]}${stamp[2]}${stamp[3]}-${stamp[4]}${stamp[5]}${stamp[6]}`;
	return name === '' ? 'codex-session' : name;
}

/** Codex 一条记录 → 统一的内部消息形状（不认识的类型返回 undefined）。 */
function codexMessage(record) {
	if (record.type === 'session_meta') return undefined;
	if (record.type === 'response_item') {
		const payload = record.payload ?? {};
		if (payload.type === 'message') {
			const role = payload.role === 'assistant' ? 'assistant' : payload.role === 'developer' ? 'developer' : 'user';
			const text = blocksToText(payload.content);
			if (text.trim() === '') return undefined;
			return { role, text, at: toIso(record.timestamp) };
		}
		if (payload.type === 'reasoning') {
			const text = blocksToText(payload.summary ?? payload.content);
			if (text.trim() === '') return undefined;
			return { role: 'reasoning', text, at: toIso(record.timestamp) };
		}
		if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
			return { role: 'tool', text: `[调用工具 ${String(payload.name ?? '')}] ${summarize(payload.arguments ?? payload.input, 300)}`, at: toIso(record.timestamp) };
		}
		if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
			const out = typeof payload.output === 'string' ? payload.output : blocksToText(payload.output);
			return { role: 'tool-result', text: `[工具结果] ${String(out ?? '')}`, at: toIso(record.timestamp) };
		}
		return undefined;
	}
	if (record.type === 'event_msg') {
		const payload = record.payload ?? {};
		if (payload.type === 'user_message' && typeof payload.message === 'string') {
			return { role: 'user', text: payload.message, at: toIso(record.timestamp) };
		}
		if (payload.type === 'agent_message' && typeof payload.message === 'string') {
			return { role: 'assistant', text: payload.message, at: toIso(record.timestamp) };
		}
	}
	return undefined;
}

/**
 * Claude Code `<session-uuid>.jsonl`：
 *   每条一个 JSON，`type` 为 `user` / `assistant` / `system` / `summary` …；
 *   `message.content` 可能是字符串，也可能是 `[{type:'text'|'tool_use'|'tool_result'|'thinking'}]`。
 */
function claudeMessage(record) {
	const type = record.type;
	if (type === 'summary') {
		return record.summary === undefined ? undefined : { role: 'meta', text: String(record.summary), at: toIso(record.timestamp) };
	}
	if (type !== 'user' && type !== 'assistant') return undefined;
	if (record.isSidechain === true) return { role: 'skip', text: '', at: toIso(record.timestamp) };
	const message = record.message ?? {};
	const role = message.role === 'assistant' || type === 'assistant' ? 'assistant' : 'user';
	const content = message.content;
	// 纯 tool_result 的 user 记录：不当用户说话，标成工具结果
	if (Array.isArray(content) && content.length > 0 && content.every((block) => block?.type === 'tool_result')) {
		const text = blocksToText(content);
		return text.trim() === '' ? undefined : { role: 'tool-result', text, at: toIso(record.timestamp) };
	}
	const text = blocksToText(content);
	if (text.trim() === '') return undefined;
	return { role, text, at: toIso(record.timestamp) };
}

/**
 * WorkBuddy `<conversation-uuid>.jsonl`：一行一条扁平记录，
 * `type` 为 `message`（带 role）/ `reasoning` / `function_call` / `function_call_result` /
 * `ai-title`（标题）/ `file-history-snapshot`（噪声）。
 */
function workbuddyMessage(record) {
	const type = record.type;
	if (type === 'message') {
		const role = record.role === 'assistant' ? 'assistant' : 'user';
		const text = stripInjected(blocksToText(record.content));
		if (text.trim() === '') return undefined;
		return { role, text, at: toIso(record.timestamp) };
	}
	if (type === 'reasoning') {
		const text = blocksToText(record.content) || (typeof record.text === 'string' ? record.text : '');
		return text.trim() === '' ? undefined : { role: 'reasoning', text, at: toIso(record.timestamp) };
	}
	if (type === 'function_call') {
		return { role: 'tool', text: `[调用工具 ${String(record.name ?? '')}] ${summarize(record.arguments ?? record.input, 300)}`, at: toIso(record.timestamp) };
	}
	if (type === 'function_call_result') {
		const text = blocksToText(record.output) || (typeof record.output === 'string' ? record.output : '');
		return text.trim() === '' ? undefined : { role: 'tool-result', text: `[工具结果] ${text}`, at: toIso(record.timestamp) };
	}
	return undefined;
}

const PARSERS = { codex: codexMessage, claude: claudeMessage, workbuddy: workbuddyMessage };

// ---------------------------------------------------------------------------
// 列目录
// ---------------------------------------------------------------------------

/** 递归列文件（有层数上限，坏目录安静跳过）。 */
async function walkFiles(root, depth, pattern, out = []) {
	if (depth < 0) return out;
	let entries;
	try {
		entries = await readdir(expandHome(root), { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(expandHome(root), entry.name);
		if (entry.isDirectory()) {
			if (depth > 0) await walkFiles(full, depth - 1, pattern, out);
			continue;
		}
		if (entry.isFile() && pattern.test(entry.name)) out.push(full);
	}
	return out;
}

/** WorkBuddy 的标题在 sqlite 里（只读打开；读不到就当没有，不影响 JSONL 那条路）。 */
async function workbuddyTitles() {
	const out = new Map();
	const dbPath = expandHome('~/.workbuddy/workbuddy.db');
	if (!exists(dbPath)) return out;
	let sqlite;
	try {
		sqlite = await import('node:sqlite');
	} catch {
		return out;
	}
	let db;
	try {
		db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
		const rows = db.prepare('SELECT id, title, custom_title, created_at, updated_at, cwd FROM sessions').all();
		for (const row of rows ?? []) {
			const title = String(row.custom_title ?? '').trim() !== '' ? String(row.custom_title) : String(row.title ?? '');
			out.set(String(row.id), {
				title: title.trim(),
				createdAt: toIso(row.created_at),
				updatedAt: toIso(row.updated_at),
				cwd: typeof row.cwd === 'string' ? row.cwd : undefined,
			});
		}
	} catch {
		return out;
	} finally {
		try {
			db?.close();
		} catch {}
	}
	return out;
}

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

/** 列表缓存：key = 来源 id，value = { at, rows }。 */
const LIST_CACHE = new Map();

/** 一个来源 → 原始对话条目（只读；解析失败的单个文件不影响别的）。 */
async function scanSource(source) {
	const rows = [];
	if (source.mode === 'unsupported') return rows;
	const titles = source.id === 'workbuddy' ? await workbuddyTitles() : new Map();
	const files = [];
	for (const root of source.roots) {
		if (!exists(root)) continue;
		for (const file of await walkFiles(root, source.depth, source.filePattern)) files.push(file);
	}
	const byKey = new Map();
	for (const file of files) {
		try {
			const row = await describeConversation(source, file, titles);
			if (row === undefined) continue;
			const previous = byKey.get(row.key);
			if (previous === undefined) {
				byKey.set(row.key, row);
				continue;
			}
			// Codex 一个 session 会分卷成多个 rollout 文件：合并成一条，
			// 保留消息条数最多的那份（它同时是最完整的那份）。
			if ((row.messages ?? 0) > (previous.messages ?? 0)) byKey.set(row.key, row);
		} catch {}
	}
	rows.push(...byKey.values());
	rows.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
	return rows;
}

/** 一个对话文件 → 列表里的一行（标题 / 时间 / 条数 / 首条用户消息）。 */
async function describeConversation(source, file, titles) {
	const head = await readHead(file);
	if (head === '') return undefined;
	const parse = PARSERS[source.parser];
	if (parse === undefined) return undefined;
	let info = null;
	let sessionId;
	let cwd;
	let rawUser = '';
	let firstUser = '';
	let firstUserFallback = '';
	let firstUserTagged = '';
	let firstAt;
	let lastAt;
	let messages = 0;
	let lines = 0;

	eachRecord(head, (record) => {
		lines += 1;
		if (source.parser === 'codex') {
			if (record.type === 'session_meta') {
				const payload = record.payload ?? {};
				if (typeof payload.session_id === 'string' && payload.session_id !== '') sessionId = payload.session_id;
				if (typeof payload.cwd === 'string' && payload.cwd !== '') cwd = payload.cwd;
				firstAt = firstAt ?? toIso(payload.timestamp);
				lastAt = toIso(record.timestamp) ?? lastAt;
				return;
			}
			if (record.type === 'turn_context') {
				const payload = record.payload ?? {};
				cwd = cwd ?? (typeof payload.cwd === 'string' ? payload.cwd : undefined);
				return;
			}
		}
		if (source.parser === 'claude') {
			if (typeof record.sessionId === 'string' && record.sessionId !== '') sessionId = record.sessionId;
			if (typeof record.cwd === 'string' && record.cwd !== '') cwd = record.cwd;
		}
		if (source.parser === 'workbuddy') {
			if (record.type === 'ai-title' && typeof record.sessionId === 'string') sessionId = record.sessionId;
			if (typeof record.cwd === 'string' && record.cwd !== '') cwd = cwd ?? record.cwd;
		}
		const message = parse(record);
		if (message === undefined || message.role === 'skip') return;
		if (message.role === 'meta') {
			info = info ?? message.text;
			return;
		}
		if (message.role === 'tool' || message.role === 'tool-result' || message.role === 'reasoning') return;
		messages += 1;
		firstAt = firstAt ?? message.at;
		lastAt = message.at ?? lastAt;
		if (message.role === 'user') {
			const clean = stripInjected(message.text);
			if (rawUser === '') rawUser = String(message.text ?? '').trim();
			if (firstUserFallback === '' && clean !== '') firstUserFallback = clean;
			if (firstUserTagged === '' && clean !== '' && !looksNoisy(clean)) firstUserTagged = clean;
			// 首条「用户消息」优先：不以标签开头、也不是长长一段注入上下文的
			if (firstUser === '' && clean !== '' && !looksNoisy(clean) && !/^</u.test(clean)) firstUser = clean;
		}
	});

	const fallbackId = source.parser === 'codex' ? codexIdFromPath(file) : basename(file).replace(/\.jsonl$/iu, '');
	const id = sessionId ?? fallbackId;
	const meta = titles.get(id) ?? titles.get(fallbackId);
	// 标题优先级：来源自己的标题 → 首条**真实**用户消息 → summary → 首条用户消息原文 → session id。
	// 注意「来源自己的标题」也要过一遍噪声判断：Codex 有些会话的"第一条用户消息"是
	// <external_...> 那种壳，长得像标题其实是噪声，这种就往下退。
	let title = '';
	const named = meta !== undefined && typeof meta.title === 'string' ? meta.title.trim() : '';
	if (named !== '' && !looksNoisyTitle(named)) title = named;
	if (title === '' && firstUser !== '' && !looksNoisyTitle(firstUser)) title = summarize(firstUser, 80);
	if (title === '' && info !== null) title = summarize(info, 80);
	if (title === '' && firstUserTagged !== '' && !looksNoisyTitle(firstUserTagged)) title = summarize(firstUserTagged, 80);
	if (title === '' && firstUserFallback !== '' && !looksNoisyTitle(firstUserFallback)) title = summarize(firstUserFallback, 80);
	// 一路都是注入块（Codex 有的会话第一条就是 <external_...> 壳）→ 老实退回 session id，别拿噪声当标题
	if (title === '' && named !== '' && !looksNoisyTitle(named)) title = named;
	if (title === '') title = id;
	const createdAt = meta?.createdAt ?? firstAt;
	const updatedAt = meta?.updatedAt ?? lastAt ?? firstAt;
	return {
		key: `${source.id}:${id}`,
		sourceId: source.id,
		sourceLabel: source.label,
		id,
		title,
		firstUser: summarize(firstUser !== '' ? firstUser : firstUserTagged, 160),
		createdAt,
		updatedAt,
		messages,
		path: file,
		cwd: cwd ?? meta?.cwd,
		sampled: lines > 0,
	};
}

/** 探测一个来源的对话（带 60 秒缓存；失败降级成空列表，不抛）。 */
export async function scanConversations(sourceId, { force = false } = {}) {
	const source = SOURCES[sourceId];
	if (source === undefined) throw new Error(`没有这个对话来源：${sourceId}`);
	const cached = LIST_CACHE.get(sourceId);
	if (force !== true && cached !== undefined && Date.now() - cached.at < LIST_CACHE_TTL_MS) return cached;
	let rows = [];
	let error = null;
	try {
		rows = await scanSource(source);
	} catch (cause) {
		error = String(cause?.message ?? cause);
	}
	const result = { rows, error };
	LIST_CACHE.set(sourceId, { at: Date.now(), ...result });
	return result;
}

/** 清掉列表缓存（测试/重探用）。 */
export function clearConversationCache() {
	LIST_CACHE.clear();
}

/**
 * 「对话记录」这一类的整体清单：库里必有的 4 个来源 + 本机扫到多少对话。
 * 没装 / 装了但没对话 / 装不了解析，三种情况分开说清楚。
 * @param {(id: string) => boolean} installedOf - 复用「智能体导入」那套安装判据
 * @returns {Promise<object>} { toolkits, total, probe }
 */
export async function listConversations(installedOf) {
	const toolkits = [];
	for (const id of CONVERSATION_TOOLKIT_IDS) {
		const source = SOURCES[id];
		const installed = typeof installedOf === 'function' ? installedOf(id) === true : false;
		if (source.mode === 'unsupported') {
			toolkits.push({
				id,
				label: source.label,
				supported: false,
				installed,
				count: 0,
				note: source.note,
				hint: '这个工具的对话不落地成文件（在它自己的云端 / 应用内数据库里），所以导不进来。',
			});
			continue;
		}
		let rows = [];
		let error = null;
		if (installed) {
			const scanned = await scanConversations(id);
			rows = Array.isArray(scanned?.rows) ? scanned.rows : [];
			error = scanned?.error ?? null;
		}
		const dirs = source.roots.filter((root) => exists(root));
		toolkits.push({
			id,
			label: source.label,
			supported: true,
			installed,
			count: rows.length,
			note: source.note,
			dirs,
			hint: installed
				? rows.length === 0
					? '装是装了，但在这些位置没扫到任何对话文件。'
					: `已扫到 ${rows.length} 个对话（只读）。`
				: '没检测到安装 —— 装好之后回到这一页点「重新扫描」，就能把里面的对话列出来。',
			error,
		});
	}
	return {
		toolkits,
		total: toolkits.reduce((sum, item) => sum + (item.count ?? 0), 0),
		probe: '只读扫描：递归列 Codex 的 sessions 目录、Claude 的 projects 目录、WorkBuddy 的 projects 目录；标题优先取来源自己的标题，其次首条用户消息，最后 session id。60 秒内重复打开走缓存。',
	};
}

/**
 * 搜一个来源的对话（标题 / 首条用户消息 / session id 三处匹配，不区分大小写）。
 * @param {object} input - { sourceId, query, limit }
 */
export async function searchConversations(input) {
	const sourceId = String(input?.sourceId ?? '').trim();
	const query = String(input?.query ?? '').trim().toLowerCase();
	const limit = Number.isInteger(input?.limit) && input.limit > 0 ? Math.min(input.limit, 500) : 200;
	if (sourceId === '' || !CONVERSATION_TOOLKIT_IDS.includes(sourceId)) throw new Error('没给对话来源 id（codex / claude / trae / workbuddy）');
	const { rows } = await scanConversations(sourceId);
	const matched = query === ''
		? rows
		: rows.filter((row) => `${row.title} ${row.firstUser} ${row.id}`.toLowerCase().includes(query));
	return {
		sourceId,
		query: input?.query ?? '',
		total: rows.length,
		matched: matched.length,
		items: matched.slice(0, limit),
		truncated: matched.length > limit,
	};
}

// ---------------------------------------------------------------------------
// 读一份完整对话 → 统一消息列表
// ---------------------------------------------------------------------------

/**
 * 读一个对话的完整内容。
 * @param {object} input - { sourceId, id }
 * @returns {Promise<object>} 对话元信息 + messages[{ role, text, at, meta? }]
 */
export async function readConversation(input) {
	const sourceId = String(input?.sourceId ?? '').trim();
	const id = String(input?.id ?? '').trim();
	if (sourceId === '') throw new Error('没给对话来源 id');
	if (id === '') throw new Error('没给对话 id');
	const source = SOURCES[sourceId];
	if (source === undefined) throw new Error(`没有这个对话来源：${sourceId}`);
	if (source.mode === 'unsupported') throw new Error(`${source.label}：暂不支持解析这个工具的对话格式（${source.note}）`);
	const wanted = `${sourceId}:${id}`;
	const { rows } = await scanConversations(sourceId);
	const row = rows.find((item) => item.key === wanted) ?? rows.find((item) => item.id === id);
	if (row === undefined) throw new Error(`在这个来源里找不到对话「${id}」（可能被删了，点「重新扫描」再试）`);
	const parse = PARSERS[source.parser];
	const text = await readFile(row.path, 'utf8').catch(() => '');
	if (text === '') throw new Error(`读不到这个对话的内容：${row.path}`);
	const messages = [];
	let dropped = 0;
	let truncated = 0;
	eachRecord(text, (record) => {
		const message = parse(record);
		if (message === undefined || message.role === 'skip') return;
		if (message.role === 'meta') {
			if (row.title === '') row.title = summarize(message.text, 80);
			return;
		}
		if (message.role === 'developer') return; // 上游注入的权限说明：DSH 有自己的，不搬
		if (message.role === 'reasoning') return; // 思考块不进正文，避免把导入的会话撑爆
		if (messages.length >= MAX_MESSAGES) {
			dropped += 1;
			return;
		}
		let content = String(message.text ?? '').trim();
		if (content === '') return;
		if (content.length > MAX_MESSAGE_CHARS) {
			content = `${content.slice(0, MAX_MESSAGE_CHARS)}\n…（本条太长，已截断）`;
			truncated += 1;
		}
		messages.push({
			role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'tool',
			text: content,
			at: message.at,
		});
	});
	if (messages.length === 0) throw new Error(`这个对话里没有可导入的正文（${row.path}）`);
	return {
		key: row.key,
		sourceId: row.sourceId,
		sourceLabel: row.sourceLabel,
		id: row.id,
		title: row.title,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		cwd: row.cwd,
		path: row.path,
		messages,
		dropped,
		truncated,
		digest: digestOf(messages),
	};
}

/** 内容指纹：用来判断「同一份内容导过了」还是「内容变了」。 */
function digestOf(messages) {
	const hash = createHash('sha256');
	for (const message of messages) hash.update(`${message.role}\u0000${message.text}\u0000${message.at ?? ''}\u0001`);
	return hash.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// 转换成 DSH 会话事件
// ---------------------------------------------------------------------------

/** 稳定、可读、能当目录名的会话 id。 */
export function sessionIdFor(sourceId, conversationId, attempt = 1) {
	const slug = String(conversationId ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 48);
	const suffix = attempt > 1 ? `-${attempt}` : '';
	return `session-import-${String(sourceId ?? 'ai').toLowerCase()}-${slug === '' ? 'conversation' : slug}${suffix}`;
}

/** 一个 markdown 小标题行：`（导入自 Codex · 2026-03-05 10:26）`。 */
function importHeaderLine(conversation) {
	const when = conversation.createdAt === undefined ? '' : ` · ${String(conversation.createdAt).replace('T', ' ').slice(0, 16)}`;
	return `> 由「DSH 更新中心 · 从其它 AI 导入」导自 **${conversation.sourceLabel}**${when}\n> 原会话：\`${conversation.id}\``;
}

/** 稳定 message id（重复导入同一份内容得到同一个 id，日志可比对）。 */
function messageIdFor(conversation, index) {
	const hash = createHash('sha256').update(`${conversation.sourceId}:${conversation.id}:${index}`).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * 一份对话 → DSH 会话事件数组（seq 从 0 开始，连续）。
 * 角色只保留 user / assistant；工具调用与工具结果折成 `[调用工具 x] …` 文本一行，
 * 转不了的直接跳过（不让整条导入失败）。
 * @param {object} conversation - readConversation 的返回值
 * @returns {Array<object>} 事件数组
 */
export function toSessionEvents(conversation) {
	const events = [];
	const push = (type, data, surfaceOp) => {
		const event = { type, seq: events.length, time: timeOf(conversation, events.length), data };
		if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
		events.push(event);
		return event.seq;
	};
	// 顶部一条说明（系统消息，第一屏就能看出这是导进来的）
	push('system/message', {
		turn: 0,
		step: 0,
		message: {
			role: 'system',
			source: { kind: 'system-prompt' },
			content: [{ type: 'text', text: `本会话由「从其它 AI 导入」把 ${conversation.sourceLabel} 的对话「${conversation.title}」导进来（共 ${String(conversation.messages.length)} 条消息）。原始内容未改写，工具调用与思考块折成了文本。` }],
			id: messageIdFor(conversation, -1),
		},
	}, 'append');
	let titleSeq;
	let turn = 0;
	let index = 0;
	let inTurn = false;
	for (const message of conversation.messages) {
		if (message.role === 'user') {
			turn += 1;
			push('turn/start', { turn });
			push('step/start', { turn, step: 1 });
			inTurn = true;
			const seq = push('user/message', {
				role: 'user',
				id: messageIdFor(conversation, index),
				source: { kind: 'user', clientTimeZone: 'Asia/Shanghai', importedFrom: { source: conversation.sourceId, conversationId: conversation.id, importDigest: conversation.digest } },
				content: [{ type: 'text', text: message.text }],
			}, 'append');
			if (index === 0) titleSeq = seq;
			// 导入说明挂在第一条用户消息里，让标题与正文都对得上
			if (index === 0) {
				const head = events[seq];
				head.data.content.unshift({ type: 'text', text: `${importHeaderLine(conversation)}\n\n` });
			}
		} else {
			if (!inTurn) {
				turn += 1;
				push('turn/start', { turn });
				push('step/start', { turn, step: 1 });
				inTurn = true;
			}
			push('assistant/message', {
				turn,
				step: 1,
				message: {
					role: 'assistant',
					id: messageIdFor(conversation, index),
					source: { kind: 'model', provider: 'imported', model: conversation.sourceLabel },
					content: [{ type: 'text', text: message.text }],
				},
				stream: [],
			}, 'append');
		}
		index += 1;
	}
	if (inTurn) {
		push('step/end', { turn, step: 1 });
		push('turn/end', { turn, reason: { kind: 'completed' } });
	}
	const title = summarize(conversation.title, 80) || conversation.id;
	push('session/title', { title, ...(titleSeq === undefined ? {} : { messageSeqs: [titleSeq] }), source: { kind: 'fallback' } });
	return events;
}

/** 事件时间：尽量沿用原对话的时间，没有就顺序递增（保证单调）。 */
function timeOf(conversation, index) {
	const base = conversation.createdAt === undefined ? Date.now() : Date.parse(conversation.createdAt);
	const fallback = Number.isFinite(base) ? base : Date.now();
	let at = fallback + index;
	const messages = conversation.messages ?? [];
	// 用「第几条输出事件」粗略对应消息时间；对不上就用递增时间戳
	const message = messages[Math.min(index, Math.max(0, messages.length - 1))];
	const parsed = message?.at === undefined ? Number.NaN : Date.parse(message.at);
	if (Number.isFinite(parsed)) at = parsed + index % 1000;
	return Number.isFinite(at) ? at : fallback + index;
}

/** DSH 会话头部（与 dsh-session-persistence-jsonl 的 canonicalHeader 一致）。 */
export function sessionHeader(id, cwd, createdAt) {
	return {
		type: 'session',
		version: SESSION_FORMAT_VERSION,
		id,
		createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
		...(cwd === undefined || cwd === '' ? {} : { cwd }),
		isSeeded: false,
		delegationDepth: 0,
		agentPreset: 'standard',
	};
}

// ---------------------------------------------------------------------------
// 写进 DSH 会话存储
// ---------------------------------------------------------------------------

/** 项目路径 → 目录名（抄自 dsh-session-persistence-jsonl 的 projectKey）。 */
export function projectKey(cwd) {
	if (typeof cwd !== 'string' || cwd === '') throw new Error('cannot encode an empty project path');
	let readable = '';
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i += 1) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === '/' || ch === '\\' || ch === ':') {
			if (!separatorRun) readable += '-';
			separatorRun = true;
		} else if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/u, '') || 'root').slice(0, 251)}--`;
}

/** 单个路径段 → 目录名（抄自 encodeSegment）。 */
export function encodeSegment(raw) {
	if (raw.length === 0) throw new Error('cannot encode an empty path segment');
	if (raw === '.') return '~002E';
	if (raw === '..') return '~002E~002E';
	let out = '';
	for (let i = 0; i < raw.length; i += 1) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) out += ch;
		else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
	}
	return out;
}

/** 会话目录：`<root>/<projectKey>/<encoded id>`。 */
export function sessionDir(root, cwd, id) {
	const project = cwd === undefined || cwd === '' ? '_no-cwd' : projectKey(cwd);
	return join(root, project, encodeSegment(id));
}

/** 当前格式的日志文件名。 */
export const SESSION_LOG_FILENAME = `session.v${String(SESSION_FORMAT_VERSION)}.jsonl.zstd`;

/**
 * 把一次会话写成日志字节：第一帧是头行，之后每条事件一帧（与宿主写入方式一致）。
 * @param {object} header - sessionHeader() 的返回值
 * @param {Array<object>} events - 事件数组
 * @returns {Buffer}
 */
export function encodeSessionLog(header, events) {
	const frames = [];
	const headerLine = `${JSON.stringify(header)}\n`;
	frames.push(zstdCompressSync(Buffer.from(headerLine, 'utf8')));
	for (const event of events) frames.push(zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')));
	return Buffer.concat(frames);
}

/**
 * 取得宿主会话存储服务（拿不到就返回 undefined，调用方退回写文件）。
 * @param {object} ctx - 宿主上下文
 */
export function sessionPersistenceOf(ctx) {
	try {
		const service = ctx?.get?.('sessionPersistence');
		if (service !== undefined && service !== null && typeof service.create === 'function') return service;
	} catch {}
	return undefined;
}

/**
 * 把一份对话写成一个 **新的** DSH 会话。
 * 优先用官方存储服务 `ctx.sessionPersistence.create(header)` + `handle.append(events)`；
 * 服务不可用（旧宿主 / 测试里的假 ctx）时才自己按同一套编码写文件。
 * @param {object} ctx - 宿主上下文
 * @param {object} conversation - readConversation 的返回值
 * @param {object} options - { id, cwd }
 * @returns {Promise<object>} { id, via, dir, file, events }
 */
export async function createSessionFromConversation(ctx, conversation, options = {}) {
	const id = String(options.id ?? '');
	if (id === '') throw new Error('没给要创建的会话 id');
	const events = toSessionEvents(conversation);
	const cwd = typeof options.cwd === 'string' && isAbsolute(options.cwd) ? options.cwd : undefined;
	const header = sessionHeader(id, cwd, conversation.createdAt === undefined ? undefined : Date.parse(conversation.createdAt));
	const service = sessionPersistenceOf(ctx);
	const dir = sessionDir(SESSION_STORE_ROOT, cwd, id);
	const file = join(dir, SESSION_LOG_FILENAME);
	if (service !== undefined) {
		const stored = await service.create(header);
		if (stored !== undefined && typeof stored.append === 'function') {
			await stored.append(events);
			if (typeof stored.flush === 'function') await stored.flush();
			if (typeof stored.close === 'function') await stored.close();
			return { id, via: 'sessionPersistence', dir, file: stored.path ?? file, events: events.length };
		}
	}
	await writeSessionLog(dir, file, header, events);
	return { id, via: 'file', dir, file, events: events.length };
}

/** 自己落盘（服务不可用时的兜底；编码与宿主一致）。 */
async function writeSessionLog(dir, file, header, events) {
	await mkdir(dir, { recursive: true });
	const bytes = encodeSessionLog(header, events);
	const temp = `${file}.tmp-${process.pid}`;
	await writeFile(temp, bytes, { mode: 0o600 });
	await rename(temp, file);
}

/** 这个会话 id 在存储里存在吗（存在就不要覆盖）。 */
export async function sessionExists(ctx, id) {
	return (await storedSessionFile(ctx, id)) !== undefined;
}

/** 这个会话 id 在存储里的日志文件路径（找不到返回 undefined）。 */
export async function storedSessionFile(ctx, id) {
	const service = sessionPersistenceOf(ctx);
	if (service !== undefined && typeof service.stat === 'function') {
		try {
			const info = await service.stat(id);
			if (info !== undefined && info !== null) return info.path ?? info.file ?? '(sessionPersistence)';
		} catch {}
	}
	try {
		const dirs = await readdir(SESSION_STORE_ROOT, { withFileTypes: true });
		for (const entry of dirs) {
			if (!entry.isDirectory()) continue;
			const dir = join(SESSION_STORE_ROOT, entry.name, encodeSegment(id));
			if (!existsSync(dir)) continue;
			for (const name of [SESSION_LOG_FILENAME, 'session.v3.jsonl.zstd', 'session.v4.jsonl', 'session.v3.jsonl']) {
				const file = join(dir, name);
				if (existsSync(file)) return file;
			}
		}
	} catch {}
	return undefined;
}

// ---------------------------------------------------------------------------
// 批量导入
// ---------------------------------------------------------------------------

/**
 * 导入一批对话。逐条报错：成功一条就报一条，失败也报清楚为什么，绝不整批静默失败。
 * @param {object} ctx - 宿主上下文
 * @param {object} input - { items: [{ sourceId, id }], cwd, force }
 * @returns {Promise<object>} { results, imported, skipped, failed }
 */
export async function importConversations(ctx, input) {
	const items = Array.isArray(input?.items) ? input.items : [];
	if (items.length === 0) throw new Error('没选要导入的对话');
	if (items.length > 50) throw new Error(`一次最多导 50 个对话（这次给了 ${items.length} 个）`);
	const cwd = typeof input?.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : undefined;
	const results = [];
	for (const item of items) {
		const sourceId = String(item?.sourceId ?? '');
		const id = String(item?.id ?? '');
		const label = `${sourceId}:${id}`;
		try {
			const conversation = await readConversation({ sourceId, id });
			const usedCwd = cwd ?? (isAbsolute(String(conversation.cwd ?? '')) ? conversation.cwd : undefined);
			let attempt = 1;
			let sessionId = sessionIdFor(sourceId, id, attempt);
			let existing = await sessionExists(ctx, sessionId);
			// 幂等：同名会话已在 → 内容一样就跳过；内容变了就换一个 -2/-3 的新会话，绝不覆盖
			let skipped = false;
			while (existing && attempt < 20) {
				const verdict = await compareExisting(ctx, sessionId, conversation);
				if (verdict === 'same') {
					skipped = true;
					break;
				}
				attempt += 1;
				sessionId = sessionIdFor(sourceId, id, attempt);
				existing = await sessionExists(ctx, sessionId);
			}
			if (skipped) {
				results.push({ key: label, ok: true, skipped: true, sessionId, title: conversation.title, reason: '同一个对话（内容没变）已经导过了，跳过。' });
				continue;
			}
			const created = await createSessionFromConversation(ctx, conversation, { id: sessionId, cwd: usedCwd });
			results.push({
				key: label,
				ok: true,
				skipped: false,
				sessionId: created.id,
				title: conversation.title,
				messages: conversation.messages.length,
				dropped: conversation.dropped,
				truncated: conversation.truncated,
				via: created.via,
				file: created.file,
			});
		} catch (error) {
			results.push({ key: label, ok: false, error: String(error?.message ?? error) });
		}
	}
	return {
		results,
		imported: results.filter((row) => row.ok === true && row.skipped !== true).length,
		skipped: results.filter((row) => row.ok === true && row.skipped === true).length,
		failed: results.filter((row) => row.ok !== true).length,
	};
}

/**
 * 同名会话已经在存储里时，判断「内容一样」还是「内容变了」。
 * 问存储要事件序列，跟这次要写的比一遍；问不到（服务不可用）就当「不一样」，
 * 于是下一个会话 id —— 宁可多一个副本，也不覆盖用户已经导过的会话。
 * @returns {Promise<'same'|'different'>}
 */
async function compareExisting(ctx, sessionId, conversation) {
	const found = await findImportedDigest(ctx, sessionId);
	if (found === undefined) return 'different';
	return found === digestOf(conversation.messages) ? 'same' : 'different';
}

/** 从已有会话里读出「导入指纹」（没有就 undefined）。 */
async function findImportedDigest(ctx, sessionId) {
	const text = await readExistingSessionText(ctx, sessionId);
	if (text === '') return undefined;
	const match = /"importDigest":"([0-9a-f]{16})"/u.exec(text);
	return match === null ? undefined : match[1];
}

/** 读出已有会话的日志文本：优先问存储服务，问不到就直接读文件（同一套编码）。 */
async function readExistingSessionText(ctx, sessionId) {
	const service = sessionPersistenceOf(ctx);
	if (service !== undefined && typeof service.open === 'function') {
		let handle;
		try {
			handle = await service.open(sessionId, 'read');
			const read = await handle.read(0, 4_000_000);
			const bytes = Buffer.isBuffer(read?.bytes) ? read.bytes : Buffer.from(read?.bytes ?? []);
			const text = decodeFrames(bytes);
			if (text !== '') return text;
		} catch {}
		finally {
			try {
				await handle?.close();
			} catch {}
		}
	}
	const file = await storedSessionFile(ctx, sessionId);
	if (file === undefined || file.startsWith('(')) return '';
	try {
		return decodeFrames(await readFile(file));
	} catch {
		return '';
	}
}

/** 解多帧 zstd（每帧一条记录）；解不开就返回空串。 */
export function decodeFrames(bytes) {
	if (!Buffer.isBuffer(bytes) || bytes.length === 0) return '';
	const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
	const starts = [];
	let offset = 0;
	while (offset < bytes.length) {
		const at = bytes.indexOf(MAGIC, offset);
		if (at < 0) break;
		starts.push(at);
		offset = at + 4;
	}
	if (starts.length === 0) return '';
	const parts = [];
	for (let index = 0; index < starts.length; index += 1) {
		const start = starts[index];
		const end = index + 1 < starts.length ? starts[index + 1] : bytes.length;
		try {
			parts.push(decompressFrame(bytes.subarray(start, end)));
		} catch {}
	}
	return parts.join('');
}

/** 单帧解压。 */
function decompressFrame(bytes) {
	return zstdDecompressSync(bytes).toString('utf8');
}
