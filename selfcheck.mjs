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
  // 站点两页：index.html = 极简介绍页（Pages 首页），editor.html = 编辑器。
  const landing = read('index.html');
  const html = read('editor.html');
  ok(html.includes('content="' + version + '"'), 'editor.html 版本不一致');
  ok(landing.includes('content="' + version + '"'), 'index.html 版本不一致');
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
  // 演示动图：两版 README 必须引用同一份真实 GIF，避免只改一份或留下失效图片。
  // 图片用仓库自身的绝对 raw URL —— 相对路径只有 GitHub 网页会重写，本地 / 第三方
  // Markdown 阅读器会解析成空白；相对路径改作兜底链接保留，兼顾 fork 与离线场景。
  const demo = 'assets/bidirectional-demo.gif', demoPath = path.join(ROOT, demo);
  const demoUrl = 'https://github.com/udarent/TimingBench/raw/main/' + demo;
  ok(fs.existsSync(demoPath), '缺少演示动图 ' + demo);
  ok(fs.readFileSync(demoPath).subarray(0, 6).toString('ascii') === 'GIF89a', '演示动图不是有效 GIF');
  ok(enReadme.includes(demoUrl) && zhReadme.includes(demoUrl), '双语 README 未同时引用演示动图绝对 URL');
  ok(!/!\[[^\]]*\]\(assets\/bidirectional-demo\.gif\)/.test(enReadme + zhReadme),
     '演示动图退回相对路径，非 GitHub 阅读器会显示空白');
  ok(enReadme.includes('](' + demoUrl + ')') && zhReadme.includes('](' + demoUrl + ')'),
     '双语 README 缺少动图直接打开链接');
  ok(enReadme.includes('](' + demo + ')') && zhReadme.includes('](' + demo + ')'),
     '双语 README 缺少本地动图文件兜底链接');
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
  // 全键盘可达：焦点入口、连线端点光标、命令分派、就地编辑焦点恢复、可见焦点样式
  ok(/focusPane/.test(editorSrc) && /ensureSelCell/.test(editorSrc) && /tabIndex=0/.test(editorSrc),
    '状态层缺少键盘焦点入口或画布不可聚焦');
  ok(/F6/.test(interSrc) && /linkKeys/.test(interSrc) && /linkCursor/.test(interSrc) &&
     /command\(/.test(interSrc), '交互层缺少 F6 / 连线端点光标 / 命令分派');
  ok(/restoreFocus/.test(interSrc) && /closeInline\(true,true\)/.test(interSrc),
    '就地编辑键盘结算后未把焦点还给画布');
  ok(/linkCursor/.test(shapesSrc) && /\.linkCursor/.test(cssSrc) && /:focus-visible/.test(cssSrc),
    '绘制层或样式层缺少连线端点光标 / 键盘焦点样式');
  // 两版 README 必须同时给出完整键盘表，防止只改一份或漏掉关键键位
  for (const key of ['F6', 'Shift+Enter', '`K`', 'Ctrl+↑', 'Shift+E'])
    ok(enReadme.includes(key) && zhReadme.includes(key), '双语 README 快捷键表缺少 ' + key);
  const kbRows = (s) => s.split('\n').filter((l) => l.startsWith('|')).length;
  const enKb = (enReadme.split('## Keyboard shortcuts')[1] || '').split('\n## ')[0];
  const zhKb = (zhReadme.split('## 快捷键')[1] || '').split('\n## ')[0];
  ok(kbRows(enKb) >= 18 && kbRows(zhKb) === kbRows(enKb),
    '双语快捷键表行数不一致或内容过短：en=' + kbRows(enKb) + ' zh=' + kbRows(zhKb));
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  ok(refs.length >= 2, 'editor.html 未引用样式与入口脚本');
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    ok(fs.existsSync(path.join(ROOT, ref)), 'editor.html 引用的资源缺失：' + ref);
  }
  ok(refs.every((r) => !r.startsWith('../')), 'editor.html 存在跳出站点根的相对路径');
  ok(fs.existsSync(path.join(ROOT, '.nojekyll')), '缺少 .nojekyll');

  // 首页是介绍页：极简、自包含（不引外部 CSS），必须有进编辑器的入口与演示动图
  const lrefs = [...landing.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  ok(lrefs.includes('editor.html'), '首页缺少进入编辑器的入口 editor.html');
  ok(lrefs.some((r) => r === 'assets/bidirectional-demo.gif'), '首页未引用演示动图');
  ok(!/<link[^>]+stylesheet/.test(landing), '首页不应引外部样式表（自带内联样式）');
  // 唯一允许的脚本是嵌入加载器：首页的「嵌入示例」是活的卡片，不是动图。
  // 除此之外仍须保持零脚本，且脚本路径只能是同目录的本地文件（不能外链 CDN）。
  const lscripts = [...landing.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
  ok(lscripts.length === 1 && /src="embed\.js"/.test(lscripts[0]),
    '首页应只加载本地 embed.js 这一个脚本（实际 ' + lscripts.length + ' 个）');
  ok(!/<script[^>]*>(?!\s*<\/script>)/.test(landing.replace(/<script src="embed\.js"[^>]*><\/script>/g, '')),
    '首页出现了内联脚本（只允许外部 embed.js）');
  ok(/data-timingbench/.test(landing) && /data-wavejson=/.test(landing) && /data-height=/.test(landing),
    '首页缺少可直接编辑的嵌入示例（data-timingbench / data-wavejson / data-height）');
  ok(/<noscript>/.test(landing), '首页缺少 noscript 兜底（脚本被禁用时给出编辑器入口）');
  ok(/prefers-color-scheme/.test(landing), '首页未跟随系统明暗主题');
  // 首页面向国际受众，用英文：`lang="en"`，且全文不得出现中日韩字符
  ok(/<html[^>]+lang="en"/.test(landing), '首页未声明 lang="en"');
  // 编辑器页面同样只含英文（aria-label / title 全英文）：lang 若仍写 zh-CN，读屏会用中文音库念英文名称
  ok(/<html[^>]+lang="en"/.test(html), 'editor.html 未声明 lang="en"（界面与 aria 全英文）');
  ok(!/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(landing), '首页出现中日韩字符（应全英文）');
  for (const ref of lrefs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    ok(fs.existsSync(path.join(ROOT, ref)), '首页引用的资源缺失：' + ref);
  }
  ok(lrefs.every((r) => !r.startsWith('../')), '首页存在跳出站点根的相对路径');

  // 触摸版式的容器与入口：桌面隐藏、粗指针（或 ?touch=1）时由 main.js 装配
  for (const id of ['app', 'tabbar', 'touchbar', 'tbpanel', 'toast'])
    ok(html.includes('id="' + id + '"'), '触摸 UI 容器缺失：#' + id);
  ok(html.includes('viewport-fit=cover'), '移动端安全区 viewport 缺失');
  ok(read('src/main.js').includes('is-touch'), 'main.js 未装配触摸版式开关');
  // 卡片口径：操作层（HUD / 字符条）按可视宽度排布并钉在可视区，只有纵向可增长；
  // 波形层仍按内容撑宽、可横向滚动 / 缩放。禁止退回「按整张画布宽度排字符条」或「不钉住」。
  ok(!/overflow-x:auto/.test(cssSrc), '触摸操作栏仍允许横向滚动（窄屏会溢出）');
  ok(/flex:1 1 44px/.test(cssSrc) && /min-width:44px/.test(cssSrc),
    '触摸操作栏按钮未按屏宽自适应或命中区不足 44px');
  ok(/viewW/.test(shapesSrc) && /Math\.floor\(\(viewW-barLeft-PAD\)\/CHIP_STEP\)/.test(shapesSrc),
    '字符条未按可视宽度换行（会横向溢出卡片）');
  ok(/g class="hudBar"/.test(shapesSrc) && /g class="charChips"/.test(shapesSrc) &&
     /syncPinned/.test(shapesSrc) && /wrap\.scrollLeft/.test(shapesSrc),
    'HUD / 字符条未钉在卡片可视区（滚动后按钮会跑出视野）');
  ok(/window\.addEventListener\('resize'/.test(editorSrc) &&
     /ctx\.wrap\.addEventListener\('scroll'/.test(editorSrc),
    '缺少旋屏重排或滚动跟随');

  // 分层：波形层（渲染内核）与操作层（UI）必须解耦。
  // ① waveform.js 只做「给定字符 → 图元字符串」，不得读视口尺寸或滚动位置；
  // ② shapes.js 对 waveGlyph 的调用不得掺入 viewW / scrollLeft 等操作层变量；
  // ③ 渲染内核模块不得反向依赖 UI 模块（shapes / interactions / touch / index），
  //    保证「改 UI 不动波形」在依赖图上就成立。
  const waveSrc = read('src/editor/waveform.js');
  ok(!/clientWidth|clientHeight|innerWidth|innerHeight|scrollLeft|scrollTop/.test(waveSrc),
    'waveform.js 读取了视口尺寸 / 滚动位置（渲染内核必须与 UI 解耦）');
  ok(!/from ['"]\.\/(shapes|interactions|touch|index)\.js['"]/.test(waveSrc),
    'waveform.js 反向依赖了 UI 模块（渲染内核必须保持底层）');
  ok(/waveGlyph\(w,prevCh,x0,yT,yM,yB,CELL,/.test(shapesSrc),
    'waveGlyph 调用参数被改动（不得掺入操作层的排版变量）');
  ok(!/waveGlyph\([^)]*viewW|waveGlyph\([^)]*scrollLeft|waveGlyph\([^)]*barLeft/.test(shapesSrc),
    'waveGlyph 被传入了操作层变量（波形层与 UI 已耦合）');

  // 嵌入能力（2026-11-13 起）：宿主可一行引入，默认只读、点一下进编辑。
  const mainSrc = read('src/main.js');
  ok(fs.existsSync(path.join(ROOT, 'embed.js')), '缺少嵌入加载器 embed.js');
  ok(/data-timingbench/.test(read('embed.js')) && /TimingBenchEmbed/.test(read('embed.js')),
    'embed.js 未提供 [data-timingbench] 自动挂载与全局 mount 接口');
  ok(/embed=1/.test(read('embed.js')), 'embed.js 未按 ?embed=1 装配卡片');
  ok(/attachEmbed/.test(mainSrc) && /EMBED/.test(mainSrc),
    'main.js 未接入嵌入壳');
  ok(/state\.readonly/.test(shapesSrc) && /state\.readonly/.test(editorSrc) &&
     /state\.readonly/.test(read('src/editor/interactions.js')),
    '只读态未贯穿绘制层 / 装配层 / 交互层');
  ok(/postMessage/.test(read('src/editor/embed-shell.js')) &&
     /'height'|"height"/.test(read('src/editor/embed-shell.js')),
    '嵌入壳未上报高度（宿主无法自适应 iframe 高度）');
  ok(/is-embed/.test(cssSrc) && /is-readonly/.test(cssSrc),
    '样式缺少嵌入 / 只读态规则');
  ok(fs.existsSync(path.join(ROOT, 'embed-demo.html')), '缺少嵌入示例页 embed-demo.html');
  // 工作台 → 嵌入的分发路径：HUD 的 <> 生成可粘贴片段
  const shareSrc = read('src/editor/share.js');
  ok(/openEmbedCode/.test(shareSrc) && /attachShare/.test(editorSrc),
    '缺少嵌入代码生成（openEmbedCode / attachShare）');
  ok(/data-wavejson/.test(shareSrc) && /data-timingbench/.test(shareSrc) && /embed\.js/.test(shareSrc),
    '生成的片段缺少 embed.js / data-timingbench / data-wavejson');
  // 属性值改用双引号包裹（片段可读性最好），因此必须转义双引号；
  // 同时 & < > 也要转义，否则源码里的箭头或 & 会破坏属性。
  ok(/&#34;|&quot;/.test(shareSrc), '片段未转义双引号（data-wavejson 用双引号包裹会截断）');
  ok(/&amp;/.test(shareSrc) && /&lt;/.test(shareSrc),
    '片段未转义 & 或 <（源码含 < > & 时会破坏属性）');
  ok(/data-wavejson="/.test(shareSrc),
    '片段应用双引号包裹 data-wavejson（单引号会让源码里的 &#39; 遍地都是）');
  ok(/data-cmd="embed"|'embed'/.test(shapesSrc),
    'HUD 未提供嵌入代码入口');
  // 嵌入只读卡片必须按容器宽度等比缩小：否则 320/360px 手机上只能看到半张波形，
  // 而读者不会去横向拖一张只读卡片。缩放只改 svg 渲染尺寸，viewBox 保持内部坐标。
  ok(/state\.embedCard&&state\.readonly/.test(shapesSrc) && /var fit=/.test(shapesSrc),
    '嵌入只读卡片缺少按容器宽度等比缩放（窄屏会只显示部分波形）');
  ok(/outW=fit<1\?viewW:W/.test(shapesSrc) && /viewBox="0 0 '\+W\+' '\+H\+'"/.test(shapesSrc),
    '缩放未保持 viewBox 为内部坐标（图元几何与就地编辑坐标会错位）');
  // 只读态没有字符条，触摸引导 toast 不适用，也不该出现在英文宿主页面里
  const touchSrc = read('src/editor/touch.js');
  ok(/isReadonly && ctx\.isReadonly\(\)\) return/.test(touchSrc),
    '只读态仍会弹触摸引导 toast');

  // ---- 零常驻文字：桌面用 aria-label 替代 tooltip，触摸端用图标 + 长按出名称 ----
  // <title> 在 SVG 里必然变成浏览器 tooltip，画布层一律不允许出现。
  ok(!/<title>/.test(shapesSrc), '画布层仍在使用 <title>（会显示成 tooltip 文字）');
  ok(/role="button" aria-label="'\+esc\(title\)/.test(shapesSrc),
    '画布按钮缺少 aria-label（视觉无文字时读屏会失去名称）');
  ok(/aria-label="Write '\+esc\(v\)/.test(shapesSrc), '字符条缺少 aria-label');
  // 触摸端：操作栏 4 个符号、标签页 2 个图标，上下文条随选中对象自动切换
  ok(!/data-panel=/.test(html), '触摸操作栏仍保留「对象 / 列」文字面板入口');
  ok(touchSrc.indexOf("className = 'ctxbtn'") >= 0 && /function renderContext/.test(touchSrc),
    '触摸端缺少上下文图标条（renderContext / ctxbtn）');
  ok(/function bindLongName/.test(touchSrc) && /data-name/.test(touchSrc),
    '触摸端缺少「长按出名称」');
  ok(/ROW_ACTS = \['name'/.test(touchSrc) && /COL_ACTS = \['insert'/.test(touchSrc),
    '上下文动作集缺失或被改成文字面板');

  // ---- 英文优先：运行时字符串不得出现中日韩字符（注释不算） ----
  const runtimeFiles = ['src/editor/shapes.js', 'src/editor/interactions.js',
    'src/editor/touch.js', 'src/editor/index.js', 'src/editor/share.js',
    'src/editor/embed-shell.js', 'src/editor/waveform.js', 'src/editor/mode.js',
    'src/editor/geometry.js', 'src/main.js', 'src/core/example.js', 'src/core/util.js', 'embed.js'];
  const cjk = new RegExp('[\\u4e00-\\u9fa5\\u3040-\\u30ff\\uac00-\\ud7af]');
  for (const f of runtimeFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const body = read(f).split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
      .join('\n');
    ok(!cjk.test(body), '运行时字符串出现中文（交付语言为英文）：' + f);
  }

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
