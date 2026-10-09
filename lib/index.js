/**
 * @mhxy13867806343/dsh-update-vd — Host 半边。
 *
 * 干什么：把 DSH Desktop 的更新从「原生确认框 → 选保存路径 → 下载 DMG →
 * Finder 打开 → 手动把 app 拖进 Applications」换成一条自动链路：
 *
 *   检查版本 → 下载 DMG（带进度）→ 校验 → 挂载 → 替换
 *   /Applications/DSH Desktop.app → 自动重启
 *
 * 三条边界：
 *  1. 只走官方那两个固定端点（版本查询 / 下载），不自己拼任何别的下载地址；
 *  2. 只在**下载完成且校验通过**之后才动 /Applications —— 先整份 ditto 到暂存目录，
 *     再 `codesign --verify` 验一遍，最后才是「移开旧的、换上新的」，任一步失败都能退回；
 *  3. 装完才重启；替换动作放在独立脚本里（detached），进程死掉也不影响它跑完。
 *
 * 与宿主的关系：`desktopRuntime` 提供当前版本号、安装 ID 和 Electron 的网络栈；
 * 它缺失（非 Desktop 的普通 DSH boot）时本插件照常挂载，只是回报 supported:false，
 * 界面自己隐藏。所有 HTTP 路由走 `ctx.connection.fetch.register`，与其它 /api 路由
 * 一样过宿主的 token + Host/Origin 两道防线。
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AgentManager, McpManager, addSource, applyLocalImports, deleteAgent, deleteSkill, detectLocalImports, exportAgents, importAgent, importOtherAi, importOtherAiConversations, importSkill, listAgents, listOtherAi, listOtherAiConversations, listSkills, listSources, readAgent, readOtherAiConversation, readOtherAiToolkit, readSkill, removeSource, saveAgent, saveSkill, searchAgents, searchMcp, searchOtherAiConversations, searchSkills } from './resources.js';

/** 稳定插件名。 */
const name = 'dsh-update-vd';

/** 需要宿主提供的服务（desktopRuntime 是可选的，见 apply）。 */
export const inject = ['connection'];

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 版本查询端点（与 DSH Desktop 内置更新用的是同一个）。 */
const VERSION_ENDPOINT = 'https://www.dshdesktop.cn/api/desktop/version';
/** 下载端点：302 到 CDN 上的具体 DMG，跟随重定向即可。 */
const DOWNLOAD_ENDPOINT = 'https://www.dshdesktop.cn/api/downloads/mac';
/** 本插件自己的路由前缀。 */
const ROUTE = '/api/dsh-update-vd';
/** 安装包小于这个体积基本就是下错了（正常 ~500MB）。 */
const MIN_INSTALLER_BYTES = 8 * 1024 * 1024;
/** 启动后多久做第一次后台检查。 */
const FIRST_CHECK_DELAY_MS = 8_000;
/** 后台检查间隔。 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 下载进度回传节流。 */
const PROGRESS_THROTTLE_MS = 200;
/** 缓存/暂存目录，可用 DSH_UPDATER_CACHE_DIR 覆盖。 */
const CACHE_DIR = process.env.DSH_UPDATER_CACHE_DIR ?? join(homedir(), 'Library', 'Caches', 'dsh-update-vd');
/** 发布通道。 */
const CHANNEL = process.env.DSH_UPDATER_CHANNEL ?? 'stable';
/** 下载完成后是否自动安装（默认按需求：直接装，不再问）。设 0 则停在「待安装」。 */
const AUTO_INSTALL = process.env.DSH_UPDATER_AUTO_INSTALL !== '0';
/** 演练模式：跑完整套流程但最后一步不真的换 app、不重启（用来验证脚本）。 */
const DRY_RUN = process.env.DSH_UPDATER_DRY_RUN === '1';
/**
 * 代码版本标记，写进 state.json。
 * 用来确认「正在跑的这一份宿主代码」到底是哪一版 —— 改完文件不重启，跑的还是旧的。
 */
const CODE_TAG = 'v1.9.0';

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 解析 SemVer（允许小写 v 前缀），失败返回 null。 */
function parseVersion(input) {
	const text = String(input ?? '').trim().replace(/^v/u, '');
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(text);
	if (match === null) return null;
	return {
		text,
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] === undefined ? [] : match[4].split('.'),
	};
}

/** 比较两个版本：a > b 返回正数。无法解析时按「不更新」处理。 */
function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (left === null || right === null) return 0;
	for (const key of ['major', 'minor', 'patch']) {
		if (left[key] !== right[key]) return left[key] - right[key];
	}
	if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
	if (left.prerelease.length === 0) return 1;
	if (right.prerelease.length === 0) return -1;
	return left.prerelease.join('.') === right.prerelease.join('.') ? 0 : left.prerelease.join('.') < right.prerelease.join('.') ? -1 : 1;
}

/** 把 web ReadableStream / Node Readable 都收敛成 Node 可读流。 */
function toNodeReadable(body) {
	if (body === null || body === undefined) throw new Error('响应没有正文');
	if (typeof body.pipe === 'function') return body;
	if (typeof body.getReader === 'function') return Readable.fromWeb(body);
	throw new Error('无法识别的响应正文');
}

/** 人类可读的体积。 */
function formatBytes(value) {
	if (!Number.isFinite(value) || value <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = value;
	let index = 0;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}
	return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** 原子写一个文件。 */
async function writeFileAtomic(targetPath, content, mode = 0o600) {
	await mkdir(dirname(targetPath), { recursive: true });
	const temporaryPath = `${targetPath}.tmp-${process.pid.toString()}`;
	await writeFile(temporaryPath, content, { mode });
	await rename(temporaryPath, targetPath);
}

/** 当前运行的这个 DSH Desktop 的 .app 路径（从 execPath 往上找最外层 .app）。 */
function resolveAppBundle() {
	const candidates = [];
	const execPath = process.execPath ?? '';
	const segments = execPath.split('/');
	const appIndex = segments.findIndex((segment) => segment.endsWith('.app'));
	if (appIndex > 0) candidates.push(segments.slice(0, appIndex + 1).join('/'));
	candidates.push('/Applications/DSH Desktop.app', join(homedir(), 'Applications', 'DSH Desktop.app'));
	for (const candidate of candidates) {
		try {
			if (existsSync(join(candidate, 'Contents', 'Info.plist'))) return candidate;
		} catch {}
	}
	return candidates[0] ?? '/Applications/DSH Desktop.app';
}

/** 文件大小；不存在就算 0（断点续传要读 .part 的现有长度）。 */
async function fileSize(path) {
	try {
		const info = await stat(path);
		return info.isFile() ? info.size : 0;
	} catch {
		return 0;
	}
}

/**
 * 从响应头算出「整包总字节数」。
 * 206 时 content-length 只是这一段的长度，总长得看 content-range 的 `/total`。
 */
function totalBytesFrom(headers, offset) {
	const contentRange = headers.get('content-range');
	if (typeof contentRange === 'string') {
		const match = /\/(\d+)\s*$/u.exec(contentRange);
		if (match !== null) {
			const total = Number(match[1]);
			if (Number.isFinite(total) && total > 0) return total;
		}
	}
	const length = Number(headers.get('content-length') ?? 0);
	if (Number.isFinite(length) && length > 0) return offset + length;
	return 0;
}

/** 读一个 DMG 的尾部，确认它是真的磁盘映像（前 4 字节 koly）。 */
async function assertInstaller(path) {	const handle = await open(path, 'r');
	try {
		const info = await handle.stat();
		if (info.size < MIN_INSTALLER_BYTES) throw new Error(`安装包体积异常（${info.size} 字节），已丢弃`);
		const trailer = Buffer.alloc(512);
		await handle.read(trailer, 0, 512, info.size - 512);
		if (trailer.subarray(0, 4).toString('ascii') !== 'koly') throw new Error('下载到的文件不是有效的 DMG，已丢弃');
		return info.size;
	} finally {
		await handle.close();
	}
}

/** 允许的下载/版本服务主机（含其子域）。 */
const ALLOWED_HOSTS = ['dshdesktop.cn'];

/** 只接受我们自己那两个服务发出来的 https 地址；重定向到别处就拒绝。 */
function assertSecureUrl(url) {
	const target = new URL(url);
	if (target.protocol !== 'https:') throw new Error(`更新服务返回了非 https 地址：${target.protocol}`);
	const host = target.hostname.toLowerCase();
	if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
		throw new Error(`更新服务把请求指向了不受信任的主机：${host}`);
	}
	return target;
}

/** 把 node:https 的响应头收敛成 Headers，好让调用方统一用 .get()。 */
function toHeaders(raw) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(raw)) {
		if (typeof value === 'string') headers.set(name, value);
	}
	return headers;
}

/** node:https 的 GET，自己跟重定向（每一跳都重新校验主机）。 */
function openGetNode(target, headers, signal, redirectsLeft) {
	return new Promise((resolve, reject) => {
		const outgoing = httpsRequest(target, { method: 'GET', headers: { ...headers } }, (response) => {
			const status = response.statusCode ?? 0;
			const location = response.headers.location;
			if (status >= 300 && status < 400 && typeof location === 'string') {
				response.resume();
				if (redirectsLeft <= 0) {
					reject(new Error('更新服务重定向次数过多'));
					return;
				}
				let next;
				try {
					next = assertSecureUrl(new URL(location, target).href);
				} catch (cause) {
					reject(cause);
					return;
				}
				resolve(openGetNode(next, headers, signal, redirectsLeft - 1));
				return;
			}
			resolve({ status, headers: toHeaders(response.headers), body: response });
		});
		outgoing.on('error', reject);
		if (signal !== undefined) {
			const abort = () => outgoing.destroy(new Error('已取消下载'));
			if (signal.aborted) abort();
			else signal.addEventListener('abort', abort, { once: true });
			outgoing.on('close', () => signal.removeEventListener('abort', abort));
		}
		outgoing.end();
	});
}

/**
 * 不带任意超时的 GET：返回 { status, headers, body(Node 可读流) }。
 *
 * 为什么**不用** `ctx.desktopRuntime.updates.request`：Desktop 的宿主进程是独立进程，
 * 那个 request 是 IPC 代理（`update:request` 通道），有固定超时 —— 拿它下一整个
 * 500MB 的安装包必然超时（实测就是 “DSH Host call cancelled or timed out”）。
 * 所以这里优先用宿主进程自己的 fetch，没有就退到 node:https。
 */
async function openGet(url, options) {
	const target = assertSecureUrl(url);
	if (typeof fetch === 'function') {
		const response = await fetch(target.href, {
			method: 'GET',
			headers: options.headers,
			redirect: 'follow',
			cache: 'no-store',
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		if (typeof response.url === 'string' && response.url !== '') assertSecureUrl(response.url);
		return { status: response.status, headers: response.headers, body: response.body === null ? null : Readable.fromWeb(response.body) };
	}
	return openGetNode(target, options.headers, options.signal, 5);
}

/** 读一小段文本正文（版本查询用），超限直接报错。 */
async function readTextBody(body, limitBytes = 64 * 1024) {
	if (body === null) return '';
	const chunks = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > limitBytes) throw new Error('版本服务返回的正文过大');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// 更新管理器
// ---------------------------------------------------------------------------

class DesktopUpdateManager {
	constructor(ctx, logger) {
		this.ctx = ctx;
		this.log = logger;
		this.state = {
			supported: false,
			platform: process.platform,
			channel: CHANNEL,
			phase: 'idle',
			currentVersion: '',
			latestVersion: null,
			receivedBytes: 0,
			totalBytes: 0,
			bytesPerSecond: 0,
			error: null,
			artifactPath: null,
			artifactReady: false,
			autoInstall: AUTO_INSTALL,
			dryRun: DRY_RUN,
			appPath: null,
			updatedAt: Date.now(),
		};
		this.checkTask = null;
		this.downloadTask = null;
		this.installTask = null;
		this.downloadController = null;
		this.installing = false;
		this.persistedAt = 0;
		this.persistedPhase = null;
	}

	// -- 状态 ---------------------------------------------------------------

	patch(next) {
		this.state = { ...this.state, ...next, updatedAt: Date.now() };
		this.persist();
		return this.state;
	}

	/**
	 * 把当前状态落盘一份（阶段变化必写，其余最多每秒一次）。
	 * 出问题时不用问用户、也不用看界面，翻这个文件就知道宿主在干什么、报什么错。
	 */
	persist() {
		const now = Date.now();
		if (this.state.phase === this.persistedPhase && now - this.persistedAt < 1000) return;
		this.persistedAt = now;
		this.persistedPhase = this.state.phase;
		const payload = JSON.stringify({ code: CODE_TAG, at: new Date().toISOString(), ...this.snapshot() }, null, 2);
		void writeFileAtomic(join(CACHE_DIR, 'state.json'), `${payload}\n`, 0o600).catch(() => {});
	}

	/** 正在下载 / 已就绪 / 正在安装这三个阶段由下载与安装自己写，后台检查不能把它们冲掉。 */
	patchPhase(phase, extra = {}) {
		const current = this.state.phase;
		if ((current === 'downloading' || current === 'downloaded' || current === 'installing') && phase !== current) return this.patch(extra);
		return this.patch({ phase, ...extra });
	}

	/** 有下载或安装在进行时，后台检查只回报现状，不碰任何字段。 */
	isBusy() {
		return this.state.phase === 'downloading' || this.state.phase === 'installing';
	}

	snapshot() {
		const { receivedBytes, totalBytes } = this.state;
		const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : this.state.phase === 'downloading' ? 0 : receivedBytes > 0 ? 100 : 0;
		return { ...this.state, percent };
	}

	runtime() {
		const runtime = this.ctx.desktopRuntime;
		return runtime === undefined || runtime === null ? undefined : runtime;
	}

	updates() {
		const runtime = this.runtime();
		return runtime?.updates;
	}

	info(message) {
		this.log?.(message);
	}

	// -- 检查 ---------------------------------------------------------------

	/** 当前版本号。优先问 desktopRuntime，其次扫 app bundle。 */
	async currentVersion() {
		const updates = this.updates();
		if (updates?.currentVersion) return String(updates.currentVersion);
		try {
			const appPath = resolveAppBundle();
			const plist = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8');
			const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist);
			if (match !== null) return match[1];
		} catch {}
		return '';
	}

	/** 检查更新用的网络出口（见 openGet 的说明：不走 desktopRuntime 的 IPC 代理）。 */
	async requestJson(url, options) {
		const response = await openGet(url, options);
		if (response.status !== 200) throw new Error(`版本服务返回 HTTP ${response.status}`);
		const text = await readTextBody(response.body);
		return JSON.parse(text);
	}

	async check() {
		if (this.checkTask !== null) return this.checkTask;
		if (this.isBusy()) return this.snapshot();
		const task = (async () => {
			const current = await this.currentVersion();
			if (current === '') throw new Error('读不到当前版本号');
			this.patchPhase('checking', { currentVersion: current, error: null });
			const headers = {
				'X-DSH-Desktop-Version': current,
				'X-DSH-Desktop-Channel': CHANNEL,
			};
			const installationId = this.updates()?.installationId;
			if (typeof installationId === 'string' && installationId !== '') headers['X-DSH-Desktop-Installation-Id'] = installationId;
			const body = await this.requestJson(VERSION_ENDPOINT, { headers });
			const latest = typeof body?.version === 'string' ? body.version : '';
			if (parseVersion(latest) === null) throw new Error('版本服务返回的版本号无法解析');
			const available = compareVersions(latest, current) > 0;
			return this.patchPhase(available ? 'available' : 'up-to-date', {
				latestVersion: latest,
				error: null,
				artifactReady: await this.artifactExists(latest),
			});
		})()
			.catch((cause) => {
				this.info(`dsh-update-vd: 检查更新失败：${cause instanceof Error ? cause.message : String(cause)}`);
				return this.patchPhase('error', { error: cause instanceof Error ? cause.message : String(cause) });
			})
			.finally(() => {
				this.checkTask = null;
			});
		this.checkTask = task;
		return task;
	}

	// -- 下载 ---------------------------------------------------------------

	artifactPath(version) {
		const prefix = CHANNEL === 'stable' ? 'DSH-Desktop' : CHANNEL === 'beta' ? 'DSH-Desktop-Beta' : 'DSH-NEXT';
		return join(CACHE_DIR, `${prefix}-${version}-mac.dmg`);
	}

	async artifactExists(version) {
		if (typeof version !== 'string' || version === '') return false;
		const path = this.artifactPath(version);
		try {
			await assertInstaller(path);
			return true;
		} catch {
			return false;
		}
	}

	/** 磁盘余量检查：安装包 + 解压出来的新 app，留 1.5 倍余量。 */
	async assertFreeSpace(needBytes) {
		try {
			const info = await statfs(CACHE_DIR);
			const free = info.bavail * info.bsize;
			if (free < needBytes * 3) throw new Error(`磁盘余量不足（可用 ${formatBytes(free)}）`);
		} catch (cause) {
			if (cause instanceof Error && cause.message.startsWith('磁盘余量不足')) throw cause;
		}
	}

	/**
	 * 起一次下载就立刻返回（不 await）。
	 *
	 * HTTP 路由必须马上回：整包 500MB 要下好几分钟，让请求一直挂着的话，
	 * 浏览器/宿主两侧任何一个请求超时都会把它掐断（表现就是
	 * 「Host call cancelled or timed out」），而进度本来就走 /status 轮询。
	 */
	startDownload(version) {
		const target = typeof version === 'string' && version !== '' ? version : this.state.latestVersion;
		// 同步先把阶段翻到 downloading：路由返回的那份快照就得是「正在下载」。
		// 否则客户端收到的是 available，会按「空闲」去排下一次轮询（20 秒后才动）。
		if (this.downloadTask === null && typeof target === 'string' && target !== '') {
			// 只翻阶段：已下载的字节数留着，界面才能显示「继续下载 xx%」。
			this.patch({ phase: 'downloading', latestVersion: target, error: null, artifactPath: this.artifactPath(target), artifactReady: false });
		}
		void this.download(version).catch((cause) => {
			const message = cause instanceof Error ? cause.message : String(cause);
			this.info(`dsh-update-vd: 下载启动失败：${message}`);
			this.patchPhase('error', { error: message });
		});
		return this.snapshot();
	}

	async download(version) {
		if (this.downloadTask !== null) return this.downloadTask;
		const task = (async () => {
			const target = typeof version === 'string' && version !== '' ? version : this.state.latestVersion;
			if (target === null || target === '') throw new Error('还不知道要更新到哪个版本');
			await mkdir(CACHE_DIR, { recursive: true });
			const destination = this.artifactPath(target);

			// 已经下好过一份且校验通过：直接用，不重复花时间/流量。
			if (await this.artifactExists(target)) {
				return this.finishDownload(destination, target, true);
			}

			await this.assertFreeSpace(600 * 1024 * 1024);
			const controller = new AbortController();
			this.downloadController = controller;
			const started = Date.now();
			this.patch({ phase: 'downloading', latestVersion: target, bytesPerSecond: 0, error: null, artifactPath: destination, artifactReady: false });

			const temporary = `${destination}.part`;
			let validationFailed = false;
			try {
				// 断点续传：上一段 .part 还在就接着下（CDN 支持 Range）。
				// 取消、断网都**保留** .part；只有「文件坏了」才丢掉重来。
				const existing = await fileSize(temporary);
				const headers = {
					'X-DSH-Release-Channel': CHANNEL,
					'X-DSH-Desktop-Target-Version': target,
					...(existing > 0 ? { Range: `bytes=${existing}-` } : {}),
				};
				const response = await openGet(DOWNLOAD_ENDPOINT, { headers, signal: controller.signal });
				if (response.status !== 200 && response.status !== 206) throw new Error(`下载服务返回 HTTP ${response.status}`);
				// 只有服务端真的给了 206 才算续传；它要是无视 Range 回了 200，就得从头写。
				const resuming = existing > 0 && response.status === 206;
				const offset = resuming ? existing : 0;
				const total = totalBytesFrom(response.headers, offset);
				this.patch({ receivedBytes: offset, totalBytes: total });

				let received = offset;
				let lastEmit = 0;
				const counter = new Transform({
					transform: (chunk, _encoding, callback) => {
						received += chunk.length;
						const now = Date.now();
						if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
							lastEmit = now;
							const seconds = Math.max(0.5, (now - started) / 1000);
							this.patch({ receivedBytes: received, bytesPerSecond: Math.round((received - offset) / seconds) });
						}
						callback(null, chunk);
					},
				});
				await pipeline(toNodeReadable(response.body), counter, createWriteStream(temporary, { mode: 0o600, flags: offset > 0 ? 'a' : 'w' }), { signal: controller.signal });
				this.patch({ receivedBytes: received });
				try {
					await assertInstaller(temporary);
				} catch (cause) {
					validationFailed = true;
					throw cause;
				}
				await rm(destination, { force: true });
				await rename(temporary, destination);
				return this.finishDownload(destination, target, false);
			} catch (cause) {
				if (validationFailed) await rm(temporary, { force: true }).catch(() => {});
				const aborted = controller.signal.aborted;
				const message = aborted ? '已取消下载' : cause instanceof Error ? cause.message : String(cause);
				if (!aborted) this.info(`dsh-update-vd: 下载失败：${message}`);
				// 取消后回到「有可用更新」，并把已下字节数留着 —— 界面据此显示「继续下载 xx%」。
				if (aborted) return this.patch({ phase: 'available', error: null, bytesPerSecond: 0 });
				return this.patch({ phase: 'error', error: message, bytesPerSecond: 0 });
			} finally {
				if (this.downloadController === controller) this.downloadController = null;
			}
		})().finally(() => {
			if (this.downloadTask === task) this.downloadTask = null;
		});
		this.downloadTask = task;
		return task;
	}

	async finishDownload(path, version, reused) {
		this.info(`dsh-update-vd: 安装包就绪（${reused ? '复用缓存' : '新下载'}）：${path}`);
		this.patch({ phase: 'downloaded', latestVersion: version, artifactPath: path, artifactReady: true, error: null, receivedBytes: this.state.totalBytes || this.state.receivedBytes, bytesPerSecond: 0 });
		if (AUTO_INSTALL) return this.install();
		return this.snapshot();
	}

	cancel() {
		this.downloadController?.abort();
		return this.snapshot();
	}

	// -- 安装 ---------------------------------------------------------------

	async install() {
		if (this.installTask !== null) return this.installTask;
		const task = (async () => {
			const updates = this.updates();
			if (updates?.canDownload === false) throw new Error('当前安装不支持自动更新（非打包版本）');
			const version = this.state.latestVersion;
			const artifact = this.state.artifactPath;
			if (typeof version !== 'string' || typeof artifact !== 'string') throw new Error('还没有可安装的安装包');
			if ((await this.artifactExists(version)) === false) throw new Error('安装包已失效，请重新下载');

			const appPath = resolveAppBundle();
			const scriptPath = join(CACHE_DIR, 'install.sh');
			const logPath = join(CACHE_DIR, 'install.log');
			await mkdir(CACHE_DIR, { recursive: true });
			const template = await readFile(new URL('./install.sh', import.meta.url), 'utf8');
			await writeFileAtomic(scriptPath, template, 0o700);
			await chmod(scriptPath, 0o700);
			await writeFileAtomic(logPath, `[${new Date().toISOString()}] install ${version} → ${appPath}${DRY_RUN ? ' (dry-run)' : ''}\n`, 0o600);

			const args = [scriptPath, artifact, version, appPath, logPath, DRY_RUN ? 'dry-run' : 'real'];
			const child = spawn('/bin/sh', args, {
				detached: true,
				stdio: 'ignore',
				cwd: CACHE_DIR,
				env: { ...process.env, PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH ?? ''}` },
			});
			child.unref();
			this.installing = true;
			this.info(`dsh-update-vd: 已交给安装脚本（pid ${child.pid ?? 0}）`);
			this.patch({ phase: 'installing', appPath, error: null });
			return this.snapshot();
		})()
			.catch((cause) => {
				const message = cause instanceof Error ? cause.message : String(cause);
				this.info(`dsh-update-vd: 安装启动失败：${message}`);
				return this.patch({ phase: 'error', error: message });
			})
			.finally(() => {
				if (this.installTask === task) this.installTask = null;
			});
		this.installTask = task;
		return task;
	}

	// -- 生命周期 -----------------------------------------------------------

	async start() {
		const updates = this.updates();
		if (updates === undefined) {
			this.patch({ supported: false, phase: 'idle', error: null });
			return;
		}
		const current = await this.currentVersion();
		this.patch({ supported: updates.canDownload !== false, currentVersion: current, appPath: resolveAppBundle() });
		await writeFileAtomic(join(CACHE_DIR, 'last-run.json'), `${JSON.stringify({ at: new Date().toISOString(), currentVersion: current, appPath: this.state.appPath }, null, 2)}\n`, 0o600).catch(() => {});
	}
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

/** 统一的 JSON 响应（禁止缓存，否则界面会看到旧进度）。 */
function json(data, status = 200) {
	return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

/** 读一个可选 JSON 请求体，坏体/空体都当 {}。 */
async function readJson(request) {
	try {
		const value = await request.json();
		return value !== null && typeof value === 'object' ? value : {};
	} catch {
		return {};
	}
}

/** 一次性把几个方法包成 route 注册项。 */
function routesFor(manager) {
	const wrap = (handler) => (request) =>
		Promise.resolve()
			.then(() => handler(request))
			.catch((cause) => {
				const message = cause instanceof Error ? cause.message : String(cause);
				return json({ ...manager.snapshot(), error: message, phase: manager.state.phase === 'idle' ? 'error' : manager.state.phase }, 500);
			});
	return [
		{ path: `${ROUTE}/status`, methods: ['GET'], handler: wrap(() => json(manager.snapshot())) },
		{ path: `${ROUTE}/check`, methods: ['POST'], handler: wrap(async () => json(await manager.check())) },
		{
			path: `${ROUTE}/download`,
			methods: ['POST'],
			handler: wrap(async (request) => {
				const body = await readJson(request);
				const version = typeof body.version === 'string' ? body.version : undefined;
				return json(manager.startDownload(version));
			}),
		},
		{ path: `${ROUTE}/install`, methods: ['POST'], handler: wrap(async () => json(await manager.install())) },
		{ path: `${ROUTE}/cancel`, methods: ['POST'], handler: wrap(() => json(manager.cancel())) },
	];
}

// ---------------------------------------------------------------------------
// 技能 / MCP 的路由
// ---------------------------------------------------------------------------

/** 统一的 JSON 成功/失败包装（客户端只看 ok 字段）。 */
function wrapJson(handler) {
	return (request) =>
		Promise.resolve()
			.then(() => handler(request))
			.then((payload) => json({ ok: true, ...payload }))
			.catch((cause) => json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, 400));
}

/** 技能（列表/读/存/删/导入）、MCP（列表/存/删/启停）与智能体预设的路由。 */
function routesForResources(ctx, mcp, agents) {
	const readBody = (request) => readJson(request);
	return [
		{ path: `${ROUTE}/skills`, methods: ['GET'], handler: wrapJson(() => listSkills(ctx)) },
		{ path: `${ROUTE}/skills/read`, methods: ['POST'], handler: wrapJson(async (request) => readSkill(ctx, (await readBody(request)).name)) },
		{ path: `${ROUTE}/skills/save`, methods: ['POST'], handler: wrapJson(async (request) => saveSkill(ctx, await readBody(request))) },
		{ path: `${ROUTE}/skills/delete`, methods: ['POST'], handler: wrapJson(async (request) => deleteSkill(ctx, (await readBody(request)).name)) },
		{ path: `${ROUTE}/skills/import`, methods: ['POST'], handler: wrapJson(async (request) => importSkill(ctx, await readBody(request))) },
		{ path: `${ROUTE}/sources`, methods: ['GET'], handler: wrapJson(async () => ({ sources: await listSources() })) },
		{ path: `${ROUTE}/sources/add`, methods: ['POST'], handler: wrapJson(async (request) => addSource(await readBody(request))) },
		{ path: `${ROUTE}/sources/remove`, methods: ['POST'], handler: wrapJson(async (request) => removeSource(await readBody(request))) },
		{ path: `${ROUTE}/import/local`, methods: ['GET'], handler: wrapJson(async () => detectLocalImports(ctx)) },
		{ path: `${ROUTE}/import/apply`, methods: ['POST'], handler: wrapJson(async (request) => applyLocalImports(ctx, mcp, await readBody(request))) },
		{ path: `${ROUTE}/skills/search`, methods: ['POST'], handler: wrapJson(async (request) => searchSkills(await readBody(request))) },
		{ path: `${ROUTE}/mcp/search`, methods: ['POST'], handler: wrapJson(async (request) => searchMcp(await readBody(request))) },
		{ path: `${ROUTE}/mcp`, methods: ['GET'], handler: wrapJson(async () => ({ servers: mcp.list() })) },
		{ path: `${ROUTE}/mcp/save`, methods: ['POST'], handler: wrapJson(async (request) => mcp.save(await readBody(request))) },
		{ path: `${ROUTE}/mcp/delete`, methods: ['POST'], handler: wrapJson(async (request) => mcp.remove((await readBody(request)).id)) },
		{
			path: `${ROUTE}/mcp/toggle`,
			methods: ['POST'],
			handler: wrapJson(async (request) => {
				const body = await readBody(request);
				return mcp.toggle(body.id, body.enabled);
			}),
		},
		// ── 智能体预设（agent preset）：列表 / 读 / 存 / 删 / 导入 / 导出 / 在线搜索 ──
		{ path: `${ROUTE}/agents`, methods: ['GET'], handler: wrapJson(async () => listAgents(ctx, agents)) },
		{ path: `${ROUTE}/agents/read`, methods: ['POST'], handler: wrapJson(async (request) => readAgent(ctx, agents, (await readBody(request)).id)) },
		{ path: `${ROUTE}/agents/save`, methods: ['POST'], handler: wrapJson(async (request) => saveAgent(ctx, agents, await readBody(request))) },
		{ path: `${ROUTE}/agents/delete`, methods: ['POST'], handler: wrapJson(async (request) => deleteAgent(ctx, agents, (await readBody(request)).id)) },
		{ path: `${ROUTE}/agents/import`, methods: ['POST'], handler: wrapJson(async (request) => importAgent(ctx, agents, await readBody(request))) },
		{ path: `${ROUTE}/agents/export`, methods: ['POST'], handler: wrapJson(async (request) => exportAgents(ctx, agents, await readBody(request))) },
		{ path: `${ROUTE}/agents/search`, methods: ['POST'], handler: wrapJson(async (request) => searchAgents(await readBody(request))) },
		// ── 从其它 AI 导入：默认 4 个来源（Codex / Claude Code / TRAE / WorkBuddy）的探测与导入 ──
		// kind 省略 = agents（老行为，一个字没动）；kind='conversations' 时多带一份对话清单
		{ path: `${ROUTE}/other-ai`, methods: ['GET'], handler: wrapJson(async () => listOtherAi()) },
		{ path: `${ROUTE}/other-ai/conversations`, methods: ['GET'], handler: wrapJson(async () => listOtherAi({ kind: 'conversations' })) },
		{ path: `${ROUTE}/other-ai/conversations/list`, methods: ['POST'], handler: wrapJson(async (request) => listOtherAiConversations(await readBody(request))) },
		{ path: `${ROUTE}/other-ai/conversations/search`, methods: ['POST'], handler: wrapJson(async (request) => searchOtherAiConversations(await readBody(request))) },
		{ path: `${ROUTE}/other-ai/conversations/read`, methods: ['POST'], handler: wrapJson(async (request) => readOtherAiConversation(await readBody(request))) },
		{ path: `${ROUTE}/other-ai/conversations/import`, methods: ['POST'], handler: wrapJson(async (request) => importOtherAiConversations(ctx, await readBody(request))) },
		{ path: `${ROUTE}/other-ai/read`, methods: ['POST'], handler: wrapJson(async (request) => readOtherAiToolkit((await readBody(request)).toolkitId)) },
		{ path: `${ROUTE}/other-ai/import`, methods: ['POST'], handler: wrapJson(async (request) => importOtherAi(ctx, agents, await readBody(request))) },
	];
}

// ---------------------------------------------------------------------------
// 插件本体
// ---------------------------------------------------------------------------

/**
 * 注册更新管理器和它的 HTTP 路由。
 * @param ctx - 宿主上下文（connection 必到；desktopRuntime 可能缺席）。
 */
export function apply(ctx) {
	const logger = (message) => {
		try {
			ctx.logger?.info?.(message);
		} catch {}
	};
	const manager = new DesktopUpdateManager(ctx, logger);
	const mcp = new McpManager(ctx, logger);
	const agents = new AgentManager(ctx, logger);

	// MCP 清单开机就挂上（失败只记日志，不连累更新那半边）
	void mcp
		.load()
		.then(() => mcp.applyAll())
		.then((results) => {
			for (const result of results) if (result.ok !== true) logger(`dsh-update-vd: MCP「${result.name}」挂载失败：${result.error}`);
		})
		.catch((cause) => logger(`dsh-update-vd: MCP 清单读取失败：${cause?.message ?? cause}`));

	// 自定义的智能体预设同样开机就挂上（每一条 = 一行 @deepseek-ai/dsh-agent-preset）
	void agents
		.load()
		.then(() => agents.applyAll())
		.then((results) => {
			for (const result of results) if (result.ok !== true) logger(`dsh-update-vd: 智能体预设「${result.id}」挂载失败：${result.error}`);
		})
		.catch((cause) => logger(`dsh-update-vd: 智能体预设清单读取失败：${cause?.message ?? cause}`));

	ctx.effect(() => {
		const routes = [...routesFor(manager), ...routesForResources(ctx, mcp, agents)];
		// 启动就把「哪一版代码 + 注册了哪些接口」写进宿主日志：排查版本不同步时一眼可见
		logger(`dsh-update-vd: 宿主就绪 code=${CODE_TAG}，注册接口 ${routes.length} 条`);
		const disposeRoutes = routes.map((route) =>
			ctx.connection.fetch.register({
				path: route.path,
				methods: route.methods,
				requestBody: 'buffered',
				fetch: route.handler,
			}),
		);
		return () => {
			for (const dispose of disposeRoutes) {
				try {
					dispose?.();
				} catch {}
			}
			mcp.disposeAll();
			agents.disposeAll();
		};
	}, 'dsh-update-vd: routes');

	ctx.inject(['desktopRuntime'], (scope) => {
		scope.effect(() => {
			let cancelled = false;
			let timer;
			const schedule = (delay) => {
				timer = setTimeout(() => {
					timer = undefined;
					if (cancelled) return;
					void manager.check().finally(() => {
						if (!cancelled) schedule(CHECK_INTERVAL_MS);
					});
				}, delay);
			};
			void manager.start();
			schedule(FIRST_CHECK_DELAY_MS);
			return () => {
				cancelled = true;
				if (timer !== undefined) clearTimeout(timer);
				manager.cancel();
			};
		}, 'dsh-update-vd: 后台检查更新');
	});
}

export { name };
