/**
 * @mhxy13867806343/dsh-update-vd — Client 半边。
 *
 * 两处 UI：
 *   1. `sidebar.footer.action`：侧栏底部、账号那一行**上面**的一行 ——
 *      左边是当前版本号，右边是「检查更新 / 更新」按钮；下载中这里直接显示百分比。
 *   2. `shell.overlay`：更新弹窗（标题「升级 APP」+ 进度条 + 后台升级），
 *      样式与宿主一致（只用 --dsw-alias-* 主题变量，深浅色都跟着走）。
 *
 * 数据来自宿主半边的 /api/dsh-update-vd/*：下载/安装期间 0.6 秒轮询一次，
 * 空闲时 20 秒一次。不直接读 DOM、不碰别人的样式，全部走 slot。
 */

window.__ModuleLoader__.load({
	id: '@mhxy13867806343/dsh-update-vd',
	factory: (require) => {
		const React = require('react');
		const h = React.createElement;

		/**
		 * `react-dom` 只有在真要开 portal 时才需要，所以**惰性**取一次并记住。
		 * 取不到（宿主没装 / 自测假 factory 不认这个模块）就返回 null，调用方走纯 slot 分支。
		 */
		let reactDomCache;
		let reactDomTried = false;
		function reactDom() {
			if (reactDomTried) return reactDomCache;
			reactDomTried = true;
			try {
				reactDomCache = require('react-dom');
			} catch {
				reactDomCache = null;
			}
			return reactDomCache;
		}

		/** 文案命名空间。 */
		const NS = 'dsh-update-vd';
		/** 宿主半边暴露的接口前缀。 */
		const ROUTE = '/api/dsh-update-vd';
		/** 快轮询 / 慢轮询间隔。 */
		const ACTIVE_POLL_MS = 600;
		const IDLE_POLL_MS = 20_000;

		const zh = {
			'row.version': '版本',
			'row.check': '检查更新',
			'row.checking': '检查中',
			'row.update': '更新',
			'row.updating': '更新中',
			'row.view': '查看',
			'row.install': '安装',
			'row.installing': '安装中',
			'row.retry': '重试',
			'row.available': '有新版本',
			'row.downloading': '正在下载',
			'row.ready': '待安装',
			'row.failed': '更新失败',
			'row.title': '更新 DSH Desktop',
			'modal.title': '升级 APP',
			'modal.checking': '正在检查更新，请稍候…',
			'modal.available': '发现新版本，正在开始下载…',
			'modal.uptodate': '已经是最新版本',
			'modal.downloading': '正在为您更新，请耐心等待',
			'modal.downloaded': '下载完成，准备安装…',
			'modal.installing': '下载完成，正在安装并重启应用…',
			'modal.failed': '更新失败',
			'modal.percent': '已下载 {percent}%',
			'modal.bytes': '已下载 {size}',
			'modal.speed': '{speed}/s',
			'modal.cancel': '取消',
			'modal.cancelTitle': '确定要取消下载吗？',
			'modal.cancelDetail': '已下载的部分会保留，下次点「继续下载」从这里接着下。',
			'modal.cancelBack': '继续下载',
			'modal.cancelConfirm': '确定取消',
			'modal.resume': '上次已下载 {percent}%，从断点继续',
			'row.resume': '继续下载',
			'modal.background': '后台升级',
			'modal.installNow': '立即安装并重启',
			'modal.later': '稍后',
			'modal.close': '关闭',
			'modal.retry': '重试',
			'modal.ok': '知道了',
			'modal.warning': '安装时会自动退出并重启 DSH Desktop',
			// ── 「Token 活动」热力图（设置 → 账号与余额 的「充值余额」下面） ──
			'ta.mode.day': '每天',
			'ta.mode.week': '每周',
			'ta.mode.year': '年',
			'ta.mode.total': '累计总量',
			'ta.unit.day': '每天 Token',
			'ta.unit.week': '每周 Token',
			'ta.unit.year': '每年 Token',
			'ta.unit.total': '累计 Token',
			'ta.empty': '还没有 Token 活动记录',
			'ta.emptyHint': '聊过一轮之后，这里会出现一格一天的用量。',
			'ta.error': '用量数据暂时取不到',
			'ta.retry': '重新取一次',
			'ta.loading': '正在统计本机会话日志…',
			'ta.summary': '合计 {total} · 有记录 {days} 天',
			'ta.aria': 'Token 活动热力图，共 {days} 天有记录',
		};
		const en = {
			'row.version': 'Version',
			'row.check': 'Check for updates',
			'row.checking': 'Checking',
			'row.update': 'Update',
			'row.updating': 'Updating',
			'row.view': 'View',
			'row.install': 'Install',
			'row.installing': 'Installing',
			'row.retry': 'Retry',
			'row.available': 'Update available',
			'row.downloading': 'Downloading',
			'row.ready': 'Ready to install',
			'row.failed': 'Update failed',
			'row.title': 'Update DSH Desktop',
			'modal.title': 'Upgrade',
			'modal.checking': 'Checking for updates…',
			'modal.available': 'New version found, starting download…',
			'modal.uptodate': 'You are on the latest version',
			'modal.downloading': 'Updating, please wait',
			'modal.downloaded': 'Download complete, ready to install…',
			'modal.installing': 'Installing and restarting…',
			'modal.failed': 'Update failed',
			'modal.percent': 'Downloaded {percent}%',
			'modal.bytes': 'Downloaded {size}',
			'modal.speed': '{speed}/s',
			'modal.cancel': 'Cancel',
			'modal.cancelTitle': 'Cancel this download?',
			'modal.cancelDetail': 'What has been downloaded is kept; "Continue" picks up where it stopped.',
			'modal.cancelBack': 'Keep downloading',
			'modal.cancelConfirm': 'Cancel download',
			'modal.resume': '{percent}% already downloaded, resuming',
			'row.resume': 'Continue',
			'modal.background': 'Continue in background',
			'modal.installNow': 'Install and restart now',
			'modal.later': 'Later',
			'modal.close': 'Close',
			'modal.retry': 'Retry',
			'modal.ok': 'OK',
			'modal.warning': 'Installing quits and restarts DSH Desktop',
			'ta.mode.day': 'Daily',
			'ta.mode.week': 'Weekly',
			'ta.mode.year': 'Yearly',
			'ta.mode.total': 'Cumulative',
			'ta.unit.day': 'tokens per day',
			'ta.unit.week': 'tokens per week',
			'ta.unit.year': 'tokens per year',
			'ta.unit.total': 'cumulative tokens',
			'ta.empty': 'No token activity yet',
			'ta.emptyHint': 'Cells appear here after your first conversation.',
			'ta.error': 'Usage data is unavailable right now',
			'ta.retry': 'Try again',
			'ta.loading': 'Reading local session logs…',
			'ta.summary': '{total} in total · {days} active days',
			'ta.aria': 'Token activity heatmap, {days} days with activity',
		};

		// -------------------------------------------------------------------
		// 样式（只用宿主主题变量，深浅色自动跟随）
		// -------------------------------------------------------------------

		const CSS = `
.dsu-wrap { width: 100%; }
.dsu-card {
  box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; min-width: 0; margin: 0 2px 6px; padding: 6px 8px;
  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 16px;
}
.dsu-card-main { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.dsu-glyph { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.dsu-card[data-state="available"] .dsu-glyph { color: var(--dsw-alias-brand-primary); }
.dsu-version { font-family: var(--ds-font-family-code, ui-monospace, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsu-arrow { color: var(--dsw-alias-label-secondary); flex: none; }
.dsu-next { color: var(--dsw-alias-brand-primary); font-family: var(--ds-font-family-code, ui-monospace, monospace); white-space: nowrap; }
.dsu-hint { color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsu-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer;
  white-space: nowrap;
}
.dsu-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsu-btn[data-variant="primary"] {
  border-color: transparent; background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted, #fff); font-weight: 500;
}
.dsu-btn[data-variant="primary"]:hover { filter: brightness(1.08); }
.dsu-btn:disabled { opacity: .55; cursor: default; }
.dsu-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.dsu-bar { position: relative; height: 3px; margin: 0 2px 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsu-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); transition: width .25s var(--ds-ease-in-out, ease); }
.dsu-rail {
  display: inline-flex; align-items: center; justify-content: center; position: relative;
  width: 32px; height: 32px; border: none; border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsu-rail:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsu-dot {
  position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
}
.dsu-backdrop {
  position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .38); pointer-events: auto;
}
.dsu-modal {
  box-sizing: border-box; width: 336px; max-width: calc(100vw - 32px);
  padding: 20px 20px 14px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .34); text-align: center; font-size: 14px;
}
.dsu-modal-title { font-size: 16px; font-weight: 600; line-height: 24px; }
.dsu-modal-sub { margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsu-modal-percent { margin-top: 12px; color: var(--dsw-alias-brand-primary); font-size: 13px; font-variant-numeric: tabular-nums; }
.dsu-modal[data-state="failed"] .dsu-modal-percent { color: var(--dsw-alias-state-error-primary); }
.dsu-modal-track { height: 8px; margin-top: 10px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsu-modal-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); transition: width .25s var(--ds-ease-in-out, ease); }
.dsu-modal-actions { display: flex; justify-content: center; gap: 10px; margin-top: 18px; }
.dsu-modal-actions .dsu-btn { height: 30px; padding: 0 16px; font-size: 13px; }
.dsu-modal-warning { margin-top: 12px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
`;

		// -------------------------------------------------------------------
		// 状态存储（轮询宿主，供两个组件共享）
		// -------------------------------------------------------------------

		const listeners = new Set();
		let server = {
			supported: true,
			loaded: false,
			phase: 'idle',
			currentVersion: '',
			latestVersion: null,
			receivedBytes: 0,
			totalBytes: 0,
			percent: 0,
			bytesPerSecond: 0,
			error: null,
			autoInstall: true,
		};
		let ui = { modalOpen: false, confirmCancel: false };
		let snapshot = { ...server, ...ui };
		let pollTimer = null;
		let inFlight = false;
		let failures = 0;
		let running = false;
		/** 刚点过「更新」的一小段时间内强制按「忙」来轮询，避免宿主的阶段还没翻过来时掉进 20 秒空闲轮询。 */
		let optimisticUntil = 0;

		function publish() {
			snapshot = { ...server, ...ui };
			for (const listener of listeners) {
				try {
					listener();
				} catch {}
			}
		}

		function subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}

		function getSnapshot() {
			return snapshot;
		}

		function setServer(next) {
			server = { ...server, ...next };
			publish();
		}

		function setUi(next) {
			ui = { ...ui, ...next };
			publish();
		}

		function isBusy() {
			if (Date.now() < optimisticUntil) return true;
			return server.phase === 'downloading' || server.phase === 'installing' || server.phase === 'checking';
		}

		function schedule() {
			if (!running) return;
			if (pollTimer !== null) clearTimeout(pollTimer);
			pollTimer = setTimeout(() => {
				pollTimer = null;
				void refresh();
			}, isBusy() ? ACTIVE_POLL_MS : IDLE_POLL_MS);
		}

		async function refresh() {
			if (inFlight || !running) return;
			inFlight = true;
			try {
				const response = await fetch(`${ROUTE}/status`, { cache: 'no-store' });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const data = await response.json();
				failures = 0;
				setServer({ ...data, error: data.error ?? null, loaded: true });
			} catch {
				failures += 1;
				if (failures >= 3 && server.currentVersion === '') setServer({ supported: false });
			} finally {
				inFlight = false;
				schedule();
			}
		}

		async function post(path, body) {
			let response;
			try {
				response = await fetch(`${ROUTE}${path}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body ?? {}),
					cache: 'no-store',
				});
			} catch {
				// 触发类请求本身失败不覆盖界面：进度和错误一律以宿主的 /status 为准。
				void refresh();
				return null;
			}
			let data = null;
			try {
				data = await response.json();
			} catch {}
			if (data !== null && typeof data === 'object') setServer({ ...data, error: data.error ?? null });
			schedule();
			return data;
		}

		function start() {
			if (running) return;
			running = true;
			void refresh();
		}

		function stop() {
			running = false;
			if (pollTimer !== null) clearTimeout(pollTimer);
			pollTimer = null;
		}

		/** 「更新」按钮：打开弹窗并立刻开始下载。 */
		async function beginUpdate() {
			setUi({ modalOpen: true, confirmCancel: false });
			const phase = server.phase;
			if (phase === 'downloaded') {
				optimisticUntil = Date.now() + 5000;
				return post('/install');
			}
			if (phase === 'available' || phase === 'error' || server.artifactReady === true) {
				optimisticUntil = Date.now() + 10000;
				const data = await post('/download');
				void refresh();
				return data;
			}
			const data = await post('/check');
			if (data !== null && data.phase === 'available') {
				optimisticUntil = Date.now() + 10000;
				const started = await post('/download');
				void refresh();
				return started;
			}
			return data;
		}

		function useStatus() {
			return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}

		// -------------------------------------------------------------------
		// 小部件
		// -------------------------------------------------------------------

		function formatSize(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
			const units = ['B', 'KB', 'MB', 'GB'];
			let value = bytes;
			let index = 0;
			while (value >= 1024 && index < units.length - 1) {
				value /= 1024;
				index += 1;
			}
			return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
		}

		function ArrowGlyph({ size = 14, active = false }) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, className: 'dsu-glyph' },
				h('path', {
					d: 'M8 12.5V3.5M8 3.5L4.5 7M8 3.5L11.5 7',
					stroke: 'currentColor',
					strokeWidth: 1.3,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					opacity: active ? 1 : 0.7,
				}),
			);
		}

		function footerLabel(t, state) {
			const version = state.currentVersion === '' ? '—' : state.currentVersion;
			// 每一态都用同一个 dsu-card-main 包住左边内容：它 flex:1，
			// 才能把右边的按钮顶到卡片最右边（否则按钮会贴着文字飘在中间）。
			const line = (active, ...children) => h('span', { className: 'dsu-card-main' }, h(ArrowGlyph, { active }), ...children);
			if (state.phase === 'downloading') {
				// 服务端没给 content-length 时不硬凑百分比，改报已下体积。
				const text = state.totalBytes > 0 ? `${t('row.downloading')} ${state.percent}%` : `${t('row.downloading')} ${formatSize(state.receivedBytes)}`;
				return line(true, h('span', { className: 'dsu-hint' }, text));
			}
			if (state.phase === 'downloaded') return line(true, h('span', { className: 'dsu-hint' }, t('row.ready')));
			if (state.phase === 'installing') return line(true, h('span', { className: 'dsu-hint' }, t('row.installing')));
			if (state.phase === 'checking') return line(false, h('span', { className: 'dsu-hint' }, t('row.checking')));
			if (state.phase === 'error') return line(false, h('span', { className: 'dsu-hint' }, t('row.failed')));
			if (state.phase === 'available') {
				return line(
					true,
					h('span', { className: 'dsu-version' }, version),
					h('span', { className: 'dsu-arrow' }, '→'),
					h('span', { className: 'dsu-next' }, state.latestVersion ?? ''),
				);
			}
			return line(false, h('span', { className: 'dsu-hint' }, `${t('row.version')}`), h('span', { className: 'dsu-version' }, version));
		}

		function footerAction(t, state) {
			const hasPartial = state.receivedBytes > 0 && state.totalBytes > 0;
			if (state.phase === 'available') return { label: hasPartial ? t('row.resume') : t('row.update'), variant: 'primary', run: beginUpdate };
			if (state.phase === 'downloading') return { label: t('row.view'), variant: 'default', run: () => setUi({ modalOpen: true }) };
			if (state.phase === 'downloaded') return { label: t('row.install'), variant: 'primary', run: beginUpdate };
			if (state.phase === 'installing') return { label: t('row.installing'), variant: 'default', run: () => setUi({ modalOpen: true }), disabled: true };
			if (state.phase === 'checking') return { label: t('row.checking'), variant: 'default', run: () => setUi({ modalOpen: true }), disabled: true };
			if (state.phase === 'error') return { label: t('row.retry'), variant: 'default', run: beginUpdate };
			return { label: t('row.check'), variant: 'default', run: beginUpdate };
		}

		/** 侧栏底部那一行：左边版本号，右边按钮。 */
		// ===================================================================
		// 更新日志：点侧栏那行左边的「版本 2.0.17」打开（纯客户端，内联样式不依赖 <style>）
		// ===================================================================
		const RELEASE_PAGE = 'https://www.dshdesktop.cn/';
		const changelogUi = {
			open: false,
			listeners: new Set(),
			set(open) {
				this.open = open;
				for (const notify of this.listeners) notify();
			},
			subscribe(notify) {
				this.listeners.add(notify);
				return () => this.listeners.delete(notify);
			},
		};
		function useChangelogOpen() {
			const [open, setOpen] = React.useState(changelogUi.open);
			React.useEffect(() => changelogUi.subscribe(() => setOpen(changelogUi.open)), []);
			return open;
		}

		/** 更新日志 / 版本信息弹窗。 */
		function ChangelogModal({ t }) {
			const open = useChangelogOpen();
			const state = useStatus();
			if (open !== true) return null;
			const rows = [
				['当前版本', state.currentVersion ?? '—'],
				['最新版本', state.latestVersion ?? '—'],
				['更新渠道', state.channel ?? 'stable'],
				['平台', state.platform ?? 'darwin'],
				['最近检查', state.updatedAt === undefined ? '—' : new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false })],
				['状态', state.phase ?? '—'],
			];
			return h(
				'div',
				{
					style: { position: 'fixed', inset: 0, zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'color-mix(in srgb, #000 42%, transparent)' },
					onClick: (event) => {
						if (event.target === event.currentTarget) changelogUi.set(false);
					},
				},
				h(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '10px', width: 'min(560px, 100%)', padding: '16px', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: '14px', background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1))', boxShadow: '0 18px 48px rgb(0 0 0 / 38%)' } },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
						h('span', { style: { fontSize: '15px', fontWeight: '600' } }, '更新日志'),
						h('span', { style: { flex: '1' } }),
						h('button', { className: 'dsu-btn', type: 'button', title: '关闭（Esc）', onClick: () => changelogUi.set(false) }, '✕'),
					),
					h(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', fontSize: '13px' } },
						rows.map(([key, value]) =>
							h(
								'div',
								{ key, style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)' } },
								h('span', { style: { width: '84px', flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, key),
								h('span', { style: { minWidth: 0, wordBreak: 'break-all' } }, String(value)),
							),
						),
					),
					h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '这里显示的是本机记录的版本核对信息；完整的版本更新说明在官网页面上。'),
					h(
						'div',
						{ style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
						h('button', { className: 'dsu-btn', type: 'button', 'data-variant': 'primary', onClick: () => window.open(RELEASE_PAGE, '_blank', 'noreferrer') }, '打开更新日志页面'),
						h('span', { style: { flex: '1' } }),
						h('button', { className: 'dsu-btn', type: 'button', onClick: () => changelogUi.set(false) }, '关闭'),
					),
				),
			);
		}

		function SidebarUpdateRow({ wide, t }) {
			const state = useStatus();
			// 第一次拿到状态之前不画，免得先闪一下「版本 —」。
			if (state.loaded !== true || state.supported === false) return null;
			if (wide === false) {
				const active = state.phase === 'available' || state.phase === 'downloaded';
				return h(
					'button',
					{
						type: 'button',
						className: 'dsu-rail',
						title: t('row.title'),
						onClick: () => (state.phase === 'downloading' ? setUi({ modalOpen: true }) : void beginUpdate()),
					},
					h('style', null, CSS),
					h(ArrowGlyph, { size: 18, active }),
					active ? h('span', { className: 'dsu-dot' }) : null,
				);
			}
			const action = footerAction(t, state);
			const showBar = state.phase === 'downloading' || state.phase === 'installing';
			return h(
				'div',
				{ className: 'dsu-wrap' },
				h('style', null, CSS),
				h(
					'div',
					{ className: 'dsu-card', 'data-state': state.phase },
					// 点「版本 2.0.17」这半边 → 打开更新日志弹窗
					h(
						'button',
						{
							type: 'button',
							title: '查看更新日志',
							onClick: () => changelogUi.set(true),
							style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1', minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
						},
						footerLabel(t, state),
					),
					h(
						'button',
						{
							type: 'button',
							className: 'dsu-btn',
							'data-variant': action.variant,
							disabled: action.disabled === true,
							onClick: action.run,
						},
						action.label,
					),
				),
				showBar ? h('div', { className: 'dsu-bar' }, h('div', { className: 'dsu-bar-fill', style: { width: `${state.percent}%` } })) : null,
			);
		}

		/** 更新弹窗：进度条 + 后台升级 + 取消的二次确认。 */
		function UpdateModal({ t }) {
			const state = useStatus();
			const open = state.modalOpen === true;
			const confirming = open && state.confirmCancel === true;
			const phase = state.phase;
			const percent = phase === 'downloaded' || phase === 'installing' ? 100 : state.percent;
			const showTrack = phase === 'downloading' || phase === 'downloaded' || phase === 'installing';

			// Esc：先收回二次确认，再隐藏弹窗。隐藏 = 后台升级，下载继续进行。
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key !== 'Escape') return;
					setUi(snapshot.confirmCancel === true ? { confirmCancel: false } : { modalOpen: false });
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [open]);

			if (!open) return null;

			const title = t('modal.title');
			const hasPartial = state.receivedBytes > 0 && state.totalBytes > 0;
			let sub = t('modal.downloading');
			if (phase === 'checking' || phase === 'idle') sub = t('modal.checking');
			else if (phase === 'available') sub = hasPartial ? t('modal.resume', { percent: String(state.percent) }) : t('modal.available');
			else if (phase === 'up-to-date') sub = t('modal.uptodate');
			else if (phase === 'downloaded') sub = t('modal.downloaded');
			else if (phase === 'installing') sub = t('modal.installing');
			else if (phase === 'error') sub = state.error ?? t('modal.failed');
			if (confirming) sub = t('modal.cancelTitle');

			let percentText = null;
			if (phase === 'downloading') {
				percentText =
					state.totalBytes > 0 ? t('modal.percent', { percent: String(state.percent) }) : t('modal.bytes', { size: formatSize(state.receivedBytes) });
			} else if (phase === 'downloaded' || phase === 'installing') {
				percentText = t('modal.percent', { percent: '100' });
			}

			const actions = [];
			if (confirming) {
				// 安全的那一个（继续下载）当主按钮。
				actions.push(
					h('button', { key: 'keep', type: 'button', className: 'dsu-btn', 'data-variant': 'primary', onClick: () => setUi({ confirmCancel: false }) }, t('modal.cancelBack')),
				);
				actions.push(
					h(
						'button',
						{
							key: 'stop',
							type: 'button',
							className: 'dsu-btn',
							onClick: () => {
								setUi({ confirmCancel: false });
								void post('/cancel');
							},
						},
						t('modal.cancelConfirm'),
					),
				);
			} else if (phase === 'downloading') {
				actions.push(h('button', { key: 'cancel', type: 'button', className: 'dsu-btn', onClick: () => setUi({ confirmCancel: true }) }, t('modal.cancel')));
				actions.push(
					h('button', { key: 'bg', type: 'button', className: 'dsu-btn', 'data-variant': 'primary', onClick: () => setUi({ modalOpen: false, confirmCancel: false }) }, t('modal.background')),
				);
			} else if (phase === 'downloaded' && state.autoInstall !== true) {
				actions.push(h('button', { key: 'later', type: 'button', className: 'dsu-btn', onClick: () => setUi({ modalOpen: false, confirmCancel: false }) }, t('modal.later')));
				actions.push(
					h('button', { key: 'now', type: 'button', className: 'dsu-btn', 'data-variant': 'primary', onClick: () => void post('/install') }, t('modal.installNow')),
				);
			} else if (phase === 'error') {
				actions.push(h('button', { key: 'close', type: 'button', className: 'dsu-btn', onClick: () => setUi({ modalOpen: false, confirmCancel: false }) }, t('modal.close')));
				actions.push(
					h('button', { key: 'retry', type: 'button', className: 'dsu-btn', 'data-variant': 'primary', onClick: () => void beginUpdate() }, t('modal.retry')),
				);
			} else if (phase === 'up-to-date') {
				actions.push(
					h('button', { key: 'ok', type: 'button', className: 'dsu-btn', 'data-variant': 'primary', onClick: () => setUi({ modalOpen: false, confirmCancel: false }) }, t('modal.ok')),
				);
			}

			const warning = confirming
				? t('modal.cancelDetail')
				: phase === 'downloading' || phase === 'installing'
					? t('modal.warning')
					: null;

			return h(
				'div',
				{
					className: 'dsu-backdrop',
					role: 'presentation',
					onClick: (event) => {
						// 只有点在背景上才算（点卡片不算）。点空白 = 后台升级，下载不中断。
						if (event.target !== event.currentTarget) return;
						if (confirming) setUi({ confirmCancel: false });
						else setUi({ modalOpen: false, confirmCancel: false });
					},
				},
				h('style', null, CSS),
				h(
					'div',
					{ className: 'dsu-modal', 'data-state': phase, role: 'dialog', 'aria-modal': true, 'aria-label': title },
					h('div', { className: 'dsu-modal-title' }, title),
					h('div', { className: 'dsu-modal-sub' }, sub),
					percentText === null ? null : h('div', { className: 'dsu-modal-percent' }, percentText),
					showTrack ? h('div', { className: 'dsu-modal-track' }, h('div', { className: 'dsu-modal-fill', style: { width: `${percent}%` } })) : null,
					actions.length > 0 ? h('div', { className: 'dsu-modal-actions' }, actions) : null,
					warning === null ? null : h('div', { className: 'dsu-modal-warning' }, warning),
				),
			);
		}

		// ===================================================================
		// 笔记：侧栏一行 + 中间弹窗（增删改查 / 搜索 / 可调分页 / 多选插入输入框）
		// 数据只存在本机 localStorage —— 纯客户端功能，刷新页面就生效，不用重启应用。
		// ===================================================================
		const NOTES_KEY = 'dsh-notes/v1';
		const NOTES_SEED = [
			{ id: 'seed-1', title: 'git 提交（带身份）', content: 'cd "<仓库目录>"\ngit add -A\ngit -c user.name=\'名字\' -c user.email=\'邮箱\' commit -m "说明"\ngit -c credential.helper= -c credential.helper=\'!gh auth git-credential\' push origin main', updatedAt: 0 },
			{ id: 'seed-2', title: '回到上一个提交（保留改动）', content: 'git reset --soft HEAD~1', updatedAt: 0 },
			{ id: 'seed-3', title: '看今天改了哪些文件', content: 'git status --short\ngit log --oneline -5', updatedAt: 0 },
		];

		function loadNotes() {
			try {
				const raw = localStorage.getItem(NOTES_KEY);
				if (raw === null) {
					localStorage.setItem(NOTES_KEY, JSON.stringify(NOTES_SEED));
					return NOTES_SEED.slice();
				}
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}
		function persistNotes(list) {
			try {
				localStorage.setItem(NOTES_KEY, JSON.stringify(list));
			} catch {}
		}

		/** 笔记数据 + 弹窗开合，都是极简 store：变更后通知所有订阅者。 */
		const notesStore = {
			list: null,
			listeners: new Set(),
			get() {
				if (this.list === null) this.list = loadNotes();
				return this.list;
			},
			set(next) {
				this.list = next;
				persistNotes(next);
				for (const notify of this.listeners) notify();
			},
			subscribe(notify) {
				this.listeners.add(notify);
				return () => this.listeners.delete(notify);
			},
		};
		const notesUi = {
			open: false,
			listeners: new Set(),
			set(open) {
				this.open = open;
				for (const notify of this.listeners) notify();
			},
			subscribe(notify) {
				this.listeners.add(notify);
				return () => this.listeners.delete(notify);
			},
		};
		function useNotesList() {
			const [list, setList] = React.useState(() => notesStore.get());
			React.useEffect(() => notesStore.subscribe(() => setList(notesStore.get())), []);
			return list;
		}
		function useNotesOpen() {
			const [open, setOpen] = React.useState(notesUi.open);
			React.useEffect(() => notesUi.subscribe(() => setOpen(notesUi.open)), []);
			return open;
		}

		const NOTES_CSS = `
.dsn-row { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 8px; border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
.dsn-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsn-row-count { margin-left: auto; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsn-row-rail { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsn-row-rail:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsn-mask { position: fixed; inset: 0; z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 42%, transparent); }
.dsn-card { display: flex; flex-direction: column; width: min(760px, 100%); max-height: min(78vh, 720px); border: .5px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)); box-shadow: 0 18px 48px rgb(0 0 0 / 38%); overflow: hidden; }
.dsn-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: .5px solid var(--dsw-alias-border-l1); }
.dsn-title { font-size: 15px; font-weight: 600; }
.dsn-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.dsn-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px; border-top: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dsn-input, .dsn-select, .dsn-area { box-sizing: border-box; width: 100%; padding: 7px 10px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 6px); }
.dsn-area { min-height: 200px; resize: vertical; line-height: 20px; white-space: pre-wrap; }
.dsn-btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.dsn-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsn-btn[data-variant="primary"] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted, #fff); font-weight: 500; }
.dsn-btn[data-variant="danger"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsn-btn[disabled] { opacity: .5; cursor: default; }
.dsn-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.dsn-item[data-picked="true"] { border-color: var(--dsw-alias-brand-primary); }
.dsn-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dsn-item-title { font-size: 13px; font-weight: 500; }
.dsn-item-body { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dsn-item-time { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsn-item-actions { display: flex; gap: 6px; flex: none; }
.dsn-spacer { flex: 1; }
.dsn-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsn-warn { font-size: 12px; color: var(--dsw-alias-state-warn-primary); }
.dsn-empty { padding: 26px 0; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsn-pages { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsn-counter { font-size: 12px; color: var(--dsw-alias-label-secondary); }
`;

		/**
		 * 取当前会话输入框的官方动词面（宿主 `uiSession` 服务暴露的 inputActions）。
		 * 返回 {actions, draft} / {noSession:true} / null（服务拿不到 → 调用方退回 DOM）。
		 */
		function composerApi() {
			try {
				const snapshot = notesCtx?.get?.('uiSession')?.adapter?.current?.getSnapshot?.();
				if (snapshot === undefined || snapshot === null) return null;
				if (snapshot.key === undefined) return { noSession: true };
				const actions = snapshot.props?.inputActions;
				if (actions === undefined) return null;
				return { actions, draft: currentDraft(snapshot) };
			} catch {
				return null;
			}
		}

		/**
		 * 读当前草稿。
		 *
		 * 为什么不用 `snapshot.hooks.input.draft`：宿主的 hooks 是**可观察源**，不是快照对象 ——
		 * ui-conversation 递进来的是 `shell.state`（`createSnapshotStore(compose())` 的返回值，
		 * 形状是 {getSnapshot, subscribe, update}），渲染器再把它包成组件用的 `useInput(selector)`。
		 * 所以直接取 `.draft` 永远是 undefined，等于「草稿是空的」，
		 * 后面 setDraft(新文本) 就会把用户已经打好的草稿**整段冲掉**。
		 * 顺带兜一下纯对象形态（万一将来宿主改了投影方式）。
		 */
		function currentDraft(snapshot) {
			const source = snapshot?.hooks?.input;
			if (source === undefined || source === null) return '';
			const value = typeof source.getSnapshot === 'function' ? source.getSnapshot() : source;
			return typeof value?.draft === 'string' ? value.draft : '';
		}

		/** 插一段文本进输入框：优先官方 API（setDraft），拿不到才退回 DOM。 */
		function insertTextIntoInput(text) {
			const api = composerApi();
			if (api !== null && api.noSession === true) return { ok: false, reason: 'no-session' };
			if (api !== null) {
				const next = api.draft.trim() === '' ? text : `${api.draft.replace(/\s+$/u, '')}\n\n${text}`;
				if (typeof api.actions.setDraft === 'function') {
					api.actions.setDraft(next);
					return { ok: true, via: 'setDraft' };
				}
				// 注意：inputActions.insertText(text, span) 需要 captureInsertion() 给的 span
				// （内部会读 span.draftRev 校验），只传文本会直接抛错，所以这里不拿它当退路，
				// 没有 setDraft 就走下面的 DOM 兜底。
			}
			// 退路：官方服务拿不到时直接操作 DOM（textarea 走原生 setter + input 事件，contenteditable 走 execCommand）
			if (insertIntoComposer(text) === true) return { ok: true, via: 'dom' };
			return { ok: false, reason: 'no-input' };
		}

		/** 把文本写进当前会话的输入框；没有输入框（没打开会话/没选工作区）就返回 false。 */
		function insertIntoComposer(text) {
			if (typeof document === 'undefined') return false;
			const nodes = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter((node) => {
				if (node.closest('[data-dsn-notes]') !== null) return false;      // 不要写回弹窗自己的输入框
				if (node.getAttribute('aria-hidden') === 'true') return false;
				const rect = node.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			});
			const target = nodes.find((node) => node.tagName === 'TEXTAREA') ?? nodes[0];
			if (target === undefined) return false;
			target.focus();
			if (target.tagName === 'TEXTAREA') {
				// React 受控组件：必须走原生 setter 再派发 input，否则 React 不知道值变了
				const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
				const current = target.value;
				const next = current.trim() === '' ? text : `${current.replace(/\s+$/u, '')}\n\n${text}`;
				descriptor?.set?.call(target, next);
				target.dispatchEvent(new Event('input', { bubbles: true }));
				target.setSelectionRange(next.length, next.length);
				return true;
			}
			const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
			const range = document.createRange();
			range.selectNodeContents(target);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.execCommand('insertText', false, text);
			return true;
		}

		/** 多条笔记 → 一段可粘贴的文本。 */
		function notesToText(notes) {
			// 只插一条：就要那条内容本身（用户多半是要把这行命令粘进去）
			if (notes.length === 1) return notes[0].content.trim();
			return notes
				.map((note) => (note.title.trim() === '' ? note.content.trim() : `# ${note.title.trim()}\n${note.content.trim()}`))
				.join('\n\n');
		}
		const noteTime = (note) => (note.updatedAt === 0 || note.updatedAt === undefined ? '内置示例' : new Date(note.updatedAt).toLocaleString('zh-CN', { hour12: false }));

		/** 侧栏那一行「笔记」。 */
		function NotesRow({ wide }) {
			const list = useNotesList();
			const open = useNotesOpen();
			const toggle = () => notesUi.set(!open);
			if (wide === false) {
				// 窄栏也要自带 <style>：折叠侧栏时别的地方可能一个 <style> 都没渲染过，
				// 少了它这个按钮就是浏览器默认外观（更新行同一分支也是这么做的）。
				return h(
					'button',
					{ className: 'dsn-row-rail', type: 'button', title: `笔记（${list.length} 条）`, onClick: toggle },
					h('style', null, NOTES_CSS),
					h('span', null, '📝'),
				);
			}
			return h(
				'div',
				{ style: { width: '100%', display: 'block' } },
				h('style', null, NOTES_CSS),
				h(
					'button',
					{
						className: 'dsn-row',
						type: 'button',
						title: '打开笔记（命令 / git 提交之类，可多选插进输入框）',
						onClick: toggle,
						// 内联兜底：不依赖 <style> 一定能作用上，宽度/对齐永远是对的
						style: { boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '6px', width: '100%', height: '28px', padding: '0 8px', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px', cursor: 'pointer', textAlign: 'left' },
					},
					h('span', null, '📝'),
					h('span', null, '笔记'),
					h('span', { className: 'dsn-row-count' }, String(list.length)),
				),
			);
		}

		/** 笔记弹窗：列表 / 编辑 / 删除确认三种视图。 */
		function NotesModal() {
			const open = useNotesOpen();
			const list = useNotesList();
			const [query, setQuery] = React.useState('');
			const [pageSize, setPageSize] = React.useState(10);
			const [page, setPage] = React.useState(1);
			const [picked, setPicked] = React.useState([]);
			const [view, setView] = React.useState({ kind: 'list' });
			const [hint, setHint] = React.useState(null);
			React.useEffect(() => {
				if (open !== true) return;
				const onKey = (event) => {
					if (event.key === 'Escape') notesUi.set(false);
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [open]);
			if (open !== true) return null;

			const filtered = list.filter((note) => {
				const keyword = query.trim().toLowerCase();
				return keyword === '' || `${note.title} ${note.content}`.toLowerCase().includes(keyword);
			});
			const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
			const current = Math.min(page, pages);
			const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
			const pickedNotes = list.filter((note) => picked.includes(note.id));
			const errorLine = hint === null ? null : h('div', { className: 'dsn-warn' }, hint);

			const doInsert = (notes) => {
				const result = insertTextIntoInput(notesToText(notes));
				if (result.ok === true) {
					// 插成功就把弹窗收掉：内容已经在输入框里了，不需要用户再点一次关闭
					setPicked([]);
					notesUi.set(false);
					return;
				}
				setHint(result.reason === 'no-session' ? '请先在左侧选一个工作区目录、打开一个会话，再插入。' : '没找到可写入的输入框：请先打开一个会话（输入框出现后）再插入。');
			};
			// 页码：页数多的时候中间省略
			const pageList = [];
			for (let index = 1; index <= pages; index += 1) {
				if (pages > 7 && index > 1 && index < pages && Math.abs(index - current) > 1) {
					if (pageList[pageList.length - 1] !== '…') pageList.push('…');
					continue;
				}
				pageList.push(index);
			}
			const remove = (id) => notesStore.set(notesStore.get().filter((note) => note.id !== id));
			const upsert = (draft, id) => {
				const now = Date.now();
				const title = draft.title.trim() === '' ? draft.content.trim().split('\n')[0].slice(0, 50) : draft.title.trim();
				const record = { id: id ?? `note-${now}-${Math.random().toString(36).slice(2, 7)}`, title, content: draft.content, updatedAt: now };
				const existing = notesStore.get();
				notesStore.set(id === undefined ? [record, ...existing] : existing.map((note) => (note.id === id ? record : note)));
				setView({ kind: 'list' });
			};

			if (view.kind === 'edit') {
				const draft = view.draft;
				return h(
					'div',
					{ className: 'dsn-mask', 'data-dsn-notes': '1', onClick: (event) => { if (event.target === event.currentTarget) notesUi.set(false); } },
					h(
						'div',
						{ className: 'dsn-card' },
						h('style', null, NOTES_CSS),
						h('div', { className: 'dsn-head' }, h('span', { className: 'dsn-title' }, view.isNew ? '新增笔记' : '编辑笔记'), h('span', { className: 'dsn-spacer' }), h('button', { className: 'dsn-btn', type: 'button', onClick: () => setView({ kind: 'list' }) }, '返回列表')),
						h(
							'div',
							{ className: 'dsn-body' },
							h(
								'div',
								null,
								h('div', { className: 'dsn-hint' }, '标题（最多 50 字）'),
								h('input', { className: 'dsn-input', maxLength: 50, value: draft.title, onChange: (event) => setView({ ...view, draft: { ...draft, title: event.target.value } }), placeholder: '例如：git 提交（带身份）' }),
								h('div', { className: 'dsn-counter' }, `${draft.title.length}/50`),
							),
							h(
								'div',
								null,
								h('div', { className: 'dsn-hint' }, '内容（最多 1000 字，命令 / 提交说明 / 片段都行）'),
								h('textarea', { className: 'dsn-area', maxLength: 1000, value: draft.content, onChange: (event) => setView({ ...view, draft: { ...draft, content: event.target.value } }), placeholder: '要记下的命令或文字…' }),
								h('div', { className: 'dsn-counter' }, `${draft.content.length}/1000`),
							),
						),
						h(
							'div',
							{ className: 'dsn-foot' },
							h('button', { className: 'dsn-btn', type: 'button', onClick: () => setView({ kind: 'list' }) }, '取消'),
							h('span', { className: 'dsn-spacer' }),
							h('button', { className: 'dsn-btn', type: 'button', 'data-variant': 'primary', disabled: draft.title.trim() === '' && draft.content.trim() === '', onClick: () => upsert(draft, view.isNew ? undefined : draft.id) }, '保存'),
						),
					),
				);
			}

			if (view.kind === 'confirm') {
				return h(
					'div',
					{ className: 'dsn-mask', 'data-dsn-notes': '1', onClick: (event) => { if (event.target === event.currentTarget) notesUi.set(false); } },
					h(
						'div',
						{ className: 'dsn-card', style: { width: 'min(520px, 100%)' } },
						h('style', null, NOTES_CSS),
						h('div', { className: 'dsn-head' }, h('span', { className: 'dsn-title' }, '删除笔记'), h('span', { className: 'dsn-spacer' })),
						h(
							'div',
							{ className: 'dsn-body' },
							h('div', null, `确定要删除「${view.note.title || '(无标题)'}」吗？`),
							h('div', { className: 'dsn-item-body' }, view.note.content.slice(0, 160)),
							h('div', { className: 'dsn-hint' }, '删掉就没了，不能撤销。'),
						),
						h(
							'div',
							{ className: 'dsn-foot' },
							h('button', { className: 'dsn-btn', type: 'button', onClick: () => setView({ kind: 'list' }) }, '取消'),
							h('span', { className: 'dsn-spacer' }),
							h('button', { className: 'dsn-btn', type: 'button', 'data-variant': 'danger', onClick: () => { remove(view.note.id); setPicked(picked.filter((id) => id !== view.note.id)); setView({ kind: 'list' }); } }, '确定删除'),
						),
					),
				);
			}

			return h(
				'div',
				{ className: 'dsn-mask', 'data-dsn-notes': '1', onClick: (event) => { if (event.target === event.currentTarget) notesUi.set(false); } },
				h(
					'div',
					{ className: 'dsn-card' },
					h('style', null, NOTES_CSS),
					h(
						'div',
						{ className: 'dsn-head' },
						h('span', { className: 'dsn-title' }, '笔记'),
						h('span', { className: 'dsn-hint' }, `共 ${list.length} 条`),
						h('span', { className: 'dsn-spacer' }),
						h('button', { className: 'dsn-btn', type: 'button', 'data-variant': 'primary', onClick: () => { setHint(null); setView({ kind: 'edit', isNew: true, draft: { title: '', content: '' } }); } }, '新增'),
						h('button', { className: 'dsn-btn', type: 'button', title: '关闭（Esc）', onClick: () => notesUi.set(false) }, '✕'),
					),
					h(
						'div',
						{ className: 'dsn-body' },
						h('input', { className: 'dsn-input', placeholder: '搜索笔记（标题或内容）…', value: query, onChange: (event) => { setQuery(event.target.value); setPage(1); } }),
						// 全选：本页一个勾，跨页给个按钮（筛选结果一起选）
						h(
							'div',
							{ className: 'dsn-actions-row', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
							h(
								'label',
								{ className: 'dsn-hint', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
								h('input', {
									type: 'checkbox',
									checked: rows.length > 0 && rows.every((note) => picked.includes(note.id)),
									onChange: (event) =>
										setPicked(
											event.target.checked
												? [...new Set([...picked, ...rows.map((note) => note.id)])]
												: picked.filter((id) => !rows.some((note) => note.id === id)),
										),
								}),
								`全选本页（${rows.length} 条）`,
							),
							h('button', { className: 'dsn-btn', type: 'button', disabled: filtered.length === 0, onClick: () => setPicked(filtered.map((note) => note.id)) }, `全选全部 ${filtered.length} 条`),
							picked.length === 0 ? null : h('button', { className: 'dsn-btn', type: 'button', onClick: () => setPicked([]) }, '清空选择'),
							h('span', { className: 'dsn-spacer' }),
							h('span', { className: 'dsn-hint' }, `已选 ${picked.length} 条`),
						),
						errorLine,
						rows.length === 0
							? h('div', { className: 'dsn-empty' }, list.length === 0 ? '还没有笔记，点「新增」记一条（比如你常用的 git 命令）。' : '没有匹配的笔记。')
							: rows.map((note) =>
									h(
										'div',
										{ className: 'dsn-item', key: note.id, 'data-picked': picked.includes(note.id) ? 'true' : 'false' },
										h('input', { type: 'checkbox', checked: picked.includes(note.id), onChange: (event) => setPicked(event.target.checked ? [...picked, note.id] : picked.filter((id) => id !== note.id)) }),
										h(
											'div',
											{ className: 'dsn-item-main' },
											h('div', { className: 'dsn-item-title' }, note.title || '(无标题)'),
											h('div', { className: 'dsn-item-body' }, note.content),
											h('div', { className: 'dsn-item-time' }, noteTime(note)),
										),
										h(
											'div',
											{ className: 'dsn-item-actions' },
											h('button', { className: 'dsn-btn', type: 'button', onClick: () => { setHint(null); doInsert([note]); } }, '插入'),
											h('button', { className: 'dsn-btn', type: 'button', onClick: () => { setHint(null); setView({ kind: 'edit', isNew: false, draft: { id: note.id, title: note.title, content: note.content } }); } }, '编辑'),
											h('button', { className: 'dsn-btn', type: 'button', 'data-variant': 'danger', onClick: () => setView({ kind: 'confirm', note }) }, '删除'),
										),
									),
								),
					),
					h(
						'div',
						{ className: 'dsn-foot' },
						h('label', { className: 'dsn-hint' }, '每页 '),
						h(
							'select',
							{ className: 'dsn-select', style: { width: '86px' }, value: String(pageSize), onChange: (event) => { setPageSize(Number(event.target.value)); setPage(1); } },
							[10, 20, 50, 100].map((size) => h('option', { key: size, value: String(size) }, `${size} 条`)),
						),
						h('span', { className: 'dsn-hint' }, `第 ${current}/${pages} 页`),
						h('button', { className: 'dsn-btn', type: 'button', disabled: current <= 1, onClick: () => setPage(current - 1) }, '上一页'),
						...pageList.map((item) =>
							item === '…'
								? h('span', { key: 'gap', className: 'dsn-hint' }, '…')
								: h('button', { key: `p${item}`, className: 'dsn-btn', type: 'button', 'data-variant': item === current ? 'primary' : 'default', onClick: () => setPage(item) }, String(item)),
						),
						h('button', { className: 'dsn-btn', type: 'button', disabled: current >= pages, onClick: () => setPage(current + 1) }, '下一页'),
						h('span', { className: 'dsn-spacer' }),
						h(
							'button',
							{
								className: 'dsn-btn',
								type: 'button',
								'data-variant': 'primary',
								disabled: pickedNotes.length === 0,
								onClick: () => doInsert(pickedNotes),
							},
							`插入选中的 ${pickedNotes.length} 条`,
						),
					),
				),
			);
		}

		/**
		 * Client 插件体。
		 * @param ctx - 客户端根上下文。
		 */
		// ===================================================================
		// 设置页：技能 / MCP
		// ===================================================================

		/** 设置页共用样式（前缀 dsr-，只用主题变量）。 */
		const RES_CSS = `
.dsr-page { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; min-width: 0; }
.dsr-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsr-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsr-sub, .dsr-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsr-spacer { flex: 1; }
.dsr-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsr-btn {
  display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.dsr-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsr-btn[data-variant="primary"] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted, #fff); font-weight: 500; }
.dsr-btn[data-variant="primary"]:hover { filter: brightness(1.08); }
.dsr-btn[data-variant="danger"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsr-btn[disabled] { opacity: .5; cursor: default; }
.dsr-search {
  box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 6px);
}
.dsr-list { display: flex; flex-direction: column; gap: 8px; }
.dsr-item {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1);
}
.dsr-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dsr-item-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsr-name { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.dsr-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dsr-badge { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 6px; flex: none; color: var(--dsw-alias-label-secondary); border: .5px solid var(--dsw-alias-border-l2); }
.dsr-badge[data-tone="on"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsr-badge[data-tone="err"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsr-item-actions { display: flex; gap: 6px; flex: none; align-items: center; }
.dsr-form { display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
.dsr-field { display: flex; flex-direction: column; gap: 4px; }
.dsr-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsr-input, .dsr-textarea, .dsr-select {
  box-sizing: border-box; width: 100%; padding: 7px 10px; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 6px);
}
.dsr-textarea { min-height: 220px; resize: vertical; line-height: 20px; font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.dsr-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.dsr-notice { font-size: 12px; color: var(--dsw-alias-state-success-primary); }
.dsr-empty { padding: 28px 0; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsr-confirm { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: .5px solid var(--dsw-alias-state-error-primary); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); max-width: 620px; }
.dsr-mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
`;

		/** 资源接口（技能 / MCP）统一调用；非 ok 一律抛错。 */
		async function resource(path, body) {
			let response;
			try {
				response = await fetch(`${ROUTE}${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			} catch (error) {
				throw new Error(`连不上宿主：${error?.message ?? error}`);
			}
			let data = null;
			try {
				data = await response.json();
			} catch {}
			if (data === null) {
				// 404 基本都是「客户端已经是新版、宿主还停在旧版」——改宿主代码必须重启 DSH Desktop
				if (response.status === 404) throw new Error('宿主还是旧版本（重启一次 DSH Desktop 就好）：这条接口在运行中的宿主里还不存在');
				throw new Error(`宿主返回了非 JSON（HTTP ${response.status}）`);
			}
			if (data.ok !== true) throw new Error(data.error ?? `HTTP ${response.status}`);
			return data;
		}

		/** "KEY=VALUE" 每行 → 对象。 */
		function parsePairs(text) {
			const out = {};
			for (const line of String(text ?? '').split(/\r?\n/gu)) {
				const trimmed = line.trim();
				if (trimmed === '' || trimmed.startsWith('#')) continue;
				const index = trimmed.indexOf('=');
				if (index <= 0) continue;
				out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
			}
			return out;
		}
		function renderPairs(record) {
			return Object.entries(record ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
		}

		/** 从本机其它 AI 工具导入（技能 / MCP 共用）：勾选 → 导入。 */
		function LocalImport({ kind, data, setData, busy, onApply }) {
			const list = kind === 'skills' ? data.skills : data.mcp;
			const keyOf = (item) => `${item.toolId}:${item.name}`;
			const toggle = (item, checked) => {
				const selected = new Set(data.selected);
				if (checked) selected.add(keyOf(item));
				else selected.delete(keyOf(item));
				setData({ ...data, selected: [...selected] });
			};
			return h(
				'div',
				{ className: 'dsr-field' },
				h('span', { className: 'dsr-label' }, kind === 'skills' ? '本机其它 AI 工具里的技能（勾选后复制到 ~/.dsh/skills）' : '本机其它 AI 工具里配置的 MCP 服务器（勾选后写进清单并立刻挂载）'),
				data.error === null ? null : h('div', { className: 'dsr-error' }, data.error),
				data.loading
					? h('div', { className: 'dsr-empty' }, '扫描中…')
					: list.length === 0
						? h('div', { className: 'dsr-empty' }, '没扫到可以导入的内容（Codex / Claude Code / Cursor / Windsurf / Gemini / OpenCode / Continue）')
						: h(
								'div',
								{ className: 'dsr-list' },
								list.map((item) =>
									h(
										'label',
										{ className: 'dsr-item', key: keyOf(item), style: { cursor: 'pointer' } },
										h('input', { type: 'checkbox', checked: data.selected.includes(keyOf(item)), onChange: (event) => toggle(item, event.target.checked) }),
										h(
											'div',
											{ className: 'dsr-item-main' },
											h(
												'div',
												{ className: 'dsr-item-top' },
												h('span', { className: 'dsr-name' }, item.name),
												h('span', { className: 'dsr-badge' }, item.tool),
												item.transport === undefined ? null : h('span', { className: 'dsr-badge' }, item.transport),
												item.already === true ? h('span', { className: 'dsr-badge' }, '同名已存在') : null,
											),
											h('div', { className: 'dsr-desc' }, kind === 'skills' ? item.description || item.file : item.url || `${item.command ?? ''} ${(item.args ?? []).join(' ')}`),
										),
									),
								),
							),
				h(
					'div',
					{ className: 'dsr-actions' },
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setData({ ...data, selected: list.filter((item) => item.already !== true).map(keyOf) }) }, '全选未导入的'),
					h('button', { className: 'dsr-btn', type: 'button', disabled: busy || data.selected.length === 0, 'data-variant': 'primary', onClick: onApply }, `导入选中的 ${data.selected.length} 项`),
				),
			);
		}

		/** 在线搜索区（技能 / MCP 共用）：选一个源地址 → 搜 → 结果列表 → 一键取用。 */
		function OnlineSearch({ online, setOnline, sources, onSources, pickLabel, onPick }) {
			const list = sources ?? [];
			const source = list.find((item) => item.id === online.sourceId) ?? list[0];
			const isCustom = source !== undefined && source.kind !== 'github' && source.kind !== 'registry';
			const patch = (next) => setOnline({ ...online, ...next });
			const limit = online.limit ?? 24;
			const search = async (nextLimit) => {
				if (source === undefined) return;
				const take = nextLimit ?? limit;
				patch({ busy: true, error: null, results: [], limit: take });
				try {
					const data = await resource(`/${online.kind}/search`, { sourceId: source.id, custom: online.custom, query: online.query, limit: take });
					patch({ busy: false, results: data.results ?? [], source: data.source ?? source });
				} catch (error) {
					patch({ busy: false, error: String(error?.message ?? error) });
				}
			};
			// 进来就自动把默认源列出来，不用先点一下「搜索」；换源也自动重搜
			React.useEffect(() => {
				void search();
			}, [source?.id]);
			const saveAddress = async () => {
				patch({ addError: null, addBusy: true });
				try {
					const data = await resource('/sources/add', { kind: online.kind, address: online.addAddress, label: online.addLabel });
					if (typeof onSources === 'function') onSources(online.kind, data.sources?.[online.kind] ?? []);
					patch({ addBusy: false, addOpen: false, addAddress: '', addLabel: '', sourceId: data.entry.id, results: [] });
				} catch (error) {
					patch({ addBusy: false, addError: String(error?.message ?? error) });
				}
			};
			// 之前漏了这个函数：下面「删除这个地址」按钮引用的 removeAddress 从未定义，点了必抛 ReferenceError
			const removeAddress = async () => {
				patch({ addError: null });
				try {
					const data = await resource('/sources/remove', { kind: online.kind, id: source?.id });
					if (typeof onSources === 'function') onSources(online.kind, data.sources?.[online.kind] ?? []);
					patch({ sourceId: '', results: [] });
				} catch (error) {
					patch({ addError: String(error?.message ?? error) });
				}
			};
			return h(
				'div',
				{ className: 'dsr-field' },
				h('span', { className: 'dsr-label' }, '在线搜索（选一个源地址，搜到的可以直接取用）'),
				h(
					'div',
					{ className: 'dsr-actions' },
					h(
						'select',
						{ className: 'dsr-select', style: { maxWidth: '260px' }, value: source?.id ?? '', onChange: (event) => patch({ sourceId: event.target.value === '__add__' ? source?.id : event.target.value, addOpen: event.target.value === '__add__', results: [], limit: 24 }) },
						list.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
						h('option', { value: '__add__' }, '＋ 添加地址…'),
					),
					h('span', { className: 'dsr-hint' }, source?.hint ?? ''),
					online.addOpen === true ? null : h('button', { className: 'dsr-btn', type: 'button', onClick: () => patch({ addOpen: true }) }, '加地址'),
					online.addOpen !== true && ((source?.id ?? '').startsWith('gh-') || (source?.id ?? '').startsWith('url-'))
						? h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', onClick: () => void removeAddress() }, '删除这个地址')
						: null,
					h('input', { className: 'dsr-input', style: { maxWidth: '220px' }, placeholder: '关键字（可留空＝全部）', value: online.query, onChange: (event) => patch({ query: event.target.value }), onKeyDown: (event) => { if (event.key === 'Enter') void search(); } }),
					h('button', { className: 'dsr-btn', type: 'button', disabled: online.busy, onClick: () => void search() }, online.busy ? '搜索中…' : '搜索'),
				),
				online.addOpen === true
					? h(
							'div',
							{ className: 'dsr-actions' },
							h('input', { className: 'dsr-input', style: { maxWidth: '380px' }, placeholder: online.kind === 'mcp' ? '注册表 URL，或 owner/repo' : 'owner/repo 或完整 GitHub 链接', value: online.addAddress ?? '', onChange: (event) => patch({ addAddress: event.target.value, addError: null }) }),
							h('input', { className: 'dsr-input', style: { maxWidth: '160px' }, placeholder: '显示名（可选）', value: online.addLabel ?? '', onChange: (event) => patch({ addLabel: event.target.value }) }),
							h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', disabled: online.addBusy === true, onClick: () => void saveAddress() }, '保存地址'),
							h('button', { className: 'dsr-btn', type: 'button', onClick: () => patch({ addOpen: false, addError: null }) }, '取消'),
						)
					: null,
				online.addError === null || online.addError === undefined ? null : h('div', { className: 'dsr-error' }, online.addError),
				online.error === null ? null : h('div', { className: 'dsr-error' }, online.error),
				online.busy === true
					? h('div', { className: 'dsr-empty' }, `正在搜「${source?.label ?? ''}」…（GitHub 未登录有配额，第一次会慢几秒）`)
					: null,
				online.busy !== true && (online.results ?? []).length === 0
					? h('div', { className: 'dsr-empty' }, online.query === '' ? '这个源里没搜到东西，换个源或填个关键字试试。' : `没搜到「${online.query}」，换个关键字。`)
					: null,
				(online.results ?? []).length === 0
					? null
					: h(
							'div',
							{ className: 'dsr-list' },
							online.results.map((result, index) =>
								h(
									'div',
									{ className: 'dsr-item', key: `${result.name}:${index}` },
									h(
										'div',
										{ className: 'dsr-item-main' },
										h(
											'div',
											{ className: 'dsr-item-top' },
											h('span', { className: 'dsr-name' }, result.name),
											result.transport === undefined ? null : h('span', { className: 'dsr-badge' }, result.transport),
											result.path === undefined ? null : h('span', { className: 'dsr-badge' }, result.path),
										),
										h('div', { className: 'dsr-desc' }, result.description || (result.url || `${result.command ?? ''} ${(result.args ?? []).join(' ')}`)),
									),
									h('div', { className: 'dsr-item-actions' }, h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', disabled: online.busy, onClick: () => onPick(result) }, pickLabel)),
								),
							),
							(online.results ?? []).length >= limit
								? h('div', { className: 'dsr-actions' }, h('button', { className: 'dsr-btn', type: 'button', disabled: online.busy === true, onClick: () => void search(limit + 30) }, `加载更多（已显示 ${online.results.length} 条）`))
								: null,
						),
			);
		}

		/** 技能设置页：列表 / 搜索 / 新增 / 编辑 / 删除（要确认）/ 导入。 */
		function SkillsPage() {
			const [state, setState] = React.useState({ loading: true, skills: [], roots: [], error: null, notice: null });
			const [query, setQuery] = React.useState('');
			const [mode, setMode] = React.useState({ kind: 'list' });
			const [busy, setBusy] = React.useState(false);
			const [sources, setSources] = React.useState([]);
			const [online, setOnline] = React.useState({ kind: 'skills', sourceId: '', custom: '', query: '', results: [], busy: false, error: null });
			const [local, setLocal] = React.useState({ loading: false, skills: [], mcp: [], selected: [], error: null });

			React.useEffect(() => {
				void (async () => {
					try {
						const data = await resource('/sources');
						setSources(data.sources?.skills ?? []);
					} catch {}
				})();
			}, []);

			const load = React.useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await resource('/skills');
					setState({ loading: false, skills: data.skills ?? [], roots: data.roots ?? [], error: null, notice: null });
				} catch (error) {
					setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				void load();
			}, [load]);

			const run = async (task, notice) => {
				setBusy(true);
				setState((previous) => ({ ...previous, error: null, notice: null }));
				try {
					await task();
					await load();
					setMode({ kind: 'list' });
					if (notice !== undefined) setState((previous) => ({ ...previous, notice }));
				} catch (error) {
					setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
				} finally {
					setBusy(false);
				}
			};

			const filtered = state.skills.filter((skill) => {
				const haystack = `${skill.name} ${skill.description ?? ''}`.toLowerCase();
				return query.trim() === '' || haystack.includes(query.trim().toLowerCase());
			});
			const errorLine = state.error === null ? null : h('div', { className: 'dsr-error' }, state.error);
			const noticeLine = state.notice === null ? null : h('div', { className: 'dsr-notice' }, state.notice);

			if (mode.kind === 'edit') {
				const draft = mode.draft;
				const patch = (next) => setMode({ kind: 'edit', isNew: mode.isNew, draft: { ...draft, ...next } });
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, mode.isNew ? '新增技能' : `编辑技能 · ${draft.name}`), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ className: 'dsr-form' },
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '名字（建议小写字母与短横线）'), h('input', { className: 'dsr-input', value: draft.name, onChange: (event) => patch({ name: event.target.value }) })),
						h(
							'div',
							{ className: 'dsr-field' },
							h('span', { className: 'dsr-label' }, '描述（模型靠这句话决定要不要用这个技能，必填）'),
							h('input', { className: 'dsr-input', value: draft.description, onChange: (event) => patch({ description: event.target.value }) }),
						),
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '正文（Markdown）'), h('textarea', { className: 'dsr-textarea', value: draft.body, onChange: (event) => patch({ body: event.target.value }) })),
						draft.path === undefined ? null : h('div', { className: 'dsr-mono' }, draft.path),
						errorLine,
						h(
							'div',
							{ className: 'dsr-actions' },
							h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
							h(
								'button',
								{
									className: 'dsr-btn',
									type: 'button',
									'data-variant': 'primary',
									disabled: busy,
									onClick: () =>
										void run(
											() => resource('/skills/save', { name: draft.name, description: draft.description, body: draft.body, path: mode.isNew ? undefined : draft.path, originalName: mode.isNew ? undefined : draft.originalName }),
											`已保存「${draft.name}」`,
										),
								},
								'保存',
							),
						),
					),
				);
			}

			if (mode.kind === 'online') {
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '在线搜技能'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(OnlineSearch, {
						online,
						setOnline,
						sources,
						onSources: (kind, next) => setSources(next),
						pickLabel: '导入这个',
						onPick: (result) => void run(() => resource('/skills/import', { url: result.url, name: result.name }), `已导入「${result.name}」`),
					}),
				);
			}

			if (mode.kind === 'local') {
				const selected = local.skills.filter((item) => local.selected.includes(`${item.toolId}:${item.name}`)).map((item) => ({ name: item.name, path: item.path }));
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '从本机其它 AI 工具导入技能'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(LocalImport, {
						kind: 'skills',
						data: local,
						setData: setLocal,
						busy,
						onApply: () =>
							void run(async () => {
								const result = await resource('/import/apply', { skills: selected });
								const failed = (result.skills ?? []).filter((item) => item.ok !== true);
								if (failed.length > 0) throw new Error(failed.map((item) => `${item.name}：${item.error}`).join('；'));
							}, `已导入 ${selected.length} 个技能`),
					}),
				);
			}

			if (mode.kind === 'import') {
				const draft = mode.draft;
				const patch = (next) => setMode({ kind: 'import', draft: { ...draft, ...next } });
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '导入技能'), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ className: 'dsr-form' },
						h('div', { className: 'dsr-hint' }, '两种来源二选一：一个 http/https 地址（抓里面的 SKILL.md 正文），或者一个本机路径（技能目录，或单个 .md）。'),
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '地址（URL）'), h('input', { className: 'dsr-input', placeholder: 'https://raw.githubusercontent.com/…/SKILL.md', value: draft.url, onChange: (event) => patch({ url: event.target.value }) })),
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '本机路径（目录或 .md 文件）'), h('input', { className: 'dsr-input', placeholder: '~/Downloads/my-skill', value: draft.path, onChange: (event) => patch({ path: event.target.value }) })),
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '名字（可选，留空就用 SKILL.md 里的 name）'), h('input', { className: 'dsr-input', value: draft.name, onChange: (event) => patch({ name: event.target.value }) })),
						h(OnlineSearch, {
							online,
							setOnline,
							sources,
							pickLabel: '导入这个',
							onPick: (result) => void run(() => resource('/skills/import', { url: result.url, name: result.name }), `已导入「${result.name}」`),
						}),
						errorLine,
						h(
							'div',
							{ className: 'dsr-actions' },
							h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
							h(
								'button',
								{
									className: 'dsr-btn',
									type: 'button',
									'data-variant': 'primary',
									disabled: busy,
									onClick: () =>
										void run(
											() => resource('/skills/import', { url: draft.url.trim() === '' ? undefined : draft.url.trim(), path: draft.path.trim() === '' ? undefined : draft.path.trim(), name: draft.name.trim() === '' ? undefined : draft.name.trim() }),
											'导入完成',
										),
								},
								'导入',
							),
						),
					),
				);
			}

			if (mode.kind === 'confirm') {
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '删除技能'), h('span', { className: 'dsr-spacer' })),
					h('div', { className: 'dsr-confirm' }, h('div', null, `确定要删除技能「${mode.skill.name}」吗？`), h('div', { className: 'dsr-mono' }, mode.skill.path ?? ''), h('div', { className: 'dsr-hint' }, '会把它的 SKILL.md（或整个技能目录）从磁盘删掉，不能撤销。')),
					errorLine,
					h(
						'div',
						{ className: 'dsr-actions' },
						h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => void run(() => resource('/skills/delete', { name: mode.skill.name }), `已删除「${mode.skill.name}」`) }, '确定删除'),
					),
				);
			}

			return h(
				'div',
				{ className: 'dsr-page' },
				h('style', null, RES_CSS),
				h(
					'div',
					{ className: 'dsr-head' },
					h('span', { className: 'dsr-title' }, '技能'),
					h('span', { className: 'dsr-sub' }, `${state.skills.length} 个`),
					h('span', { className: 'dsr-spacer' }),
					h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => void load() }, '刷新'),
					h('button', {
						className: 'dsr-btn',
						type: 'button',
						onClick: () => {
							setMode({ kind: 'local' });
							setLocal((previous) => ({ ...previous, loading: true, error: null, selected: [] }));
							void resource('/import/local')
								.then((data) => setLocal({ loading: false, skills: data.skills ?? [], mcp: data.mcp ?? [], selected: [], error: null }))
								.catch((error) => setLocal({ loading: false, skills: [], mcp: [], selected: [], error: String(error?.message ?? error) }));
						},
					}, '从本机导入'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'online' }) }, '在线搜索'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'import', draft: { url: '', path: '', name: '' } }) }, '导入'),
					h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', onClick: () => setMode({ kind: 'edit', isNew: true, draft: { name: '', description: '', body: '' } }) }, '新增'),
				),
				h('input', { className: 'dsr-search', placeholder: '搜索技能（名字或描述）…', value: query, onChange: (event) => setQuery(event.target.value) }),
				state.roots.length === 0 ? null : h('div', { className: 'dsr-hint' }, `可写目录：${state.roots.map((root) => root.label).join(' · ')}`),
				errorLine,
				noticeLine,
				state.loading
					? h('div', { className: 'dsr-empty' }, '读取中…')
					: filtered.length === 0
						? h('div', { className: 'dsr-empty' }, state.skills.length === 0 ? '还没有技能。点「新增」建一个，或「导入」一个现成的。' : '没有匹配的技能。')
						: h(
								'div',
								{ className: 'dsr-list' },
								filtered.map((skill) =>
									h(
										'div',
										{ className: 'dsr-item', key: `${skill.name}:${skill.path ?? ''}` },
										h(
											'div',
											{ className: 'dsr-item-main' },
											h(
												'div',
												{ className: 'dsr-item-top' },
												h('span', { className: 'dsr-name' }, skill.name),
												h('span', { className: 'dsr-badge' }, skill.rootLabel ?? skill.source ?? '未知来源'),
												skill.writable === true ? null : h('span', { className: 'dsr-badge' }, '只读'),
											),
											h('div', { className: 'dsr-desc' }, skill.description ?? '（没有描述）'),
											skill.path === null || skill.path === undefined ? null : h('div', { className: 'dsr-mono' }, skill.path),
										),
										h(
											'div',
											{ className: 'dsr-item-actions' },
											skill.writable !== true
												? null
												: h(
														'button',
														{
															className: 'dsr-btn',
															type: 'button',
															disabled: busy,
															onClick: async () => {
																setBusy(true);
																try {
																	const data = await resource('/skills/read', { name: skill.name });
																	setMode({ kind: 'edit', isNew: false, draft: { name: data.name, description: data.description, body: data.body, path: data.path, originalName: data.name } });
																} catch (error) {
																	setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
																} finally {
																	setBusy(false);
																}
															},
														},
														'编辑',
													),
											skill.writable !== true ? null : h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => setMode({ kind: 'confirm', skill }) }, '删除'),
										),
									),
								),
							),
			);
		}

		/** MCP 设置页：列表 / 搜索 / 新增 / 编辑 / 删除（要确认）/ 启用停用。 */
		function McpPage() {
			const [state, setState] = React.useState({ loading: true, servers: [], error: null, notice: null });
			const [query, setQuery] = React.useState('');
			const [mode, setMode] = React.useState({ kind: 'list' });
			const [busy, setBusy] = React.useState(false);
			const [sources, setSources] = React.useState([]);
			const [online, setOnline] = React.useState({ kind: 'mcp', sourceId: '', custom: '', query: '', results: [], busy: false, error: null });
			const [local, setLocal] = React.useState({ loading: false, skills: [], mcp: [], selected: [], error: null });

			React.useEffect(() => {
				void (async () => {
					try {
						const data = await resource('/sources');
						setSources(data.sources?.mcp ?? []);
					} catch {}
				})();
			}, []);

			const load = React.useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await resource('/mcp');
					setState({ loading: false, servers: data.servers ?? [], error: null, notice: null });
				} catch (error) {
					setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				void load();
			}, [load]);

			const run = async (task, notice) => {
				setBusy(true);
				setState((previous) => ({ ...previous, error: null, notice: null }));
				try {
					const data = await task();
					await load();
					setMode({ kind: 'list' });
					const failed = (data?.results ?? []).filter((item) => item.ok !== true);
					setState((previous) => ({
						...previous,
						notice: failed.length === 0 && notice !== undefined ? notice : null,
						error: failed.length === 0 ? null : `清单已保存，但连接失败：${failed.map((item) => `${item.name}：${item.error}`).join('；')}`,
					}));
				} catch (error) {
					setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
				} finally {
					setBusy(false);
				}
			};

			const filtered = state.servers.filter((server) => {
				const haystack = `${server.name} ${server.url} ${server.command} ${server.args}`.toLowerCase();
				return query.trim() === '' || haystack.includes(query.trim().toLowerCase());
			});
			const errorLine = state.error === null ? null : h('div', { className: 'dsr-error' }, state.error);
			const noticeLine = state.notice === null ? null : h('div', { className: 'dsr-notice' }, state.notice);
			const toDraft = (server) => ({
				id: server.id,
				name: server.name,
				transport: server.transport,
				url: server.url ?? '',
				command: server.command ?? '',
				args: server.args ?? '',
				headersText: renderPairs(server.headers),
				envText: renderPairs(server.env),
				enabled: server.enabled !== false,
			});

			if (mode.kind === 'edit') {
				const draft = mode.draft;
				const patch = (next) => setMode({ kind: 'edit', isNew: mode.isNew, draft: { ...draft, ...next } });
				const isStdio = draft.transport === 'stdio';
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, mode.isNew ? '新增 MCP 服务器' : `编辑 MCP 服务器 · ${draft.name}`), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ className: 'dsr-form' },
						h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '名字（工具会变成 mcp__<名字>__<工具名>；只能小写字母、数字、短横线）'), h('input', { className: 'dsr-input', value: draft.name, onChange: (event) => patch({ name: event.target.value }) })),
						h(
							'div',
							{ className: 'dsr-field' },
							h('span', { className: 'dsr-label' }, '类型'),
							h(
								'select',
								{ className: 'dsr-select', value: draft.transport, onChange: (event) => patch({ transport: event.target.value }) },
								h('option', { value: 'streamable-http' }, 'streamable-http（远程 URL）'),
								h('option', { value: 'stdio' }, 'stdio（本机命令）'),
							),
						),
						isStdio
							? h(
									React.Fragment,
									null,
									h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '命令'), h('input', { className: 'dsr-input', placeholder: 'npx', value: draft.command, onChange: (event) => patch({ command: event.target.value }) })),
									h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '参数（空格分隔）'), h('input', { className: 'dsr-input', placeholder: '-y @modelcontextprotocol/server-filesystem ~/Desktop', value: draft.args, onChange: (event) => patch({ args: event.target.value }) })),
									h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '环境变量（每行 KEY=VALUE，可留空）'), h('textarea', { className: 'dsr-textarea', style: { minHeight: '80px' }, value: draft.envText, onChange: (event) => patch({ envText: event.target.value }) })),
								)
							: h(
									React.Fragment,
									null,
									h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, 'URL'), h('input', { className: 'dsr-input', placeholder: 'https://example.com/mcp', value: draft.url, onChange: (event) => patch({ url: event.target.value }) })),
									h('div', { className: 'dsr-field' }, h('span', { className: 'dsr-label' }, '请求头（每行 KEY=VALUE，可留空）'), h('textarea', { className: 'dsr-textarea', style: { minHeight: '80px' }, value: draft.headersText, onChange: (event) => patch({ headersText: event.target.value }) })),
								),
						h('label', { className: 'dsr-actions' }, h('input', { type: 'checkbox', checked: draft.enabled, onChange: (event) => patch({ enabled: event.target.checked }) }), h('span', { className: 'dsr-hint' }, '保存后立即启用')),
						errorLine,
						h(
							'div',
							{ className: 'dsr-actions' },
							h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
							h(
								'button',
								{
									className: 'dsr-btn',
									type: 'button',
									'data-variant': 'primary',
									disabled: busy,
									onClick: () =>
										void run(
											() =>
												resource('/mcp/save', {
													id: mode.isNew ? undefined : draft.id,
													name: draft.name,
													transport: draft.transport,
													url: draft.url,
													command: draft.command,
													args: draft.args,
													headers: parsePairs(draft.headersText),
													env: parsePairs(draft.envText),
													enabled: draft.enabled,
												}),
											'已保存',
										),
								},
								'保存',
							),
						),
					),
				);
			}

			if (mode.kind === 'local') {
				const selected = local.mcp
					.filter((item) => local.selected.includes(`${item.toolId}:${item.name}`))
					.map((item) => ({ name: item.name, transport: item.transport, url: item.url, command: item.command, args: item.args, env: item.env, cwd: item.cwd, enabled: item.enabled !== false }));
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '从本机其它 AI 工具导入 MCP 服务器'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(LocalImport, {
						kind: 'mcp',
						data: local,
						setData: setLocal,
						busy,
						onApply: () =>
							void run(async () => {
								const result = await resource('/import/apply', { mcp: selected });
								const failed = (result.mcp ?? []).filter((item) => item.ok !== true);
								if (failed.length > 0) throw new Error(failed.map((item) => `${item.name}：${item.error}`).join('；'));
								const offline = (result.mcp ?? []).filter((item) => item.connected === false);
								if (offline.length > 0) throw new Error(`已写进清单，但没连上：${offline.map((item) => `${item.name}：${item.error}`).join('；')}`);
							}, `已导入 ${selected.length} 个服务器`),
					}),
				);
			}

			if (mode.kind === 'online') {
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '在线找 MCP 服务器'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(OnlineSearch, {
						online,
						setOnline,
						sources,
						onSources: (kind, next) => setSources(next),
						pickLabel: '用它新建',
						onPick: (result) =>
							setMode({
								kind: 'edit',
								isNew: true,
								draft: {
									name: result.name,
									transport: result.transport ?? 'streamable-http',
									url: result.url ?? '',
									command: result.command ?? '',
									args: Array.isArray(result.args) ? result.args.join(' ') : String(result.args ?? ''),
									headersText: renderPairs(result.headers),
									envText: renderPairs(result.env),
									enabled: true,
								},
							}),
					}),
				);
			}

			if (mode.kind === 'confirm') {
				return h(
					'div',
					{ className: 'dsr-page' },
					h('style', null, RES_CSS),
					h('div', { className: 'dsr-head' }, h('span', { className: 'dsr-title' }, '删除 MCP 服务器'), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ className: 'dsr-confirm' },
						h('div', null, `确定要删除 MCP 服务器「${mode.server.name}」吗？`),
						h('div', { className: 'dsr-mono' }, mode.server.transport === 'stdio' ? `${mode.server.command} ${mode.server.args}` : mode.server.url),
						h('div', { className: 'dsr-hint' }, '会从清单移除并立刻断开连接，它提供的工具会跟着消失。'),
					),
					errorLine,
					h(
						'div',
						{ className: 'dsr-actions' },
						h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => void run(() => resource('/mcp/delete', { id: mode.server.id }), `已删除「${mode.server.name}」`) }, '确定删除'),
					),
				);
			}

			return h(
				'div',
				{ className: 'dsr-page' },
				h('style', null, RES_CSS),
				h(
					'div',
					{ className: 'dsr-head' },
					h('span', { className: 'dsr-title' }, 'MCP'),
					h('span', { className: 'dsr-sub' }, `${state.servers.length} 个`),
					h('span', { className: 'dsr-spacer' }),
					h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => void load() }, '刷新'),
					h('button', {
						className: 'dsr-btn',
						type: 'button',
						onClick: () => {
							setMode({ kind: 'local' });
							setLocal((previous) => ({ ...previous, loading: true, error: null, selected: [] }));
							void resource('/import/local')
								.then((data) => setLocal({ loading: false, skills: data.skills ?? [], mcp: data.mcp ?? [], selected: [], error: null }))
								.catch((error) => setLocal({ loading: false, skills: [], mcp: [], selected: [], error: String(error?.message ?? error) }));
						},
					}, '从本机导入'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'online' }) }, '在线搜索'),
					h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', onClick: () => setMode({ kind: 'edit', isNew: true, draft: { name: '', transport: 'streamable-http', url: '', command: '', args: '', headersText: '', envText: '', enabled: true } }) }, '新增'),
				),
				h('input', { className: 'dsr-search', placeholder: '搜索服务器（名字 / 地址 / 命令）…', value: query, onChange: (event) => setQuery(event.target.value) }),
				h('div', { className: 'dsr-hint' }, '清单存在 ~/.dsh/mcp-servers.json；保存后立刻挂载或断开，不用重启。'),
				errorLine,
				noticeLine,
				state.loading
					? h('div', { className: 'dsr-empty' }, '读取中…')
					: filtered.length === 0
						? h('div', { className: 'dsr-empty' }, state.servers.length === 0 ? '还没有配置 MCP 服务器。点「新增」加一个。' : '没有匹配的服务器。')
						: h(
								'div',
								{ className: 'dsr-list' },
								filtered.map((server) =>
									h(
										'div',
										{ className: 'dsr-item', key: server.id },
										h(
											'div',
											{ className: 'dsr-item-main' },
											h(
												'div',
												{ className: 'dsr-item-top' },
												h('span', { className: 'dsr-name' }, server.name),
												h('span', { className: 'dsr-badge' }, server.transport),
												h('span', { className: 'dsr-badge', 'data-tone': server.enabled === false ? undefined : server.mounted ? 'on' : 'err' }, server.enabled === false ? '已停用' : server.mounted ? '已连接' : '未连上'),
											),
											h('div', { className: 'dsr-desc' }, server.transport === 'stdio' ? `${server.command} ${server.args}` : server.url),
										),
										h(
											'div',
											{ className: 'dsr-item-actions' },
											h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => void run(() => resource('/mcp/toggle', { id: server.id, enabled: server.enabled === false }), server.enabled === false ? '已启用' : '已停用') }, server.enabled === false ? '启用' : '停用'),
											h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'edit', isNew: false, draft: toDraft(server) }) }, '编辑'),
											h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => setMode({ kind: 'confirm', server }) }, '删除'),
										),
									),
								),
							),
			);
		}

		/** 组件里要用到 client 上下文（取会话输入框的官方动词面），apply 时记一份。 */
		let notesCtx = null;

		// ===================================================================
		// 设置页：DSH 智能体（agent preset）—— 排在「MCP」下面
		// ===================================================================
		//
		// 这一页管的是 DSH 的「智能体预设」：一行 `@deepseek-ai/dsh-agent-preset` 声明，
		// config.plugins 就是「这个智能体能用的插件/工具」。内置的四个（standard /
		// ptc / minimal / cordis）随包发布，只读；本插件自己加的挂在
		// ~/.dsh/agent-presets.json，保存后宿主**动态挂载**，不用重启。
		//
		// 全部走宿主 /api/dsh-update-vd/agents*；本页是纯新增段落，不碰技能/MCP/笔记。

		/** 关键布局的内联兜底（这个宿主里 <style> 有过不生效的情况）。 */
		const AGENT_INLINE = {
			page: { display: 'flex', flexDirection: 'column', gap: '12px', boxSizing: 'border-box', width: '100%', minWidth: 0, padding: '4px 0' },
			head: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 },
			actions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 },
			list: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
			item: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', minWidth: 0 },
			itemMain: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' },
			itemTop: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
			itemActions: { display: 'flex', gap: '6px', flex: 'none', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
			desc: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
			form: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '760px', minWidth: 0 },
			field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
			grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' },
			code: { boxSizing: 'border-box', width: '100%', margin: 0, padding: '10px 12px', maxHeight: '46vh', overflow: 'auto', whiteSpace: 'pre', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: '12.5px', lineHeight: '1.5', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '6px' },
			checks: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
			confirm: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', border: '.5px solid var(--dsw-alias-state-error-primary)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', maxWidth: '620px' },
			notice: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
			error: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' },
			hint: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' },
			empty: { padding: '28px 0', textAlign: 'center', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
			mono: { fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' },
			badge: { fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '6px', flex: 'none', color: 'var(--dsw-alias-label-secondary)', border: '.5px solid var(--dsw-alias-border-l2)' },
			badgeBuiltin: { fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '6px', flex: 'none', color: 'var(--dsw-alias-brand-primary)', border: '.5px solid var(--dsw-alias-brand-primary)' },
			badgeMine: { fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '6px', flex: 'none', color: 'var(--dsw-alias-state-success-primary)', border: '.5px solid var(--dsw-alias-state-success-primary)' },
			badgeErr: { fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '6px', flex: 'none', color: 'var(--dsw-alias-state-error-primary)', border: '.5px solid var(--dsw-alias-state-error-primary)' },
			textarea: { boxSizing: 'border-box', width: '100%', minHeight: '240px', resize: 'vertical', padding: '8px 10px', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: '12.5px', lineHeight: '19px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '6px' },
			input: { boxSizing: 'border-box', width: '100%', height: '32px', padding: '0 10px', font: 'inherit', fontSize: '13px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '6px' },
		};

		/** 内置/随包 → 蓝；自己加的 → 绿；装配失败 → 红。 */
		function agentBadgeStyle(agent) {
			if (agent.broken !== null && agent.broken !== undefined) return AGENT_INLINE.badgeErr;
			if (agent.managed === true) return AGENT_INLINE.badgeMine;
			if (agent.origin === 'builtin') return AGENT_INLINE.badgeBuiltin;
			return AGENT_INLINE.badge;
		}

		/**
		 * 一份对话（或一堆）→ Markdown 文本。
		 * 轻量备选：导不成 DSH 会话时至少能落成文件 / 塞进输入框。
		 */
		function conversationsToMarkdown(rows) {
			return rows
				.map((row) => {
					const when = row.createdAt === undefined ? '' : ` · ${String(row.createdAt).replace('T', ' ').slice(0, 16)}`;
					const lines = [`# ${row.title}`, '', `> 来源：${row.sourceLabel}${when} · 原会话 \`${row.id}\``, ''];
					for (const message of row.messages ?? []) {
						lines.push(message.role === 'user' ? '## 用户' : message.role === 'assistant' ? '## 助手' : '## 工具', '', message.text, '');
					}
					return lines.join('\n');
				})
				.join('\n\n---\n\n');
		}

		/** 下载一段文本（Blob + createObjectURL + <a download>）。 */
		function downloadText(filename, mime, content) {
			if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') throw new Error('这个环境里没法下载文件');
			const blob = new Blob([content], { type: `${mime};charset=utf-8` });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.style.display = 'none';
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}

		/** 智能体的在线搜索区（技能/MCP 那套交互：选源 / 加地址 / 关键字 / 结果 / 一键装）。 */
		function AgentSource({ online, setOnline, sources, onSources, pickLabel, onPick }) {
			const list = sources ?? [];
			const source = list.find((item) => item.id === online.sourceId) ?? list[0];
			const patch = (next) => setOnline({ ...online, ...next });
			const limit = online.limit ?? 24;
			const search = async (nextLimit) => {
				if (source === undefined) return;
				const take = nextLimit ?? limit;
				patch({ busy: true, error: null, results: [], limit: take });
				try {
					const data = await resource('/agents/search', { sourceId: source.id, custom: online.custom, query: online.query, limit: take });
					patch({ busy: false, results: data.results ?? [], source: data.source ?? source });
				} catch (error) {
					patch({ busy: false, error: String(error?.message ?? error) });
				}
			};
			// 进来就把默认源列出来，换源自动重搜
			React.useEffect(() => {
				void search();
			}, [source?.id]);
			const saveAddress = async () => {
				patch({ addError: null, addBusy: true });
				try {
					const data = await resource('/sources/add', { kind: 'agents', address: online.addAddress, label: online.addLabel });
					if (typeof onSources === 'function') onSources(data.sources?.agents ?? []);
					patch({ addBusy: false, addOpen: false, addAddress: '', addLabel: '', sourceId: data.entry.id, results: [] });
				} catch (error) {
					patch({ addBusy: false, addError: String(error?.message ?? error) });
				}
			};
			const removeAddress = async () => {
				patch({ addError: null });
				try {
					const data = await resource('/sources/remove', { kind: 'agents', id: source?.id });
					if (typeof onSources === 'function') onSources(data.sources?.agents ?? []);
					patch({ sourceId: '', results: [] });
				} catch (error) {
					patch({ addError: String(error?.message ?? error) });
				}
			};
			return h(
				'div',
				{ className: 'dsr-field', style: AGENT_INLINE.field },
				h('span', { className: 'dsr-label', style: AGENT_INLINE.hint }, '在线搜索智能体（选一个源地址；结果是别人写好的预设，一键装到本机）'),
				h(
					'div',
					{ className: 'dsr-actions', style: AGENT_INLINE.actions },
					h(
						'select',
						{ className: 'dsr-select', style: { ...AGENT_INLINE.input, maxWidth: '280px' }, value: source?.id ?? '', onChange: (event) => patch({ sourceId: event.target.value === '__add__' ? (source?.id ?? '') : event.target.value, addOpen: event.target.value === '__add__', results: [], limit: 24 }) },
						list.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
						h('option', { value: '__add__' }, '＋ 添加地址…'),
					),
					h('span', { className: 'dsr-hint', style: AGENT_INLINE.hint }, source?.hint ?? ''),
					online.addOpen === true ? null : h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, onClick: () => patch({ addOpen: true }) }, '加地址'),
					source?.fromCustom === true || (source?.id ?? '').startsWith('gh-') || (source?.id ?? '').startsWith('url-') ? h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, 'data-variant': 'danger', onClick: () => void removeAddress() }, '删除这个地址') : null,
					h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '220px' }, placeholder: '关键字（可留空＝全部）', value: online.query ?? '', onChange: (event) => patch({ query: event.target.value }), onKeyDown: (event) => { if (event.key === 'Enter') void search(); } }),
					h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, disabled: online.busy === true, onClick: () => void search() }, online.busy === true ? '搜索中…' : '搜索'),
				),
				online.addOpen === true
					? h(
							'div',
							{ className: 'dsr-actions', style: AGENT_INLINE.actions },
							h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '380px' }, placeholder: 'owner/repo，或一个 .patch.yml 的完整 https 地址', value: online.addAddress ?? '', onChange: (event) => patch({ addAddress: event.target.value, addError: null }) }),
							h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '160px' }, placeholder: '显示名（可选）', value: online.addLabel ?? '', onChange: (event) => patch({ addLabel: event.target.value }) }),
							h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, 'data-variant': 'primary', disabled: online.addBusy === true, onClick: () => void saveAddress() }, '保存地址'),
							h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, onClick: () => patch({ addOpen: false, addError: null }) }, '取消'),
						)
					: null,
				online.addError === null || online.addError === undefined ? null : h('div', { style: AGENT_INLINE.error }, online.addError),
				online.error === null || online.error === undefined ? null : h('div', { style: AGENT_INLINE.error }, online.error),
				online.source?.cached === true
					? h('div', { style: AGENT_INLINE.hint }, `这些结果是 ${String(online.source.cachedAgeSeconds ?? 0)} 秒前抓的缓存 —— GitHub 未登录只有 60 次/小时，一次搜索要花十几次请求，所以同一个仓库 10 分钟内换关键字不再重抓（换源、或等 10 分钟就会重新抓）。`)
					: null,
				online.busy === true ? h('div', { style: AGENT_INLINE.empty }, `正在搜「${source?.label ?? ''}」…（GitHub 要拉十几个 patch 文件、要花十几次配额，第一次会慢几秒；同一个仓库 10 分钟内再搜就走缓存）`) : null,
				online.busy !== true && (online.results ?? []).length === 0 ? h('div', { style: AGENT_INLINE.empty }, online.query === '' || online.query === undefined ? '这个源里没搜到预设，换个源或填个关键字试试。' : `没搜到「${online.query}」，换个关键字。`) : null,
				(online.results ?? []).length === 0
					? null
					: h(
							'div',
							{ style: AGENT_INLINE.list },
							online.results.map((result, index) =>
								h(
									'div',
									{ className: 'dsr-item', style: AGENT_INLINE.item, key: `${result.id}:${index}` },
									h(
										'div',
										{ style: AGENT_INLINE.itemMain },
										h(
											'div',
											{ style: AGENT_INLINE.itemTop },
											h('span', { className: 'dsr-name' }, result.name ?? result.id),
											h('span', { style: AGENT_INLINE.badge }, result.id),
											h('span', { style: AGENT_INLINE.badge }, `插件 ${String(result.plugins ?? 0)} · 工具 ${String(result.tools ?? 0)}`),
											result.sourceLabel === undefined ? null : h('span', { style: AGENT_INLINE.badge }, result.sourceLabel),
										),
										h('div', { style: AGENT_INLINE.desc }, result.description === '' || result.description === undefined ? '（没有简介）' : result.description),
									),
									h('div', { style: AGENT_INLINE.itemActions }, h('button', { className: 'dsr-btn', type: 'button', style: { height: '30px' }, 'data-variant': 'primary', disabled: online.busy === true, onClick: () => onPick(result) }, pickLabel)),
								),
							),
						),
			);
		}

		/** 设置页：DSH 智能体（列表 / 搜索 / 新建 / 编辑 / 删除 / 导入 / 导出 / 在线搜索）。 */
		function AgentsPage() {
			const [state, setState] = React.useState({ loading: true, presets: [], error: null, notice: null, registryError: null, model: null, store: '' });
			const [query, setQuery] = React.useState('');
			const [mode, setMode] = React.useState({ kind: 'list' });
			const [busy, setBusy] = React.useState(false);
			const [sources, setSources] = React.useState([]);
			const [online, setOnline] = React.useState({ kind: 'agents', sourceId: '', custom: '', query: '', results: [], busy: false, error: null, addOpen: false, addAddress: '', addLabel: '', addError: null, addBusy: false, limit: 24 });
			const [draft, setDraft] = React.useState({ text: '', url: '', path: '', name: '', id: '', asCopy: false, overwrite: false, asPrompt: false, error: null });
			React.useEffect(() => {
				void (async () => {
					try {
						const data = await resource('/sources');
						setSources(data.sources?.agents ?? []);
					} catch {}
				})();
			}, []);

			const load = React.useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await resource('/agents');
					setState({ loading: false, presets: data.presets ?? [], error: null, notice: null, registryError: data.registryError ?? null, model: data.model ?? null, store: data.store ?? '' });
				} catch (error) {
					setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				void load();
			}, [load]);

			const run = async (task, notice) => {
				setBusy(true);
				setState((previous) => ({ ...previous, error: null, notice: null }));
				try {
					await task();
					await load();
					setMode({ kind: 'list' });
					if (notice !== undefined) setState((previous) => ({ ...previous, notice }));
				} catch (error) {
					setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
				} finally {
					setBusy(false);
				}
			};

			const patchDraft = (next) => setDraft((previous) => ({ ...previous, ...next }));
			/** 跟 run 一样，但**留在当前视图**（导出页生成预览要靠它）。 */
			const runHere = async (task, notice) => {
				setBusy(true);
				setState((previous) => ({ ...previous, error: null, notice: null }));
				try {
					await task();
					if (notice !== undefined) setState((previous) => ({ ...previous, notice }));
				} catch (error) {
					setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
				} finally {
					setBusy(false);
				}
			};
			const filtered = state.presets.filter((agent) => {
				const haystack = `${agent.id} ${agent.name ?? ''} ${agent.description ?? ''} ${agent.originLabel ?? ''}`.toLowerCase();
				return query.trim() === '' || haystack.includes(query.trim().toLowerCase());
			});
			const errorLine = state.error === null ? null : h('div', { style: AGENT_INLINE.error }, state.error);
			const noticeLine = state.notice === null ? null : h('div', { style: AGENT_INLINE.notice }, state.notice);
			const registryLine = state.registryError === null || state.registryError === undefined ? null : h('div', { style: AGENT_INLINE.error }, `读 DSH 预设注册表失败：${state.registryError}（下面只显示本插件自己管的那几个）`);
			const agentMeta = (agent) => h('div', { style: AGENT_INLINE.mono }, `${agent.id} · 插件 ${String(agent.plugins ?? 0)} 个（工具 ${String(agent.tools ?? 0)} 行）${agent.model === undefined || agent.model === '' ? '' : ` · 模型备注 ${agent.model}`}`);

			// ── 查看正文 ─────────────────────────────────────────────────
			if (mode.kind === 'view') {
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, `正文 · ${mode.agent.name ?? mode.agent.id}`), h('span', { className: 'dsr-spacer' })),
					h('div', { style: AGENT_INLINE.hint }, '这就是这个智能体的 config.plugins（DSH patch 的条目清单格式）。只读的那些不能改，但可以「复制一份」改成自己的。'),
					mode.content === undefined ? h('div', { style: AGENT_INLINE.empty }, '读取中…') : h('pre', { style: AGENT_INLINE.code }, mode.content),
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回'),
						h('button', { className: 'dsr-btn', type: 'button', onClick: () => void run(() => resource('/agents/export', { ids: [mode.agent.id], format: 'yaml' }).then((data) => downloadText(data.filename, data.mime, data.content)), `已导出「${mode.agent.id}」的补丁 YAML`) }, '导出这条'),
						h(
							'button',
							{
								className: 'dsr-btn',
								type: 'button',
								'data-variant': 'primary',
								disabled: busy,
								onClick: () =>
									void run(async () => {
										const data = await resource('/agents/read', { id: mode.agent.id });
										setMode({ kind: 'edit', isNew: true, copyFrom: mode.agent.id, draft: { id: `${mode.agent.id}-copy`, name: `${mode.agent.name ?? mode.agent.id}（副本）`, description: data.description ?? '', order: '', model: '', body: data.content, asPrompt: false } });
									}),
							},
							'复制一份',
						),
					),
				);
			}

			// ── 编辑器（新建 / 编辑 / 复制）───────────────────────────────
			if (mode.kind === 'edit') {
				const current = mode.draft;
				const patch = (next) => setMode({ ...mode, draft: { ...current, ...next } });
				const bodyLength = String(current.body ?? '').length;
				const idOk = /^[a-z0-9][a-z0-9-]{0,47}$/u.test(String(current.id ?? ''));
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, mode.isNew ? (mode.copyFrom === undefined ? '新建智能体' : `复制自「${mode.copyFrom}」`) : `编辑智能体 · ${current.id}`), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ style: AGENT_INLINE.form },
						h(
							'div',
							{ style: AGENT_INLINE.grid2 },
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '显示名字'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: '例如：我的审查模式', value: current.name ?? '', onChange: (event) => patch({ name: event.target.value }) })),
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '标识（id，列表与新任务里的唯一名字）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: 'my-review', value: current.id ?? '', onChange: (event) => patch({ id: event.target.value }) })),
						),
						h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '简介（列表里显示，两行截断）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: '一句话说清它适合干什么', value: current.description ?? '', onChange: (event) => patch({ description: event.target.value }) })),
						h(
							'div',
							{ style: AGENT_INLINE.grid2 },
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '排序（可空，越小越靠前）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: '例如 20', value: current.order ?? '', onChange: (event) => patch({ order: event.target.value }) })),
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '模型（可空，仅作备注）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: '例如 deepseek-flash', value: current.model ?? '', onChange: (event) => patch({ model: event.target.value }) })),
						),
						h('div', { style: AGENT_INLINE.hint }, '说明：DSH 的预设本身不带模型 —— 实际用哪个模型由设置的「默认模型」决定，这里的「模型」只是给你自己看的备注（会存在本机、跟着导出走）。'),
						h(
							'div',
							{ style: AGENT_INLINE.field },
							h('span', { className: 'dsr-label' }, current.asPrompt === true ? '系统提示词（会自动包成一行 persona）' : '正文（插件行清单，YAML —— 就是 config.plugins）'),
							current.asPrompt === true
								? h('textarea', { style: AGENT_INLINE.textarea, placeholder: '你是一个…', value: current.body ?? '', onChange: (event) => patch({ body: event.target.value }) })
								: h('textarea', { className: 'dsr-textarea', style: AGENT_INLINE.textarea, placeholder: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: You are a helpful assistant.\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'", value: current.body ?? '', onChange: (event) => patch({ body: event.target.value }) }),
						),
						h(
							'label',
							{ style: { ...AGENT_INLINE.checks, cursor: 'pointer' } },
							h('input', { type: 'checkbox', checked: current.asPrompt === true, onChange: (event) => patch({ asPrompt: event.target.checked }) }),
							'这段正文是「系统提示词」而不是插件清单（保存时自动包成 persona）',
						),
						h('div', { style: AGENT_INLINE.mono }, `正文 ${String(bodyLength)} 个字符${idOk ? '' : ' · 标识还不合法（只能小写字母/数字/短横线）'}`),
						errorLine,
						h(
							'div',
							{ style: AGENT_INLINE.actions },
							h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
							h(
								'button',
								{
									className: 'dsr-btn',
									type: 'button',
									'data-variant': 'primary',
									disabled: busy || !idOk || String(current.body ?? '').trim() === '',
									onClick: () =>
										void run(
											() => resource('/agents/save', { originalId: mode.isNew ? undefined : mode.originalId, id: current.id, name: current.name, description: current.description, order: current.order === '' ? undefined : current.order, model: current.model, body: current.body, asPrompt: current.asPrompt === true, overwrite: mode.isNew !== true && mode.originalId === current.id }),
											`已保存「${current.id}」`,
										),
								},
								'保存',
							),
						),
					),
				);
			}

			// ── 删除确认 ─────────────────────────────────────────────────
			if (mode.kind === 'confirm') {
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, '删除智能体'), h('span', { className: 'dsr-spacer' })),
					h(
						'div',
						{ style: AGENT_INLINE.confirm },
						h('div', null, `确定要删除智能体「${mode.agent.name ?? mode.agent.id}」（${mode.agent.id}）吗？`),
						h('div', { style: AGENT_INLINE.hint }, '会把它从本插件的清单里删掉、并从 DSH 的预设注册表里摘掉（正在用它的任务不受影响）。不能撤销。'),
					),
					errorLine,
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => void run(() => resource('/agents/delete', { id: mode.agent.id }), `已删除「${mode.agent.id}」`) }, '确定删除'),
					),
				);
			}

			// ── 导出 ─────────────────────────────────────────────────────
			if (mode.kind === 'export') {
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, mode.id === undefined ? '导出全部自定义智能体' : `导出智能体 · ${mode.id}`), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h(
							'select',
							{ className: 'dsr-select', style: { ...AGENT_INLINE.input, maxWidth: '260px' }, value: mode.format, onChange: (event) => setMode({ ...mode, format: event.target.value, content: undefined, filename: undefined }) },
							h('option', { value: 'json' }, '本插件 JSON（原样再导入）'),
							h('option', { value: 'yaml' }, 'DSH 补丁 YAML（能放进 bundle）'),
						),
						h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => void runHere(async () => { const data = await resource('/agents/export', { ids: mode.id === undefined ? undefined : [mode.id], format: mode.format }); setMode({ ...mode, content: data.content, filename: data.filename }); }) }, '生成内容'),
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', disabled: busy || mode.content === undefined, onClick: () => { try { downloadText(mode.filename ?? `agent-presets.${mode.format === 'yaml' ? 'yml' : 'json'}`, mode.format === 'yaml' ? 'application/x-yaml' : 'application/json', mode.content ?? ''); } catch (error) { setState((previous) => ({ ...previous, error: String(error?.message ?? error) })); } } }, '下载文件'),
					),
					h('div', { style: AGENT_INLINE.hint }, 'JSON 是本插件自己的整包格式（再导入时连名字、简介、模型备注一起还原）；YAML 是 DSH 的补丁片段（贴进 bundle 的 cordis.patch.yml 就能用）。内置/随包的预设也能导出来当模板。'),
					errorLine,
					noticeLine,
					mode.content === undefined ? h('div', { style: AGENT_INLINE.empty }, '点「生成内容」先看一眼，再点「下载文件」。') : h('pre', { style: AGENT_INLINE.code }, mode.content),
				);
			}

			// ── 导入（粘贴 / 本地文件 / 地址 + 在线搜索）──────────────────
			if (mode.kind === 'import') {
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, '导入智能体'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h(
						'div',
						{ style: AGENT_INLINE.form },
						h('div', { style: AGENT_INLINE.hint }, '四种来源随便挑一个：粘贴一段内容、选一个本地文件、给一个本机路径、或者给一个 http/https 地址（下载后导入）。认这几种内容：本插件导出的 JSON、带 @deepseek-ai/dsh-agent-preset 声明的 patch（YAML），或者干脆一串插件行 / 一段系统提示词。'),
						h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '粘贴内容'), h('textarea', { style: { ...AGENT_INLINE.textarea, minHeight: '160px' }, placeholder: '# 直接粘 patch / JSON / 插件行清单 / 一段提示词', value: draft.text, onChange: (event) => patchDraft({ text: event.target.value, error: null }) })),
						h(
							'div',
							{ style: AGENT_INLINE.grid2 },
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '本机路径（.yml / .yaml / .json）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: '~/Downloads/my-preset.patch.yml', value: draft.path, onChange: (event) => patchDraft({ path: event.target.value, error: null }) })),
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, 'http/https 地址'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, placeholder: 'https://raw.githubusercontent.com/…/preset.patch.yml', value: draft.url, onChange: (event) => patchDraft({ url: event.target.value, error: null }) })),
						),
						h(
							'div',
							{ style: AGENT_INLINE.field },
							h('span', { className: 'dsr-label' }, '或者选一个本地文件（在浏览器里读，不上传）'),
							h('input', { type: 'file', accept: '.yml,.yaml,.json,.txt', onChange: (event) => { const file = event.target.files === undefined || event.target.files === null ? undefined : event.target.files[0]; if (file === undefined) return; const reader = new FileReader(); reader.onload = () => patchDraft({ text: String(reader.result ?? ''), name: draft.name === '' ? String(file.name).replace(/\.[^.]+$/u, '') : draft.name, error: null }); reader.readAsText(file); } }),
						),
						h(
							'div',
							{ style: AGENT_INLINE.grid2 },
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '标识（可空：留空就用内容里的 id）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, value: draft.id, onChange: (event) => patchDraft({ id: event.target.value, error: null }) })),
							h('div', { style: AGENT_INLINE.field }, h('span', { className: 'dsr-label' }, '显示名字（可空）'), h('input', { className: 'dsr-input', style: AGENT_INLINE.input, value: draft.name, onChange: (event) => patchDraft({ name: event.target.value, error: null }) })),
						),
						h(
							'div',
							{ style: AGENT_INLINE.checks },
							h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: draft.asCopy, onChange: (event) => patchDraft({ asCopy: event.target.checked, error: null }) }), '重名时自动改个名字（加 -2、-3…）'),
							h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: draft.overwrite, onChange: (event) => patchDraft({ overwrite: event.target.checked, error: null }) }), '覆盖同名自定义预设（内置的永远不覆盖）'),
							h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: draft.asPrompt, onChange: (event) => patchDraft({ asPrompt: event.target.checked, error: null }) }), '这段是系统提示词'),
						),
						draft.error === null || draft.error === undefined ? null : h('div', { style: AGENT_INLINE.error }, draft.error),
						h(
							'div',
							{ style: AGENT_INLINE.actions },
							h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => setMode({ kind: 'list' }) }, '取消'),
							h(
								'button',
								{
									className: 'dsr-btn',
									type: 'button',
									'data-variant': 'primary',
									disabled: busy,
									onClick: () => {
										const payload = { text: draft.text.trim() === '' ? undefined : draft.text, path: draft.path.trim() === '' ? undefined : draft.path.trim(), url: draft.url.trim() === '' ? undefined : draft.url.trim(), id: draft.id.trim() === '' ? undefined : draft.id.trim(), name: draft.name.trim() === '' ? undefined : draft.name.trim(), asCopy: draft.asCopy, overwrite: draft.overwrite, asPrompt: draft.asPrompt };
										void run(async () => {
											try {
												await resource('/agents/import', payload);
											} catch (error) {
												patchDraft({ error: String(error?.message ?? error) });
												throw error;
											}
										}, '导入完成');
									},
								},
								'导入',
							),
						),
						h(AgentSource, {
							online,
							setOnline,
							sources,
							onSources: (next) => setSources(next),
							pickLabel: '装到本机',
							onPick: (result) =>
								void run(
									() => resource('/agents/import', result.localPath === undefined ? { url: result.url, id: result.id, asCopy: true } : { path: result.localPath, id: result.id, asCopy: true }),
									`已装上「${result.id}」`,
								),
						}),
					),
				);
			}

			// ── 在线搜索（整页）──────────────────────────────────────────
			if (mode.kind === 'online') {
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h('div', { style: AGENT_INLINE.head }, h('span', { className: 'dsr-title' }, '在线找智能体'), h('span', { className: 'dsr-spacer' }), h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'list' }) }, '返回')),
					h('div', { style: AGENT_INLINE.hint }, '装第三方预设 = 把别人写的插件行挂到你的 DSH 里。装完在列表里会出现；如果它引用的插件包你没装，那一条会标红写着「装配失败」，按提示装包后重启 DSH 再试。'),
					h(AgentSource, {
						online,
						setOnline,
						sources,
						onSources: (next) => setSources(next),
						pickLabel: '装到本机',
						onPick: (result) =>
							void run(
								() => resource('/agents/import', result.localPath === undefined ? { url: result.url, id: result.id, asCopy: true } : { path: result.localPath, id: result.id, asCopy: true }),
								`已装上「${result.id}」`,
							),
					}),
				);
			}

			// ── 列表 ─────────────────────────────────────────────────────
			return h(
				'div',
				{ className: 'dsr-page', style: AGENT_INLINE.page },
				h('style', null, RES_CSS),
				h(
					'div',
					{ style: AGENT_INLINE.head },
					h('span', { className: 'dsr-title' }, 'DSH 智能体'),
					h('span', { className: 'dsr-sub', style: AGENT_INLINE.hint }, `${state.presets.length} 个（自定义 ${state.presets.filter((agent) => agent.managed === true).length} 个）`),
					h('span', { className: 'dsr-spacer', style: { flex: '1 1 auto' } }),
					h('button', { className: 'dsr-btn', type: 'button', disabled: busy, onClick: () => void load() }, '刷新'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'import' }) }, '导入'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'export', format: 'json' }) }, '导出'),
					h('button', { className: 'dsr-btn', type: 'button', onClick: () => setMode({ kind: 'online' }) }, '在线搜索'),
					h(
						'button',
						{
							className: 'dsr-btn',
							type: 'button',
							'data-variant': 'primary',
							onClick: () => setMode({ kind: 'edit', isNew: true, draft: { id: '', name: '', description: '', order: '', model: '', body: defaultAgentBodyText, asPrompt: false } }),
						},
						'新建',
					),
				),
				h('input', { className: 'dsr-search', style: { ...AGENT_INLINE.input, height: '32px' }, placeholder: '搜索智能体（名字 / 标识 / 简介 / 来源）…', value: query, onChange: (event) => setQuery(event.target.value) }),
				h('div', { style: AGENT_INLINE.hint }, `智能体 = 一行 @deepseek-ai/dsh-agent-preset 声明，正文就是它能用的插件/工具清单。本插件自己加的存在 ${state.store === '' ? '~/.dsh/agent-presets.json' : state.store}，保存后立刻生效、不用重启。${state.model === null || state.model === undefined || state.model.model === '' ? '' : `当前默认模型：${state.model.model}（${state.model.provider}${state.model.reasoningEffort === '' ? '' : ` · ${state.model.reasoningEffort}`}）`}`),
				registryLine,
				errorLine,
				noticeLine,
				state.loading
					? h('div', { style: AGENT_INLINE.empty }, '读取中…')
					: filtered.length === 0
						? h('div', { style: AGENT_INLINE.empty }, state.presets.length === 0 ? '一个智能体都没读到。点「新建」建一个，或「在线搜索」装一个。' : `没有匹配「${query.trim()}」的智能体。`)
						: h(
								'div',
								{ style: AGENT_INLINE.list },
								filtered.map((agent) =>
									h(
										'div',
										{ className: 'dsr-item', style: AGENT_INLINE.item, key: agent.id },
										h(
											'div',
											{ style: AGENT_INLINE.itemMain },
											h(
												'div',
												{ style: AGENT_INLINE.itemTop },
												h('span', { className: 'dsr-name' }, agent.name ?? agent.id),
												h('span', { style: agentBadgeStyle(agent) }, agent.originLabel ?? '来源未知'),
												agent.writable === true ? null : h('span', { style: AGENT_INLINE.badge }, '只读'),
												agent.broken === null || agent.broken === undefined ? null : h('span', { style: AGENT_INLINE.badgeErr }, '装配失败'),
											),
											h('div', { style: AGENT_INLINE.desc }, agent.description === '' || agent.description === undefined ? '（没有简介）' : agent.description),
											agentMeta(agent),
											agent.broken === null || agent.broken === undefined ? null : h('div', { style: AGENT_INLINE.error }, agent.broken),
											agent.note === '' || agent.note === undefined ? null : h('div', { style: AGENT_INLINE.hint }, agent.note),
										),
										h(
											'div',
											{ style: AGENT_INLINE.itemActions },
											h(
												'button',
												{
													className: 'dsr-btn',
													type: 'button',
													style: { height: '28px' },
													disabled: busy,
													onClick: () => {
														setMode({ kind: 'view', agent });
														void resource('/agents/read', { id: agent.id })
															.then((data) => setMode({ kind: 'view', agent, content: data.content }))
															.catch((error) => setState((previous) => ({ ...previous, error: String(error?.message ?? error) })));
													},
												},
												'查看',
											),
											agent.writable !== true
												? null
												: h(
														'button',
														{
															className: 'dsr-btn',
															type: 'button',
															style: { height: '28px' },
															disabled: busy,
															onClick: async () => {
																setBusy(true);
																try {
																	const data = await resource('/agents/read', { id: agent.id });
																	setMode({ kind: 'edit', isNew: false, originalId: agent.id, draft: { id: data.id, name: data.name, description: data.description, order: data.order === null || data.order === undefined ? '' : String(data.order), model: data.model ?? '', body: data.content, asPrompt: false } });
																} catch (error) {
																	setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
																} finally {
																	setBusy(false);
																}
															},
														},
														'编辑',
													),
											h(
												'button',
												{
													className: 'dsr-btn',
													type: 'button',
													style: { height: '28px' },
													disabled: busy,
													onClick: async () => {
														setBusy(true);
														try {
															const data = await resource('/agents/read', { id: agent.id });
															setMode({ kind: 'edit', isNew: true, copyFrom: agent.id, draft: { id: `${agent.id}-copy`, name: `${agent.name ?? agent.id}（副本）`, description: data.description ?? '', order: '', model: '', body: data.content, asPrompt: false } });
														} catch (error) {
															setState((previous) => ({ ...previous, error: String(error?.message ?? error) }));
														} finally {
															setBusy(false);
														}
													},
												},
												'复制一份',
											),
											h('button', { className: 'dsr-btn', type: 'button', style: { height: '28px' }, disabled: busy, onClick: () => setMode({ kind: 'export', format: 'json', id: agent.id }) }, '导出'),
											agent.writable !== true ? null : h('button', { className: 'dsr-btn', type: 'button', style: { height: '28px' }, 'data-variant': 'danger', disabled: busy, onClick: () => setMode({ kind: 'confirm', agent }) }, '删除'),
										),
									),
								),
							),
			);
		}

		/**
		 * 设置页：从其它 AI 导入（独立一页；v1.9.1 从「智能体」页**搬出来**，
		 * `settings.section` id = `other-ai`、order 160）。
		 *
		 * 里面两个页签与搬过来之前一模一样：「智能体预设」（默认）把 Codex / Claude Code /
		 * TRAE / WorkBuddy 里的指令 / 子代理 / 技能导成 DSH 智能体预设；「对话记录」把它们
		 * 聊过的会话导成真正的 DSH 会话。搬出来之后这一页自己拉 `/agents`（只为「已导入」标记），
		 * 原来那个「返回智能体列表」的按钮去掉了 —— 这一页自己在设置导航里，没有上一级。
		 */
		function OtherAiPage() {
			// 「已导入」标记（搬出来之后这一页自己拉，不再借「智能体」页的 state）
			const [presets, setPresets] = React.useState([]);
			const [busy, setBusy] = React.useState(false);
			const [ai, setAi] = React.useState({ loading: false, toolkits: [], error: null, notice: null, addOpen: false, addAddress: '', addLabel: '', addBusy: false, addError: null });
			const [aiBusy, setAiBusy] = React.useState('');
			// 每一项的「重名时自动改个名字」勾选：{ [key]: true }
			const [aiOpt, setAiOpt] = React.useState({});
			// 页签：默认 agents = 老行为（智能体预设）；conversations = 对话记录
			const [aiTab, setAiTab] = React.useState('agents');
			const [conv, setConv] = React.useState({ loading: false, toolkits: [], probe: '', error: null, notice: null });
			const [convQuery, setConvQuery] = React.useState('');
			const [convSource, setConvSource] = React.useState('');
			const [convRows, setConvRows] = React.useState([]);
			const [convPageSize, setConvPageSize] = React.useState(10);
			const [convPage, setConvPage] = React.useState(1);
			const [convPicked, setConvPicked] = React.useState([]);
			const [convResult, setConvResult] = React.useState(null);
			const [convCwd, setConvCwd] = React.useState('');

			/** 拉 `/agents` 只为算「已导入」标记；拉不到就静默降级（不影响导入本身）。 */
			const loadPresets = React.useCallback(async () => {
				try {
					const data = await resource('/agents');
					setPresets(data.presets ?? []);
				} catch {}
			}, []);

			/** 拉「其它 AI」来源清单（只在这页用，失败只写 error 不炸）。 */
			const loadAi = React.useCallback(async () => {
				setAi((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await resource('/other-ai');
					setAi((previous) => ({ ...previous, loading: false, toolkits: data.toolkits ?? [], error: null }));
				} catch (error) {
					setAi((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			/**
			 * 拉「对话记录」清单（只在切到那一个页签时跑，失败只写 error 不炸）。
			 * 走 /other-ai/conversations（来源清单 + 每家的对话条数）与
			 * /other-ai/conversations/list（某一个来源的对话明细）。
			 * @param {string} [sourceId] - 只拉这一个来源；省略 = 全部来源
			 */
			const loadConv = React.useCallback(async (sourceId) => {
				setConv((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await resource('/other-ai/conversations');
					const rows = await resource('/other-ai/conversations/list', sourceId === undefined || sourceId === '' ? {} : { sourceId });
					setConv((previous) => ({
						...previous,
						loading: false,
						toolkits: data.conversations?.toolkits ?? [],
						probe: data.conversations?.probe ?? '',
						error: null,
						notice: (rows.items ?? []).length === 0 ? '这个来源里没扫到对话。' : null,
					}));
					setConvRows(rows.items ?? []);
					setConvPage(1);
				} catch (error) {
					setConv((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				void loadPresets();
			}, [loadPresets]);

			React.useEffect(() => {
				void loadAi();
			}, [loadAi]);

			React.useEffect(() => {
				if (aiTab === 'conversations' && convRows.length === 0 && conv.loading !== true && conv.error === null) void loadConv(convSource);
			}, [aiTab, convSource, convRows.length, conv.loading, conv.error, loadConv]);

			/** 跟「智能体」页里的同名帮手一样：跑一步，失败写 error，留在当前页。 */
			const runHere = async (task, notice) => {
				setBusy(true);
				setAi((previous) => ({ ...previous, error: null, notice: null }));
				try {
					await task();
					if (notice !== undefined) setAi((previous) => ({ ...previous, notice }));
				} catch (error) {
					setAi((previous) => ({ ...previous, error: String(error?.message ?? error) }));
				} finally {
					setBusy(false);
				}
			};

			const list = ai.toolkits ?? [];
			const importedKeys = new Set();
			for (const preset of presets ?? []) {
				if (preset?.external?.item !== undefined && preset.external.item !== null) importedKeys.add(String(preset.external.item));
			}
			const patchAi = (next) => setAi((previous) => ({ ...previous, ...next }));
			const installHint = (toolkit) => `没检测到 ${toolkit.label} —— 装好之后回到这一页点「重新探测」，就能把里面的智能体导进来。`;
			const addAiSource = async () => {
				patchAi({ addBusy: true, addError: null });
				try {
					const data = await resource('/sources/add', { kind: 'other-ai', address: ai.addAddress, label: ai.addLabel });
					patchAi({ addBusy: false, addOpen: false, addAddress: '', addLabel: '', notice: `已加上来源「${data.entry?.label ?? ''}」` });
					await loadAi();
				} catch (error) {
					patchAi({ addBusy: false, addError: String(error?.message ?? error) });
				}
			};
			const removeAiSource = async (toolkit) => {
				patchAi({ addError: null });
				try {
					await resource('/sources/remove', { kind: 'other-ai', id: toolkit.id });
					await loadAi();
				} catch (error) {
					patchAi({ addError: String(error?.message ?? error) });
				}
			};
			const importItem = (toolkit, item) =>
				void runHere(async () => {
					setAiBusy(item.key);
					try {
						const data = await resource('/other-ai/import', { toolkitId: toolkit.id, key: item.key, asCopy: aiOpt[item.key] === true });
						await loadAi();
						// 搬出来之后这一页自己拉「已导入」标记（原来是借「智能体」页的 state，导完那份不会刷新）
						await loadPresets();
						setAi((previous) => ({
							...previous,
							notice: data.error === null || data.error === undefined ? `已导入「${data.id}」${data.renamed === true ? '（重名，自动改了标识）' : ''}` : `已导入「${data.id}」，但装配时报了错：${data.error}`,
						}));
					} finally {
						setAiBusy('');
					}
				});
			// 页签条：「智能体预设」是老行为（默认），「对话记录」是这次新增的那一类
			const tabBar = h(
				'div',
				{
					className: 'dsr-head',
					style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0, padding: '3px', border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-2)', alignSelf: 'flex-start' },
				},
				h(
					'button',
					{
						className: 'dsr-btn',
						type: 'button',
						'data-ai-tab': 'agents',
						'data-variant': aiTab === 'agents' ? 'primary' : 'default',
						style: { height: '28px' },
						onClick: () => { setAiTab('agents'); setConvResult(null); },
					},
					'智能体预设',
				),
				h(
					'button',
					{
						className: 'dsr-btn',
						type: 'button',
						'data-ai-tab': 'conversations',
						'data-variant': aiTab === 'conversations' ? 'primary' : 'default',
						style: { height: '28px' },
						onClick: () => { setAiTab('conversations'); setConvResult(null); },
					},
					'对话记录',
				),
			);

			// ── 页签二：对话记录（Codex / Claude Code / WorkBuddy 的历史会话 → DSH 会话）──
			if (aiTab === 'conversations') {
				const toolkits = conv.toolkits ?? [];
				const installedIds = new Set(toolkits.filter((toolkit) => toolkit.installed === true).map((toolkit) => toolkit.id));
				// 来源过滤 + 关键字过滤（标题 / 首条用户消息 / session id 三处都算）
				const keyword = convQuery.trim().toLowerCase();
				const filtered = (convRows ?? []).filter((row) => {
					if (convSource !== '' && row.sourceId !== convSource) return false;
					if (keyword === '') return true;
					return `${row.title} ${row.firstUser} ${row.id}`.toLowerCase().includes(keyword);
				});
				const pages = Math.max(1, Math.ceil(filtered.length / convPageSize));
				const current = Math.min(convPage, pages);
				const rows = filtered.slice((current - 1) * convPageSize, current * convPageSize);
				const pickedRows = filtered.filter((row) => convPicked.includes(row.key));
				const pageList = [];
				for (let index = 1; index <= pages; index += 1) {
					if (pages > 7 && index > 1 && index < pages && Math.abs(index - current) > 1) {
						if (pageList[pageList.length - 1] !== '…') pageList.push('…');
						continue;
					}
					pageList.push(index);
				}
				const patchConv = (next) => setConv((previous) => ({ ...previous, ...next }));
				/** 读一个对话的完整内容（导入 / 预览 / 导出 Markdown 都要它）。 */
				const readOne = (row) => resource('/other-ai/conversations/read', { sourceId: row.sourceId, id: row.id });
				/** 导入：把选中的对话导成 DSH 会话，逐条回报成功/失败。 */
				const importPicked = async () => {
					if (pickedRows.length === 0) return;
					patchConv({ loading: true, error: null, notice: null });
					setConvResult(null);
					try {
						const data = await resource('/other-ai/conversations/import', {
							items: pickedRows.map((row) => ({ sourceId: row.sourceId, id: row.id })),
							cwd: convCwd.trim() === '' ? undefined : convCwd.trim(),
						});
						setConvResult(data);
						patchConv({ loading: false, notice: `导入完成：成功 ${String(data.imported ?? 0)} · 跳过 ${String(data.skipped ?? 0)} · 失败 ${String(data.failed ?? 0)}。导入的会话在左侧会话列表里（可能要刷新一下或重启 DSH 才出现）。` });
					} catch (error) {
						patchConv({ loading: false, error: String(error?.message ?? error) });
					}
				};
				/** 轻量备选：选中对话 → 一个 Markdown 文件。 */
				const exportMarkdown = async () => {
					if (pickedRows.length === 0) return;
					patchConv({ error: null });
					try {
						const read = [];
						for (const row of pickedRows) read.push(await readOne(row));
						downloadText(`imported-conversations-${String(Date.now())}.md`, 'text/markdown', conversationsToMarkdown(read));
						patchConv({ notice: `已导出 ${String(read.length)} 个对话成 Markdown（存到你的下载目录）。` });
					} catch (error) {
						patchConv({ error: String(error?.message ?? error) });
					}
				};
				/** 轻量备选：把选中对话塞进当前会话的输入框。 */
				const insertPicked = async () => {
					if (pickedRows.length === 0) return;
					patchConv({ error: null });
					try {
						const read = [];
						for (const row of pickedRows) read.push(await readOne(row));
						const text = conversationsToMarkdown(read);
						const result = insertTextIntoInput(text.slice(0, 20000));
						if (result.ok === true) {
							patchConv({ notice: '已插入到输入框（只带了前 20000 字，整份请用「导出 Markdown」）。' });
							return;
						}
						patchConv({ error: result.reason === 'no-session' ? '请先在左侧选一个工作区目录、打开一个会话，再插入。' : '没找到可写入的输入框：请先打开一个会话（输入框出现后）再插入。' });
					} catch (error) {
						patchConv({ error: String(error?.message ?? error) });
					}
				};
				const copyRow = async (row) => {
					patchConv({ error: null, notice: null });
					try {
						const data = await readOne(row);
						const text = conversationsToMarkdown([data]);
						const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
						if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
							patchConv({ error: '这个环境里拿不到剪贴板，用「导出 Markdown」吧。' });
							return;
						}
						await clipboard.writeText(text);
						patchConv({ notice: `已复制「${data.title}」（Markdown）。` });
					} catch (error) {
						patchConv({ error: String(error?.message ?? error) });
					}
				};
				return h(
					'div',
					{ className: 'dsr-page', style: AGENT_INLINE.page },
					h('style', null, RES_CSS),
					h(
						'div',
						{ style: AGENT_INLINE.head },
						h('span', { className: 'dsr-title' }, '从其它 AI 导入'),
						h('span', { className: 'dsr-sub', style: AGENT_INLINE.hint }, `${String(convRows.length)} 个对话`),
						h('span', { className: 'dsr-spacer', style: { flex: '1 1 auto' } }),
						h('button', { className: 'dsr-btn', type: 'button', disabled: conv.loading === true, onClick: () => void loadConv(convSource) }, conv.loading === true ? '扫描中…' : '重新扫描'),
					),
					tabBar,
					h('div', { style: AGENT_INLINE.hint }, '只读扫本机 Codex / Claude Code / WorkBuddy 的历史对话（一个字节都不写别人的目录）。选中的对话可以导成 **DSH 会话**（导完在左侧会话列表里打开，能接着聊），也可以退一步：导出成 Markdown 文件，或者插入到输入框。'),
					h('div', { style: AGENT_INLINE.hint }, '导入是按会话 id 幂等的：同一个对话再导一次 = 跳过（内容变了则新建一个 -2 的会话，不覆盖原来那个）。TRAE 的对话不落地成文件，暂不支持解析。'),
					conv.probe === '' ? null : h('div', { style: AGENT_INLINE.mono }, `扫描方式：${conv.probe}`),
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h(
							'select',
							{ className: 'dsr-select', style: { ...AGENT_INLINE.input, maxWidth: '190px' }, value: convSource, onChange: (event) => { setConvSource(event.target.value); setConvPicked([]); void loadConv(event.target.value); } },
							h('option', { value: '' }, '全部来源'),
							toolkits.map((toolkit) => h('option', { key: toolkit.id, value: toolkit.id }, `${toolkit.label}${toolkit.supported === false ? '（不支持）' : `（${String(toolkit.count ?? 0)}）`}`)),
						),
						h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '320px' }, placeholder: '搜索标题 / 首条用户消息 / 会话 id…', value: convQuery, onChange: (event) => { setConvQuery(event.target.value); setConvPage(1); } }),
						h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '320px' }, placeholder: '导入到哪个工作区目录（可选，默认用原对话的目录）', value: convCwd, onChange: (event) => setConvCwd(event.target.value) }),
					),
					h(
						'div',
						{ style: AGENT_INLINE.list },
						toolkits.map((toolkit) =>
							h(
								'div',
								{ className: 'dsr-item', style: AGENT_INLINE.item, key: toolkit.id, 'data-conv-source': toolkit.id },
								h(
									'div',
									{ style: AGENT_INLINE.itemMain },
									h(
										'div',
										{ style: AGENT_INLINE.itemTop },
										h('span', { className: 'dsr-name' }, toolkit.label),
										toolkit.installed === true ? h('span', { style: AGENT_INLINE.badgeMine }, '已检测到安装') : h('span', { style: AGENT_INLINE.badge }, '未检测到'),
										toolkit.supported === false ? h('span', { style: AGENT_INLINE.badgeErr }, '暂不支持解析这个工具的对话格式') : h('span', { style: AGENT_INLINE.badge }, `${String(toolkit.count ?? 0)} 个对话`),
									),
									h('div', { style: AGENT_INLINE.hint }, toolkit.hint ?? ''),
									toolkit.note === undefined || toolkit.note === '' ? null : h('div', { style: AGENT_INLINE.mono }, toolkit.note),
									toolkit.error !== null && toolkit.error !== undefined ? h('div', { style: AGENT_INLINE.error }, toolkit.error) : null,
								),
								toolkit.installed !== true
									? h(
											'div',
											{ style: AGENT_INLINE.itemActions },
											toolkit.homepage === undefined || toolkit.homepage === '' ? null : h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', onClick: () => window.open(toolkit.homepage, '_blank', 'noopener,noreferrer') }, `去官网下载安装${toolkit.homepageLabel === undefined || toolkit.homepageLabel === '' ? '' : `（${toolkit.homepageLabel}）`}`),
										)
									: null,
							),
						),
					),
					conv.error === null || conv.error === undefined ? null : h('div', { style: AGENT_INLINE.error }, conv.error),
					conv.notice === null || conv.notice === undefined ? null : h('div', { style: AGENT_INLINE.notice }, conv.notice),
					conv.loading === true && convRows.length === 0 ? h('div', { style: AGENT_INLINE.empty }, '正在扫描本机的对话…（Codex 的会话文件很多，第一次会慢一点）') : null,
					h(
						'div',
						{ className: 'dsr-head', style: { ...AGENT_INLINE.actions, justifyContent: 'space-between' } },
						h(
							'label',
							{ className: 'dsr-hint', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
							h('input', {
								type: 'checkbox',
								checked: rows.length > 0 && rows.every((row) => convPicked.includes(row.key)),
								onChange: (event) =>
									setConvPicked(
										event.target.checked
											? [...new Set([...convPicked, ...rows.map((row) => row.key)])]
											: convPicked.filter((key) => !rows.some((row) => row.key === key)),
									),
							}),
							`全选本页（${String(rows.length)} 条）`,
						),
						h('button', { className: 'dsr-btn', type: 'button', disabled: filtered.length === 0, onClick: () => setConvPicked(filtered.map((row) => row.key)) }, `全选全部 ${String(filtered.length)} 条`),
						convPicked.length === 0 ? null : h('button', { className: 'dsr-btn', type: 'button', onClick: () => setConvPicked([]) }, '清空选择'),
						h('span', { style: AGENT_INLINE.hint }, `已选 ${String(pickedRows.length)} 条`),
					),
					rows.length === 0
						? h('div', { style: AGENT_INLINE.empty }, conv.loading === true ? '' : convRows.length === 0 ? '没扫到任何对话。装好工具、聊点东西，再点「重新扫描」。' : '没有匹配的对话。')
						: rows.map((row) =>
								h(
									'div',
									{ className: 'dsr-item', style: AGENT_INLINE.item, key: row.key, 'data-picked': convPicked.includes(row.key) ? 'true' : 'false' },
									h('input', { type: 'checkbox', checked: convPicked.includes(row.key), onChange: (event) => setConvPicked(event.target.checked ? [...convPicked, row.key] : convPicked.filter((key) => key !== row.key)) }),
									h(
										'div',
										{ style: AGENT_INLINE.itemMain },
										h(
											'div',
											{ style: AGENT_INLINE.itemTop },
											h('span', { className: 'dsr-name' }, row.title),
											h('span', { style: AGENT_INLINE.badgeBuiltin }, row.sourceLabel),
											h('span', { style: AGENT_INLINE.badge }, `${String(row.messages ?? 0)} 条消息`),
											row.createdAt === undefined ? null : h('span', { style: AGENT_INLINE.badge }, String(row.createdAt).replace('T', ' ').slice(0, 16)),
										),
										row.firstUser === undefined || row.firstUser === '' ? null : h('div', { style: AGENT_INLINE.desc }, row.firstUser),
										h('div', { style: AGENT_INLINE.mono }, `${row.id}${row.cwd === undefined || row.cwd === '' ? '' : ` · ${row.cwd}`}`),
									),
									h(
										'div',
										{ style: AGENT_INLINE.itemActions },
										h('button', { className: 'dsr-btn', type: 'button', style: { height: '28px' }, onClick: () => void copyRow(row) }, '复制 Markdown'),
									),
								),
							),
					convResult === null ? null : h(
						'div',
						{ style: AGENT_INLINE.list },
						h('div', { style: AGENT_INLINE.hint }, `导入结果：成功 ${String(convResult.imported ?? 0)} · 跳过 ${String(convResult.skipped ?? 0)} · 失败 ${String(convResult.failed ?? 0)}`),
						(convResult.results ?? []).map((row) =>
							h(
								'div',
								{ className: 'dsr-item', style: { ...AGENT_INLINE.item, alignItems: 'center' }, key: row.key, 'data-import-row': row.ok === true ? 'ok' : 'fail' },
								h('span', { style: row.ok === true ? AGENT_INLINE.badgeMine : AGENT_INLINE.badgeErr }, row.ok !== true ? '失败' : row.skipped === true ? '跳过' : '已导入'),
								h('span', { style: AGENT_INLINE.mono }, row.key),
								h('span', { style: AGENT_INLINE.hint }, row.ok !== true ? String(row.error ?? '') : row.skipped === true ? String(row.reason ?? '') : `${String(row.sessionId ?? '')} · ${String(row.messages ?? 0)} 条消息${row.truncated > 0 ? ` · 截断 ${String(row.truncated)} 条` : ''}${row.via === 'file' ? '（直接写存储）' : '（官方存储服务）'}`),
							),
						),
					),
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', disabled: conv.loading === true || pickedRows.length === 0, onClick: () => void importPicked() }, conv.loading === true ? '导入中…' : `导入成 DSH 会话（${String(pickedRows.length)} 条）`),
						h('button', { className: 'dsr-btn', type: 'button', disabled: pickedRows.length === 0, onClick: () => void exportMarkdown() }, '导出 Markdown'),
						h('button', { className: 'dsr-btn', type: 'button', disabled: pickedRows.length === 0, onClick: () => void insertPicked() }, '插入到输入框'),
						h('span', { style: { flex: '1 1 auto' } }),
						h('label', { style: AGENT_INLINE.hint }, '每页 '),
						h(
							'select',
							{ className: 'dsr-select', style: { ...AGENT_INLINE.input, width: '86px' }, value: String(convPageSize), onChange: (event) => { setConvPageSize(Number(event.target.value)); setConvPage(1); } },
							[10, 20, 50, 100].map((size) => h('option', { key: size, value: String(size) }, `${String(size)} 条`)),
						),
						h('span', { style: AGENT_INLINE.hint }, `第 ${String(current)}/${String(pages)} 页`),
						h('button', { className: 'dsr-btn', type: 'button', disabled: current <= 1, onClick: () => setConvPage(current - 1) }, '上一页'),
						...pageList.map((item) =>
							item === '…'
								? h('span', { key: 'gap', style: AGENT_INLINE.hint }, '…')
								: h('button', { key: `cp${String(item)}`, className: 'dsr-btn', type: 'button', 'data-variant': item === current ? 'primary' : 'default', onClick: () => setConvPage(item) }, String(item)),
						),
						h('button', { className: 'dsr-btn', type: 'button', disabled: current >= pages, onClick: () => setConvPage(current + 1) }, '下一页'),
					),
					h('div', { style: AGENT_INLINE.hint }, '「导入成 DSH 会话」把对话写进 DSH 的会话存储（走宿主的会话存储服务；拿不到服务时按同一套格式写 ~/.dsh/sessions）。导入后的会话在左侧会话列表里打开、能接着聊。「导出 Markdown / 插入到输入框」是轻量备选：不进会话列表，但立刻能看、能改。'),
				);
			}

			return h(
				'div',
				{ className: 'dsr-page', style: AGENT_INLINE.page },
				h('style', null, RES_CSS),
				h(
					'div',
					{ style: AGENT_INLINE.head },
					h('span', { className: 'dsr-title' }, '从其它 AI 导入'),
					h('span', { className: 'dsr-sub', style: AGENT_INLINE.hint }, `${list.filter((toolkit) => toolkit.installed === true).length} / ${list.length} 个来源已装`),
					h('span', { className: 'dsr-spacer', style: { flex: '1 1 auto' } }),
					h('button', { className: 'dsr-btn', type: 'button', disabled: ai.loading === true, onClick: () => void loadAi() }, ai.loading === true ? '探测中…' : '重新探测'),
				),
				tabBar,
				h('div', { style: AGENT_INLINE.hint }, '只读探测本机的其它 AI 工具（只看它自己的配置目录/可执行文件在不在，不递归扫盘、不上网）。装了就把里面的智能体/提示词一键导成 DSH 智能体预设；没装的不藏起来，直接给官网入口。'),
				ai.error === null || ai.error === undefined ? null : h('div', { style: AGENT_INLINE.error }, ai.error),
				ai.notice === null || ai.notice === undefined ? null : h('div', { style: AGENT_INLINE.notice }, ai.notice),
				ai.loading === true && list.length === 0 ? h('div', { style: AGENT_INLINE.empty }, '正在探测本机…') : null,
				ai.loading !== true && list.length === 0 ? h('div', { style: AGENT_INLINE.empty }, '一个来源都没有。点「重新探测」再试一次，或者在下面手动加一个第三方来源。') : null,
				h(
					'div',
					{ style: AGENT_INLINE.list },
					list.map((toolkit) =>
						h(
							'div',
							{ className: 'dsr-item', style: { ...AGENT_INLINE.item, flexDirection: 'column', alignItems: 'stretch' }, key: toolkit.id },
							h(
								'div',
								{ style: AGENT_INLINE.itemTop },
								h('span', { className: 'dsr-name' }, toolkit.label),
								toolkit.installed === true ? h('span', { style: AGENT_INLINE.badgeMine }, '已检测到安装') : h('span', { style: AGENT_INLINE.badge }, '未检测到'),
								toolkit.partial === true ? h('span', { style: AGENT_INLINE.badge }, '只有配置残渣') : null,
								toolkit.custom === true ? h('span', { style: AGENT_INLINE.badge }, '第三方来源') : null,
								toolkit.installed === true ? h('span', { style: AGENT_INLINE.badge }, `${String((toolkit.items ?? []).length)} 项可导入`) : null,
								toolkit.importable !== true ? h('span', { style: AGENT_INLINE.badgeErr }, '格式暂不支持导入') : null,
							),
							h('div', { style: AGENT_INLINE.mono }, `探测：${toolkit.probeNote ?? ''}${(toolkit.foundPaths ?? []).length === 0 ? '' : ` · 命中 ${(toolkit.foundPaths ?? []).join('、')}`}${(toolkit.appPaths ?? []).length === 0 ? '' : ` · 应用 ${(toolkit.appPaths ?? []).join('、')}`}${(toolkit.binaries ?? []).length === 0 ? '' : ` · 命令 ${(toolkit.binaries ?? []).join('、')}`}`),
							toolkit.format === undefined || toolkit.format === '' ? null : h('div', { style: AGENT_INLINE.hint }, `能导入什么：${toolkit.format}`),
							toolkit.hint === undefined || toolkit.hint === '' ? null : h('div', { style: AGENT_INLINE.hint }, toolkit.hint),
							toolkit.error !== null && toolkit.error !== undefined ? h('div', { style: AGENT_INLINE.error }, toolkit.error) : null,
							toolkit.installed !== true
								? h(
										'div',
										{ style: AGENT_INLINE.actions },
										h('span', { style: AGENT_INLINE.hint }, installHint(toolkit)),
										toolkit.homepage === undefined || toolkit.homepage === '' ? null : h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', onClick: () => window.open(toolkit.homepage, '_blank', 'noopener,noreferrer') }, `去官网下载安装${toolkit.homepageLabel === undefined || toolkit.homepageLabel === '' ? '' : `（${toolkit.homepageLabel}）`}`),
									)
								: null,
							toolkit.installed === true && (toolkit.items ?? []).length === 0 ? h('div', { style: AGENT_INLINE.empty }, '装是装了，但它自己还没存任何可导入的智能体/提示词。') : null,
							(toolkit.items ?? []).length === 0
								? null
								: h(
										'div',
										{ style: AGENT_INLINE.list },
										(toolkit.items ?? []).map((item) =>
											h(
												'div',
												{ className: 'dsr-item', style: AGENT_INLINE.item, key: item.key },
												h(
													'div',
													{ style: AGENT_INLINE.itemMain },
													h(
														'div',
														{ style: AGENT_INLINE.itemTop },
														h('span', { className: 'dsr-name' }, item.name ?? item.key),
														h('span', { style: AGENT_INLINE.badge }, item.badge ?? item.kind ?? '内容'),
														h('span', { style: AGENT_INLINE.badge }, `${String(item.chars ?? 0)} 字`),
														importedKeys.has(String(item.key)) ? h('span', { style: AGENT_INLINE.badgeMine }, '已导入') : null,
													),
													h('div', { style: AGENT_INLINE.desc }, item.description === undefined || item.description === '' ? '（没有简介）' : item.description),
													h('div', { style: AGENT_INLINE.mono }, item.path ?? item.url ?? ''),
												),
												h(
													'div',
													{ style: AGENT_INLINE.itemActions },
													h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, h('input', { type: 'checkbox', checked: aiOpt[item.key] === true, onChange: (event) => setAiOpt((previous) => ({ ...previous, [item.key]: event.target.checked })) }), '重名自动改名'),
													h('button', { className: 'dsr-btn', type: 'button', style: { height: '28px' }, 'data-variant': 'primary', disabled: aiBusy !== '' || busy, onClick: () => importItem(toolkit, item) }, aiBusy === item.key ? '导入中…' : importedKeys.has(String(item.key)) ? '重新导入' : '导入成 DSH 智能体'),
												),
											),
										),
									),
							toolkit.custom === true ? h('div', { style: AGENT_INLINE.actions }, h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'danger', disabled: busy, onClick: () => void removeAiSource(toolkit) }, '删除这个来源')) : null,
						),
					),
				),
				h(
					'div',
					{ style: AGENT_INLINE.field },
					h('span', { className: 'dsr-label', style: AGENT_INLINE.hint }, '添加第三方来源（一个本机路径，或一个 http/https 地址；加过的来源能删，导进来的预设不会被删）'),
					h(
						'div',
						{ style: AGENT_INLINE.actions },
						h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '420px' }, placeholder: '~/my-agents，或 https://github.com/owner/repo', value: ai.addAddress, onChange: (event) => patchAi({ addAddress: event.target.value, addError: null }) }),
						h('input', { className: 'dsr-input', style: { ...AGENT_INLINE.input, maxWidth: '160px' }, placeholder: '显示名（可选）', value: ai.addLabel, onChange: (event) => patchAi({ addLabel: event.target.value }) }),
						h('button', { className: 'dsr-btn', type: 'button', 'data-variant': 'primary', disabled: ai.addBusy === true, onClick: () => void addAiSource() }, '保存来源'),
					),
					h('div', { style: AGENT_INLINE.hint }, '本机路径可以是一个 md 文件，也可以是一个目录（目录里的 *.md 一个一个列出来）；http 地址可以指一个文件，也可以是一个 GitHub 仓库（会去找里面的 AGENTS.md / CLAUDE.md / agents/ / prompts/）。'),
					ai.addError === null || ai.addError === undefined ? null : h('div', { style: AGENT_INLINE.error }, ai.addError),
				),
			);
		}

		/** 新建智能体时的默认正文（persona + 几个常用工具）。 */
		const defaultAgentBodyText = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: You are a helpful software engineer assistant.\n    complete: false\n    includeRuntimeContext: true\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n- id: tool-fs-search\n  name: '@deepseek-ai/dsh-tool-fs-search'\n- id: tool-todo\n  name: '@deepseek-ai/dsh-tool-todo'\n- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n";

		// ===================================================================
		// Token 活动（热力图）—— 纯新增段落，不碰上面任何一段
		//
		// 放在哪：设置 →「账号与余额」的「充值余额」卡片**下面**。
		//   · 那一页是自带插件注册的单页 slot（`settings.section` + id `account`），
		//     **没有** item 子插槽可用；按 slot 规则也**绝不能**复用 `account` 这个 id
		//     （复用 = 把那一格整页替换掉）。所以这里用 React portal 把卡片**追加到**
		//     该页的余额卡片节点后面，DOM 在就挂、DOM 没了自动收走，不改宿主一个字节。
		//   · 同时另注册一个独立设置页（id `token-activity`，order 170）作为兜底/直达入口；
		//     账号页那边挂上了的话，兜底页就不再出现在导航里（避免同一个东西两处都在）。
		//
		// 数据：宿主 `/api/dsh-update-vd/usage/daily`，来自本机会话日志里
		// `assistant/message` 事件的 `data.usage`，按**本地日期**汇总（口径 inputTokens + outputTokens）。
		// ===================================================================

		/** 热力图取数接口。 */
		const TA_ROUTE = `${ROUTE}/usage/daily`;
		/** 账号页里那张「充值余额」卡片（自带 AccountSection.module.css 的类名）。 */
		const TA_ANCHOR_CLASS = 'swbgcW_balanceCard';
		/** 我们插进去的容器的标记，用来判断「是不是已经插过了」。 */
		const TA_MARKER = 'data-dsh-token-activity';
		/** 滚动容器兜底：万一那页的滚动条不在 window 上，向上找可滚的祖先。 */
		const TA_SCROLLER_CLASS = 'swbgcW_section';

		/** 四种模式的配色：每天=绿 / 每周=黄 / 年=红 / 累计总量=蓝；每档都比上一档深。 */
		const TA_PALETTE = Object.freeze({
			day: { label: '每天', unit: '每天 Token', family: 'green', levels: ['#16281d', '#0e4429', '#1f7a3d', '#31a95c', '#57d987'] },
			week: { label: '每周', unit: '每周 Token', family: 'yellow', levels: ['#2c2410', '#5c4407', '#8f6a05', '#c79102', '#f2c024'] },
			year: { label: '年', unit: '每年 Token', family: 'red', levels: ['#2d1517', '#5d1a1a', '#932020', '#c62f2c', '#ef5350'] },
			total: { label: '累计总量', unit: '累计 Token', family: 'blue', levels: ['#16233a', '#12315c', '#1a4c8f', '#2a6fc4', '#4f9bf0'] },
		});
		/** 模式顺序 = 界面上的按钮顺序。 */
		const TA_MODES = ['day', 'week', 'year', 'total'];
		/** `<style>` 块在这个宿主上出现过不生效，关键布局一律内联兜底，这里只放次要的过渡/悬停。 */
		const TA_CSS = `
.dta-cell { transition: opacity .12s ease, outline-color .12s ease; }
.dta-seg { transition: background .12s ease, color .12s ease; }
.dta-seg:not([data-active="1"]):hover { background: var(--dsw-alias-interactive-bg-hover); }
`;
		/** 中文单位：10000 → 万，1e8 → 亿，1e12 → 万亿。 */
		const TA_UNITS = [
			[1e12, '万亿'],
			[1e8, '亿'],
			[1e4, '万'],
		];

		/** 本地日期 → 星期几（0=周日，1=周一…）。 */
		function taWeekday(date) {
			return date.getDay();
		}

		/**
		 * 数值格式（全插件统一，别处照抄这一条）：
		 *   · 绝对值 < 10000            → 千分位整数，如 `1,234`
		 *   · ≥ 10000                   → 万：折算值 <10 保留 2 位、<1000 保留 1 位、再大取整
		 *   · ≥ 1e8                     → 亿，同上 → `1.23亿` / `12.3亿`
		 *   · ≥ 1e12                    → 万亿，同上
		 *   · 一律去掉尾随 0（`1.00万` → `1万`、`239.70万` → `239.7万`）
		 *   · 不合法（NaN / null）      → `0`
		 * 一句话：**按「折算到该单位后的数值」定小数位：<10 两位、<1000 一位、否则取整**。
		 * @param value - token 数。
		 * @returns 展示用字符串。
		 */
		function taFormat(value) {
			const number = Number(value);
			if (!Number.isFinite(number) || number === 0) return '0';
			const sign = number < 0 ? '-' : '';
			const abs = Math.abs(number);
			for (const [scale, unit] of TA_UNITS) {
				if (abs >= scale) {
					const scaled = abs / scale;
					// 规则：万/亿/万亿按「折合后的数值」决定小数位 —— <10 保留 2 位（1.23亿）、
					// <1000 保留 1 位（12.3万 / 239.7万）、≥1000 取整（1235万）；最后去掉尾随 0。
					const digits = scaled < 10 ? 2 : scaled < 1e3 ? 1 : 0;
					return `${sign}${taTrim(scaled.toFixed(digits))}${unit}`;
				}
			}
			const rounded = Math.round(abs);
			return `${sign}${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}`;
		}

		/** 去掉小数尾巴：`1.20` → `1.2`；`1.00` → `1`。 */
		function taTrim(text) {
			return text.includes('.') ? text.replace(/\.?0+$/u, '') : text;
		}

		/** 本地「日期键」`YYYY-MM-DD`（与宿主同口径，避免跨时区错一天）。 */
		function taDayKey(date) {
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return `${date.getFullYear()}-${month}-${day}`;
		}

		/** 一天的起点（本地零点）。 */
		function taStartOfDay(date) {
			return new Date(date.getFullYear(), date.getMonth(), date.getDate());
		}

		/** 这一周的周一（自然周，周一开头）。 */
		function taWeekStart(date) {
			const start = taStartOfDay(date);
			const weekday = (taWeekday(start) + 6) % 7;
			start.setDate(start.getDate() - weekday);
			return start;
		}

		/** 加减天数（跨月/跨年安全）。 */
		function taAddDays(date, days) {
			const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
			next.setDate(next.getDate() + days);
			return next;
		}

		/** 两个日期差几天。 */
		function taDaysBetween(from, to) {
			return Math.round((taStartOfDay(to).getTime() - taStartOfDay(from).getTime()) / 86400000);
		}

		/** 月份刻度文案（如 `11月`）；跨年时带上年份。 */
		function taMonthLabel(date) {
			return `${date.getMonth() + 1}月`;
		}

		/** 悬停浮层第一行：`4月1日`（跨年再加年份，避免误读）。 */
		function taDateLabel(date, withYear) {
			return `${withYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
		}

		/**
		 * 数值 → 档位（0 = 没有记录，1..4 = 由浅到深）。
		 * 用「最大值四等分」分档：首档做底线，避免只出现最深的一档。
		 * @param value - 该格的数值。
		 * @param max - 全图最大值。
		 * @returns 0..4。
		 */
		function taLevel(value, max) {
			const number = Number(value);
			if (!Number.isFinite(number) || number <= 0) return 0;
			const ceiling = Number(max);
			if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
			const level = Math.ceil((number / ceiling) * 4);
			return Math.min(4, Math.max(1, level));
		}

		/** 一组格子里的最大值（日/周/年用原值，累计用增量，避免最后一天永远最深）。 */
		function taMaxValue(cells) {
			let max = 0;
			for (const cell of cells) if (cell.value > max) max = cell.value;
			return max;
		}

		/**
		 * 解析 `YYYY-MM-DD` 为本地零点；格式对但日期不存在（如 `2026-13-99`）返回 null。
		 * 所有分支都必须走这里 —— 之前的 bug 就是 `new Date('2026-13-99T00:00:00')` 变成
		 * Invalid Date，差值算成 NaN，再拿去做 `new Array(NaN)` 直接 RangeError。
		 * @param key - 日期键。
		 * @returns Date 或 null。
		 */
		function taParseDay(key) {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(key));
			if (match === null) return null;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			if (month < 1 || month > 12 || day < 1 || day > 31) return null;
			const date = new Date(year, month - 1, day);
			if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
			return date;
		}

		/**
		 * 聚合纯函数：把「天 → token」变成某一种模式的网格（**不碰 React、不读 DOM**，方便单测）。
		 *
		 * 模式口径：
		 *   · day   逐日原值，横轴按自然周排 7 行（GitHub 那种一年视图，默认最近 53 周）
		 *   · week  按**自然周**（周一开头）求和，一格一周；默认最近 26 周
		 *   · year  按**自然年**求和，一格一年
		 *   · total 按天累加（从最早的一天开始，中间缺的日子也接着累加），显示每天的累计值
		 * @param rows - `{ 'YYYY-MM-DD': tokens }`。
		 * @param mode - `day` / `week` / `year` / `total`。
		 * @param now - 参考「今天」（测试里固定它）。
		 * @returns `{ mode, rows, columns, cells, labels, peak, total, days }`。
		 *   `cells` 是**行优先**的二维数组（`cells[row][column]`），`null` 表示占位空格。
		 */
		function buildHeatmap(rows, mode, now) {
			const input = rows !== null && typeof rows === 'object' ? rows : {};
			// 非法 / 未知模式一律按「每天」处理（外部传什么字符串都不该把它弄崩）。
			const shape = TA_PALETTE[mode] === undefined ? 'day' : mode;
			const parsedNow = now instanceof Date ? now : new Date(now ?? Date.now());
			const today = Number.isNaN(parsedNow.getTime()) ? taStartOfDay(new Date()) : taStartOfDay(parsedNow);
			const flat = new Map();
			for (const [key, value] of Object.entries(input)) {
				if (taParseDay(key) === null) continue;
				const number = Number(value);
				if (!Number.isFinite(number) || number <= 0) continue;
				flat.set(key, number);
			}
			const days = flat.size;
			/** 把一个日期段填成一格。 */
			const makeCell = (start, end, value, level, label, range) => ({
				date: taDayKey(start),
				key: range === undefined ? taDayKey(start) : `${taDayKey(start)}~${taDayKey(end)}`,
				value,
				level,
				label,
				range,
			});
			if (days === 0) {
				return { mode: shape, rows: 1, columns: 1, cells: [[null]], labels: [], peak: 0, total: 0, days: 0 };
			}
			const total = [...flat.values()].reduce((sum, value) => sum + value, 0);

			if (shape === 'year') {
				const byYear = new Map();
				for (const [key, value] of flat) {
					const year = Number(key.slice(0, 4));
					byYear.set(year, (byYear.get(year) ?? 0) + value);
				}
				const years = [...byYear.keys()].sort((left, right) => left - right);
				const values = years.map((year) => byYear.get(year));
				const peak = Math.max(...values);
				const cells = years.map((year, index) => {
					const start = new Date(year, 0, 1);
					const end = new Date(year, 11, 31);
					return [makeCell(start, end, values[index], taLevel(values[index], peak), `${year}年`, `全年合计`)];
				});
				return { mode: shape, rows: 1, columns: years.length, cells, labels: [], peak, total, days };
			}

			if (shape === 'week') {
				const byWeek = new Map();
				for (const [key, value] of flat) {
					const day0 = taParseDay(key);
					if (day0 === null) continue;
					const start = taWeekStart(day0);
					const weekKey = taDayKey(start);
					byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + value);
				}
				const earliest = taParseDay([...byWeek.keys()].sort()[0]);
				const lastWeek = taWeekStart(today);
				const span = Math.max(1, Math.round(taDaysBetween(earliest, lastWeek) / 7) + 1);
				const weeks = Math.min(26, span);
				const values = [];
				const starts = [];
				for (let index = weeks - 1; index >= 0; index -= 1) {
					const start = taAddDays(lastWeek, -7 * index);
					starts.push(start);
					values.push(byWeek.get(taDayKey(start)) ?? 0);
				}
				const peak = taMaxValue(values.map((value) => ({ value })));
				const count = starts.length;
				const columns = Math.ceil(count / 2);
				const gridRows = [];
				for (let row = 0; row < 2; row += 1) {
					const line = [];
					for (let column = 0; column < columns; column += 1) {
						const index = column * 2 + row;
						if (index >= count) {
							line.push(null);
							continue;
						}
						const start = starts[index];
						const end = taAddDays(start, 6);
						line.push(makeCell(start, end, values[index], taLevel(values[index], peak), taDateLabel(start), `${taDateLabel(start)} – ${taDateLabel(end)}`));
					}
					gridRows.push(line);
				}
				return { mode: shape, rows: 2, columns, cells: gridRows, labels: [], peak, total, days };
			}

			if (shape === 'total') {
				const keys = [...flat.keys()].sort();
				const first = taParseDay(keys[0]);
				const spanDays = Math.max(1, taDaysBetween(first, today) + 1);
				const start = spanDays > 371 ? taAddDays(today, -370) : first;
				// 先把「每天累加到多少」算出来（从最早的一天起算，缺记录的日子也接着累加）。
				const sums = new Map();
				let running = 0;
				for (const key of keys) {
					running += flat.get(key);
					sums.set(key, running);
				}
				const dates = new Map();
				const byKey = new Map();
				let carried = 0;
				let previous = 0;
				for (let index = 0; index < 371; index += 1) {
					const date = taAddDays(start, index);
					if (date > today) break;
					const key = taDayKey(date);
					dates.set(key, date);
					// 没有记录的那天沿用上一次的累计值 —— 这样「累计总量」整条是连续的、单调不减的，
					// 最后一天也就等于全部合计（而不是「最后一条记录那天」）。
					if (sums.has(key)) carried = sums.get(key);
					const sum = carried;
					byKey.set(key, { key, sum, delta: sum - previous });
					previous = sum;
				}
				const incrementPeak = taMaxValue([...byKey.values()].map((item) => ({ value: item.delta })));
				return taGridFromDays(dates, byKey, incrementPeak, today, shape, total, days, true);
			}

			// day（默认）
			const earliest = taParseDay([...flat.keys()].sort()[0]);
			const spanDays = Math.max(1, taDaysBetween(earliest, today) + 1);
			const start = spanDays > 371 ? taAddDays(today, -370) : earliest;
			const dates = new Map();
			for (let index = 0; index < 371; index += 1) {
				const date = taAddDays(start, index);
				if (date > today) break;
				dates.set(taDayKey(date), date);
			}
			const byKey = new Map([...flat.entries()].map(([key, value]) => [key, { key, sum: value, delta: value }]));
			return taGridFromDays(dates, byKey, taMaxValue([...flat.values()].map((value) => ({ value }))), today, mode, total, days, false);
		}

		/**
		 * 把「一串日期 + 值」排成 7 行（周一…周日）的周列网格 —— GitHub 那种形状。
		 * @param dates - `YYYY-MM-DD` → Date，按天连续。
		 * @param byKey - `YYYY-MM-DD` → `{ key, sum, delta }`。
		 * @param peak - 分档用的最大值（累计模式传的是**增量**，这样最后一格才不会永远最深）。
		 * @param today - 今天（用于跨年标签）。
		 * @param mode - 模式（放进返回值）。
		 * @param total - 合计。
		 * @param days - 有记录的天数。
		 * @param cumulative - 该格展示的是累计值还是原值。
		 * @returns 与 `buildHeatmap` 同形的网格。
		 */
		function taGridFromDays(dates, byKey, peak, today, mode, total, days, cumulative) {
			const all = [...dates.values()];
			if (all.length === 0) return { mode, rows: 1, columns: 1, cells: [[null]], labels: [], peak: 0, total: 0, days: 0 };
			const firstWeek = taWeekStart(all[0]);
			const lastWeek = taWeekStart(all[all.length - 1]);
			// 天花板与地板都夹一下：日期乱序 / 未来数据也不会算出负数列数。
			const columns = Math.max(1, Math.min(200, Math.round(taDaysBetween(firstWeek, lastWeek) / 7) + 1));
			const grid = [];
			for (let row = 0; row < 7; row += 1) grid.push(new Array(columns).fill(null));
			const labels = [];
			let previousMonth = -1;
			const lastYear = all[all.length - 1].getFullYear();
			for (const date of all) {
				const key = taDayKey(date);
				const column = Math.round(taDaysBetween(firstWeek, taWeekStart(date)) / 7);
				const row = (taWeekday(date) + 6) % 7;
				const item = byKey.get(key);
				const value = item?.sum ?? 0;
				// 累计模式按**当日增量**分档（否则最后一天永远最深）；增量是 0 但有累计值的日子
				// 至少给 1 档 —— 「总量还在」不该显示成空格。
				const level = taLevel(cumulative ? item?.delta ?? 0 : value, peak);
				grid[row][column] = {
					date: key,
					key,
					value,
					level: cumulative && level === 0 && value > 0 ? 1 : level,
					label: taDateLabel(date, date.getFullYear() !== today.getFullYear()),
					range: undefined,
					future: date > today,
				};
				const month = date.getMonth();
				if (row === 0 && month !== previousMonth) {
					previousMonth = month;
					labels.push({ column, text: taMonthLabel(date), year: date.getFullYear() !== lastYear });
				}
			}
			return { mode, rows: 7, columns, cells: grid, labels, peak, total, days };
		}

		/**
		 * 悬停浮层的两行文案（**纯函数**，单测直接断言）。
		 * @param cell - 网格里的一格。
		 * @param mode - 当前模式。
		 * @returns `{ title, value, unit }`；`value` 已按万/亿格式化，`title` 形如 `4月1日`。
		 */
		function tokenTooltip(cell, mode) {
			const palette = TA_PALETTE[mode] ?? TA_PALETTE.day;
			if (cell === null || cell === undefined) return { title: '', value: '0', unit: palette.unit };
			const title = cell.range === undefined ? cell.label : `${cell.label} · ${cell.range}`;
			return { title, value: taFormat(cell.value), unit: palette.unit };
		}

		/**
		 * 从 7×N 的网格算出月份刻度（每一列最多一个刻度，按列位置排）。
		 * @param labels - `buildHeatmap` 给的 `labels`。
		 * @returns 供刻度条渲染的 `{ column, text, span }` 数组。
		 */
		function taAxis(labels) {
			const out = [];
			for (let index = 0; index < labels.length; index += 1) {
				const current = labels[index];
				const next = labels[index + 1];
				const span = (next === undefined ? current.column + 1 : next.column) - current.column;
				out.push({ column: current.column, text: current.text, span: Math.max(1, span) });
			}
			return out;
		}

		/** 格子配色（导出给单测断言四种模式颜色不同、分别是绿/黄/红/蓝系）。 */
		function taColor(mode, level) {
			const palette = TA_PALETTE[mode] ?? TA_PALETTE.day;
			if (!Number.isFinite(level) || level <= 0) return 'var(--dsw-alias-bg-skeleton)';
			return palette.levels[Math.min(palette.levels.length - 1, Math.max(0, level - 1))];
		}

		// ── 取数小仓库（模块级，页面来回切也不重取） ──
		let tokenActivityState = { phase: 'loading', days: {}, error: null, ready: false };
		const tokenActivityListeners = new Set();
		let tokenActivityRequest = null;

		function tokenActivitySet(next) {
			tokenActivityState = next;
			for (const listener of tokenActivityListeners) {
				try {
					listener();
				} catch {}
			}
		}

		async function tokenActivityLoad(force) {
			if (tokenActivityRequest !== null) return tokenActivityRequest;
			tokenActivitySet({ ...tokenActivityState, phase: tokenActivityState.ready ? 'ready' : 'loading', error: null });
			tokenActivityRequest = (async () => {
				try {
					const response = await fetch(force === true ? `${TA_ROUTE}?refresh=1` : TA_ROUTE, { cache: 'no-store' });
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const payload = await response.json();
					if (payload?.ok !== true) throw new Error(payload?.error ?? '接口没有返回 ok');
					const days = payload.days !== null && typeof payload.days === 'object' ? payload.days : {};
					tokenActivitySet({ phase: 'ready', days, error: null, ready: true, stats: payload.stats ?? null, at: payload.at ?? null });
				} catch (cause) {
					tokenActivitySet({ ...tokenActivityState, phase: 'error', error: cause instanceof Error ? cause.message : String(cause) });
				} finally {
					tokenActivityRequest = null;
				}
			})();
			return tokenActivityRequest;
		}

		function tokenActivitySubscribe(listener) {
			tokenActivityListeners.add(listener);
			return () => tokenActivityListeners.delete(listener);
		}

		/** 账号页那边有没有把卡片挂上去（挂上了兜底设置页就不再出现在导航里）。 */
		let tokenActivityAccountHosted = false;
		const tokenActivityHostListeners = new Set();

		function tokenActivityHostSet(value) {
			if (tokenActivityAccountHosted === value) return;
			tokenActivityAccountHosted = value;
			for (const listener of tokenActivityHostListeners) {
				try {
					listener();
				} catch {}
			}
		}

		/** 月份刻度条（内联布局，不依赖 <style>）。 */
		function TokenAxis({ labels, cellSize, gap, indent }) {
			return h(
				'div',
				{ style: { display: 'flex', alignItems: 'flex-end', gap: `${gap}px`, paddingLeft: `${indent}px`, marginBottom: '4px', height: '14px' } },
				labels.map((label) =>
					h(
						'div',
						{
							key: `${label.column}-${label.text}`,
							style: {
								flex: `0 0 ${label.span * cellSize + (label.span - 1) * gap}px`,
								width: `${label.span * cellSize + (label.span - 1) * gap}px`,
								color: 'var(--dsw-alias-label-tertiary)',
								fontSize: '11px',
								lineHeight: '14px',
								whiteSpace: 'nowrap',
								overflow: 'hidden',
							},
						},
						label.text,
					),
				),
			);
		}

		/** 一个格子：圆角小方块，悬停高亮、其它格变暗。 */
		function TokenCell({ cell, mode, size, hoveredKey, onEnter, onLeave }) {
			if (cell === null) return h('div', { style: { width: `${size}px`, height: `${size}px` } });
			const active = hoveredKey === cell.key;
			const dimmed = hoveredKey !== null && hoveredKey !== undefined && !active;
			return h('div', {
				'data-dta-cell': '1',
				'data-dta-key': cell.key,
				'data-dta-level': String(cell.level),
				className: 'dta-cell',
				onMouseEnter: () => onEnter(cell),
				onMouseLeave: onLeave,
				style: {
					boxSizing: 'border-box',
					width: `${size}px`,
					height: `${size}px`,
					borderRadius: '3px',
					backgroundColor: taColor(mode, cell.level),
					opacity: dimmed ? 0.32 : 1,
					outline: active ? '1px solid var(--dsw-alias-label-primary)' : '1px solid transparent',
					outlineOffset: '-1px',
					cursor: 'pointer',
				},
			});
		}

		/** 环境里的行/列尺寸：按容器宽度自适应，保证「横向铺满」。 */
		function taCellSize(mode, width) {
			const available = Math.max(220, Math.min(Number.isFinite(width) && width > 0 ? width : 640, 1400));
			if (mode === 'day' || mode === 'total') return { cell: 11, gap: 3, rowGap: 3, indent: 26 };
			if (mode === 'week') return { cell: 16, gap: 6, rowGap: 6, indent: 0 };
			return { cell: 30, gap: 8, rowGap: 8, indent: 0 };
		}

		/**
		 * 「Token 活动」卡片本体。
		 * 自带 `<style>`（次要动效）+ 关键内联样式；四种模式 + 悬停浮层 + 空/错/加载三态。
		 * state 顺序（渲染测试的队列必须照这个来）：
		 *   0 tokenActivity（外部数据）/ 1 模式 / 2 hovered / 3 tooltip / 4..12 tooltip 的九个字段
		 */
		function TokenActivityCard({ t, compact }) {
			const [external, setExternal] = React.useState(tokenActivityState);
			const [mode, setMode] = React.useState('day');
			const [hovered, setHovered] = React.useState(null);
			const [tooltip, setTooltip] = React.useState(null);
			const [tipTitle, setTipTitle] = React.useState('');
			const [tipValue, setTipValue] = React.useState('');
			const [tipUnit, setTipUnit] = React.useState('');
			const [tipLeft, setTipLeft] = React.useState(0);
			const [tipTop, setTipTop] = React.useState(0);
			const [tipBelow, setTipBelow] = React.useState(false);
			const [tipVisible, setTipVisible] = React.useState(false);
			const [tipKey, setTipKey] = React.useState(null);
			React.useEffect(() => {
				const unsubscribe = tokenActivitySubscribe(() => setExternal(tokenActivityState));
				void tokenActivityLoad(false);
				return unsubscribe;
			}, []);
			const grid = React.useRef(null);
			const gridBox = grid.current === null || grid.current === undefined ? null : grid.current.getBoundingClientRect();
			const width = compact === true ? 520 : Math.max(320, (gridBox === null ? 0 : gridBox.width) || 640);
			const metrics = taCellSize(mode, width);
			const model = buildHeatmap(external.days, mode, new Date());
			const axis = taAxis(model.labels);
			const enter = (cell) => {
				setHovered(cell.key);
				const text = tokenTooltip(cell, mode);
				const box = grid.current === null || grid.current === undefined ? null : grid.current.getBoundingClientRect();
				const host = box === null ? { left: 0, top: 0, width: 640, height: 120 } : box;
				// 行列都用引用相等来找：单元格是这一帧刚建出来的对象，引用唯一，不会认错格。
				let columnIndex = 0;
				let rowIndex = 0;
				for (let index = 0; index < model.cells.length; index += 1) {
					const at = model.cells[index].indexOf(cell);
					if (at === -1) continue;
					rowIndex = index;
					columnIndex = at;
					break;
				}
				const cellLeft = metrics.indent + columnIndex * (metrics.cell + metrics.gap);
				const cellTop = rowIndex * (metrics.cell + metrics.rowGap);
				setTipTitle(text.title);
				setTipValue(text.value);
				setTipUnit(text.unit);
				setTipLeft(Math.max(4, Math.min(cellLeft, Math.max(4, host.width - 150))));
				setTipTop(Math.max(0, cellTop));
				setTipBelow(cellTop < 56);
				setTipKey(cell.key);
				setTipVisible(true);
				setTooltip(cell);
			};
			const leave = () => {
				setHovered(null);
				setTipVisible(false);
				setTipKey(null);
				setTooltip(null);
			};
			const header = h(
				'div',
				{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
				h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: '0' } }, h('span', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, 'Token 活动')),
				h(
					'div',
					{ style: { display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-module-platform)' } },
					TA_MODES.map((id) =>
						h(
							'button',
							{
								key: id,
								type: 'button',
								className: 'dta-seg',
								'data-dta-mode': id,
								'data-active': id === mode ? '1' : '0',
								'aria-pressed': id === mode ? 'true' : 'false',
								onClick: () => {
									setMode(id);
									leave();
								},
								style: {
									border: 'none',
									cursor: 'pointer',
									padding: '4px 10px',
									borderRadius: 'var(--dsw-radius-sm, 6px)',
									fontSize: '12px',
									lineHeight: '18px',
									fontFamily: 'inherit',
									color: id === mode ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
									background: id === mode ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
									boxShadow: id === mode ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
								},
							},
							t(`ta.mode.${id === 'day' ? 'day' : id === 'week' ? 'week' : id === 'year' ? 'year' : 'total'}`),
						),
					),
				),
			);
			const body = () => {
				if (model.days === 0 && external.phase === 'loading') {
					return h('div', { style: { padding: '18px 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' } }, t('ta.loading'));
				}
				if (model.days === 0 && external.phase === 'error') {
					return h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 0', flexWrap: 'wrap' } },
						h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, `${t('ta.error')}${external.error === null || external.error === undefined ? '' : `（${external.error}）`}`),
						h(
							'button',
							{
								type: 'button',
								className: 'dsu-btn',
								onClick: () => void tokenActivityLoad(true),
								style: { height: '28px', padding: '0 10px', fontSize: '12px' },
							},
							t('ta.retry'),
						),
					);
				}
				if (model.days === 0) {
					return h(
						'div',
						{ style: { padding: '14px 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' } },
						h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('ta.empty')),
						h('div', { style: { marginTop: '4px' } }, t('ta.emptyHint')),
					);
				}
				return null;
			};
			const empty = body();
			return h(
				'div',
				{
					'data-dta-card': '1',
					'data-dta-mode': mode,
					'data-dta-palette': TA_PALETTE[mode].family,
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '10px',
						width: '100%',
						boxSizing: 'border-box',
						padding: '12px 16px',
						border: '0.5px solid var(--dsw-alias-settings-card-stroke)',
						borderRadius: 'var(--dsw-radius-xl)',
						background: 'var(--dsw-alias-settings-card-fill)',
						color: 'var(--dsw-alias-label-primary)',
						fontSize: '13px',
						lineHeight: '22px',
					},
				},
				h('style', null, TA_CSS),
				header,
				empty !== null
					? empty
					: h(
							'div',
							{ ref: grid, style: { position: 'relative', width: '100%', overflowX: 'auto', paddingBottom: '2px' }, role: 'img', 'aria-label': t('ta.aria', { days: String(model.days) }) },
							h('div', { style: { display: 'inline-block', minWidth: '100%' } }, axis.length === 0 ? null : h(TokenAxis, { labels: axis, cellSize: metrics.cell, gap: metrics.gap, indent: metrics.indent }), h(
								'div',
								{ style: { display: 'flex', flexDirection: 'column', gap: `${metrics.rowGap}px` } },
								model.cells.map((line, rowIndex) =>
									h(
										'div',
										{ key: `row-${rowIndex}`, style: { display: 'flex', gap: `${metrics.gap}px`, paddingLeft: `${metrics.indent}px` } },
										line.map((cell, columnIndex) =>
											h(TokenCell, {
												key: cell === null ? `empty-${rowIndex}-${columnIndex}` : cell.key,
												cell,
												mode,
												size: metrics.cell,
												hoveredKey: hovered,
												onEnter: enter,
												onLeave: leave,
											}),
										),
									),
								),
							), tipVisible === false
								? null
								: h(
										'div',
										{
											'data-dta-tooltip': '1',
											'data-dta-tip-key': tipKey === null ? '' : tipKey,
											style: {
												position: 'absolute',
												left: `${tipLeft}px`,
												top: tipBelow ? `${tipTop + metrics.cell + 6}px` : `${tipTop - 8}px`,
												transform: tipBelow ? 'none' : 'translateY(-100%)',
												pointerEvents: 'none',
												zIndex: 5,
												padding: '6px 9px',
												borderRadius: 'var(--dsw-radius-md)',
												border: '1px solid var(--dsw-alias-border-l2)',
												background: 'var(--dsw-alias-bg-overlay)',
												boxShadow: '0 6px 20px rgba(0,0,0,.24)',
												whiteSpace: 'nowrap',
												fontSize: '12px',
												lineHeight: '18px',
											},
										},
										h('div', { 'data-dta-tip-title': '1', style: { color: 'var(--dsw-alias-label-secondary)' } }, tipTitle),
										h(
											'div',
											{ style: { display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 } },
											h('span', { 'data-dta-tip-value': '1' }, tipValue),
											h(
												'svg',
												{ width: '11', height: '11', viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { flex: 'none' } },
												h('path', { d: 'M8 2.2 L13.2 8.6 H9.9 V13.8 H6.1 V8.6 H2.8 Z', fill: 'currentColor' }),
											),
											h('span', { 'data-dta-tip-unit': '1' }, tipUnit),
										),
									),
							),
						),
				model.days === 0 ? null : h(
					'div',
					{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: '16px' } },
					h('span', { 'data-dta-summary': '1' }, t('ta.summary', { total: taFormat(model.total), days: String(model.days) })),
					h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, h('span', null, '少'), TA_PALETTE[mode].levels.map((color) => h('span', { key: color, style: { width: '10px', height: '10px', borderRadius: '2px', backgroundColor: color, display: 'inline-block' } })), h('span', null, '多')),
				),
			);
		}

		/** 独立设置页（兜底/直达）：账号页那边没挂上时才出现在导航里。 */
		function TokenActivityPage({ t }) {
			return h('section', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' } }, h(TokenActivityCard, { t, compact: false }));
		}

		/**
		 * 把卡片 portal 到「账号与余额」页的余额卡片后面。
		 * 挂上就返回 null（导航里的兜底页会自动隐藏）；宿主结构变了 / 那页没渲染出来，
		 * 就把兜底页亮出来 —— 功能始终可达，不会两处同时出现。
		 */
		/**
		 * 找「账号与余额」页里那张「充值余额」卡片。
		 * 两个锚点：① 卡片里「充值」那个链接的 href 以 `/top-up` 结尾（自带插件拼的，最稳）；
		 * ② 退一步用 AccountSection.module.css 的类名（宿主改版时类名哈希会变，所以只当兜底）。
		 * 两条都找不到就返回 null —— 调用方会把独立的「Token 活动」设置页亮出来，功能不会消失。
		 * @returns 那个卡片元素，或 null。
		 */
		function tokenActivityAnchor() {
			// 自带插件拼的是 `${origin}/top_up`（下划线，见 dsh-deepseek-account-platform 的
			// `topUpUrl`）；同时也认写成 `top-up` 的变体，别把锚点写死成一个拼法。
			const link = document.querySelector('section[aria-label] a[href$="/top_up"], section[aria-label] a[href$="/top-up"]');
			const card = link === null ? null : link.closest(`.${TA_ANCHOR_CLASS}`);
			if (card !== null) return card;
			return document.querySelector(`section[aria-label] .${TA_ANCHOR_CLASS}`);
		}

		function AccountTokenActivityMount({ t }) {
			const [host, setHost] = React.useState(null);
			React.useEffect(() => {
				if (typeof document === 'undefined') return undefined;
				if (typeof MutationObserver !== 'function') return undefined;
				const ensure = () => {
					const anchor = tokenActivityAnchor();
					if (anchor === null || anchor.parentElement === null) {
						setHost(null);
						tokenActivityHostSet(false);
						return;
					}
					let node = anchor.nextElementSibling;
					if (node === null || !node.hasAttribute(TA_MARKER)) {
						node = document.createElement('div');
						node.setAttribute(TA_MARKER, 'account');
						node.style.display = 'contents';
						anchor.after(node);
					}
					setHost(node);
					tokenActivityHostSet(true);
				};
				ensure();
				const observer = new MutationObserver(ensure);
				observer.observe(document.body, { childList: true, subtree: true });
				return () => {
					observer.disconnect();
					tokenActivityHostSet(false);
					const existing = document.querySelector(`[${TA_MARKER}]`);
					if (existing !== null && existing.parentElement !== null) existing.remove();
				};
			}, []);
			if (host === null) return null;
			const dom = reactDom();
			if (dom === null || typeof dom.createPortal !== 'function') return null;
			return dom.createPortal(h(TokenActivityCard, { t, compact: true }), host);
		}

		/** 兜底设置页的导航项（账号页挂上了就返回 null，导航里看不到这一格）。 */
		function TokenActivityNavGate({ children }) {
			const [hosted, setHosted] = React.useState(tokenActivityAccountHosted);
			React.useEffect(() => {
				const listener = () => setHosted(tokenActivityAccountHosted);
				tokenActivityHostListeners.add(listener);
				return () => tokenActivityHostListeners.delete(listener);
			}, []);
			return hosted === true ? null : children;
		}

		function apply(ctx) {
			notesCtx = ctx;
			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh,
						en,
					}),
				'dsh-desktop-updater: 文案',
			);
			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register(
					{
						name: 'sidebar.footer.action',
						id: 'dsh-update-vd',
						order: 100,
						locale: NS,
					},
					SidebarUpdateRow,
				),
			);
			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register(
					{
						name: 'shell.overlay',
						id: 'dsh-update-vd-modal',
						order: 150,
						locale: NS,
					},
					UpdateModal,
				),
			);
			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register({ name: 'shell.overlay', id: 'dsh-update-vd-changelog', order: 170, locale: NS }, ChangelogModal),
			);
			// 设置面板里的两页：技能 / MCP（order 排在自带页后面，也就是导航最下面）
			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-update-notes', order: 120, locale: NS }, NotesRow),
			);
			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register({ name: 'shell.overlay', id: 'dsh-update-notes-modal', order: 160 }, NotesModal),
			);
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'skills', order: 130, label: '技能' }, SkillsPage),
			);
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'mcp', order: 140, label: 'MCP' }, McpPage),
			);
			// 「DSH 智能体」排在 MCP（140）后面；自带的那页 id 是 agent-presets（order 20），别撞
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'agents', order: 150, label: '智能体' }, AgentsPage),
			);
			// 「导入」（从其它 AI 导入）排在「智能体」（150）**下面**，是独立一页，不再挂在智能体页里
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'other-ai', order: 160, label: '导入' }, OtherAiPage),
			);
			// ── Token 活动（纯新增） ──
			// ① 主位置：portal 到「账号与余额」页的「充值余额」卡片下面（那页没有 item 子插槽可用，
			//    也绝不能复用 `account` 这个 id —— 复用等于整页替换）。挂上了就返回 null，不占额外位置。
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'token-activity-mount', order: 165 }, AccountTokenActivityMount),
			);
			// ② 兜底：独立一页 id `token-activity`（order 170，排在「导入」160 后面），
			//    只在 ① 没挂上时出现在导航里 —— 功能永远可达，且不会同一个东西出现两次。
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'token-activity', order: 170, label: 'Token 活动' }, (props) =>
					h(TokenActivityNavGate, null, h(TokenActivityPage, props)),
				),
			);
			ctx.effect(() => {
				start();
				return () => stop();
			}, 'dsh-desktop-updater: 状态轮询');
		}

		/** 需要的客户端服务：slot 注册表与文案。 */
		const inject = ['slots', 'locale'];

		// 仅给 node --test 用（宿主与页面都不消费）：让渲染测试能直接摆出各个阶段。
		const __test = {
			getSnapshot,
			setServer,
			setUi,
			subscribe,
			insertTextIntoInput,
			notesToText,
			notesStore,
			// Token 活动（纯函数 + 组件 + 常量，渲染测试直接摆状态用）
			TokenActivityCard,
			TokenActivityPage,
			AccountTokenActivityMount,
			buildHeatmap,
			tokenTooltip,
			taFormat,
			taLevel,
			taColor,
			taAxis,
			TA_PALETTE,
			TA_MODES,
			taGridFromDays,
			tokenActivityAnchor,
			/** 自测用：拿中文文案，让渲染断言能直接搜到人话（不是 key）。 */
			messages: { zh, en },
			tokenActivityStore: {
				get: () => tokenActivityState,
				set: tokenActivitySet,
				load: tokenActivityLoad,
				days: () => tokenActivityState.days,
			},
		};

		return { apply, inject, __test };
	},
});
