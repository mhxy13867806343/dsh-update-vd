/**
 * 一键跑全部测试并汇总。
 * 用法：node test/run-all.mjs      （需要先 npm install，react 在 devDependencies 里）
 */
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// 除了汇总脚本自己，test/ 下所有 .mjs 都是测试（含 dsh-notes-verify 这种不叫 -test 的）
const files = (await readdir(here)).filter((name) => name.endsWith('.mjs') && name !== 'run-all.mjs').sort();

let pass = 0;
const failed = [];
for (const file of files) {
	const output = await new Promise((resolve) => {
		const child = spawn(process.execPath, [join(here, file)], { cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
		let text = '';
		child.stdout.on('data', (chunk) => (text += chunk));
		child.stderr.on('data', (chunk) => (text += chunk));
		child.on('close', (code) => resolve({ code, text }));
	});
	const last = output.text.split('\n').filter((line) => line.trim() !== '').pop() ?? '';
	const ok = output.code === 0;
	if (ok) pass += 1;
	else failed.push(`${file} → ${last.slice(0, 120)}`);
	console.log(`${ok ? '  ok  ' : ' FAIL '} ${file.padEnd(32)} ${last.trim()}`);
}
console.log(`\n${pass}/${files.length} 套通过`);
if (failed.length > 0) {
	console.log('失败：\n' + failed.map((line) => '  - ' + line).join('\n'));
	process.exit(1);
}
