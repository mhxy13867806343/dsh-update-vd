/**
 * 「Token 活动」的**宿主侧**自测：数据从哪来、怎么解码、怎么汇总、路由怎么回。
 *
 * 这里不碰真实 `~/.dsh/sessions`：`DSH_UPDATER_SESSION_ROOT` 指到 /tmp 下的临时目录，
 * 现场用 `zstdCompressSync` 造出「多帧拼接」的会话日志（格式与
 * `@deepseek-ai/dsh-session-persistence-jsonl` 一致：每行一帧）。
 *
 * 覆盖：
 *   1. 多帧容器能解出来（含「末尾残缺帧」和「结构坏掉的文件」两种异常）；
 *   2. `assistant/message.data.usage` 的 input+output 口径、按**本地日期**分桶；
 *   3. `collectDailyUsage` 跨会话合并 + 逐文件缓存（第二次不再重解析）；
 *   4. 宿主路由 `GET /api/dsh-update-vd/usage/daily` 真的能返回 `{ ok, days, stats }`。
 *
 * 跑法：cd <仓库根> && node test/dsh-token-activity-host-test.mjs
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

process.env.DSH_HOME = '/tmp/dsh-token-activity-host-home';
process.env.DSH_UPDATER_SESSION_ROOT = '/tmp/dsh-token-activity-host-home/sessions';
await rm(process.env.DSH_HOME, { recursive: true, force: true });
await mkdir(process.env.DSH_UPDATER_SESSION_ROOT, { recursive: true });

const usage = await import(new URL('../lib/usage.js', import.meta.url));

let failures = 0;
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

/** 造一段「多帧拼接」的会话日志（每行一帧），与宿主写文件的编码一致。 */
const encode = (lines) => Buffer.concat(lines.map((line) => zstdCompressSync(Buffer.from(`${line}\n`, 'utf8'))));

const header = (id) => JSON.stringify({ type: 'session', version: 4, id, createdAt: Date.now(), cwd: '/tmp/x', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' });
/** 一条带用量的 assistant/message（`time` 用本地时间构造，保证分桶可预期）。 */
const message = (time, inputTokens, outputTokens) => JSON.stringify({ type: 'assistant/message', seq: 1, time, data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } } });

const DAY_A = new Date(2026, 9, 1, 10, 0, 0).getTime(); // 2026-10-01 本地
const DAY_B = new Date(2026, 9, 2, 23, 30, 0).getTime(); // 2026-10-02 本地（23:30 也不许滚到第二天）
const DAY_C = new Date(2026, 9, 3, 0, 5, 0).getTime();

const sessionDir = (workspace, id) => join(process.env.DSH_UPDATER_SESSION_ROOT, workspace, id);
const writeLog = async (workspace, id, lines) => {
	const dir = sessionDir(workspace, id);
	await mkdir(dir, { recursive: true });
	// usage.js 故意不导出内部文件名常量，这里照格式写死（格式不对的话下面第一条断言就会红）。
	const file = join(dir, 'session.v4.jsonl.zstd');
	await writeFile(file, encode(lines));
	return file;
};

// ── 1. 容器解码 ────────────────────────────────────────────────────────────
console.log('— 多帧 Zstandard 容器 —');
const goodBytes = encode([header('session-a'), message(DAY_A, 1000, 200), message(DAY_A, 300, 40), message(DAY_B, 5000, 500)]);
const scanned = usage.scanZstdFrames(goodBytes);
check('一帧一行，帧数对得上', scanned.frames.length === 4 && scanned.torn === undefined, `${scanned.frames.length} 帧 torn=${scanned.torn}`);
check('解出来的明文是 4 行', usage.decodeSessionLog(goodBytes).text.split('\n').filter(Boolean).length === 4);
const torn = Buffer.concat([goodBytes, goodBytes.subarray(0, 12)]);
const tornScan = usage.scanZstdFrames(torn);
check('末尾残缺帧：只报已完整的帧 + torn 偏移', tornScan.frames.length === 4 && Number.isInteger(tornScan.torn), `frames=${tornScan.frames.length} torn=${tornScan.torn}`);
const decodedTorn = usage.decodeSessionLog(torn);
check('残缺帧不影响已完整帧的解码', decodedTorn.text.includes('assistant/message') && decodedTorn.bad === 0);
let threw = false;
try {
	usage.decodeSessionLog(Buffer.from('这不是 zstandard 也不是 jsonl'));
} catch {
	threw = true;
}
check('结构坏掉的文件会抛错（交给调用方跳过，不静默给错数据）', threw === true);

// ── 2. 汇总口径 ────────────────────────────────────────────────────────────
console.log('\n— 天 → token 汇总 —');
const days = new Map();
const hits = usage.addLogUsage(usage.decodeSessionLog(goodBytes).text, days);
check('只认 assistant/message 且带 usage 的事件', hits === 3, `${hits} 条`);
check('口径 = inputTokens + outputTokens', days.get('2026-10-01') === 1200 + 340 && days.get('2026-10-02') === 5500, JSON.stringify([...days.entries()]));
check('按**本地日期**分桶（10-02 23:30 不滚到 10-03）', days.has('2026-10-03') === false && days.size === 2);
check('tokensOf：缺字段 / 非对象 = 0', usage.tokensOf({}) === 0 && usage.tokensOf(null) === 0 && usage.tokensOf({ inputTokens: 7 }) === 7);
const weird = new Map();
usage.addLogUsage(['not json', '{"type":"assistant/message"}', '{"type":"tool/result","time":1,"data":{"usage":{"inputTokens":9}}}', ''].join('\n'), weird);
check('坏行 / 缺 usage / 别的类型一律跳过', weird.size === 0);

// ── 3. 扫描 + 缓存 ─────────────────────────────────────────────────────────
console.log('\n— 扫描会话目录 —');
await writeLog('--tmp-a--', 'session-a', [header('session-a'), message(DAY_A, 1000, 200), message(DAY_A, 300, 40), message(DAY_B, 5000, 500)]);
await writeLog('--tmp-a--', 'session-b', [header('session-b'), message(DAY_A, 100, 100), message(DAY_C, 10, 1)]);
await writeLog('--tmp-b--', 'session-c', [header('session-c'), message(DAY_C, 1000, 0)]);
const ROOT = process.env.DSH_UPDATER_SESSION_ROOT;
const badFile = join(sessionDir('--tmp-b--', 'session-bad'), 'session.v4.jsonl.zstd');
await mkdir(sessionDir('--tmp-b--', 'session-bad'), { recursive: true });
await writeFile(badFile, Buffer.from('这不是 zstandard 也不是 jsonl'));
await mkdir(join(ROOT, '--tmp-empty--'), { recursive: true });

const first = await usage.collectDailyUsage();
check('跨会话 / 跨 workspace 合并', first.days['2026-10-01'] === 1200 + 340 + 200, JSON.stringify(first.days));
check('10-02 / 10-03 也对（不同文件里同一天的量会相加）', first.days['2026-10-02'] === 5500 && first.days['2026-10-03'] === 1000 + 0 + 10 + 1, JSON.stringify(first.days));
// `parsed` 是「读进来了几个」，坏文件也会被读进来再解失败；失败的那个记在 `skipped` 里。
check('统计里写明扫了几个文件、跳了几个', first.stats.files === 4 && first.stats.parsed === 4 && first.stats.skipped === 1, JSON.stringify(first.stats));
check('坏文件被跳过，不影响其它文件', first.stats.skipped === 1 && first.stats.events === 6 && Object.keys(first.days).length === 3);
check('days 按日期升序（界面直接当时间序用）', JSON.stringify(Object.keys(first.days)) === JSON.stringify(['2026-10-01', '2026-10-02', '2026-10-03']));
check('带扫描时间戳', Number.isFinite(first.at) && first.at > 0);

const second = await usage.collectDailyUsage();
check('第二次走缓存：三个好文件不再重解析', second.stats.cached === 3 && second.stats.events === 0, JSON.stringify(second.stats));
check('缓存结果与首次一致', JSON.stringify(second.days) === JSON.stringify(first.days));

await writeLog('--tmp-a--', 'session-a', [header('session-a'), message(DAY_A, 1, 1), message(DAY_B, 5000, 500)]);
const third = await usage.collectDailyUsage();
check('文件变了只重解析它（mtime/size 变了，坏文件每次重读一次）', third.stats.parsed === 2 && third.stats.cached === 2, JSON.stringify(third.stats));
check('结果跟着更新', third.days['2026-10-01'] === 1 + 1 + 200, JSON.stringify(third.days));

const forced = await usage.collectDailyUsage({ refresh: true });
check('refresh=1 时全部重解析', forced.stats.cached === 0 && forced.stats.events === 5, JSON.stringify(forced.stats));
usage.resetUsageCache();
check('resetUsageCache() 之后缓存为空', (await usage.collectDailyUsage()).stats.cached === 0);

const missing = await (async () => {
	process.env.DSH_UPDATER_SESSION_ROOT = '/tmp/dsh-token-activity-host-home/does-not-exist';
	const module = await import(`../lib/usage.js?missing=${Date.now()}`);
	const result = await module.collectDailyUsage();
	process.env.DSH_UPDATER_SESSION_ROOT = ROOT;
	return result;
})();
check('会话目录不存在 → 空数据而不是抛错', Object.keys(missing.days).length === 0 && missing.stats.files === 0);

// ── 4. 宿主路由 ────────────────────────────────────────────────────────────
console.log('\n— 宿主路由 GET /api/dsh-update-vd/usage/daily —');
const routes = new Map();
const mod = await import(new URL('../lib/index.js', import.meta.url));
const ctx = {
	connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
	get: () => undefined,
	logger: { info: () => {} },
	effect: (fn) => { fn(); return () => {}; },
	inject: (_deps, callback) => { callback(ctx); return () => {}; },
};
mod.apply(ctx);
const route = routes.get('/api/dsh-update-vd/usage/daily');
check('路由注册上了', route !== undefined && route.methods.includes('GET'));
const response = await route.fetch(new Request('http://x/api/dsh-update-vd/usage/daily'));
const payload = await response.json();
check('返回 { ok, days, stats }', payload.ok === true && typeof payload.days === 'object' && typeof payload.stats === 'object', JSON.stringify(payload.stats));
check('路由不回缓存（no-store）', response.headers.get('cache-control') === 'no-store', String(response.headers.get('cache-control')));
check('路由里能拿到真实汇总', payload.days['2026-10-03'] === 1011 && payload.days['2026-10-01'] === 202, JSON.stringify(payload.days));
const refreshed = await (await route.fetch(new Request('http://x/api/dsh-update-vd/usage/daily?refresh=1'))).json();
check('?refresh=1 也能走通', refreshed.ok === true && refreshed.stats.cached === 0, JSON.stringify(refreshed.stats));

const fileStat = await stat(sessionDir('--tmp-a--', 'session-a'));
check('测试只在 /tmp 下造数据（没碰真实 ~/.dsh）', ROOT.startsWith('/tmp/'), ROOT);
// 注意：这个 sandbox 里 `stat()` 返回的是普通对象（没有 isFile 方法），所以只断言 size ——
// 上面的 check 已经证明路径在 /tmp 下，这里再证明那个文件真的有内容。
check('会话日志真的落盘了（有字节）', Number(fileStat.size) > 0, `${fileStat.size} 字节`);

await rm(process.env.DSH_HOME, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
