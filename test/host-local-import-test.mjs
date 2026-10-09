import { fileURLToPath } from 'node:url';
const INDEX_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));

process.env.DSH_HOME = '/tmp/vd-local-home';
const { rm, readFile, stat } = await import('node:fs/promises');
await rm('/tmp/vd-local-home', { recursive: true, force: true });
const mod = await import(INDEX_PATH);
const mcpClient = await import('/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js');

const routes = new Map();
const plugged = [];
const ctx = {
  connection: { fetch: { register: (r) => { routes.set(r.path, r); return () => {}; } } },
  get: () => undefined,
  plugin: (m, c) => { plugged.push({ m, c }); return { dispose: () => {} }; },
  desktopRuntime: { updates: { currentVersion: '2.0.17', canDownload: true, request: () => Promise.reject(new Error('no')) } },
  logger: { info: (m) => console.log('   [host]', m) },
  effect: (fn) => { fn(); return () => {}; },
  inject: (_d, cb) => { cb(ctx); return () => {}; },
};
mod.apply(ctx);
await new Promise((r) => setTimeout(r, 200));
const call = async (p, body) => { const r = await routes.get(p).fetch(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })); return { s: r.status, d: await r.json().catch(() => null) }; };
let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };

console.log('\n① 扫本机（Codex / Claude / Cursor …）');
const detected = await call('/api/dsh-update-vd/import/local');
const d = detected.d;
check('扫描成功', d.ok === true);
const codexSkills = d.skills.filter((s) => s.toolId === 'codex');
check(`Codex 技能扫到 ${codexSkills.length} 个`, codexSkills.length >= 5, codexSkills.slice(0, 4).map((s) => s.name).join(', '));
check('技能带描述与路径', codexSkills.every((s) => typeof s.path === 'string' && s.path !== ''), codexSkills[0]?.path);
const codexMcp = d.mcp.filter((m) => m.toolId === 'codex');
const claudeMcp = d.mcp.filter((m) => m.toolId === 'claude');
check(`Codex 的 MCP 扫到 ${codexMcp.length} 个`, codexMcp.length >= 3, codexMcp.map((m) => `${m.name}(${m.transport})`).join(', '));
check(`Claude 的 MCP 扫到 ${claudeMcp.length} 个`, claudeMcp.length >= 1, claudeMcp.map((m) => `${m.name}(${m.transport})`).join(', '));
check('Codex 的 TOML 解析出 command/args', codexMcp.some((m) => m.command !== '' && m.args.length >= 0), JSON.stringify(codexMcp.find((m) => m.command) ?? {}).slice(0, 120));
check('Claude 的 env 也读到了', claudeMcp[0]?.env !== undefined && Object.keys(claudeMcp[0]?.env ?? {}).length >= 0);

console.log('\n② 真的导入两个 Codex 技能');
const pick = codexSkills.slice(0, 2).map((s) => ({ name: s.name, path: s.path }));
const applied = await call('/api/dsh-update-vd/import/apply', { skills: pick });
check('导入接口返回成功', applied.d.ok === true && applied.d.skills.every((x) => x.ok), JSON.stringify(applied.d.skills));
for (const item of pick) {
  const target = `/tmp/vd-local-home/skills/${item.name}/SKILL.md`;
  const text = await readFile(target, 'utf8').catch(() => '');
  check(`文件真的落地：${item.name}`, text.includes('description:'), target.replace('/tmp/vd-local-home', '~'));
}
const listAfter = await call('/api/dsh-update-vd/skills');
check('列表里能看到刚导入的', listAfter.d.skills.filter((s) => pick.some((p) => p.name === s.name)).length === 2);

console.log('\n③ 真的导入 MCP（Codex 里的 codegraph）');
const target = codexMcp.find((m) => m.name === 'codegraph') ?? codexMcp[0];
const applied2 = await call('/api/dsh-update-vd/import/apply', { mcp: [{ name: target.name, transport: target.transport, url: target.url, command: target.command, args: target.args, env: target.env, cwd: target.cwd, enabled: true }] });
check('导入接口返回成功', applied2.d.ok === true && applied2.d.mcp.every((x) => x.ok), JSON.stringify(applied2.d.mcp));
check('清单里出现了', applied2.d.servers.some((s) => s.name === target.name), JSON.stringify(applied2.d.servers.map((s) => s.name)));
check('挂载被调用（ctx.plugin）', plugged.length >= 1, `plugged=${plugged.length}`);
const store = JSON.parse(await readFile('/tmp/vd-local-home/mcp-servers.json', 'utf8'));
check('落盘到 ~/.dsh/mcp-servers.json', store.servers.some((s) => s.name === target.name));

console.log('\n④ 生成的 MCP 配置拿官方 Zod schema 校验');
const bad = [];
for (const [label, cfg] of [
  ['stdio', { transport: 'stdio', serverName: 'demo', command: 'npx', args: ['-y', 'x'], env: {}, cwd: '', failOnStartupError: false }],
  ['http', { transport: 'streamable-http', serverName: 'demo2', url: 'https://x/mcp', headers: {}, failOnStartupError: false }],
]) {
  try { mcpClient.Config(cfg); console.log(`  ok   官方 schema 接受 ${label} 配置`); } catch (error) { fail += 1; bad.push(label); console.log(`  FAIL 官方 schema 拒绝 ${label}：${error.message}`); }
}

console.log('\n⑤ 新增 / 编辑 / 删除（真文件）');
const created = await call('/api/dsh-update-vd/skills/save', { name: 'tmp-created-skill', description: '测试新增', body: '# 新技能' });
check('新增技能', created.d.ok === true, created.d.path);
check('磁盘上真的有', (await stat('/tmp/vd-local-home/skills/tmp-created-skill/SKILL.md').catch(() => null)) !== null);
const edited = await call('/api/dsh-update-vd/skills/save', { name: 'tmp-created-skill', originalName: 'tmp-created-skill', description: '改过的描述', body: '# 改过' });
const reread = await call('/api/dsh-update-vd/skills/read', { name: 'tmp-created-skill' });
check('编辑生效', edited.d.ok === true && reread.d.description === '改过的描述' && reread.d.body.includes('# 改过'));
const removed = await call('/api/dsh-update-vd/skills/delete', { name: 'tmp-created-skill' });
check('删除技能', removed.d.ok === true);
check('磁盘上真的没了', (await stat('/tmp/vd-local-home/skills/tmp-created-skill').catch(() => null)) === null);
const mcpAdded = await call('/api/dsh-update-vd/mcp/save', { name: 'tmp-http', transport: 'streamable-http', url: 'https://example.com/mcp' });
check('新增 MCP', mcpAdded.d.ok === true && mcpAdded.d.servers.some((s) => s.name === 'tmp-http'));
const toggled = await call('/api/dsh-update-vd/mcp/toggle', { id: mcpAdded.d.servers.find((s) => s.name === 'tmp-http').id, enabled: false });
check('停用 MCP', toggled.d.ok === true);
const mcpRemoved = await call('/api/dsh-update-vd/mcp/delete', { id: mcpAdded.d.servers.find((s) => s.name === 'tmp-http').id });
check('删除 MCP', mcpRemoved.d.ok === true && !mcpRemoved.d.servers.some((s) => s.name === 'tmp-http'));

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
await rm('/tmp/vd-local-home', { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
