/**
 * 渲染测试：把「技能」「MCP」两个设置页的**每种模式**都渲染一遍。
 * SSR 不会跑 state 变化，所以用受控 useState 把初始 state 直接喂进去 ——
 * 这样列表/编辑/导入/确认四种视图都能真的走一遍（slot 里抛错会整片空白）。
 */
import { createRequire } from 'node:module';
const require = createRequire(process.env.DSH_TEST_DEPS ?? '/tmp/dsudep9/package.json');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => (captured = d) }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, skills: [], servers: [], roots: [] }) });

await import('new URL('../lib/client.js', import.meta.url).pathname');
const mod = captured.factory((id) => {
	if (id === 'react') return React;
	throw new Error(`unexpected require(${id})`);
});

// 记录设置页组件：slots.register 时把组件抓下来
const registered = [];
let queue = [];
const React2 = Object.create(React);
React2.useState = (initial) => {
	const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial;
	return React.useState(value);
};
const fakeRequire = (id) => {
	if (id === 'react') return React2;
	throw new Error(`unexpected require(${id})`);
};
const mod2 = captured.factory(fakeRequire);
mod2.apply({
	effect: (fn) => fn(),
	slots: { inject: (_k, cb) => cb(), register: (o, C) => registered.push({ o, C }) },
	locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) },
});

const skills = registered.find((e) => e.o.id === 'skills');
const mcp = registered.find((e) => e.o.id === 'mcp');
if (skills === undefined || mcp === undefined) throw new Error('设置页没注册上');

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ' · ').replace(/(\s*·\s*)+/gu, ' | ').replace(/\s+/gu, ' ').trim();

const skillData = [
	{ name: 'my-skill', description: '我自己的技能', path: '/Users/x/.dsh/skills/my-skill/SKILL.md', writable: true, rootLabel: '~/.dsh/skills', source: 'user-dsh' },
	{ name: 'bundled-one', description: '随包发布的', path: '/Applications/x/SKILL.md', writable: false, rootLabel: 'bundled', source: 'bundled' },
];
const serverData = [
	{ id: 'a', name: 'demo-http', transport: 'streamable-http', url: 'https://example.com/mcp', command: '', args: '', headers: {}, env: {}, enabled: true, mounted: true },
	{ id: 'b', name: 'demo-stdio', transport: 'stdio', url: '', command: 'npx', args: '-y server-filesystem', headers: {}, env: { K: 'V' }, enabled: false, mounted: false },
];

let failures = 0;
const render = (component, label, args) => {
	queue = args;
	try {
		const html = renderToStaticMarkup(React.createElement(component));
		console.log(`  ok   ${label} → ${text(html).slice(0, 150)}`);
		return html;
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${label} → ${error.message}`);
		return '';
	}
};

console.log('— 技能页 —');
let html = render(skills.C, '列表（有数据）', [{ loading: false, skills: skillData, roots: [{ id: 'user-dsh', label: '~/.dsh/skills' }], error: null, notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('my-skill') || !html.includes('只读')) { failures += 1; console.log('     FAIL 列表内容不对'); }
render(skills.C, '列表（空）', [{ loading: false, skills: [], roots: [], error: null, notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(skills.C, '列表（报错）', [{ loading: false, skills: [], roots: [], error: '技能服务不可用', notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(skills.C, '搜索过滤', [{ loading: false, skills: skillData, roots: [], error: null, notice: null }, 'myskill', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
html = render(skills.C, '编辑', [{ loading: false, skills: skillData, roots: [], error: null, notice: null }, '', { kind: 'edit', isNew: false, draft: { name: 'my-skill', description: '描述', body: '# 正文', path: '/x/SKILL.md', originalName: 'my-skill' } }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('保存')) { failures += 1; console.log('     FAIL 编辑视图缺保存'); }
render(skills.C, '新增', [{ loading: false, skills: [], roots: [], error: null, notice: null }, '', { kind: 'edit', isNew: true, draft: { name: '', description: '', body: '' } }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
html = render(skills.C, '导入（内含在线搜索）', [{ loading: false, skills: [], roots: [], error: null, notice: null }, '', { kind: 'import', draft: { url: '', path: '', name: '' } }, false, [{ id: 'anthropics-skills', label: 'Anthropic 官方技能库', kind: 'github' }], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: 'pdf', results: [{ name: 'pdf', description: '处理 PDF', path: 'skills/pdf/SKILL.md', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md' }], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('在线搜索') || !html.includes('导入这个')) { failures += 1; console.log('     FAIL 技能导入页没带在线搜索'); }
html = render(skills.C, '删除确认', [{ loading: false, skills: skillData, roots: [], error: null, notice: null }, '', { kind: 'confirm', skill: skillData[0] }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('确定要删除')) { failures += 1; console.log('     FAIL 删除确认没出现'); }

console.log('— MCP 页 —');
html = render(mcp.C, '列表（有数据）', [{ loading: false, servers: serverData, error: null, notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('demo-http') || !html.includes('已连接') || !html.includes('已停用')) { failures += 1; console.log('     FAIL MCP 列表内容不对'); }
render(mcp.C, '列表（空）', [{ loading: false, servers: [], error: null, notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(mcp.C, '列表（连接失败提示）', [{ loading: false, servers: serverData, error: '清单已保存，但连接失败：demo-http：加载不了模块', notice: null }, '', { kind: 'list' }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(mcp.C, '编辑 http', [{ loading: false, servers: serverData, error: null, notice: null }, '', { kind: 'edit', isNew: false, draft: { id: 'a', name: 'demo-http', transport: 'streamable-http', url: 'https://example.com/mcp', command: '', args: '', headersText: 'Authorization=Bearer x', envText: '', enabled: true } }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(mcp.C, '编辑 stdio', [{ loading: false, servers: serverData, error: null, notice: null }, '', { kind: 'edit', isNew: false, draft: { id: 'b', name: 'demo-stdio', transport: 'stdio', url: '', command: 'npx', args: '-y x', headersText: '', envText: 'K=V', enabled: false } }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
render(mcp.C, '新增', [{ loading: false, servers: [], error: null, notice: null }, '', { kind: 'edit', isNew: true, draft: { name: '', transport: 'streamable-http', url: '', command: '', args: '', headersText: '', envText: '', enabled: true } }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
html = render(skills.C, '从本机导入（技能）', [{ loading: false, skills: [], roots: [], error: null, notice: null }, '', { kind: 'local' }, false, [], { kind: 'skills', sourceId: '', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [{ name: '2dcs', description: '两个维度立绘', path: '/Users/x/.codex/skills/2dcs', file: '/Users/x/.codex/skills/2dcs/SKILL.md', tool: 'Codex CLI', toolId: 'codex', already: false }], mcp: [], selected: [], error: null }]);
if (!html.includes('从本机其它 AI 工具导入技能') || !html.includes('导入选中的')) { failures += 1; console.log('     FAIL 技能的本机导入视图不对'); }
html = render(mcp.C, '从本机导入（MCP）', [{ loading: false, servers: [], error: null, notice: null }, '', { kind: 'local' }, false, [], { kind: 'mcp', sourceId: '', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [{ name: 'codegraph', transport: 'stdio', command: 'codegraph', args: ['serve', '--mcp'], env: {}, url: '', tool: 'Codex CLI', toolId: 'codex', enabled: true }], selected: [], error: null }]);
if (!html.includes('从本机其它 AI 工具导入 MCP')) { failures += 1; console.log('     FAIL MCP 的本机导入视图不对'); }
html = render(mcp.C, '在线搜索（有结果）', [{ loading: false, servers: [], error: null, notice: null }, '', { kind: 'online' }, false, [{ id: 'mcp-registry', label: 'MCP 官方注册表', kind: 'registry' }], { kind: 'mcp', sourceId: 'mcp-registry', custom: '', query: 'filesystem', results: [{ name: 'filesystem', description: '本地文件系统', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('在线找 MCP 服务器') || !html.includes('用它新建')) { failures += 1; console.log('     FAIL 在线搜索视图不对'); }
html = render(mcp.C, '删除确认', [{ loading: false, servers: serverData, error: null, notice: null }, '', { kind: 'confirm', server: serverData[0] }, false, [], { kind: 'skills', sourceId: 'anthropics-skills', custom: '', query: '', results: [], busy: false, error: null }, { loading: false, skills: [], mcp: [], selected: [], error: null }]);
if (!html.includes('确定要删除')) { failures += 1; console.log('     FAIL MCP 删除确认没出现'); }

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
