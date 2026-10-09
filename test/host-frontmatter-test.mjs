import { fileURLToPath } from 'node:url';
const RESOURCES_PATH = fileURLToPath(new URL('../lib/resources.js', import.meta.url));

const { parseSkill, renderSkill } = await import(RESOURCES_PATH);
let fail = 0;
const check = (label, got, want) => { const ok = got === want; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}`); if (!ok) { console.log(`       期望 ${JSON.stringify(want)}`); fail += 1; } };

check('块标量 >-', parseSkill('---\nname: a\ndescription: >-\n  第一行\n  第二行\n---\n\n正文').front.description, '第一行 第二行');
check('块标量 |', parseSkill('---\nname: a\ndescription: |\n  第一行\n  第二行\n---\n\n正文').front.description, '第一行\n第二行');
check('单行', parseSkill('---\nname: a\ndescription: 普通描述\n---\n\n正文').front.description, '普通描述');
check('带引号', parseSkill("---\nname: a\ndescription: '有: 冒号的'\n---\n\n正文").front.description, '有: 冒号的');
check('正文保留', parseSkill('---\nname: a\ndescription: d\n---\n\n# 标题\n\n内容').body, '# 标题\n\n内容');
check('没有 frontmatter', parseSkill('# 就是正文').body, '# 就是正文');
const rendered = renderSkill('x', '有: 冒号 and 换行\n第二行', '正文');
check('生成时把描述压成一行并加引号', rendered.includes("description: '有: 冒号 and 换行 第二行'"), true);
check('生成的还能被解析回来', parseSkill(rendered).front.description, '有: 冒号 and 换行 第二行');
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
