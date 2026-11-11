// 提交前保险：一个复杂用例覆盖双向编辑闭环，并校验静态站点入口可用。
// 零第三方依赖；npm run check。不是完整验收套件，失败退出码 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Core } from './src/core/ir.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  passed += 1;
}

// 单一复杂输入：注释 / 单引号 / group / spacer / gap / data / node / edge / phase / period
const COMPLEX = `{ signal: [
  // 自检用例：保留注释与引号风格
  { name: 'clk', wave: 'p.....|...', period: 1 },
  { name: 'dat', wave: 'x.345x|=.x', data: ['head', 'body', 'tail', 'data'] },
  { name: 'req', wave: '0.1..0|1.0', node: '..a...' },
  {},
  ['Master',
    { name: 'wr', wave: '01.0....', node: '.b......' },
    { name: 'cmd', wave: 'x.=.=x..', data: 'RAS NOP CAS', phase: 0.5 }
  ],
  { name: 'ack', wave: '1.....|01.' }
], edge: ['a~>b t1'], config: { hscale: 1 } }
`;

// 图形编辑完整链路：applyOp → patchSource → 重新解析 → I2 等价
function roundTrip(ir, ops) {
  let next = ir;
  for (const op of ops) next = Core.applyOp(next, op);
  const res = Core.patchSource(ir, next);
  const parsed = Core.buildIR(res.src);
  ok(Core.canon(parsed) === Core.canon(next), 'I2 不成立：' + ops.map((o) => o.t).join('+'));
  return { res, next, parsed };
}

function check() {
  const ir = Core.buildIR(COMPLEX);
  const lane = (n) => ir.lanes.find((l) => l.name === n);
  const clk = lane('clk'), dat = lane('dat'), req = lane('req'), wr = lane('wr');
  ok(clk && dat && req && wr && lane('cmd'), '复杂用例解析缺行');
  ok(ir.ticks === 10, '周期数 = ' + ir.ticks);
  ok(ir.lanes.some((l) => l.kind === 'spacer'), '缺 spacer');
  ok(ir.lanes.some((l) => l.groupPath.length > 0), '缺 group');
  ok(ir.edges.length === 1, 'edge 数 = ' + ir.edges.length);
  ok(clk.slots[6] && clk.slots[6].gap === true, 'gap 未标记相位线');
  ok(JSON.stringify(Core.laneLabels(dat)) === JSON.stringify(['head', 'body', 'tail', 'data']), 'data 标签未按序消耗');
  ok(Core.canon(Core.buildIR(Core.emitIR(ir))) === Core.canon(ir), 'I1 不成立');

  // 16 类 EditOp 逐类回写，均以同一个复杂文档为起点
  const ops = [
    { t: 'setSlot', lanes: [clk.id], tick: 0, v: '0' },
    { t: 'setLabel', lane: dat.id, tick: 2, v: 'NEW' },
    { t: 'setNode', lane: clk.id, tick: 2, v: 'q' },
    { t: 'rename', lane: clk.id, v: 'renamed' },
    { t: 'setPhase', lane: clk.id, v: 0.5 },
    { t: 'setPeriod', lane: clk.id, v: 2 },
    { t: 'toggleGap', tick: 2 },
    { t: 'insertTick', tick: 2 },
    { t: 'deleteTick', tick: 2 },
    { t: 'setEdges', v: ['a~>b t1', 'c~>d t2'] },
    { t: 'setWave', lane: clk.id, v: '01.xz....' },
    { t: 'setLabels', lane: dat.id, v: 'A B' },
    { t: 'setNodeStr', lane: clk.id, v: '.a...' },
    { t: 'moveLane', lane: clk.id, v: 'down' },
    { t: 'addLane', id: 'fresh', name: 'fresh', at: 1, kind: 'signal' },
    { t: 'deleteLane', lane: clk.id }
  ];
  ok(ops.length === 16, 'EditOp 覆盖数 = ' + ops.length);
  for (const op of ops) roundTrip(Core.buildIR(COMPLEX), [op]);

  // 字面量修改走最小补丁，保住注释 / 键序 / 引号风格
  const lit = roundTrip(Core.buildIR(COMPLEX), [
    { t: 'setSlot', lanes: [clk.id], tick: 0, v: '1' },
    { t: 'setLabel', lane: dat.id, tick: 2, v: 'BODY' },
    { t: 'rename', lane: clk.id, v: 'clk2' },
    { t: 'setPhase', lane: lane('cmd').id, v: 0.25 }
  ]);
  ok(lit.res.patched === true, '字面量修改未走最小补丁');
  ok(lit.res.src.includes('// 自检用例'), '注释丢失');
  ok(lit.res.src.includes("name: 'dat'"), '单引号 / 键名被改写');
  ok(lit.res.src.includes('BODY') && lit.res.src.includes('clk2'), '标签 / 名称未回写源码');

  // 两点连线：node + edge 一次提交，结构变化显式回退全量 emit
  const link = roundTrip(Core.buildIR(COMPLEX), [
    { t: 'setNode', lane: req.id, tick: 1, v: 'z' },
    { t: 'setNode', lane: wr.id, tick: 2, v: 'y' },
    { t: 'setEdges', v: ['z~>y t1'] }
  ]);
  ok(link.res.patched === false, '结构变化应回退全量 emit');
  ok(link.res.src.includes('z~>y'), 'edge 未回写源码');

  // 负例与边界
  ok(Core.canon(Core.buildIR(COMPLEX.replace('// 自检用例：保留注释与引号风格', '// 注释改写'))) === Core.canon(ir), '注释被算进语义');
  ok(Core.canon(Core.buildIR(COMPLEX.replace("name: 'clk'", "name: 'CLK2'"))) !== Core.canon(ir), '信号名变化未被感知');
  let threw = false;
  try { Core.buildIR('{ signal: ['); } catch { threw = true; }
  ok(threw, '非法源码未抛错');
  ok(Core.ALL.indexOf('Q') < 0, '非法字符进入字表');

  // 版本一致 + 静态站点入口自洽（GitHub Pages 以仓库根为站点根）
  const version = JSON.parse(read('package.json')).version;
  ok(read('VERSION').trim() === version, 'VERSION 与 package.json 不一致');
  const html = read('index.html');
  ok(html.includes('content="' + version + '"'), 'index.html 版本不一致');
  // 双语 README：英文为主文件、中文独立成篇，两边互链且版本号同步
  const enReadme = read('README.md'), zhName = 'README.zh-CN.md';
  const hasZh = fs.existsSync(path.join(ROOT, zhName));
  const zhReadme = hasZh ? read(zhName) : '';
  ok(hasZh, '缺少中文版 ' + zhName);
  ok(enReadme.includes('`' + version + '`'), '英文 README 版本号不一致');
  if (hasZh) {
    ok(enReadme.includes(zhName), '英文 README 缺少中文切换链接');
    ok(zhReadme.includes('README.md'), '中文 README 缺少英文切换链接');
    ok(zhReadme.includes('`' + version + '`'), '中文 README 版本号不一致');
  }
  // 演示动图：两版 README 必须引用同一份真实 GIF，避免只改一份或留下失效图片
  const demo = 'assets/bidirectional-demo.gif', demoPath = path.join(ROOT, demo);
  ok(fs.existsSync(demoPath), '缺少演示动图 ' + demo);
  ok(fs.readFileSync(demoPath).subarray(0, 6).toString('ascii') === 'GIF89a', '演示动图不是有效 GIF');
  ok(enReadme.includes(demo) && zhReadme.includes(demo), '双语 README 未同时引用演示动图');
  // 致谢与反馈口径：两版都须感谢上游项目、引导提 issue，且不再把邮箱当反馈渠道
  const upstream = 'https://github.com/wavedrom/wavedrom';
  const issues = 'https://github.com/udarent/TimingBench/issues';
  const ackDoc = read('ACKNOWLEDGMENTS.md');
  ok(enReadme.includes('Thanks to') && zhReadme.includes('感谢'), '双语 README 缺少 WaveDrom 致谢');
  ok(enReadme.includes(upstream) && zhReadme.includes(upstream), '致谢未链接上游项目');
  ok(ackDoc.includes(upstream), 'ACKNOWLEDGMENTS.md 未同步致谢');
  ok(enReadme.includes(issues) && zhReadme.includes(issues), '双语 README 未引导提 issue');
  ok(!/helloyuechen|163\.com/.test(enReadme + zhReadme), 'README 仍把邮箱当反馈渠道');
  // 图形区互斥与渲染口径：禁止锚点小圆圈回归，连线必须由显式模式驱动
  const shapesSrc = read('src/editor/shapes.js');
  const interSrc = read('src/editor/interactions.js');
  const editorSrc = read('src/editor/index.js');
  const cssSrc = read('src/styles.css');
  ok(!/nodeAnchor|<circle|connecting/.test(shapesSrc), '绘制层仍存在锚点小圆圈 / 连线态样式');
  ok(!/\.nodeAnchor|\.connecting/.test(cssSrc), '样式层仍存在锚点规则');
  ok(/linkMode/.test(editorSrc) && /setLinkMode/.test(editorSrc), '状态层缺少唯一的连线模式入口');
  ok(/if\(state\.linkMode\)/.test(interSrc) && !/nodeAnchor/.test(interSrc), '交互层未做互斥分派或仍有锚点命中');
  ok(/cmd\('link'/.test(shapesSrc) && /data-tb="link"/.test(html), '桌面 HUD / 触摸操作栏缺少连线开关');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  ok(refs.length >= 2, 'index.html 未引用样式与入口脚本');
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    ok(fs.existsSync(path.join(ROOT, ref)), 'index.html 引用的资源缺失：' + ref);
  }
  ok(refs.every((r) => !r.startsWith('../')), 'index.html 存在跳出站点根的相对路径');
  ok(fs.existsSync(path.join(ROOT, '.nojekyll')), '缺少 .nojekyll');

  // 触摸版式的容器与入口：桌面隐藏、粗指针（或 ?touch=1）时由 main.js 装配
  for (const id of ['app', 'tabbar', 'touchbar', 'tbpanel', 'toast'])
    ok(html.includes('id="' + id + '"'), '触摸 UI 容器缺失：#' + id);
  ok(html.includes('viewport-fit=cover'), '移动端安全区 viewport 缺失');
  ok(read('src/main.js').includes('is-touch'), 'main.js 未装配触摸版式开关');

  // src/ 下所有 ES module 的相对 import 必须指向真实文件，避免残留失效引用
  function walk(dir) {
    let out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  }
  const modules = walk('src');
  ok(modules.length >= 9, 'src/ 模块数异常：' + modules.length);
  for (const file of modules) {
    const src = read(file);
    const re = /(?:from|import)\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;   // 无第三方运行时依赖；裸说明符交给浏览器报错
      const target = path.resolve(path.dirname(path.join(ROOT, file)), spec);
      ok(fs.existsSync(target), file + ' 引用了不存在的模块：' + spec);
    }
  }
}

try {
  check();
  console.log('TimingBench selfcheck OK · ' + passed + '/' + passed + ' 断言通过');
} catch (e) {
  console.error('TimingBench selfcheck FAILED · ' + passed + ' 断言通过后：' + e.message);
  process.exit(1);
}
