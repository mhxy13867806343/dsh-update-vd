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
					footerLabel(t, state),
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
			if (data === null) throw new Error(`宿主返回了非 JSON（HTTP ${response.status}）`);
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

		/** 技能设置页：列表 / 搜索 / 新增 / 编辑 / 删除（要确认）/ 导入。 */
		function SkillsPage() {
			const [state, setState] = React.useState({ loading: true, skills: [], roots: [], error: null, notice: null });
			const [query, setQuery] = React.useState('');
			const [mode, setMode] = React.useState({ kind: 'list' });
			const [busy, setBusy] = React.useState(false);

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

		function apply(ctx) {
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
			// 设置面板里的两页：技能 / MCP（order 排在自带页后面，也就是导航最下面）
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'skills', order: 130, label: '技能' }, SkillsPage),
			);
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({ name: 'settings.section', id: 'mcp', order: 140, label: 'MCP' }, McpPage),
			);
			ctx.effect(() => {
				start();
				return () => stop();
			}, 'dsh-desktop-updater: 状态轮询');
		}

		/** 需要的客户端服务：slot 注册表与文案。 */
		const inject = ['slots', 'locale'];

		// 仅给 node --test 用（宿主与页面都不消费）：让渲染测试能直接摆出各个阶段。
		const __test = { getSnapshot, setServer, setUi, subscribe };

		return { apply, inject, __test };
	},
});
