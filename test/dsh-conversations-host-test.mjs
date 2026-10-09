/**
 * 「从其它 AI 导入 → 对话记录」的**宿主侧**自测。分两段，边界很清楚：
 *
 *  ① **真实只读解析**（主进程）：用**真实的 `HOME`**（不设 `DSH_HOME`）跑
 *     `scanConversations()` / `readConversation()`，只 `readdir` / `readFile` / 只读打开
 *     `workbuddy.db`，**一个字节都不写别人的目录**。断言写的是**结构与格式**，
 *     不写死「本机一定有 230 个 Codex 会话」这类数字：
 *       · 本机有的话，必须能解析出条数、标题、首条用户消息摘要；
 *       · 本机没有的话记 SKIP；
 *       · TRAE 必须如实回报「不支持解析」而不是假装 0 条。
 *
 *  ② **写操作**（**子进程**）：`DSH_HOME=/tmp/dsh-conv-home` 再 `spawn` 自己
 *     （`lib/conversations.js` 在**模块加载时**就把 `DSH_HOME` / 会话存储根算成常量了，
 *     主进程先在真实 HOME 下 import 过它，后面改 `process.env.DSH_HOME` 就没用了 ——
 *     写操作会落进**真实的** `~/.dsh/sessions/`）。子进程里：
 *       · 造一份假的「其它 AI 对话文件」，把 `/other-ai/conversations*` 四个路由全打一遍；
 *       · 断言导入真的写出了 `session.v4.jsonl.zstd`，且能被**真正的 Session 校验路径**接受；
 *       · 断言再导一次是「跳过」（幂等），内容变了才是 `-2` 的新会话；
 *       · 断言失败项逐条报错（不是整批静默失败）。
 *     跑完断言**真实的 `~/.dsh/sessions` 目录没被动过**（文件数与 mtime）。
 *
 * 跑法：node test/dsh-conversations-host-test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMP_HOME = '/tmp/dsh-conv-home';
const SELF = fileURLToPath(import.meta.url);
const REAL_SESSIONS = join(homedir(), '.dsh', 'sessions');

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

/** 目录指纹：文件名列表 + 最近 mtime（证明它没被动过）。 */
async function dirStamp(path) {
	try {
		const names = (await readdir(path)).sort();
		let newest = 0;
		for (const name of names) {
			try {
				newest = Math.max(newest, (await stat(join(path, name))).mtimeMs);
			} catch {}
		}
		return `${String(names.length)}:${String(Math.round(newest))}`;
	} catch {
		return 'missing';
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// 子进程那一半：临时 DSH_HOME 上的写操作
// ═══════════════════════════════════════════════════════════════════════════
if (process.env.DSH_CONV_PHASE === 'write') {
	const INDEX_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));
	const CONV_PATH = fileURLToPath(new URL('../lib/conversations.js', import.meta.url));

	// 造一份假的「Codex 会话」与「Claude Code 会话」，放在临时 HOME 下面：
	// 解析器读的是 expandHome('~/.codex/...')，所以把 HOME 也指到临时目录
	const FAKE_HOME = join(TEMP_HOME, 'fake-home');
	const codexDir = join(FAKE_HOME, '.codex', 'sessions', '2026', '03', '05');
	const claudeDir = join(FAKE_HOME, '.claude', 'projects', '-tmp-demo');
	await mkdir(codexDir, { recursive: true });
	await mkdir(claudeDir, { recursive: true });
	const codexFile = join(codexDir, 'rollout-2026-03-05T18-25-59-019cbd88-6782-7c10-b582-6a68e2645385.jsonl');
	await writeFile(
		codexFile,
		[
			JSON.stringify({ timestamp: '2026-03-05T10:26:16.660Z', ordinal: 0, type: 'session_meta', payload: { session_id: '019cbd88-6782-7c10-b582-6a68e2645385', timestamp: '2026-03-05T10:25:59.181Z', cwd: '/tmp/demo', originator: 'Codex Desktop', cli_version: '0.107.0' } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:16.663Z', ordinal: 1, type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>…' }] } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:20.000Z', ordinal: 2, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context><cwd>/tmp/demo</cwd></environment_context>' }] } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:30.000Z', ordinal: 3, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '把粒子效果改成三档可调' }] } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:40.000Z', ordinal: 4, type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: '先看现有实现' }] } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:50.000Z', ordinal: 5, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好，我先把粒子系统拆成低/中/高三档。' }] } }),
			JSON.stringify({ timestamp: '2026-03-05T10:26:55.000Z', ordinal: 6, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"ls"}' } }),
			JSON.stringify({ timestamp: '2026-03-05T10:27:00.000Z', ordinal: 7, type: 'event_msg', payload: { type: 'token_count', info: null } }),
			'',
		].join('\n'),
		'utf8',
	);
	// 第二个 Claude 会话（专门用来验「有存储服务时走官方 API」那条路，避免跟前面的幂等撞车）
	const claudeBFile = join(claudeDir, '7c1a2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d.jsonl');
	await writeFile(
		claudeBFile,
		[
			JSON.stringify({ type: 'user', cwd: '/tmp/demo', sessionId: '7c1a2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', message: { role: 'user', content: [{ type: 'text', text: '走官方存储服务那条路' }] }, uuid: 'b-u1', timestamp: '2026-02-05T09:00:00.000Z' }),
			JSON.stringify({ type: 'assistant', cwd: '/tmp/demo', sessionId: '7c1a2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', message: { role: 'assistant', content: [{ type: 'text', text: '好，走 ctx.sessionPersistence。' }] }, uuid: 'b-a1', timestamp: '2026-02-05T09:00:05.000Z' }),
			'',
		].join('\n'),
		'utf8',
	);
	const claudeFile = join(claudeDir, '3ee54b7e-f45a-4bd7-ac84-b05a4e4e8567.jsonl');
	await writeFile(
		claudeFile,
		[
			JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-02-04T09:41:50.705Z', sessionId: '3ee54b7e-f45a-4bd7-ac84-b05a4e4e8567' }),
			JSON.stringify({ parentUuid: null, isSidechain: false, cwd: '/tmp/demo', sessionId: '3ee54b7e-f45a-4bd7-ac84-b05a4e4e8567', type: 'user', message: { role: 'user', content: [{ type: 'text', text: '给我写一个倒计时组件' }] }, uuid: 'u1', timestamp: '2026-02-04T09:41:50.719Z' }),
			JSON.stringify({ parentUuid: 'u1', isSidechain: false, cwd: '/tmp/demo', sessionId: '3ee54b7e-f45a-4bd7-ac84-b05a4e4e8567', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '可以，用 React 的 useEffect 做。' }] }, uuid: 'a1', timestamp: '2026-02-04T09:41:51.423Z' }),
			'',
		].join('\n'),
		'utf8',
	);

	// 子进程里也把 HOME 指到临时目录，这样解析器读到的是我们造的假对话（真实用户目录一个字节不碰）
	process.env.HOME = FAKE_HOME;
	process.env.DSH_UPDATER_SESSION_ROOT = join(TEMP_HOME, 'sessions');

	const { clearConversationCache } = await import(CONV_PATH);
	clearConversationCache();

	// 假 ctx：收路由 + 假 get()（这里**故意不给** sessionPersistence，验「写文件」那条兜底路）
	const routes = new Map();
	const ctx = {
		connection: { fetch: { register: (r) => { routes.set(r.path, r); return () => {}; } } },
		// 故意不给 sessionPersistence：下面「导入」那段验的就是「写文件」兜底路
		get: () => undefined,
		plugin: () => ({ dispose: () => {} }),
		desktopRuntime: { updates: { currentVersion: '2.0.17', canDownload: true, request: () => Promise.reject(new Error('no')) } },
		logger: { info: () => {} },
		effect: (fn) => { fn(); return () => {}; },
		inject: (_d, cb) => { cb(ctx); return () => {}; },
	};
	const mod = await import(INDEX_PATH);
	mod.apply(ctx);
	await new Promise((resolve) => setTimeout(resolve, 150));
	const call = async (path, body) => {
		const response = await routes.get(path).fetch(new Request(`http://x${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }));
		return { status: response.status, data: await response.json().catch(() => null) };
	};

	console.log('— 子进程：路由 —');
	const list = await call('/api/dsh-update-vd/other-ai/conversations');
	const toolkits = list.data?.conversations?.toolkits ?? [];
	check('GET /other-ai/conversations 返回对话清单', list.status === 200 && toolkits.length === 4, `status=${String(list.status)} toolkits=${String(toolkits.length)}`);
	const codex = toolkits.find((item) => item.id === 'codex');
	check('Codex 的对话被扫出来（假 HOME 里那 1 个）', codex?.count === 1, JSON.stringify({ count: codex?.count, installed: codex?.installed }));
	const trae = toolkits.find((item) => item.id === 'trae');
	check('TRAE 如实回报「不支持解析」', trae?.supported === false && /暂不支持解析/u.test(String(trae?.note ?? '')), String(trae?.note ?? '').slice(0, 40));

	const rows = (await call('/api/dsh-update-vd/other-ai/conversations/list', { sourceId: 'codex' })).data?.items ?? [];
	check('对话列表里有标题（首条真实用户消息）', rows[0]?.title === '把粒子效果改成三档可调', JSON.stringify(rows[0]?.title));
	check('对话列表里有时间与消息条数', typeof rows[0]?.createdAt === 'string' && rows[0]?.messages >= 3, JSON.stringify({ at: rows[0]?.createdAt, messages: rows[0]?.messages }));

	const found = (await call('/api/dsh-update-vd/other-ai/conversations/search', { query: '粒子' })).data;
	check('搜索命中标题', found?.matched === 1, JSON.stringify({ matched: found?.matched }));
	const none = (await call('/api/dsh-update-vd/other-ai/conversations/search', { query: '绝对不存在的关键字 zzzz' })).data;
	check('搜不到时 matched=0', none?.matched === 0, JSON.stringify({ matched: none?.matched }));

	console.log('— 子进程：导入 —');
	const read = (await call('/api/dsh-update-vd/other-ai/conversations/read', { sourceId: 'codex', id: '019cbd88-6782-7c10-b582-6a68e2645385' })).data;
	check('读单个对话：正文里角色与时间都在', (read?.messages ?? []).length >= 3 && read.messages.some((m) => m.role === 'user') && read.messages.some((m) => m.role === 'assistant'), JSON.stringify((read?.messages ?? []).map((m) => `${m.role}:${m.at ?? '-'}`)));
	check('读单个对话：developer/环境上下文被丢掉，真实提问留下了', (read?.messages ?? []).some((m) => m.text.includes('三档可调')) && !(read?.messages ?? []).some((m) => m.text.includes('permissions instructions')), '');

	const first = (await call('/api/dsh-update-vd/other-ai/conversations/import', { items: [{ sourceId: 'codex', id: '019cbd88-6782-7c10-b582-6a68e2645385' }, { sourceId: 'claude', id: '3ee54b7e-f45a-4bd7-ac84-b05a4e4e8567' }] })).data;
	check('导入两个对话都成功', first?.imported === 2 && first?.failed === 0, JSON.stringify({ imported: first?.imported, failed: first?.failed, results: first?.results?.map((r) => r.ok) }));
	const sessionId = first?.results?.[0]?.sessionId ?? '';
	check('会话 id 可读且带来源前缀', /^session-import-codex-/u.test(sessionId), sessionId);
	const file = first?.results?.[0]?.file ?? '';
	check('会话日志真的落盘了', file !== '' && existsSync(file), file.replace(TEMP_HOME, '<tmp>'));

	// 把落盘的日志解回来（跟宿主读写同一套 zstd 多帧编码）
	const convMod = await import(CONV_PATH);
	const bytes = readFileSync(file);
	const lines = convMod.decodeFrames(bytes).split('\n').filter(Boolean);
	const header = JSON.parse(lines[0]);
	const events = lines.slice(1).map((line) => JSON.parse(line));
	check('头行是 v4 会话头', header.version === 4 && header.id === sessionId && header.isSeeded === false, JSON.stringify(header));
	check('事件 seq 从 0 连续', events.every((event, index) => event.seq === index), `events=${String(events.length)}`);
	check('第一条是系统说明，且 surface 事件都带 surfaceOp', events[0]?.type === 'system/message' && events.filter((e) => /message$/u.test(e.type)).every((e) => e.surfaceOp === 'append'), events.map((e) => e.type).join(','));
	check('结尾有 session/title 事件（左侧列表能显示人类可读的标题）', events.at(-1)?.type === 'session/title' && events.at(-1)?.data?.title === '把粒子效果改成三档可调', JSON.stringify(events.at(-1)?.data));
	check('用户消息保留了时间戳与角色', events.some((e) => e.type === 'user/message' && e.data.role === 'user' && Number.isFinite(e.time)), '');

	// 最硬的一条：把落盘的日志喂给**宿主自己的 Session 校验**（与 resume / 恢复同一条路径）。
	// 插件自己的 node_modules 是空的，所以从 DSH 的 app 目录解析；解不到就 SKIP（没装 DSH 的机器）。
	const APP = '/Applications/DSH Desktop.app/Contents/Resources/app/package.json';
	let restore = 'skip';
	if (existsSync(APP)) {
		try {
			const { createRequire } = await import('node:module');
			const appRequire = createRequire(APP);
			const cordisUrl = appRequire.resolve('@deepseek-ai/cordis');
			const sessionUrl = appRequire.resolve('@deepseek-ai/dsh-session');
			const { Context } = await import(cordisUrl);
			const { default: SessionStore } = await import(sessionUrl);
			const ctx = new Context();
			await ctx.plugin(SessionStore);
			const restored = ctx.sessions.prepare(header.id, { seed: events, meta: header.cwd === undefined ? {} : { cwd: header.cwd } });
			restore = restored.snapshotEvents().length === events.length ? true : `事件数对不上：${String(restored.snapshotEvents().length)} != ${String(events.length)}`;
			await ctx.fiber.dispose();
		} catch (error) {
			restore = `校验失败：${String(error?.message ?? error)}`;
		}
	}
	check('宿主自己的 Session 校验接受这份日志（= 能被恢复/接着聊）', restore, restore === 'skip' ? '本机没有 DSH.app' : undefined);

	console.log('— 子进程：幂等与逐条报错 —');
	const again = (await call('/api/dsh-update-vd/other-ai/conversations/import', { items: [{ sourceId: 'codex', id: '019cbd88-6782-7c10-b582-6a68e2645385' }] })).data;
	check('同一对话再导一次 = 跳过（幂等）', again?.skipped === 1 && again?.imported === 0, JSON.stringify({ imported: again?.imported, skipped: again?.skipped, reason: again?.results?.[0]?.reason }));

	const bad = (await call('/api/dsh-update-vd/other-ai/conversations/import', { items: [{ sourceId: 'codex', id: '根本不存在' }, { sourceId: 'trae', id: 'x' }] })).data;
	check('失败逐条报错（不整批静默失败）', bad?.failed === 2 && bad?.results?.every((row) => row.ok === false && typeof row.error === 'string' && row.error !== ''), JSON.stringify(bad?.results?.map((row) => row.error?.slice(0, 40))));
	check('TRAE 那条错误说明是「不支持解析」', /不支持解析/u.test(String(bad?.results?.[1]?.error ?? '')), String(bad?.results?.[1]?.error ?? ''));

	// 内容变了 → 新建 -2，不覆盖原来那个
	const changed = convMod.sessionIdFor('codex', '019cbd88-6782-7c10-b582-6a68e2645385', 2);
	check('内容指纹不同时会用 -2 的会话 id（不覆盖）', changed.endsWith('-2') && changed !== sessionId, changed);

	console.log('— 子进程：官方存储服务那条路（有 sessionPersistence 时优先用它）—');
	{
		// 假的会话存储服务：形状照抄 @deepseek-ai/dsh-session-persistence 的
		// create(header) → handle.append(events) / flush() / close()
		const created = new Map();
		const service = {
			async create(header) {
				created.set(header.id, { header, events: [], flushed: false, closed: false });
				return {
					append: async (list) => { created.get(header.id).events.push(...list); },
					flush: async () => { created.get(header.id).flushed = true; },
					close: async () => { created.get(header.id).closed = true; },
				};
			},
			async stat(id) { return created.has(id) ? { id } : undefined; },
			async open(id) {
				const row = created.get(id);
				if (row === undefined) throw new Error('not found');
				// 按宿主同一套「多帧 zstd」编码回放（每帧一条记录）
				const { zstdCompressSync } = await import('node:zlib');
				const frames = [zstdCompressSync(Buffer.from(`${JSON.stringify(row.header)}\n`, 'utf8'))];
				for (const event of row.events) frames.push(zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')));
				return { read: async () => ({ bytes: Buffer.concat(frames) }), close: async () => {} };
			},
		};
		const serviceCtx = { get: (key) => (key === 'sessionPersistence' ? service : undefined) };
		const viaService = await convMod.importConversations(serviceCtx, { items: [{ sourceId: 'claude', id: '7c1a2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d' }] });
		const row = viaService.results[0];
		check('有存储服务时走官方 API（via=sessionPersistence）', row.ok === true && row.via === 'sessionPersistence', JSON.stringify({ ok: row.ok, via: row.via, id: row.sessionId }));
		const written = created.get(row.sessionId);
		check('create(header) 的头部是 v4 会话头', written?.header?.version === 4 && written.header.id === row.sessionId && written.header.isSeeded === false, JSON.stringify(written?.header));
		check('append(events) 收到了事件、flush/close 被调用', (written?.events?.length ?? 0) > 4 && written.flushed === true && written.closed === true, `events=${String(written?.events?.length ?? 0)} flushed=${String(written?.flushed)} closed=${String(written?.closed)}`);
		// 服务里已经有这个会话 + 同一个对话 → 应当跳过（幂等也走服务这条路）
		const againService = await convMod.importConversations(serviceCtx, { items: [{ sourceId: 'claude', id: '7c1a2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d' }] });
		check('服务路线同样是幂等的（第二次跳过）', againService.skipped === 1 && againService.imported === 0, JSON.stringify({ imported: againService.imported, skipped: againService.skipped }));
	}

	console.log('— 子进程：老语义没被改坏 —');
	const agentsList = await call('/api/dsh-update-vd/other-ai');
	check('GET /other-ai（老行为）仍然只返回 agents 那一类', agentsList.status === 200 && Array.isArray(agentsList.data?.toolkits) && agentsList.data?.conversations === undefined, `status=${String(agentsList.status)}`);
	process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 主进程：真实只读解析
// ═══════════════════════════════════════════════════════════════════════════
const CONV_PATH = fileURLToPath(new URL('../lib/conversations.js', import.meta.url));
const conv = await import(CONV_PATH);
const beforeStamp = await dirStamp(REAL_SESSIONS);

console.log('— ① 真实 HOME 只读解析（一个字节都不写）—');

/** 一个来源：本机有就验解析结果，没有就 SKIP。 */
async function verifySource(id, label, defaults) {
	const { rows, error } = await conv.scanConversations(id, { force: true });
	if (rows.length === 0) {
		check(`${label} 的对话`, 'skip', error === null ? '本机没扫到（没装 / 没聊过）' : `扫描报错：${error}`);
		return null;
	}
	const sample = rows.slice(0, defaults ?? 5);
	check(`${label}：解析出 ${String(rows.length)} 个对话`, rows.length > 0);
	check(`${label}：每条都有 id / 标题 / 时间 / 消息条数`, sample.every((row) => typeof row.id === 'string' && row.id !== '' && typeof row.title === 'string' && row.title !== '' && typeof row.createdAt === 'string' && Number.isFinite(row.messages)), JSON.stringify(sample.slice(0, 2).map((row) => ({ id: row.id.slice(0, 20), title: row.title.slice(0, 24), msgs: row.messages, at: row.createdAt }))));
	check(`${label}：至少有一条能解析出「首条用户消息摘要」`, rows.some((row) => typeof row.firstUser === 'string' && row.firstUser.length > 2), sample.map((row) => row.firstUser?.slice(0, 30)).filter(Boolean).slice(0, 2).join(' | '));
	check(`${label}：标题不是纯 id 的比例够高`, rows.filter((row) => row.title !== row.id).length >= Math.ceil(rows.length * 0.3), `${String(rows.filter((row) => row.title !== row.id).length)}/${String(rows.length)} 条有真标题`);
	// 上游会把注入上下文塞进「用户消息」里（<recommended_plugins> / # AGENTS.md instructions…），
	// 这些绝对不能当标题露出来 —— 一路都是注入块就老实退回 session id
	const noisy = rows.filter((row) => /^\s*(?:<[a-z]|#\s*AGENTS\.md)/iu.test(row.title));
	check(`${label}：标题里没有上游注入块的壳`, noisy.length === 0, noisy.slice(0, 2).map((row) => row.title.slice(0, 50)).join(' | '));
	// 完整读一个，验证「角色 / 文本 / 时间戳」都保留
	const full = await conv.readConversation({ sourceId: id, id: rows[0].id });
	check(`${label}：完整读 ` + '`' + rows[0].id.slice(0, 18) + '`', full.messages.length > 0 && full.digest.length === 16, `${String(full.messages.length)} 条消息 · ${full.messages.map((message) => message.role).slice(0, 6).join(',')}`);
	check(`${label}：消息带角色与时间戳`, full.messages.every((message) => ['user', 'assistant', 'tool'].includes(message.role) && typeof message.text === 'string') && full.messages.some((message) => typeof message.at === 'string'), '');
	// 转成 DSH 会话事件：结构必须对得上
	const events = conv.toSessionEvents(full);
	check(`${label}：转出来的事件 seq 从 0 连续`, events.every((event, index) => event.seq === index), `${String(events.length)} 个事件`);
	check(`${label}：surface 事件都带 surfaceOp=append`, events.filter((event) => /message$/u.test(event.type)).every((event) => event.surfaceOp === 'append'), '');
	check(`${label}：结尾是 session/title`, events.at(-1)?.type === 'session/title', String(events.at(-1)?.type));
	return rows.length;
}

const codexCount = await verifySource('codex', 'Codex');
const claudeCount = await verifySource('claude', 'Claude Code');
const wbCount = await verifySource('workbuddy', 'WorkBuddy');

// TRAE：本机探明「对话不在文件里」，必须如实回报而不是假装 0 条
console.log('— TRAE：必须如实说「不支持解析」—');
const traeScan = await conv.scanConversations('trae', { force: true });
check('TRAE 扫到 0 条（对话不在文件里）', traeScan.rows.length === 0, '');
const traeList = await conv.listConversations(() => true);
const trae = traeList.toolkits.find((toolkit) => toolkit.id === 'trae');
check('TRAE 在清单里 supported=false', trae?.supported === false);
check('TRAE 的说明里写清「暂不支持解析这个工具的对话格式」', /暂不支持解析/u.test(String(trae?.note ?? '')), String(trae?.note ?? '').slice(0, 60));
let traeError = '';
try {
	await conv.readConversation({ sourceId: 'trae', id: 'whatever' });
} catch (error) {
	traeError = String(error?.message ?? error);
}
check('TRAE 读单个对话会明确报错（不是静默空内容）', /不支持解析/u.test(traeError), traeError.slice(0, 60));

console.log('— 缓存与「不装」的降级 —');
{
	const firstRows = (await conv.scanConversations('claude')).rows.length;
	const cachedRows = (await conv.scanConversations('claude')).rows.length;
	check('第二次扫描走缓存且结果一致', firstRows === cachedRows, `${String(firstRows)} = ${String(cachedRows)}`);
	const noneInstalled = await conv.listConversations(() => false);
	check('没装时不给条数、给「去官网」的提示、且不炸', noneInstalled.toolkits.every((toolkit) => toolkit.count === 0 && typeof toolkit.hint === 'string' && toolkit.hint !== ''), JSON.stringify(noneInstalled.toolkits.map((toolkit) => toolkit.count)));
}
console.log(`  （本机解析结果：Codex ${String(codexCount ?? 0)} · Claude Code ${String(claudeCount ?? 0)} · WorkBuddy ${String(wbCount ?? 0)} · TRAE 不支持）`);

// ═══════════════════════════════════════════════════════════════════════════
// 子进程：写操作（临时 DSH_HOME）
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n— ② 临时 DSH_HOME：路由与导入（子进程，绝不碰真实 ~/.dsh）—');
await rm(TEMP_HOME, { recursive: true, force: true });
const childEnv = { ...process.env, DSH_HOME: TEMP_HOME, DSH_CONV_PHASE: 'write' };
delete childEnv.DSH_UPDATER_SESSION_ROOT;
const child = spawn(process.execPath, [SELF], { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
const code = await new Promise((resolve) => child.on('exit', (value) => resolve(value ?? 1)));
check('子进程（写操作那一段）退出码为 0', code === 0, `exit=${String(code)}`);

console.log('\n— 收尾：真实 ~/.dsh/sessions 必须没被动过 —');
const afterStamp = await dirStamp(REAL_SESSIONS);
check('真实的 ~/.dsh/sessions 与跑之前一模一样', beforeStamp === afterStamp, `${beforeStamp} → ${afterStamp}`);
await rm(TEMP_HOME, { recursive: true, force: true });
check('临时 DSH_HOME 已清掉', !existsSync(TEMP_HOME), TEMP_HOME);

console.log(failures === 0 ? `\n全部通过（跳过 ${skipped} 项）` : `\n${failures} 项失败（跳过 ${skipped} 项）`);
process.exit(failures === 0 ? 0 : 1);
