/**
 * 把「已经炸过的真 bug」钉成断言 —— 这些 bug 都不报在加载期，只在点击时才抛，
 * 所以必须专门盯着，不然会再犯。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const client = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');
const index = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');
const resources = readFileSync(fileURLToPath(new URL('../lib/resources.js', import.meta.url)), 'utf8');

let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };

// ① 曾经：index.js 漏 import deleteSkill → 点「删除技能」抛 deleteSkill is not defined
check('index.js 从 resources.js import 了 deleteSkill', /import\s*\{[^}]*\bdeleteSkill\b[^}]*\}\s*from\s*'\.\/resources\.js'/u.test(index));

// ② 同类：把「resources.js 导出、被 index.js 引用、但没 import」全部揪出来（防重犯）
{
	const imported = new Set((/import\s*\{([^}]*)\}\s*from\s*'\.\/resources\.js'/u.exec(index)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
	const body = index.slice(index.indexOf("from './resources.js'") + 22);
	const missing = [...resources.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gu)]
		.map((m) => m[1])
		.filter((name) => !imported.has(name) && new RegExp(`\\b${name}\\b`, 'u').test(body));
	check('resources.js 的导出被 index.js 引用时都有 import', missing.length === 0, missing.join(', ') || '无');
}

// ③ 曾经：client.js 的 OnlineSearch 形参没有 onSources，里面却用它 → 点「保存地址」抛 ReferenceError
check('OnlineSearch 形参包含 onSources', /function OnlineSearch\(\{[^}]*\bonSources\b[^}]*\}\)/u.test(client));
check('不再有「未声明标识符 !== undefined」这种写法', !/onSources !== undefined/u.test(client));

// ④ 曾经：OnlineSearch 里的 removeAddress 从未定义 → 点「删除这个地址」抛 ReferenceError
{
	const start = client.indexOf('function OnlineSearch(');
	const end = client.indexOf('function AgentSource(');
	const body = client.slice(start, end === -1 ? undefined : end);
	check('OnlineSearch 里定义了 removeAddress', /const removeAddress = async/u.test(body));
	check('OnlineSearch 里定义了 saveAddress', /const saveAddress = async/u.test(body));
}

// ⑤ 曾经：插入笔记会冲掉用户已打好的草稿（hooks.input 是 store，必须 getSnapshot() 后再取 .draft）
//    注意：注释里会提到「旧写法为什么错」，所以先把注释行剔掉再查代码
const codeOnly = client.split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line)).join('\n');
check('草稿经 getSnapshot() 读取（hooks 是 store）', /function currentDraft[\s\S]{0,400}?getSnapshot\(/u.test(codeOnly));
check('代码里没有直接读 hooks.input.draft', !/\.input\.draft|input\?\.draft|input\.draft/u.test(codeOnly));

// ⑥ 通用护栏：本项目里「点击处理器」统一写成 `() => void X(...)`。
//    凡是这种写法里的 X 必须在文件某处有声明（const/let/function/形参/对象键/import）。
//    精准盯这一类，避免像「全量未定义扫描」那样把 CSS 的 rgba()/calc() 也误报。
{
	const declared = new Set();
	for (const m of client.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gu)) declared.add(m[1]);
	for (const m of client.matchAll(/\bimport\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))/gu)) {
		if (m[1]) for (const piece of m[1].split(',')) declared.add(piece.trim().split(/\s+as\s+/u).pop().trim());
		if (m[2]) declared.add(m[2]);
	}
	for (const m of client.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/gu)) for (const piece of m[1].split(',')) declared.add(piece.trim().split('=')[0].trim().split(':').pop().trim());
	for (const m of client.matchAll(/(?:const|let)\s*\[([^\]]*)\]\s*=/gu)) for (const piece of m[1].split(',')) declared.add(piece.trim());
	for (const m of client.matchAll(/([A-Za-z_$][\w$]*)\s*:/gu)) declared.add(m[1]);   // 对象键（含传进来的 props）
	const called = new Map();
	for (const m of client.matchAll(/void\s+([a-z_$][\w$]*)\s*\(/gu)) called.set(m[1], (called.get(m[1]) ?? 0) + 1);
	const missing = [...called.keys()].filter((name) => !declared.has(name));
	check('所有 `void X(...)` 处理器都有定义/声明', missing.length === 0, missing.join(', ') || `共 ${called.size} 个处理器全部有定义`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
