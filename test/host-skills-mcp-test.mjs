import { fileURLToPath } from 'node:url';
const INDEX_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));

process.env.DSH_HOME = '/tmp/vd-res-home';
const { mkdir, writeFile, rm } = await import('node:fs/promises');
await rm('/tmp/vd-res-home', { recursive: true, force: true });
await mkdir('/tmp/vd-res-home/skills', { recursive: true });
await writeFile('/tmp/vd-res-home/skills/existing/SKILL.md', '---\nname: existing\ndescription: 已经存在的一个技能\n---\n\n正文\n', { encoding: 'utf8' }).catch(async () => { await mkdir('/tmp/vd-res-home/skills/existing', { recursive: true }); await writeFile('/tmp/vd-res-home/skills/existing/SKILL.md', '---\nname: existing\ndescription: 已经存在的一个技能\n---\n\n正文\n'); });

const mod = await import(INDEX_PATH);
const routes = new Map();
const mounted = [];
let registrySkills = [];
const ctx = {
  connection: { fetch: { register: (r) => { routes.set(r.path, r); return () => {}; } } },
  skills: { list: async () => registrySkills },
  plugin: (m, c) => { const rec = { m, c, disposed: false }; mounted.push(rec); return { dispose: () => { rec.disposed = true; } }; },
  desktopRuntime: { updates: { currentVersion: '2.0.17', canDownload: true, request: () => Promise.reject(new Error('no')) } },
  logger: { info: (m) => console.log('[host]', m) },
  effect: (fn) => { fn(); return () => {}; },
  inject: (_d, cb) => { cb(ctx); return () => {}; },
};
mod.apply(ctx);
await new Promise((r) => setTimeout(r, 200));
console.log('路由数:', routes.size, '| 含 skills/mcp:', [...routes.keys()].filter((k) => /skills|mcp/.test(k)).length);

const call = async (p, body) => {
  const r = await routes.get(p).fetch(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }));
  return { s: r.status, d: await r.json().catch(() => null) };
};
let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };

console.log('\n— 技能 —');
let list = await call('/api/dsh-update-vd/skills');
check('列表列出磁盘技能', list.d.ok === true && list.d.skills.some((s) => s.name === 'existing'), JSON.stringify(list.d.skills?.map((s) => `${s.name}${s.writable ? '(可写)' : '(只读)'}`)));
const saved = await call('/api/dsh-update-vd/skills/save', { name: 'my-new-skill', description: '测试技能：带冒号: 和引号 \' 也要能存', body: '# 用法\n\n1. 做事' });
check('新增技能', saved.d.ok === true, JSON.stringify(saved.d).slice(0, 120));
const read = await call('/api/dsh-update-vd/skills/read', { name: 'my-new-skill' });
check('读回正文', read.d.ok === true && read.d.body.includes('# 用法'), JSON.stringify({ desc: read.d.description, path: read.d.path }));
const upd = await call('/api/dsh-update-vd/skills/save', { name: 'my-new-skill', originalName: 'my-new-skill', description: '改过的描述', body: '# 改过' });
check('编辑技能', upd.d.ok === true);
const reread = await call('/api/dsh-update-vd/skills/read', { name: 'my-new-skill' });
check('编辑生效', reread.d.description === '改过的描述' && reread.d.body.includes('# 改过'));
const { mkdir: mk, writeFile: wf } = await import('node:fs/promises');
await mk('/tmp/vd-outside/pack/SKILL.md'.replace('/SKILL.md',''), { recursive: true });
await wf('/tmp/vd-outside/pack/SKILL.md', '---\nname: from-outside\ndescription: 外部导入进来的\n---\n\n正文', { encoding: 'utf8' });
const imp = await call('/api/dsh-update-vd/skills/import', { path: '/tmp/vd-outside/pack' });
check('从本地目录导入', imp.d.ok === true, JSON.stringify(imp.d).slice(0, 110));
const impDup = await call('/api/dsh-update-vd/skills/import', { path: '/tmp/vd-outside/pack' });
check('重复导入给明确提示（不覆盖）', impDup.d.ok === false, impDup.d.error);
const impSelf = await call('/api/dsh-update-vd/skills/import', { path: '/tmp/vd-res-home/skills/existing' });
check('导入到自己原地的目录被拦下', impSelf.d.ok === false, impSelf.d.error);
const bad = await call('/api/dsh-update-vd/skills/save', { name: 'x', description: '' });
check('空 description 被拒（坏数据不落盘）', bad.d.ok === false, bad.d.error);
const del = await call('/api/dsh-update-vd/skills/delete', { name: 'my-new-skill' });
check('删除技能', del.d.ok === true, del.d.removed);
list = await call('/api/dsh-update-vd/skills');
check('删除后不在列表里', list.d.ok === true && !list.d.skills.some((s) => s.name === 'my-new-skill'));
registrySkills = [{ name: 'bundled-one', description: '随包发布的技能', source: 'bundled', path: '/Applications/x/bundled/SKILL.md' }];
list = await call('/api/dsh-update-vd/skills');
const bundled = list.d.skills.find((s) => s.name === 'bundled-one');
check('注册表里的技能也列出且标记只读', bundled !== undefined && bundled.writable === false);
const delBundled = await call('/api/dsh-update-vd/skills/delete', { name: 'bundled-one' });
check('只读技能拒绝删除', delBundled.d.ok === false, delBundled.d.error);

console.log('\n— MCP —');
let mcp = await call('/api/dsh-update-vd/mcp');
check('初始为空', mcp.d.ok === true && mcp.d.servers.length === 0);
const m1 = await call('/api/dsh-update-vd/mcp/save', { name: 'demo-http', transport: 'streamable-http', url: 'https://example.com/mcp' });
check('新增 http 服务器', m1.d.ok === true, JSON.stringify(m1.d.servers?.[0] ?? m1.d).slice(0, 130));
const m2 = await call('/api/dsh-update-vd/mcp/save', { name: 'demo-stdio', transport: 'stdio', command: 'npx', args: '-y some-mcp' });
check('新增 stdio 服务器', m2.d.ok === true && m2.d.servers.length === 2);
const dup = await call('/api/dsh-update-vd/mcp/save', { name: 'demo-http', transport: 'streamable-http', url: 'https://x' });
check('重名被拒', dup.d.ok === false, dup.d.error);
const badMcp = await call('/api/dsh-update-vd/mcp/save', { name: 'no-url', transport: 'streamable-http' });
check('缺 url 被拒（校验先行）', badMcp.d.ok === false, badMcp.d.error);
const id = m2.d.servers.find((s) => s.name === 'demo-stdio').id;
const toggled = await call('/api/dsh-update-vd/mcp/toggle', { id, enabled: false });
check('停用', toggled.d.ok === true && toggled.d.servers.find((s) => s.id === id).enabled === false);
const removed = await call('/api/dsh-update-vd/mcp/delete', { id });
check('删除', removed.d.ok === true && removed.d.servers.length === 1);
const persisted = JSON.parse(await (await import('node:fs/promises')).readFile('/tmp/vd-res-home/mcp-servers.json', 'utf8'));
check('清单落盘', persisted.servers.length === 1 && persisted.servers[0].name === 'demo-http');
console.log(`  （挂载尝试 ${mounted.length} 次，失败信息会走 results —— 本机沙箱里 import 不到 mcp-client 属正常）`);
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
await rm('/tmp/vd-res-home', { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
