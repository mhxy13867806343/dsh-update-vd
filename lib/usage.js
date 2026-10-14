/**
 * `@mhxy13867806343/dsh-update-vd` — 「Token 活动」的**宿主**半边。
 *
 * 数据从哪来（这一条是查过宿主源码的，不是猜的）：
 *   · 设置 →「账号与余额」里的「查询用量」**没有**本地取数通道 —— 它只是把一个
 *     DeepSeek Platform 网页塞进内嵌页（见下），没有任何 JSON 接口能给出「按天的 token 时间序列」。
 *   · 真正「一格一天」的数据在本机的 DSH **会话日志**里：每个
 *     `assistant/message` 事件都带 `data.usage`（inputTokens / outputTokens / …）
 *     和 `time`（毫秒时间戳）。本模块把这些事件按**本地日期**汇总成 天 → token。
 *
 * 日志是「多帧 Zstandard 拼接」容器（`session.v4.jsonl.zstd`），Node 的
 * `zstdDecompressSync()` 只吃**一帧**，所以这里照 DSH 的
 * `scanZstdFrames`（@deepseek-ai/dsh-session-persistence-jsonl）的规范扫描帧边界，
 * 一帧一帧解压再拼起来。坏帧只丢那一帧，不抛给调用方 —— 界面宁可少一天数据，也不能白屏。
 *
 * 缓存：按 (mtimeMs, size) 逐文件缓存「天 → token」，只有变过的会话才重新解析。
 * 因此第一次约 1 秒，之后刷新基本是零成本（扫描目录的开销）。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** DSH home（与 resources.js / conversations.js 同一套约定）。 */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');

/** 会话日志根：默认 `<DSH_HOME>/sessions`，可用环境变量覆盖（测试里用）。 */
export const SESSION_ROOT = process.env.DSH_UPDATER_SESSION_ROOT ?? join(DSH_HOME, 'sessions');

/** Zstandard 帧魔数（小端 0xFD2FB528）。 */
const ZSTD_MAGIC = 4247762216;

/** 会话日志的文件名（含格式版本）。 */
const SESSION_LOG_NAME = 'session.v4.jsonl.zstd';

/** 单次响应最多回多少天（10 年，够用且不让响应体失控）。 */
const MAX_DAYS = 3700;

/** 一次扫描最多读多少个会话文件（防止异常目录把宿主拖住）。 */
const MAX_FILES = 4000;

/** 一次扫描最多解析多少字节的会话日志（约 512MB，正常用不到）。 */
const MAX_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Zstandard 多帧容器
// ---------------------------------------------------------------------------

/**
 * 扫描「多帧拼接」Zstandard 容器，返回每一帧的字节区间。
 * 规范与 `@deepseek-ai/dsh-session-persistence-jsonl` 的 `scanZstdFrames` 一致：
 * 帧头 → 数据块循环 → 可选校验和。结构不完整（正在写的最后一帧）只返回已完整的帧。
 * @param buffer - 会话日志的全部字节。
 * @returns `{ frames, torn }`；`torn` 是残缺末帧的起始偏移。
 */
export function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) return { frames, torn: start };
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`不是 Zstandard 帧（偏移 ${offset}）`);
		offset += 4;
		if (offset === buffer.length) return { frames, torn: start };
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) throw new Error(`Zstandard 帧头保留位被置位（偏移 ${offset - 1}）`);
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < remainingHeaderBytes) return { frames, torn: start };
		offset += remainingHeaderBytes;
		for (;;) {
			if (buffer.length - offset < 3) return { frames, torn: start };
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) throw new Error(`Zstandard 数据块类型保留（偏移 ${offset - 3}）`);
			const payloadBytes = blockType === 1 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) return { frames, torn: start };
			offset += payloadBytes;
			if (lastBlock) break;
		}
		if (checksum) {
			if (buffer.length - offset < 4) return { frames, torn: start };
			offset += 4;
		}
		frames.push({ start, end: offset });
	}
	return { frames, torn: undefined };
}

/**
 * 把一个会话日志的字节解成明文（JSONL）。
 * 坏帧只丢该帧；单帧解压失败不会影响别的帧。
 * @param buffer - 会话日志的全部字节。
 * @returns `{ text, frames, bad }`；`bad` 是解压失败的帧数。
 */
export function decodeSessionLog(buffer) {
	const { frames } = scanZstdFrames(buffer);
	const parts = [];
	let bad = 0;
	for (const frame of frames) {
		try {
			parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
		} catch {
			bad += 1;
		}
	}
	return { text: Buffer.concat(parts).toString('utf8'), frames: frames.length, bad };
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

/** 本地日期键 `YYYY-MM-DD`。 */
export function dayKey(time) {
	const date = time instanceof Date ? time : new Date(Number(time));
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 一条 `assistant/message` 事件算多少 token。
 * 口径**固定**为 `inputTokens + outputTokens`（不含 cacheRead / cacheWrite）：
 * 这样多轮对话不会被缓存命中放大成「越聊越多」，也与「这一轮真正过了多少 token」一致。
 * @param usage - 事件里的 `data.usage`。
 * @returns 该事件的 token 数（字段缺失按 0）。
 */
export function tokensOf(usage) {
	if (usage === null || typeof usage !== 'object') return 0;
	const input = Number(usage.inputTokens);
	const output = Number(usage.outputTokens);
	return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
}

/**
 * 从一段会话日志明文里累加「天 → token」。
 * 只认 `assistant/message` 且带 `usage` 的事件 —— 其它事件（工具结果、思考块…）不计。
 * @param text - JSONL 明文。
 * @param into - 累加目标（改这个对象）。
 * @returns 命中的事件条数。
 */
export function addLogUsage(text, into) {
	let hits = 0;
	for (const line of text.split('\n')) {
		if (line === '' || line.charCodeAt(0) !== 123) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event?.type !== 'assistant/message') continue;
		const usage = event.data?.usage;
		if (usage === null || typeof usage !== 'object') continue;
		const time = Number(event.time);
		if (!Number.isFinite(time)) continue;
		const tokens = tokensOf(usage);
		if (tokens <= 0) continue;
		const key = dayKey(time);
		into.set(key, (into.get(key) ?? 0) + tokens);
		hits += 1;
	}
	return hits;
}

// ---------------------------------------------------------------------------
// 扫描（带逐文件缓存）
// ---------------------------------------------------------------------------

/** 文件路径 → { mtimeMs, size, days: Map }。 */
const FILE_CACHE = new Map();

/** 一次扫描的统计（日志与界面提示用）。 */
function emptyStats() {
	return { files: 0, parsed: 0, cached: 0, skipped: 0, events: 0, badFrames: 0, truncated: false, bytes: 0 };
}

/**
 * 列出会话根下所有日志文件（`<root>/<workspace>/<session>/session.v4.jsonl.zstd`）。
 * 目录不存在 / 读不动都返回空数组 —— 界面显示「还没数据」而不是报错。
 * @returns 绝对路径数组。
 */
async function listSessionLogs() {
	const out = [];
	let workspaces;
	try {
		workspaces = await readdir(SESSION_ROOT, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const workspace of workspaces) {
		if (out.length >= MAX_FILES) break;
		if (!workspace.isDirectory()) continue;
		const workspaceDir = join(SESSION_ROOT, workspace.name);
		let sessions;
		try {
			sessions = await readdir(workspaceDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const session of sessions) {
			if (out.length >= MAX_FILES) break;
			if (!session.isDirectory()) continue;
			out.push(join(workspaceDir, session.name, SESSION_LOG_NAME));
		}
	}
	return out;
}

/**
 * 汇总本机会话日志里的每日 token 用量。
 * @param options - `{ refresh }`：`refresh` 为真时忽略逐文件缓存。
 * @returns `{ days, stats, at }`；`days` 是 `{ 'YYYY-MM-DD': tokens }`。
 */
export async function collectDailyUsage(options = {}) {
	const refresh = options.refresh === true;
	const stats = emptyStats();
	const days = new Map();
	const files = await listSessionLogs();

	for (const file of files) {
		if (stats.bytes >= MAX_BYTES) {
			stats.truncated = true;
			break;
		}
		stats.files += 1;
		let info;
		try {
			info = await stat(file);
		} catch {
			FILE_CACHE.delete(file);
			continue;
		}
		if (!info.isFile() || info.size === 0) continue;
		const cached = FILE_CACHE.get(file);
		if (!refresh && cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
			stats.cached += 1;
			for (const [key, value] of cached.days) days.set(key, (days.get(key) ?? 0) + value);
			continue;
		}
		let buffer;
		try {
			buffer = await readFile(file);
		} catch {
			stats.skipped += 1;
			continue;
		}
		stats.bytes += buffer.length;
		stats.parsed += 1;
		const perFile = new Map();
		try {
			const { text, bad } = decodeSessionLog(buffer);
			stats.badFrames += bad;
			stats.events += addLogUsage(text, perFile);
		} catch {
			// 结构不对（旧格式 / 半截文件）：跳过这个文件，别让一格坏数据毁掉整张图。
			stats.skipped += 1;
			continue;
		}
		FILE_CACHE.set(file, { mtimeMs: info.mtimeMs, size: info.size, days: perFile });
		for (const [key, value] of perFile) days.set(key, (days.get(key) ?? 0) + value);
	}

	const entries = [...days.entries()].filter(([, value]) => Number.isFinite(value) && value > 0).sort((left, right) => left[0].localeCompare(right[0], 'en'));
	const trimmed = entries.length > MAX_DAYS ? entries.slice(entries.length - MAX_DAYS) : entries;
	return { days: Object.fromEntries(trimmed), stats, at: Date.now() };
}

/** 丢掉逐文件缓存（自测用）。 */
export function resetUsageCache() {
	FILE_CACHE.clear();
}
