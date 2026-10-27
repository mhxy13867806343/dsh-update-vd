/**
 * 更新链路两个**真机炸过**的点，钉成断言（`lib/index.js`）。
 *
 * 背景（2026-10-27 真机）：侧栏一直转圈显示「安装中」，升级弹窗停在
 * 「下载完成，正在安装并重启应用」不动。查下来是两件事叠在一起：
 *
 *   ① 版本查询头名写错：插件发的是 `X-DSH-Desktop-Version`，服务端不认，
 *      于是把它当成「未知老客户端」回了稳定通道之外的 **2.0.20-next**
 *      （那是 **DSH NEXT**，bundle id `ai.deepseek.dsh.desktop.next`）。
 *      官方客户端发的是 `X-DSH-Desktop-Current-Version` —— 实测同一个接口：
 *        发 X-DSH-Desktop-Current-Version → {"version":"2.0.18"}
 *        发 X-DSH-Desktop-Version         → {"version":"2.0.20-next"}
 *   ② 安装脚本是 detached 拉起的，插件**不看它的退出码**：install.sh 里
 *      「DMG 里的 app 不是 DSH Desktop」直接失败退出，插件仍停在 `installing`
 *      → 界面永远「安装中」，而且下次还会拿同一个坏包再装一遍。
 *
 * 覆盖：
 *   1. `installFailureLine()` 的日志解析（唯一一条 / 多条取最后 / 没有失败行 / 空日志）；
 *   2. 源码级护栏：头名必须是官方那个、**不许**再出现旧头名；
 *   3. 源码级护栏：安装脚本要盯 `exit` / `error`，失败要落 `phase: 'error'` 并删掉坏包；
 *   4. 源码级护栏：启动时 `installing` 必须恢复成 `error`（重启后不许继续「安装中」）。
 *
 * 跑法：cd <仓库根> && node test/dsh-update-failure-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFailureLine } from '../lib/index.js';

let failures = 0;
const check = (label, ok, detail) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
	if (ok !== true) failures += 1;
};

const index = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------
// 1. install.log → 失败原因
// ---------------------------------------------------------------------------
console.log('— install.log 解析（installFailureLine） —');
check('空日志 → null', installFailureLine('') === null);
check('null / undefined → null', installFailureLine(null) === null && installFailureLine(undefined) === null);
check('没有「失败：」行 → null', installFailureLine('开始安装\nDMG 已挂载\n安装完成') === null);
check(
	'真机那条：DSH NEXT 被拒的原因原样抠出来',
	installFailureLine('[2026-10-27T02:19:57.383Z] install 2.0.20-next → /Applications/DSH Desktop.app\n2026-10-27 10:19:57 ===== 开始安装：期望版本 2.0.20-next -> /Applications/DSH Desktop.app （模式 real） =====\n2026-10-27 10:19:57 DMG 已挂载，源 app：/tmp/dsh-update.61VCK1/DSH NEXT.app\n2026-10-27 10:19:57 失败：DMG 里的 app 不是 DSH Desktop，bundle id = ai.deepseek.dsh.desktop.next\n2026-10-27 10:19:57 安装中止，当前 app 未被改动。') ===
		'DMG 里的 app 不是 DSH Desktop，bundle id = ai.deepseek.dsh.desktop.next',
);
check(
	'多条「失败：」取**最后**一条（真正的死因）',
	installFailureLine('失败：临时目录创建失败\n继续\n失败：签名校验没通过') === '签名校验没通过',
);
check('「失败：」后面是空 → null（不返回空串）', installFailureLine('失败：') === null && installFailureLine('失败：   ') === null);

// ---------------------------------------------------------------------------
// 2. 版本查询头名
// ---------------------------------------------------------------------------
console.log('\n— 版本查询头名 —');
check('用的是官方那个 X-DSH-Desktop-Current-Version', index.includes("'X-DSH-Desktop-Current-Version': current"));
check('**没有**再出现旧头名 X-DSH-Desktop-Version', !index.includes("'X-DSH-Desktop-Version'"), '');
check('通道头照旧（stable / beta / next 仍由 CHANNEL 决定）', index.includes("'X-DSH-Desktop-Channel': CHANNEL"));

// ---------------------------------------------------------------------------
// 3. 安装脚本失败要落到 error（不许永远「安装中」）
// ---------------------------------------------------------------------------
console.log('\n— 安装失败处理 —');
check('安装脚本确实盯了 exit 事件', /child\.once\('exit',\s*\(code, signal\)/u.test(index));
check('非 0 退出会走到 failInstall（经 settle）', /code === 0\) return;[\s\S]{0,200}settle\(/u.test(index) && /const settle = \(message\) => \{[\s\S]{0,200}this\.failInstall\(/u.test(index));
check('failInstall 会把状态写成 phase: error', /async failInstall\(message, artifact, logPath\)[\s\S]{0,900}phase: 'error'/u.test(index));
check('failInstall 会删掉那个装不上的 DMG', /async failInstall\(message, artifact, logPath\)[\s\S]{0,600}rm\(artifact, \{ force: true \}\)/u.test(index));
check('failInstall 会清掉 artifactPath / artifactReady（界面上不再显示「已下载 100%」）', /phase: 'error'[\s\S]{0,200}artifactPath: null, artifactReady: false/u.test(index));
check('失败原因里带上 install.log 的最后一条「失败：…」', /readInstallFailure\(logPath\)/u.test(index) && /detail\s*===\s*null\s*\?\s*message\s*:\s*`\$\{message\}：\$\{detail\}`/u.test(index));

// ---------------------------------------------------------------------------
// 4. 重启后不许继续「安装中」
// ---------------------------------------------------------------------------
console.log('\n— 启动恢复 —');
check("start() 里处理了残留的 phase === 'installing'", /async start\(\)[\s\S]{0,1200}phase === 'installing'/u.test(index));
check('恢复时顺手删掉残留的坏包（否则下次又拿它重试）', /phase === 'installing'[\s\S]{0,700}rm\(artifact, \{ force: true \}\)/u.test(index));
check('恢复成 error 而不是 idle（要让人看见「上次没装成」）', /phase === 'installing'[\s\S]{0,700}phase: 'error'/u.test(index));

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
