// GitHub 未登录配额只有 60 次/小时；配额为 0 时这套测试必然失败，但那是环境问题不是回归。
// 明确跳过（退出码 0）并在输出里说明，免得把「配额用尽」误读成「代码坏了」。
{
	const quota = await fetch('https://api.github.com/rate_limit').then((r) => r.json()).catch(() => null);
	if (quota !== null && (quota.resources?.core?.remaining ?? 1) === 0) {
		console.log('  跳过：GitHub 未登录配额已用完（0/60）—— 环境原因，不是回归');
		process.exit(0);
	}
}

import { fileURLToPath } from 'node:url';
const INDEX_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));

process.env.DSH_HOME = '/tmp/vd-search-home';
const mod = await import(INDEX_PATH);
const routes = new Map();
const ctx = {
  connection: { fetch: { register: (r) => { routes.set(r.path, r); return () => {}; } } },
  get: () => undefined,
  plugin: () => ({ dispose: () => {} }),
  desktopRuntime: { updates: { currentVersion: '2.0.17', canDownload: true, request: () => Promise.reject(new Error('no')) } },
  logger: { info: () => {} },
  effect: (fn) => { fn(); return () => {}; },
  inject: (_d, cb) => { cb(ctx); return () => {}; },
};
mod.apply(ctx);
await new Promise((r) => setTimeout(r, 200));
const call = async (p, body) => { const r = await routes.get(p).fetch(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })); return { s: r.status, d: await r.json().catch(() => null) }; };
let fail = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; };

console.log('— 源清单 —');
const sources = await call('/api/dsh-update-vd/sources');
check('技能源列表', sources.d.ok === true && sources.d.sources.skills.length >= 2, sources.d.sources?.skills?.map((s) => s.label).join(' / '));
check('MCP 源列表', sources.d.ok === true && sources.d.sources.mcp.length >= 2, sources.d.sources?.mcp?.map((s) => s.label).join(' / '));

console.log('\n— 在线搜技能（真实网络）—');
const s1 = await call('/api/dsh-update-vd/skills/search', { sourceId: 'anthropics-skills', query: '', limit: 4 });
check('anthropics/skills 搜到条目', s1.d.ok === true && s1.d.results.length > 0, `共 ${s1.d.source?.total} 个 SKILL.md，取回 ${s1.d.results?.length}`);
console.log(`     例：${s1.d.results?.[0]?.name} | ${(s1.d.results?.[0]?.description ?? '').slice(0, 60)}`);
check('带可导入的 raw 地址', /^https:\/\/raw\.githubusercontent\.com\//.test(s1.d.results?.[0]?.url ?? ''), s1.d.results?.[0]?.url);
const s2 = await call('/api/dsh-update-vd/skills/search', { sourceId: 'anthropics-skills', query: 'pdf', limit: 3 });
check('带关键字过滤', s2.d.ok === true && s2.d.results.every((r) => r.path.toLowerCase().includes('pdf')), s2.d.results.map((r) => r.name).join(', '));
const s3 = await call('/api/dsh-update-vd/skills/search', { sourceId: 'custom', custom: 'https://github.com/obra/superpowers', query: 'brainstorm', limit: 3 });
check('自定义地址（另一个源）能用', s3.d.ok === true, `repo=${s3.d.source?.repo} 命中 ${s3.d.results?.length}`);
// 行为已变（2026-10 改的）：没有「custom」这种源了，留空＝就用选中的那个源（不再报错），
// 想用别的地址走「＋添加地址」或临时填 custom
const s4 = await call('/api/dsh-update-vd/skills/search', { sourceId: 'custom', custom: '', query: '', limit: 2 });
check('源 id 不认识时回落到第一个源（而不是报错）', s4.d.ok === true && (s4.d.results ?? []).length > 0, `命中 ${s4.d.results?.length}`);
const s5 = await call('/api/dsh-update-vd/skills/search', { sourceId: 'custom', custom: '这不是地址', query: '' });
check('乱填地址给明确提示', s5.d.ok === false, s5.d.error);

console.log('\n— 在线搜 MCP（真实网络）—');
const m1 = await call('/api/dsh-update-vd/mcp/search', { sourceId: 'mcp-registry', query: 'filesystem', limit: 6 });
check('官方注册表搜到', m1.d.ok === true && m1.d.results.length > 0, `${m1.d.results?.length} 个`);
for (const r of (m1.d.results ?? []).slice(0, 4)) console.log(`     · ${r.name} | ${r.transport} | ${(r.url || `${r.command} ${(r.args||[]).join(' ')}`).slice(0, 70)}`);
check('结果能直接变成配置', (m1.d.results ?? []).every((r) => (r.transport === 'streamable-http' && r.url) || (r.transport === 'stdio' && r.command)), 'ok');
const m2 = await call('/api/dsh-update-vd/mcp/search', { sourceId: 'mcp-servers', query: 'git', limit: 5 });
check('GitHub 参考实现源能用', m2.d.ok === true && m2.d.results.length > 0, m2.d.results?.map((r) => `${r.name}(${r.args?.join(' ')})`).join(', '));
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
