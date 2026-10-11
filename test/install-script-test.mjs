/**
 * install.sh 的静态检查 —— 这是全插件最危险的脚本：它会退出 DSH Desktop、挂载 DMG、
 * 替换 /Applications 里的 app、失败回滚再重启。这里不做真实执行（会动用户的 app），
 * 只钉住「语法」和「几个保命机制」，防止改坏。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../lib/install.sh', import.meta.url));
const text = readFileSync(path, 'utf8');
let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };

// ① 语法：/bin/sh（脚本 shebang 是 sh）
try {
	execFileSync('/bin/sh', ['-n', path], { stdio: 'pipe' });
	check('sh -n 语法通过', true);
} catch (error) {
	check('sh -n 语法通过', false, String(error.stderr ?? error.message).slice(0, 200));
}

// ② 三种退出方式都在（宿主沙箱看不到 Electron 主进程，只靠一种会退不掉）
check('按 app 自己的可执行文件名杀进程（APP_EXEC，不会误伤 Helper）', /APP_EXEC=/u.test(text) && /killall\s+-TERM\s+"\$\{?APP_EXEC/u.test(text));
check('有 osascript 优雅退出兜底', /osascript[\s\S]{0,200}quit/u.test(text));
check('有轮询 $DSH_WEB_URL 判断是否退出的兜底', /DSH_WEB_URL/u.test(text));
check('最后一档 killall -KILL', /killall\s+-KILL/u.test(text));

// ③ 保命机制
check('失败会回滚（.old / rollback 之类）', /\.old|rollback|回滚/u.test(text));
check('挂载失败会清理（hdiutil detach）', /hdiutil\s+detach/u.test(text));
check('替换前会校验签名（codesign / spctl）', /codesign|spctl/u.test(text));
check('能跳过重启（DSH_UPDATER_NO_RELAUNCH）', /DSH_UPDATER_NO_RELAUNCH/u.test(text));

// ④ 当年踩过的坑：`$APP，` 会被 /bin/sh 当成变量名 → unbound variable。所有展开必须带花括号
const risky = text.split('\n').map((line, i) => [i + 1, line])
	.filter(([, line]) => !line.trimStart().startsWith('#'))
	.filter(([, line]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\sA-Za-z0-9_$"')\]}\/.:=-]/u.test(line) && /[，、。；]|\$[A-Za-z_][A-Za-z0-9_]*[,]/u.test(line));
check('没有「$VAR 紧跟中文标点/逗号」的危险展开', risky.length === 0, risky.map(([n, l]) => `第 ${n} 行: ${l.trim().slice(0, 60)}`).join(' | '));

// ⑤ 换掉 app 之前必须先确认它确实是 DSH Desktop（bundle id 校验），别把别的 app 覆盖了
check('替换前校验 bundle id（防止覆盖别的 app）', /BUNDLE_ID=/u.test(text) && /NEW_ID/u.test(text));

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
