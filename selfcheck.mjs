// 提交前保险：一个复杂用例覆盖双向编辑闭环，并校验静态站点入口可用。
// 零第三方依赖；npm run check。不是完整验收套件，失败退出码 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Core } from './src/core/ir.js';
import { EXAMPLE } from './src/core/example.js';
import { encodePayload, decodePayload } from './src/editor/payload.js';
import * as Cap from './src/editor/cap.js';
import { hscaleOf, HSCALE_MAX } from './src/editor/geometry.js';

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
  // tutorial.html 也是线上页面（Pages 的 /tutorial.html），它的 meta 版本同样得跟上来 ——
  // 以前只查 editor / index，发版时最容易漏的就是它。
  ok(read('tutorial.html').includes('content="' + version + '"'), 'tutorial.html 版本不一致');
  // HTML 里的正文是 HTML，不是 Markdown：`**强调**` 会原样把星号显示给人看（0.14.2 修掉三处）。
  // 判据：站点页面与指南页（仓库根的 editor-guide.html）正文里不得出现 `**`。
  {
    const pages = ['editor.html', 'index.html', 'tutorial.html', 'embed-demo.html'];
    const guide = path.join(ROOT, '..', 'editor-guide.html');
    const bad = [];
    for (const f of pages) if (read(f).includes('**')) bad.push(f);
    if (fs.existsSync(guide) && fs.readFileSync(guide, 'utf8').includes('**')) bad.push('../editor-guide.html');
    ok(bad.length === 0, 'HTML 正文里混入了 Markdown 的 `**`（会原样显示星号）：' + bad.join('；'));
  }
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
  // 只读卡片不画列号（can('colhead') 为假），顶部那条 TOP-12 的头带里什么都没有 ——
  // 必须从 viewBox 裁掉。旧写法 `Math.max(0, COL_Y-8)` 在 COL_Y=6/8 时**恒为 0**，
  // 等于从来没裁，读者在教程/笔记里看到的是首行上方 37px 死白（对照 WaveDrom 明显更松）。
  // 判据只看赋值语句（注释里会引用旧公式的字面量，不能拿全文搜）。
  ok(/var roTrimTop=Math\.max\(0, TOP-\d+\)/.test(shapesSrc) &&
     !/roTrimTop=Math\.max\(0, COL_Y/.test(shapesSrc),
    '只读卡片的顶部死白没被裁掉（roTrimTop 应基于 TOP，而不是恒为 0 的 COL_Y-8）');
  // 只读卡片的行距/波形带必须走紧凑口径：行高 40（编辑 48）、带 0.10~0.90（编辑 0.25~0.71）。
  // 编辑态的大行高是给点击命中与弧线留的，只读卡片用不上 —— 留着就是每行上下各 13px 空气。
  ok(/var RO_ROW_H = 40/.test(shapesSrc) &&
     /function rowH\(\)\{ return \(state\.readonly && state\.embedCard\) \? RO_ROW_H : ROW_H; \}/.test(shapesSrc) &&
     /var bandT=tight\?0\.10:0\.25, bandM=tight\?0\.50:0\.48, bandB=tight\?0\.90:0\.71;/.test(shapesSrc),
    '只读卡片的紧凑行高/波形带被改回编辑态口径（会重新长出每行上下的大段空白）');
  const interSrc = read('src/editor/interactions.js');
  const editorSrc = read('src/editor/index.js');
  const cssSrc = read('src/styles.css');
  const embedSrc = read('src/editor/embed-shell.js');
  // 捏合缩放（0.20.0）的三条结构前提。都是「删掉之后照样跑得通、功能却静默消失」的那种，
  // 靠断言盯住比靠注释可靠：
  // ① touch-action 必须是 pan-x pan-y —— 改回 manipulation 就等于把 pinch-zoom 让给浏览器，
  //    两指一落下就变成「整页缩放」（实测 pointercancel×2、visualViewport.scale→4.96）；
  // ② 缩放必须乘进 fit 基数，且把 baseFit 留档 —— 手势期间的快路与整次重绘要算出同一个宽高；
  // ③ 指针层要有「多指入口 + 缩放计算 + tap 作废」三件，缺一件就是捏合完顺手选中一个格子。
  ok(/\.is-touch \.svgwrap\{[^}]*touch-action:pan-x pan-y/.test(cssSrc),
    '画布 touch-action 不是 pan-x pan-y：浏览器会把捏合当整页缩放收走（现象：连顶栏一起放大）');
  ok(/var fit = baseFit \* zoom/.test(shapesSrc) && /state\.baseFit=baseFit/.test(shapesSrc) &&
     /function applyZoom\(\)/.test(shapesSrc),
    '手势缩放没乘进 fit 基数，或没给手势快路留档 baseFit / applyZoom（快路与重绘会算出不同宽高）');
  // 两道防线缺一不可：tStartMulti 里清掉候选点按（双指落下那一刻），endPointer 里否掉 tap
  // （抬手那一刻）。实测：只留其中一道，双指原地轻点就会选中一个格子。
  ok(/tStartMulti\(\)/.test(interSrc) && /tPinchMove\(\)/.test(interSrc) &&
     /function tStartMulti\(\)\{[^}]*press=null/.test(interSrc) &&
     /if\(tMulti\)\{\s*tEndMulti\(\);\s*return;\s*\}/.test(interSrc),
    '指针层缺少多指手势入口 / 缩放计算 / 候选点按作废（双指轻点会误选中格子）');
  // 桌面滚轮通道（0.20.1）：必须是 passive:false —— 否则 preventDefault 无效，
  // Ctrl+滚轮会同时缩放整页；且必须读 ctrlKey/metaKey，否则普通滚动也被吃掉。
  // 只读卡片的放大要能真的生效：CSS 把 svg 拉成 100%×100%，没有 .is-zoom 让位规则
  // 就会出现「state.zoom 变了、画面一点没变」。
  ok(/addEventListener\('wheel'/.test(interSrc) && /\{passive:false\}/.test(interSrc) &&
     /ctrlKey\|\|e\.metaKey/.test(interSrc) && /ctx\.setZoom/.test(interSrc),
    '缺少桌面 Ctrl+滚轮缩放通道（或它不是非 passive / 没判修饰键，会连整页一起缩放）');
  ok(/\.is-embed\.is-readonly \.svgwrap\.is-zoom svg/.test(cssSrc),
    '只读卡片缺少 is-zoom 让位规则：放大后 CSS 的 width:100% 会盖掉尺寸，看起来没反应');
  // 全屏方向（0.20.1）：三个可观测动作缺一不可 —— 锁方向、退出时解锁、
  // 进全屏前记住分屏方向并在退出时还原（判据用「还没记过」，不能依赖 wasFs：
  // requestFullscreen 的 promise 可能先于 fullscreenchange 结算）。
  // 分屏仍然要能手动翻（顶栏那个 ⇄/⇅）。唯一入口是 toggleLayout，别把它删掉 ——
  // 全屏方向按钮退出时那个「还原成进全屏前的方向」的入口已随 0.22.0 一并移除。
  ok(/function toggleLayout\(\)/.test(editorSrc) && /ctx\.toggleLayout=toggleLayout/.test(editorSrc),
    '状态层缺少分屏切换 toggleLayout（顶栏 ⇄/⇅ 靠它）');
  // 嵌入模式**没有**方向按钮（0.22.0 删除）：实测嵌入卡片里 \`.pane.src\` 是 display:none、
  // \`.is-embed .app\` 永远单列 —— 所以「切横屏」除了让屏幕转一下，没有任何版式收益；而系统锁在
  // 国产浏览器 / WebView 里普遍不可用，还有把物理旋转一起锁死的副作用（0.21.6 查出的那个）。
  // 转手机就够了，下面那条锁保证那条路是通的。
  // 判据咬「这件事还在不在」而不是某个方法名：整个文件不该再提 screen.orientation ——
  // 只写 /.lock/ 会被`var so=screen.orientation; so.lock(...)` 这种写法绕过（注入验证时就是这样）。
  ok(!/screen\.orientation/.test(embedSrc) && !/fsorient/.test(embedSrc) &&
     !/fsorient/.test(read('editor.html')),
    '嵌入模式又出现方向按钮 / 系统锁了：多数手机浏览器里不可用，还会把物理旋转一起锁死');
  // 「转手机能切」的两个前提，缺一条就变成「转了没反应」：
  //   ① resize 必须触发重绘 —— fit 是 JS 算的，不重绘画布还停在旧尺寸（看起来只换了窗口大小）；
  //   ② 没设过偏好时 data-layout 必须留空、交给 CSS 媒体查询 —— 写死就再也跟不动方向。
  ok(/addEventListener\('resize', *scheduleRedraw\)/.test(editorSrc) &&
     /removeAttribute\('data-layout'\)/.test(editorSrc),
    '旋转 / 改尺寸后不会重排：resize 必须重绘，且 auto 状态下不能把分栏方向写死');

  // 曾经两次想给 iframe 放行转屏：allow="screen-orientation"（0.21.2）与
  // allow="screen-orientation-lock"（0.21.6 前）—— 实测 Chromium 对两个名字都报
  // Unrecognized feature、featurePolicy.allowsFeature 均 false，Permissions Policy 里
  // 根本没有这个开关。方向功能已于 0.22.0 整体移除，这条只防「有人往 allow 里乱加名字」。
  ok(/setAttribute\('allow', *'fullscreen'\)/.test(read('embed.js')),
    '嵌入 iframe 的 allow 被改乱了：转屏不需要额外权限，加了未知特性名只会刷控制台告警');
  // 上报高度必须用**未缩放**的那份，否则读者在只读卡片里捏一下，宿主 iframe 就被撑高一次。
  ok(/state\.contentH=state\.embedCard\?Math\.round\(vbH \* outW0 \/ W\)/.test(shapesSrc),
    '上报高度跟着缩放走了：只读卡片放大后会把宿主 iframe 撑高');
  // 缩小下限（0.21.1）：它必须是**算出来的**「整图装下」比例，不是常量 1。
  // 钉死为 1 的后果就是用户报的这个现象 —— 桌面基数本来就是 1:1，宽图永远缩不到一眼看全。
  ok(/export function clampZoom\(z, min\)/.test(read('src/editor/geometry.js')) &&
     /export const ZOOM_MIN = 0\.2/.test(read('src/editor/geometry.js')),
    'clampZoom 又只认固定下限了（缩放下限必须可传入，另配一个绝对底）');
  ok(/var fitView = Math\.min\(1, rawFit, availH > 0 \? availH \/ H : 1\)/.test(shapesSrc) &&
     /var zoomMin = Math\.min\(1, Math\.max\(ZOOM_MIN, fitView \/ baseFit\)\)/.test(shapesSrc) &&
     /state\.zoomMin=zoomMin/.test(shapesSrc),
    '缩放的下限没有按「整图装进视口」现算（宽图会缩不小）');

  ok(!/nodeAnchor|<circle|connecting/.test(shapesSrc), '绘制层仍存在锚点小圆圈 / 连线态样式');
  ok(!/\.nodeAnchor|\.connecting/.test(cssSrc), '样式层仍存在锚点规则');
  ok(/linkMode/.test(editorSrc) && /setLinkMode/.test(editorSrc), '状态层缺少唯一的连线模式入口');
  ok(/if\(state\.linkMode\)/.test(interSrc) && !/nodeAnchor/.test(interSrc), '交互层未做互斥分派或仍有锚点命中');
  // 连线开关在底部动作行（与 label / node 同排，顶栏 HUD 已于 0.9.14 删除）：按钮表来自
  // cap.js 的 ACTS，顶栏只留撤销 / 重做 / 布局 / 嵌入。
  ok(/Cap\.hudCmds/.test(read('src/editor/touch.js')) && /'link'/.test(read('src/editor/cap.js')) &&
     !/touchbar/.test(html) && !/hudSVG/.test(shapesSrc),
    '顶栏缺少连线开关，或画布内 HUD / 已删的操作栏又回来了');
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

  // 首页照 wavedrom.com 复刻：居中一列，导航行 → logo 位（活图）→ 字标 → 副标题 → 四行说明 → 链接行。
  // 只保留这一页该有的东西：不引外部 CSS、不引动图 / 特性栅格 / 嵌入代码块 / 页脚。
  const lrefs = [...landing.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  ok(lrefs.includes('editor.html'), '首页缺少进入编辑器的入口 editor.html');
  ok(!/<link[^>]+stylesheet/.test(landing), '首页不应引外部样式表（自带内联样式）');
  ok(!/bidirectional-demo\.gif/.test(landing), '首页不应再引演示动图（waveDrom 首页没有，改由活图承担）');
  // 唯一允许的脚本是嵌入加载器：首页的「嵌入示例」是活的卡片，不是动图。
  // 除此之外仍须保持零脚本，且脚本路径只能是同目录的本地文件（不能外链 CDN）。
  const lscripts = [...landing.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
  ok(lscripts.length === 1 && /src="embed\.js"/.test(lscripts[0]),
    '首页应只加载本地 embed.js 这一个脚本（实际 ' + lscripts.length + ' 个）');
  ok(!/<script[^>]*>(?!\s*<\/script>)/.test(landing.replace(/<script src="embed\.js"[^>]*><\/script>/g, '')),
    '首页出现了内联脚本（只允许外部 embed.js）');
  ok(/data-timingbench/.test(landing) && /data-wavejson=/.test(landing) && /data-height=/.test(landing),
    '首页缺少可直接编辑的嵌入示例（data-timingbench / data-wavejson / data-height）');
  // 首页那张图是为本页专门设计的展示图（不是编辑器默认文档）：只需保证它是合法、非空的时序图，
  // 且确实用上了「波形 + 总线标签 + 连线」这三样，否则它就只是个装饰而不是产品的样子。
  const lm = landing.match(/data-wavejson="([^"]*)"/) || landing.match(/data-wavejson='([^']*)'/);
  ok(!!lm, '首页嵌入示例缺少 data-wavejson 内容');
  if (lm) {
    let ir = null, why = '';
    try { ir = Core.buildIR(lm[1].replace(/&#10;/g, '\n')); } catch (e) { why = 'parse: ' + e.message; }
    ok(!!ir, '首页展示图解析失败：' + why);
    if (ir) {
      const sig = ir.lanes.filter((l) => l.kind === 'signal');
      const labelled = sig.some((l) => l.slots.some((s) => s.label));
      const why2 = 'ticks=' + ir.ticks + ' lanes=' + sig.length + ' edges=' + ir.edges.length;
      ok(ir.ticks >= 6 && sig.length >= 4 && ir.edges.length >= 1 && labelled,
        '首页展示图过于单薄（需 ≥6 拍、≥4 条信号、含总线标签与连线）：' + why2);
      ok(Core.canon(ir) !== Core.canon(Core.buildIR(EXAMPLE)),
        '首页展示图退回了编辑器默认文档（应为本页专门设计的一张）：' + why2);
    }
  }
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

  // 教程页（tutorial.html）：与首页同口径 —— 英文、同版本、可编辑示例、只有一个本地 embed.js。
  const tut = read('tutorial.html');
  ok(tut.includes('content="' + version + '"'), 'tutorial.html 版本不一致');
  ok(/<html[^>]+lang="en"/.test(tut), 'tutorial.html 未声明 lang="en"');
  ok(!/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(tut), 'tutorial.html 出现中日韩字符（应全英文）');
  ok(tut.includes('editor.html'), 'tutorial.html 缺少进入编辑器的入口 editor.html');
  ok(tut.includes('index.html'), 'tutorial.html 缺少返回首页的链接');
  ok(/data-timingbench/.test(tut) && /data-wavejson=/.test(tut),
    'tutorial.html 缺少可编辑的实时示例卡片（data-timingbench）');
  {
    const ts = [...tut.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
    ok(ts.length === 1 && /src="embed\.js"/.test(ts[0]),
      'tutorial.html 应只加载本地 embed.js 这一个脚本（实际 ' + ts.length + ' 个）');
  }

  // 触摸版式的容器与入口：桌面隐藏、粗指针（或 ?touch=1）时由 main.js 装配
  for (const id of ['app', 'tbpanel', 'toast'])
    ok(html.includes('id="' + id + '"'), '触摸 UI 容器缺失：#' + id);
  ok(html.includes('viewport-fit=cover'), '移动端安全区 viewport 缺失');
  ok(read('src/main.js').includes('is-touch'), 'main.js 未装配触摸版式开关');
  // 卡片口径：操作层（HUD / 字符条）按可视宽度排布并钉在可视区，只有纵向可增长；
  // 波形层仍按内容撑宽、可横向滚动 / 缩放。禁止退回「按整张画布宽度排字符条」或「不钉住」。
  // 只约束上下文条这类动作按钮：它们必须全部落在可视宽内。
  // 字符停靠条是有意的横向滚动（23 个字符一条排不下，等价于输入法候选条），不在约束范围。
  // 停靠区高度（0.25.0）分两档：
  //   · 页面 / 触摸端：恒高 max(动作条, 字符条) —— 换选中对象时版面一动不动；
  //   · 嵌入卡片（.is-embed）：height:auto —— 卡片贴着内容长，没有按钮时不留空带
  //     （用户实测「波形和最下排按钮之间一段无用空白」）。两条子条在卡片里同高，选格↔选行不跳。
  // 子条自身仍必须是定高（否则 auto 没底），下面单独锁。
  {
    const dz = (/\.dockzone\{[^}]*?height:([^;}]+)/.exec(cssSrc) || [null, ''])[1];
    ok(!!dz && /var\(--dock-acts\)/.test(dz) && /var\(--dock-chars\)/.test(dz) &&
       !/^auto/.test(dz.trim()) &&
       !/var\(--dock-acts\)\s*\+\s*var\(--dock-chars\)/.test(dz) &&
       /\.is-embed \.dockzone\{height:auto/.test(cssSrc) &&
       /\.is-embed \.chardock\.open\{height:var\(--dock-acts\)\}/.test(cssSrc),
      '停靠区高度规则被改坏（页面恒高 + 卡片 auto + 卡片内两条同高，缺一不可）：' + (dz || '未匹配'));
  }
  ok(/\.is-readonly \.dockzone\{height:0\}/.test(cssSrc) &&
     /\.tbpanel\.open\{[^}]*height:var\(--dock-acts\)/.test(cssSrc) &&
     /\.chardock\.open\{[^}]*height:var\(--dock-acts\)/.test(cssSrc),
    '停靠区两条子规则被改坏（只读不预留 / 各自定高）');
  // 溢出区（0.25.0 定稿）：回到「⋯ 展开」，但展开块必须挂在按钮条**下方**并占位。
  // 三件事缺一不可，缺哪条都会退化成「浮层盖住波形」：
  //   ① DOM 顺序：溢出区排在按钮条之后（下挂）；
  //   ② CSS 没有 bottom:100% / position:absolute 那套上浮定位；
  //   ③ JS 把它实测高度写进 --more-h，dockzone 的定高公式里含着它，画布才会让位。
  {
    const twSrc = read('src/editor/touch.js'), htmlSrc2 = read('editor.html');
    ok(/id="chardock"[^>]*><\/div>\s*<div class="charmore"/.test(htmlSrc2.replace(/\n\s*/g, '')) ||
       htmlSrc2.indexOf('id="chardock"') < htmlSrc2.indexOf('id="charmore"'),
      '字符溢出区不在停靠条之后（应下挂，而不是浮在上方）');
    // 默认（嵌入卡片）必须是**下挂占位**；只有 .dockzone.more-up（大视图）才允许向上浮出。
    const moreBase = (/\.charmore\.open,\.tbmore\.open\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    ok(!/position:absolute/.test(moreBase) &&
       /\.dockzone\.more-up \.charmore\.open,[^{]*\{[^}]*bottom:100%/.test(cssSrc) &&
       /function isBigView/.test(read('src/editor/touch.js')),
      '溢出区定位不对：嵌入卡要下挂占位，大视图才向上浮出（.dockzone.more-up）');
    // 0.25.0 起 dockzone 是 height:auto —— 流内的溢出区自己就把高度撑开，不再需要 --more-h。
    // 这条锁改成：既不许回到常量高度，也不许留着那套 CSS 变量（会把 auto 算乱）。
    ok(!/--more-h/.test(cssSrc) && !/--more-h/.test(twSrc) &&
       /function syncMoreHeight/.test(twSrc),
      '溢出区高度还在用 --more-h（dockzone 已是 auto，两套算法会互相打架）');
    // 展开态**不进**重建 key：点「⋯」只准走 paintMore / paintCtxMore，第一行按钮不动。
    // 进了 key 就会 textContent='' 再重建，中间那一帧空白就是用户看到的「闪一下」。
    ok(/function paintMore/.test(twSrc) && /function paintCtxMore/.test(twSrc) &&
       /var actKey = acts\.join\('\,'\) \+ '\|' \+ fit;/.test(twSrc),
      '点「⋯」又触发整条重建了（应只 paintMore / paintCtxMore）');
    ok(/data-more/.test(twSrc) && /data-ctxmore/.test(twSrc),
      '两条按钮条缺少「⋯」入口');
    // 溢出区是主条的**兄弟**节点，收起时必须显式清空 —— 只清主条会留下一屏孤立按钮
    // （选中行之后字符还挂在那儿，用户实测过）。
    ok(/if \(more\) \{ more\.textContent = ''; more\.classList\.remove\('open'\); \}/.test(twSrc) &&
       /if \(tbmoreEl\) \{ tbmoreEl\.textContent = ''; tbmoreEl\.classList\.remove\('open'\); \}/.test(twSrc),
      '收起面板时没有一起清空下方溢出区（会留下一屏无关按钮）');
  }
  // 两条都不能换行：停靠区恒高，换行后的按钮会被行高裁掉。溢出走**翻页**（0.25.0 起，
  // 与字符停靠条同一套）—— 不再有浮层，所以这里只守「不换行 + 不溢出」。
  ok(/\.tbpanel\.open\{[^}]*flex-wrap:nowrap/.test(cssSrc) &&
     /\.is-touch \.tbpanel\.open\{[^}]*overflow:hidden/.test(cssSrc),
    '上下文条又允许换行了（换行后的按钮会被行高裁掉），或溢出没有被拦住');

  // ---- 停靠条左侧三个格级动作的图标：声明顺序是功能性的 ----
  // `inset` 是 top/right/bottom/left 的简写，会覆盖同一块里写在它**前面**的长属性。
  // `inset:auto` 是用来抵消 `.chipbtn svg{inset:0}` 的，必须写在 left/top 之前；
  // 顺序一反，left/top 被重置成 auto，图标退回静态起点、被 translate 推出按钮、再被
  // overflow:hidden 裁掉 —— 按钮里只剩一抹残影（0.18.0 就是这么错的，0.19.1 由 bbox 抓出）。
  // 判据看「位置先后」而不是锁整行文本：允许改数值，不许改顺序。
  // 顺序坑的**正确修法**是让基础规则不匹配动作按钮；万一有人又把 `inset` 简写搬回来，
  // 只要它写在 `left/top` 之后就会重置定位 —— 所以这条锁允许「没有 inset」，但不允许「写在后面」。
  {
    const block = (/\.chardock \.chipbtn\.act svg\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    const iInset = block.indexOf('inset:'), iLeft = block.indexOf('left:50%');
    ok(iInset < 0 || iLeft > iInset,
      '格级动作按钮的图标会被裁掉：`inset` 若出现在这条规则里，必须写在 left/top 之前（简写会覆盖它前面的长属性）');
  }
  // 光有顺序还不够：`.is-touch .chardock .chipbtn svg{inset:0}` 与动作图标规则**特异性相同**、
  // 但写在文件后面，照样会把 inset 盖回去 —— 触摸端实测偏移 -11,-11，图标被推出 44px 按钮只剩一条缝。
  // 修法不是加 !important，而是让基础规则**别管动作按钮**（`:not(.act)`），两边从此不打架。
  // 选择器现在与「⋯」弹层共用（`.chardock .chipbtn:not(.act) svg,.charmore .chipbtn svg{…}`），
  // 允许 `svg` 后接逗号再取块。触摸端不再另写一条同义规则（已并入基础规则），
  // 因此这里改为要求「基础规则排除 .act」+「动作图标有 absolute 定位」两条。
  ok(/:is\(\.chardock,\.charmore\) \.chipbtn:not\(\.act\) svg[^{]*\{/.test(cssSrc) &&
     /:is\(\.chardock,\.charmore\) \.chipbtn\.act svg\{[^}]*position:absolute/.test(cssSrc),
    '基础 .chipbtn svg 规则没有排除 .act（会把动作图标的 inset:0 盖回来、图标被推出按钮）');
  // 24 单位的线性图标必须按 1:1 渲染、描边 ≥2px：缩到 17px 时 1px 描边变 0.708px 且中心落在
  // 半像素，1 倍屏上线条被摊成两个半透明像素 —— 斜边断口、圆环发灰（0.19.3 用户实测）。
  // 判据只要求「尺寸 = 24」与「描边 ≥2」，不锁具体 px 写法。
  {
    const actSvg = (/:is\(\.chardock,\.charmore\) \.chipbtn\.act svg\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    // 选择器现在与溢出弹层共用（`.tbpanel button.ctxbtn svg,.tbmore button.ctxbtn svg{…}`），
    // 允许在 `.tbpanel button.ctxbtn svg` 后接逗号，再取第一个 `{…}` 块。
    const ctxSvg = (/:is\(\.tbpanel,\.tbmore\) button\.ctxbtn svg[^{]*\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    ok(/width:24px;height:24px/.test(actSvg) && /stroke-width:2/.test(actSvg) &&
       /width:24px;height:24px/.test(ctxSvg) && /stroke-width:2/.test(ctxSvg),
      '图标没按 1:1 画（24 单位图必须 24px 渲染 + 2px 描边，缩放会让 1 倍屏线条发灰断口）');
  }
  // 三组动作按钮（格级 / 行级 / 列级）必须是同一套规格：它们共用同一批 24 单位图标，
  // 尺寸 / 圆角 / 描边 / 端点各写一份就会「看着差不多、放一起对不齐」（用户实测反馈）。
  // 判据：桌面同尺寸同圆角；两端图标都带圆端点；触摸端描边也是 2（曾用 1.7 细一档）。
  {
    const actBox = (/:is\(\.chardock,\.charmore\) \.chipbtn\.act\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    const ctxBox = (/:is\(\.tbpanel,\.tbmore\) button\.ctxbtn\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    const actSvg2 = (/:is\(\.chardock,\.charmore\) \.chipbtn\.act svg\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    const ctxSvg2 = (/:is\(\.tbpanel,\.tbmore\) button\.ctxbtn svg[^{]*\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    const touchCtxSvg = (/\.is-touch :is\(\.tbpanel,\.tbmore\) button\.ctxbtn svg[^{]*\{([^}]*)\}/.exec(cssSrc) || [null, ''])[1];
    ok(/width:32px/.test(actBox) && /height:32px/.test(actBox) &&
       /width:32px/.test(ctxBox) && /height:32px/.test(ctxBox) &&
       /border-radius:6px/.test(ctxBox),
      '格级 / 行列动作按钮尺寸或圆角不一致（应同为桌面 32×32、圆角 6）');
    ok(/stroke-linecap:round/.test(actSvg2) && /stroke-linecap:round/.test(ctxSvg2) &&
       /stroke-width:2/.test(touchCtxSvg) && !/1\.7/.test(touchCtxSvg),
      '动作图标画笔不统一（应为 24/2 + 圆端点；触摸端曾用 1.7 细描边、桌面曾漏写端点）');
  }
  // 字符按钮（第一行 + 下方溢出区里的每一颗）必须共用同一套基础样式：字形绝对定位铺满按钮、
  // 字母压在中间。少写这一组就退化成浏览器默认按钮 —— 字形按内联流排在按钮上、字母被挤到
  // 下面（用户实测「主页的 P 与编辑页的 P 不是一个设计」，0.19.x 修过一次，0.25.0 改溢出区
  // 布局时又犯了一次）。现在统一锚在 `:is(.chardock,.charmore)` / `:is(.tbpanel,.tbmore)`，
  // 所以这里锁的是「两个容器都在选择器里」，而不是某一个具体的类名写法。
  ok(/:is\(\.chardock,\.charmore\) \.chipbtn\{[^}]*position:relative/.test(cssSrc) &&
     /:is\(\.chardock,\.charmore\) \.chipbtn:not\(\.act\) svg\{[^}]*position:absolute/.test(cssSrc) &&
     /:is\(\.chardock,\.charmore\) \.chipbtn span\{/.test(cssSrc),
    '字符按钮的基础样式漏了溢出区（会退化成默认按钮：字形在上、字母在下）');
  ok(/:is\(\.tbpanel,\.tbmore\) button\.ctxbtn\{[^}]*width:32px/.test(cssSrc) &&
     /:is\(\.tbpanel,\.tbmore\) button\.ctxbtn svg\{/.test(cssSrc),
    '行 / 列动作按钮的基础样式漏了溢出区（同样会退化成默认按钮）');

  // ---- 浅色档的低层级文字要够读 ----
  // --muted 承担时间轴数字、行号、φ/T 徽标、字符按钮里的波形预览。对白底与 --src-bg
  // 都必须 ≥ 4.5:1（WCAG 2.1 AA 正文）。用真实相对亮度公式算，不锁色值 ——
  // 换一个更深的灰同样合格，锁死色值只会在下次调色时误报。
  {
    const light = (/^:root\{([^}]*)\}/m.exec(cssSrc) || [null, ''])[1];
    const pick = (name) => {
      const m = new RegExp('--' + name + ':(#[0-9a-fA-F]{3,6})').exec(light);
      if (!m) return '';
      let h = m[1].slice(1);
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      return '#' + h;
    };
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const muted = pick('muted'), bg = pick('bg'), srcbg = pick('src-bg');
    ok(!!muted && !!bg && !!srcbg && cr(muted, bg) >= 4.5 && cr(muted, srcbg) >= 4.5,
      '浅色档 --muted 对比度不足 4.5:1（时间轴数字 / 行号 / φ·T 徽标 / 字符条波形预览都会读不清）：' +
      (muted && bg ? cr(muted, bg).toFixed(2) : '?') + ':1 on bg, ' +
      (muted && srcbg ? cr(muted, srcbg).toFixed(2) : '?') + ':1 on src-bg');
  }

  // ---- 图标按钮：没有常驻文字，桌面鼠标用户唯一的线索是 title ----
  // 只写 aria-label 的话只有读屏能拿到名称，鼠标悬停一片空白（用户实测「14 个图标全靠猜」）。
  {
    const t = read('src/editor/touch.js');
    const ctxBtn = /b\.setAttribute\('aria-label', NAMES\[k\] \|\| k\);[\s\S]{0,400}?b\.title = NAMES\[k\] \|\| k;/.test(t);
    const dockBtn = /b\.setAttribute\('aria-label', NAMES\[act\] \|\| act\);\s*b\.title = NAMES\[act\] \|\| act;/.test(t);
    ok(ctxBtn && dockBtn,
      '图标按钮缺 title（鼠标悬停看不到名称，只有读屏能读出 aria-label）');
  }

  // ---- 行选中底衬贴着内容右缘 ----
  // 铺到 W-PAD*2 会在宽屏上盖住几百像素空白（实测 1440 窗口下 918 宽底衬里 400 多像素
  // 盖在什么都没画的区域），读起来像「表格选中行」而不是「这条波形被选中」。
  // 命中面（laneRow）仍整幅宽 —— 点空白处也能选中这一行是另一个职责。
  ok(/var hiW=Math\.max\(24,ACT_X-PAD\);/.test(shapesSrc) &&
     /class="laneHi"/.test(shapesSrc) && /width="'\+hiW/.test(shapesSrc) &&
     /class="laneRow"[\s\S]{0,200}?width="'\+\(W-PAD\*2\)/.test(shapesSrc),
    '行选中底衬没贴着内容右缘（宽屏上会盖住大片空白，看起来像表格选中行）');
  // 画布高度只由内容决定：不再把 SVG 拉到视口高（那是「底栏画在 SVG 里」时代的做法，
  // 留着会让停靠区一出现就触发一次 SVG 重排，成为第二个抖动源）
  // 判据盯的是「H 由视口高推出」这件事，不是「不许读视口高」—— 缩放的下限要读可视高。
  ok(!/H *= *Math\.max\(contentH/.test(read('src/editor/shapes.js')),
    'shapes.js 又把画布拉高到视口了（停靠区一变就多重排一次）');
  // 嵌入卡片里不能把上下文条一起藏掉：触摸端没有行工具 / 拖拽把手，
  // 选中行后的 up·down·改名·加行全在 #tbpanel，藏了等于把行重排整组关掉。
  ok(!/\.is-embed[^{}]*\.tbpanel[^{}]*\{[^}]*display:\s*none/.test(cssSrc),
    '嵌入态把上下文条（#tbpanel）隐藏了 —— 触摸端在卡片里将无法上下移动行');
  // 卡片与全屏用同一套模型：.pane.diagram 是 flex 列、画布 flex:1 自己滚、dock 真占高度。
  // 反面案例写在注释里：dock 一旦改成绝对浮层，它就不进「内容 − 视口」这笔账，滚到底最后
  // 一两行仍压在 dock 底下（用户实测「全屏后能平移但范围不够，底部被编辑按钮挡住」）。
  ok(/\.is-embed \.pane\.diagram\{[^}]*display:flex/.test(cssSrc) &&
     !/\.is-embed[^{}]*\.dockzone\{[^}]*position:absolute/.test(cssSrc),
    '嵌入态的底部两条又变成浮层了（浮层不进滚动范围，最后几行会被挡住无法编辑）');
  // 同类问题的其余出口：凡是「浮在画布上、又不占版式」的东西，都要自己算清账。
  //   ① 轻提示钉在视口底部，触摸端字符停靠条也在那儿 —— 必须按停靠区高度抬起来，
  //      否则每次拦截提示都会盖在最常用的那排字符上。
  //   ② 「⋯」浮层与它的高度上限已被翻页取代（0.25.0）：翻页不占画布，也就没有「顶出视口」这回事。
  //   ③ 分享面板不能自己截断（截断会让复制按钮掉到面板外），改由遮罩滚动兜底。
  //   ④ 行号槽要让出横向滚动的空间：textarea 后出现且透明，不给它不透明底色 + 层序，
  //      长行往左滚时字符会压在行号上。
  //   ⑤ 宿主 iframe 的高度上报必须含停靠区，否则卡片进编辑后 chrome 把画布挤成一条缝。
  ok(/--toast-lift/.test(cssSrc) && /setProperty\('--toast-lift'/.test(read('src/editor/touch.js')),
    '轻提示没有按停靠区高度抬升（会压在字符停靠条上）');
  ok(!/\.sharePanel\{[^}]*max-height:calc\(100dvh/.test(cssSrc) &&
     /\.shareMask\{[^}]*overflow:auto/.test(cssSrc) &&
     /\.sharePanel\{[^}]*margin:auto/.test(cssSrc),
    '分享面板仍在按视口截断（复制按钮会掉到面板外），或遮罩没有做成可滚动');
  ok(/\.gutter\{[^}]*background:var\(--src-bg\)[^}]*z-index:2/.test(cssSrc),
    '行号槽没有不透明底色 / 层序（横向滚动后源码会压在行号上）');
  // 同步改 iframe 高度必须由宿主显式声明（autoHeight）：无条件改会把「写死高度的卡片」撑开。
  ok(/var fe = hostAutoH \? window\.frameElement : null/.test(read('src/editor/embed-shell.js')) &&
     /type === 'autoHeight'/.test(read('src/editor/embed-shell.js')) &&
     /post\('autoHeight'/.test(read('embed.js')),
    '同源直接改 iframe 高度缺少「宿主声明」这道闸（会把固定尺寸卡片撑开）');
  ok(/dockEl[\s\S]{0,120}dockH[\s\S]{0,200}state\.contentH/.test(read('src/editor/embed-shell.js')),
    '高度上报没算底部两条的高度（宿主卡片进编辑后画布会被挤没）');
  ok(!/revealLane\(laneOf, panel\.offsetHeight\)/.test(read('src/editor/touch.js')) &&
     !/state\.barH/.test(read('src/editor/interactions.js')),
    'revealLane 仍在重复扣面板高度（面板已是 flex 子项，多扣会多滚一截）');
  // 字符停靠条：在停靠区内（随停靠区定高、不随画布滚动）、触摸端命中区 ≥48px
  ok(/\.dockzone\{[^}]*display:flex/.test(cssSrc) &&
     /\.is-touch :is\(\.chardock,\.charmore\) \.chipbtn[^{]*\{[^}]*flex:0 0 48px/.test(cssSrc),
    '字符停靠条未收进 dockzone，或触摸端命中区不足 48px');
  // 字符输入只剩一套实现（HTML 停靠条 #chardock）：按**可用宽度**切片 —— 宽屏（含宽屏触摸 /
  // 宽嵌卡片）一次铺满，窄屏才把放不下的收进下方的「⋯」区。容量必须按实测宽度算，不能写死
  // 数量，也不能退回「触摸 4 颗」的按指针二选一（宽屏触摸会被浪费）。
  // 0.25.0 起「格级动作（label / node / link）」也进同一条流水线，不再常驻占三格宽度。
  const touchSrcEarly = read('src/editor/touch.js');
  ok(!/TOUCH ? QUICK\.slice\(\) : Core\.ALL\.slice\(\)/.test(touchSrcEarly) &&
     /var budget = \(host \? host\.clientWidth : dock\.clientWidth\)/.test(touchSrcEarly) &&
     /items\.push\(\{ t: 'act'/.test(touchSrcEarly) &&
     /for \(var fi = 0; fi < items\.length; fi\+\+\)/.test(touchSrcEarly) &&
     /gap \+ moreW/.test(touchSrcEarly),
    '字符停靠条未按可用宽度切片，或格级动作仍常驻占位（应与字符同一条流水线）');
  ok(!/charChips|actionBar/.test(shapesSrc),
    'SVG 内字符条（charChips / actionBar）应已删除，字符输入只走 #chardock');
  // 顶栏是页面级 HTML（不在 SVG 里），所以「滚动后按钮跑出视野」这类问题从根上没有了：
  // 画布层不应再出现任何 HUD 图元。
  ok(!/hudBar|hudSVG|syncPinned/.test(shapesSrc) &&
     /\.topbar/.test(cssSrc) && /renderTopbar/.test(read('src/editor/touch.js')),
    '画布内仍有 HUD 图元，或页面顶栏没接上');
  ok(/window\.addEventListener\('resize'/.test(editorSrc), '缺少旋屏 / 缩放后的重排');

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
  // 行级时间标尺（教程 Step 6）：period/phase 必须真的参与绘制，不能只当元信息。
  // period 把字符拆成 2·period 个 half-brick（每格宽 period 倍）。
  // phase **是连续位移，不能量化**：上游 wavedrom 走的是「整块丢掉 ceil(2p) 个半砖（parse-wave-lane
  // 里的 `for (i=0;i<phase*2;i++) R.shift()`）＋ 再把整组右移 (ceil(2p)−2p) 个半砖补偿
  // （render-wave-lane 的 `tt(xoffset*lane.xs,…)`）」，净位移 = p 个周期。实测 wavedrom@3.5.0：
  // 0.1 → translate(16)、0.2 → 12、0.3 → 8（砖宽 20、一格 40），即每 0.1 相位移 4px = 0.1 格。
  // 我们先后误读过两次：ceil 时 0.1 被抬成 0.5（与 0.5 重合）、floor 时 0.1 变成 0（与 0 重合），
  // 两种都让「0.1 和 0.2 看不出区别」。
  // **只对齐位移量，不复刻上游的实现副作用**：上游为了让砖块保持半砖对齐，会把行首 ceil(2p) 个
  // 半砖整块丢掉（phase 0.1 时前 0.4 格波形直接消失）。我们按字符格绘制、没有砖的概念，所以
  // 波形完整画出来，只把越过波形起点的部分裁掉 —— 因此裁剪区左边界必须是 XS，不能右让留白。
  const geoSrc = read('src/editor/geometry.js');
  ok(/export function lanePeriod/.test(geoSrc) && /export function laneShift/.test(geoSrc) &&
     /export function laneChars/.test(geoSrc) && /export function cellGeo/.test(geoSrc) &&
     !/Math\.(floor|round)\(p\s*\*\s*2\)/.test(geoSrc) &&
     !/Math\.ceil\(p\s*\*\s*2\)\s*\/\s*2/.test(geoSrc) &&
     !/laneLeadTrim/.test(geoSrc),
    '行级时间标尺被改坏（period/phase 只存不画，或 phase 又被量化——0.1 会和 0 / 0.5 重合）');
  // 字符缩略图两端必须同一套几何：画布固定 28×26、y 轨道固定 5/13/21，不按 TOUCH 分叉。
  // 旧写法触摸端用 44×44 + 7/22/37，同一字符在手机与桌面高宽比不同（0.57 vs 0.68）——
  // 用户实测「嵌入卡片里的 3 和编辑页的 3 设计不一样」。命中区大小是另一回事，由按钮盒子给。
  ok(/CHIP_W:\s*28/.test(geoSrc) && /CHIP_H:\s*26/.test(geoSrc) &&
     /chipGlyph\(v\)\{ return waveGlyph\(v,null,0,5,13,21,CHIP_W/.test(waveSrc) &&
     !/TOUCH\?7:5|TOUCH\?22:13|TOUCH\?37:21/.test(waveSrc),
    '字符缩略图按指针分叉或画布尺寸被改（同一字符会在嵌入卡片与编辑页画出不同形状）');
  // laneShift 必须**原样**返回相位值，两条都重要：
  //   ① 不量化（出现 round / floor / ceil 就又回到「0.1 与 0 重合」的老毛病）；
  //   ② 不把负值抹成 0 —— 负相位是「整行右移」，上游 `render-wave-lane.js` 的 xoffset
  //      对负值走 `-2p` 分支、且不吞整数部分（0.16.0 实测）。
  // 判据取函数体而不是整行字面量：写法可以变，「不许量化 / 不许抹负」这两条语义不变。
  {
    const body = (/export function laneShift\s*\(l\)\s*\{([\s\S]*?)\n\}/.exec(geoSrc) || [null, ''])[1];
    ok(!!body && !/Math\.(round|floor|ceil)/.test(body) && !/\bp\s*>\s*0\b/.test(body),
      'laneShift 又量化了相位、或把负相位抹成 0（正向 0.1 会与 0 重合；负向整行不再右移）');
  }
  ok(/var P=lanePeriod\(l\), sh=laneShift\(l\), cw=P\*CELL, chars=laneChars\(l,N\)/.test(shapesSrc) &&
     /clipPath id="lclip-'\+\w[^"]*"><rect x="'\+XS\+'"/.test(shapesSrc) &&
     /cellGeo\(l,i\)/.test(shapesSrc) && /lclip-/.test(shapesSrc) &&
     /COLS=Math\.max\(COLS, laneChars\(l,N\)\*lanePeriod\(l\)\)/.test(shapesSrc),
    'period/phase 未接入绘制（格宽 / 起点 / 画布宽度 / phase 裁剪）');
  // 0.15.2：桌面右侧不再为已删的行工具 / 列按钮留位（`W = ACT_X + ACT_W + PAD`）。
  // ACT_W 一旦被加回去，画布就比内容宽出一截，小视口里变成一段能横向滚过去的空白。
  // 判据取上限而不是字面量：触摸端 24 是幽灵列头的余量，桌面不该超过它。
  {
    const m = /ACT_W:\s*TOUCH \? (\d+) : (\d+)/.exec(geoSrc);
    ok(!!m && +m[1] <= 24 && +m[2] <= 24,
      '桌面右侧又给控件留了位（ACT_W 应 ≤ 24）：' + (m ? m[0] : '未匹配到 ACT_W'));
  }

  // 相位模式（0.13.0 起，0.14.5 改成「直接抓波形」）：必须是「按需出现」的 —— 只有
  // state.phaseEdit 指向的那一行才画标记，默认文档里一个额外图元都不能有（否则会把每次
  // redraw 的指纹与 DOM 断言全搅乱）。0.14.5 之后这块只是**淡底 + 刻度 + 读数**，
  // 命中一律穿透（pointer-events:none），拖动由「按下的行」判定 —— 所以也不再需要
  // data-maxv 那种「尺子几何」。
  ok(/if\(state\.phaseEdit&&state\.phaseEdit\.lane===l\.id\)\{/.test(shapesSrc) &&
     /class="phaseTrack" data-lane="'\+l\.id\+'"/.test(shapesSrc) &&
     /class="phaseTrack" data-lane="'\+l\.id\+'" x="'\+XS\+'"/.test(shapesSrc) &&
     /pointer-events="none"/.test(shapesSrc),
    '相位模式的标记要么消失了、要么变成常驻图元了（应只在 state.phaseEdit 指向的行上画）');
  // 0.14.5：**波形本身就是抓手** —— 不许再有滑块 / 轨道 / 原位线那些控件图元，
  // 也不许回到「按下即定位」的绝对值换算（那样手指一按波形就先跳一下）。
  ok(!/phaseKnob|phaseOrigin|phaseFill/.test(shapesSrc) && !/phaseValueAt/.test(interSrc) &&
     /var v=pe\.gest0-dx\/G\.CELL/.test(interSrc) && /PHASE_DEAD/.test(interSrc),
    '相位拖动退回了「滑块 + 按下即定位」（应该是抓着波形本身做相对位移）');
  // 方向（0.14.4 翻正、0.14.5 改抓波形后守恒）：phase 的语义是「整行左移 phase 个周期」。
  // 现在直接拿波形当抓手：`v = gest0 - dx/CELL` —— 手往右拖(dx>0) → v 变小 → 波形右移，
  // 手与波形始终同向，不再需要靠尺子端点对齐方向。0.14.4 那版用的是 `maxV-(x-x0)/CELL`
  // 配绘制层 `(pmax-pcur)` 的成对换算；0.14.5 删掉滑块后那套已不成立，锁也换成下面这一条。
  ok(/var v=pe\.gest0-dx\/G\.CELL/.test(interSrc),
    '相位拖动的方向约定被改回去了（手指往右拖，波形应该往右移 = 相位变小）');
  // 拖动期间的提交必须是 skipUndo（一次手势最后合并成一步）；步长要读 PHASE_STEP，
  // 不能就地写死 0.5 —— 之前 phase 的量化教训就是「散落的魔法数」。
  ok(/ctx\.commit\(\{t:'setPhase',lane:pe\.lane,v:v\},'phase → '\+v,true,true\)/.test(interSrc) &&
     /function flushPhaseStep\(\)/.test(interSrc) &&
     /PHASE_STEP/.test(interSrc) && !/phaseStep\s*=\s*0\.5/.test(interSrc),
    '相位尺的撤销粒度被改坏（拖动中的提交必须 skipUndo、收尾合并成一步）');
  // 键盘方向跟着拖动走：← 让波形左移（phase 变大），→ 让波形右移（phase 变小）。
  ok(/var step=\(pk==='ArrowLeft'\?1:-1\)/.test(interSrc),
    '键盘 ←/→ 的方向与拖动不一致（会变成「一个键左移、另一个也左移」的混乱）');

  // ---- 0.14.6：相位的两条入口分工 —— 数值在行名、拖拽在上下文条 ----------------
  // 改「一个数」：行名旁的 φ 徽标弹就地输入（Enter 确认 / Esc 取消），有键盘就一步到位。
  // 改「一种手感」：上下文条的 φ 按钮进拖拽模式，进去之后在波形上横拖。
  // 两条路必须同时存在 —— 少一条就是要么丢掉精确输入，要么丢掉「拖着看波形怎么挪」。
  const touchPhaseSrc = read('src/editor/touch.js');
  ok(/if\(c\.meta\)\{[\s\S]{0,400}?openRowEditor\(c\.lane,c\.meta\)/.test(interSrc) &&
     !/if\(c\.meta==='phase'\)\s*openPhaseEdit/.test(interSrc),
    '行名旁的 φ 徽标退回了「进拖拽模式」（应改成就地输入一个精确值）');
  ok(/case 'phase':[\s\S]{0,200}?ctx\.openPhaseEdit/.test(touchPhaseSrc),
    '上下文条的 phase 按钮没接到图形化拖拽（那条入口会整条消失）');
  // 触摸端：相位模式里行尾的 φ 读数是可点入口 —— 小卡片里 0.1 个周期只有 3~4px，
  // 光靠拖分不出来，必须留一条「敲数字」的路。
  // 触摸端：φ / T 两个字形的**放大命中区**必须都存在、且各带自己的 data-act。
  // 字形本身只有 8~10px，手指点不准；合成一块就分不出「点 φ 改相位」与「点 T 改周期」。
  // （0.17.0 前这里是「行尾相位读数」的命中区，读数与行名旁的 φ 重复，已删。）
  ok(/class="laneMetaHit" data-act="phase"/.test(shapesSrc) &&
     /class="laneMetaHit" data-act="period"/.test(shapesSrc) &&
     /classList\.contains\('laneMetaHit'\)/.test(interSrc),
    '触摸端 φ / T 不再是可点入口（精确值那条路被堵死）');
  // 锚点：laneMeta 必须同时带 data-act 与 data-lane —— data-lane 是就地输入框的定位依据
  // （openRowEditor 靠它在行里找锚点），漏了输入框就不出现。
  ok(/class="laneMeta" data-act="(?:phase|period)" data-lane="/.test(shapesSrc),
    'laneMeta 丢了 data-lane 锚点（就地输入框会找不到位置）');

  // 第七个参数是「这一格有多宽」：period≠1 的行按 period×CELL 传（渲染层自己的标尺），
  // 仍不得掺入 viewW / scrollLeft 这类操作层变量。
  ok(/waveGlyph\(w,prevCh,x0,yT,yM,yB,cw,/.test(shapesSrc) && /var P=lanePeriod\(l\), sh=laneShift\(l\), cw=P\*CELL/.test(shapesSrc),
    'waveGlyph 调用参数被改动（应传该行的格宽 cw = period×CELL，不得掺入操作层的排版变量）');
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
  // 分享面板的可选入口（0.24.0）：两个勾选框，勾上后**两种形态**都要把开关写出去
  // （script → data-src / data-snippet，iframe → &src=1 / &snippet=1）。
  ok(/data-opt="src"/.test(shareSrc) && /data-opt="snippet"/.test(shareSrc) &&
     /data-src="1"/.test(shareSrc) && /&src=1/.test(shareSrc) &&
     /SNIPPET_EXPLICIT/.test(shareSrc),
    '分享面板缺少「源码视图 / 嵌入代码」勾选框，或片段没把开关写出去');
  // 行头 / 列头（0.25.0）：借表格的读法 —— 行名区是独立命中带、列头悬停预览整列、
  // 选中分层（格 → 只点亮格；行 → 整行底衬）。判据咬结构，不咬具体像素。
  ok(/class="laneHead/.test(shapesSrc) && /class="colBand/.test(shapesSrc) &&
     /rowSel = state\.selLane === l\.id && !cellSel/.test(shapesSrc),
    '行头 / 列高亮带缺失，或选中格又顺带铺满了整行（行/列/格的层次读不出来）');
  ok(/laneHead/.test(interSrc),
    '行头没有接进命中判定（点了没反应）');
  ok(/\.laneHead:hover\{fill:var\(--hover\)\}/.test(cssSrc) &&
     /\.colhead:hover \.colBand\{fill:var\(--hover\)\}/.test(cssSrc),
    '行头 / 列头缺少悬停预览（表格式交互的关键反馈）');
  // 六点把手（0.25.0，对齐 Obsidian 表格）：不选中不显示；拖动 = 移动行 / 列。
  ok(/class="hnd hndRow"/.test(shapesSrc) && /class="hnd hndCol"/.test(shapesSrc) &&
     /state\.selCell\.tick===c/.test(shapesSrc),
    '行 / 列六点把手缺失，或没跟随「当前格」出现');
  ok(/startHandDrag/.test(interSrc) && /endHandDrag/.test(interSrc) && /dropLine/.test(interSrc),
    '把手的拖拽链路缺失（按下 / 落点线 / 松手提交）');
  ok(/case 'moveTick'/.test(read('src/core/ir.js')) &&
     /op\.to!==undefined/.test(read('src/core/ir.js')),
    '底层缺少整列移动，或行移动不支持绝对目标（拖拽会退回两两交换）');
  ok(/\.hnd\{cursor:grab\}/.test(cssSrc) && /\.dropLine\{/.test(cssSrc),
    '把手缺少 grab 光标或落点指示线样式');
  // 顶栏按钮表来自 cap.js（HUD_ITEMS 里有 embed），渲染在 touch.js 的 renderTopbar
  ok(/'embed'/.test(read('src/editor/cap.js')) && /TOP_META/.test(read('src/editor/touch.js')),
    '顶栏未提供嵌入代码入口');

  // ---- 两视图切换（波形 / 双栏）：0.25.0 取消「只代码」，顶栏三段控件收成一个切换键 ----
  // ① 状态层：合法值只剩 diagram/both，视图切换走 view:toggle（未发布，不做旧值兼容）。
  // 判据咬 currentView/setView 的实现与 doCmd 的分支，不咬注释。
  ok(/function currentView\(\)/.test(editorSrc) && /function setView\(v\)/.test(editorSrc) &&
     /VIEWS\s*=\s*\{\s*diagram:1,\s*both:1\s*\}/.test(editorSrc) &&
     /view:\s*SRC \? \(dom\.isEmbed \? 'diagram' : 'both'\) : 'diagram'/.test(editorSrc),
    '状态层视图有误：合法值应只有 diagram/both，切换走 view:toggle');
  // 默认值依赖 dom.isEmbed —— 必须真的从 main.js 传进来（曾漏传，只读嵌入卡默认成 both、
  // 露出可编辑代码框）；嵌入壳再显式设一次 diagram 作双保险。
  ok(/isEmbed:\s*EMBED/.test(read('src/main.js')) &&
     /ctx\.setView\('diagram'\)/.test(embedSrc),
    '嵌入卡的「默认只图形」没有落地：main.js 未传 isEmbed，或嵌入壳未显式复位 diagram');
  ok(/act==='view:toggle'/.test(editorSrc) && /setView\(act\.slice\(5\)\)/.test(editorSrc) &&
     !/view:code/.test(editorSrc),
    'doCmd 未提供视图切换键 view:toggle，或「只代码」命令还在');
  // ② 能力表：view 进 HUD_ITEMS，且嵌入卡片不过滤它（hudCmds 只滤 layout / embed）。
  var capSrc = read('src/editor/cap.js');
  ok(/\['undo', *'redo', *'layout', *'view', *'embed'\]/.test(capSrc) &&
     /if \(c === 'layout'\) return !inCard && SRC;/.test(capSrc) &&
     /if \(c === 'view'\) return SRC;/.test(capSrc) &&
     /if \(c === 'embed'\) return SNIPPET;/.test(capSrc),
    '顶栏重型入口没走开关：layout/view 应受 SRC 控制、embed 应受 SNIPPET 控制');
  // ③ 顶栏渲染：**一个**切换键（data-cmd=view:toggle），符号固定 { }、靠颜色表达状态，切视图要触发重建。
  var touchViewSrc = read('src/editor/touch.js');
  ok(/var VIEW_TXT = '\{ \}'/.test(touchViewSrc) && /var VIEW_NAME = \{/.test(touchViewSrc) &&
     /'data-cmd', *'view:toggle'/.test(touchViewSrc) &&
     /\.topbar \.viewBtn\{[^}]*color:var\(--muted\)/.test(cssSrc) &&
     /aria-pressed', *view === 'both'/.test(touchViewSrc) &&
     /\|' *\+ *view;/.test(touchViewSrc) &&
     !/VIEW_SEGS/.test(touchViewSrc),
    '顶栏的视图键不是「{ } + 灰/亮」这一套，或切视图不触发重建（视图键未进 renderTopbar 的 key）');
  // ④ CSS：data-view 控制 pane 显隐（只剩 diagram）；「只代码」那套规则必须已经下线，
  //    否则 app 上写着 code 时会只剩源码区、可 state 已经不认这个值了。
  ok(/\.app\[data-view="diagram"\] \.pane\.src\{display:none\}/.test(cssSrc) &&
     !/data-view="code"/.test(cssSrc) &&
     !/\.is-embed \.pane\.src\{display:none!important\}/.test(cssSrc),
    '视图显隐 CSS 不对：「只代码」规则应已删除，且 diagram 态要藏掉源码 pane');
  // ⑤ 嵌入退出编辑强制复位 diagram（否则只读卡片露出可编辑代码框）。
  ok(/!on && ctx\.setView/.test(embedSrc) && /ctx\.setView\('diagram'\)/.test(embedSrc),
    '嵌入退出编辑未复位到只图形视图：只读卡片会露出可编辑代码框');
  // ⑥ 开关层（ui.js）：重型入口默认「独立页开 / 卡片关」，可被 URL 覆盖，
  //    并由 embed.js 从 data-src / data-snippet 转发 —— HTML 用法也能打开。
  var uiSrc = read('src/editor/ui.js'), embedJsSrc = read('embed.js');
  ok(/export var SRC = flag\('src', !EMBED\)/.test(uiSrc) &&
     /export var SNIPPET = flag\('snippet', !EMBED\)/.test(uiSrc),
    'ui.js 的默认值不对：应以「是否嵌入」为默认（独立页开、卡片关）');
  ok(/data-src/.test(embedJsSrc) && /data-snippet/.test(embedJsSrc) && /&src=1/.test(embedJsSrc),
    'embed.js 没把 data-src / data-snippet 转成 URL 参数（宿主无法打开重型入口）');
  // ⑥ 双栏视图给 iframe 上报最小高度（单行波形的卡片切到双栏时，代码框不能矮到没法写）。
  ok(/view === 'both'/.test(embedSrc) && /Math\.max\(content, *220\)/.test(embedSrc) &&
     !/view === 'code'/.test(embedSrc),
    '双栏视图缺少最小高度上报（或「只代码」分支还留着）：单行波形的卡片切到双栏后没法写代码');
  // ⑦ 双栏视图两个坑（用户实测「双栏看不到代码区」）：
  //    a) .is-embed .app 只定义单行 grid，必须给 both 显式两行，否则源码 pane 被挤到 2px；
  //    b) 高度上报必须给 both 留两行空间，否则宿主 iframe 只够一行。
  ok(/\.is-embed \.app\[data-view="both"\]\s*\{\s*grid-template-rows:\s*minmax\(0,1fr\)\s+minmax\(0,1fr\)/.test(cssSrc),
    '嵌入双栏缺少显式两行 grid：源码 pane 会被挤成 2px（看不到代码区）');
  ok(/view === 'both'/.test(embedSrc) && /Math\.max\(content, *220\) \* 2/.test(embedSrc),
    '双栏视图高度上报没留两行空间：宿主 iframe 只够一行、源码被挤没');
  // 嵌入只读卡片必须按容器宽度等比缩小：否则 320/360px 手机上只能看到半张波形，
  // 而读者不会去横向拖一张只读卡片。缩放只改 svg 渲染尺寸，viewBox 保持内部坐标。
  // 缩放规则（2026-11-14 起）：内容比容器宽就等比缩到容器宽，只改 svg 渲染尺寸，
  // viewBox 保持内部坐标。只读卡片允许放大到 2× 铺满；触摸端与卡片的编辑态只缩不放大
  // （不再「进编辑退回 1:1」—— 那会让手指底下的内容跳一次）；桌面整页保持 1:1。
  // 不用 `var fit=` 这类字面量，格式一动就失效（踩过）。
  ok(/var rawFit = viewW/.test(shapesSrc) &&
     /Math\.min\(2, rawFit\)/.test(shapesSrc) &&
     /Math\.min\(1, rawFit\)/.test(shapesSrc) &&
     /state\.fit = outW \/ W|state\.fit=outW\/W/.test(shapesSrc),
    '缩放规则不完整：只读卡应可放大 2×、触摸/卡片编辑态应只缩不放大，且 state.fit 记真实渲染比');
  // 坐标换算不得再假设 1:1：屏幕坐标 → 用户坐标必须走 viewBox 比例
  ok(/function svgXY\(/.test(read('src/editor/interactions.js')) &&
     /vb\.width\s*\/\s*r\.width/.test(read('src/editor/interactions.js')),
    '连线预览缺少「屏幕坐标 → SVG 用户坐标」比例换算（缩放后预览会偏移）');
  // 只缩不放会导致宽笔记里左右各留一条（卡片宽度 > 画布宽时 fit 被 1 卡住），
  // 所以现在按卡片宽铺满、上限 2 倍；viewBox 仍必须是内部坐标，几何与就地编辑换算才不错位。
  // viewBox 必须是内部坐标，缩放只改渲染尺寸 —— 这样图元几何、getBBox 与就地编辑的
  // 换算都不受影响，波形层指纹也不会因缩放而变。
  ok(/viewBox="0 '\+vbTop\+' '\+W\+' '\+vbH\+'"/.test(shapesSrc) &&
     /var outW = zoom === 1 \? baseOutW : Math\.round\(baseOutW \* zoom\)/.test(shapesSrc),
    '缩放未保持 viewBox 为内部坐标（图元几何与就地编辑坐标会错位）');
  // 只读卡片不能追加周期，末尾那一列也没有任何波形内容 —— 必须整列不画
  // （否则只留一个空编号框，悬停还会露出一个点不动的 +，且右侧白占一格宽度）。
  // 列号 + 列操作整组都是「编辑定位器」，只读卡片一律不画（上游 WaveDrom 也从不画列号）。
  // 判据改成直接读能力表：比在源码里找 `if(!state.readonly)` 这种字面量稳 —— 以后把
  // 判据重命名 / 换写法都不会误报，而「只读卡片多了个编辑入口」一定报。
  ok(!Cap.can('colhead','deskView') && !Cap.can('colhead','touchView'),
    '只读态仍在画列号（能力表 colhead 在两个 View 场景应为 off）');
  ok(!Cap.can('colAct','deskView') && !Cap.can('colAct','touchView'),
    '列操作按钮未在只读态关闭');
  // 总口径：只读场景下，所有「编辑入口」能力都必须是 off —— 只读 = 编辑态渲染减去控件。
  // 任何一条漏关，这里就报；新增能力也会被这条兜住（表里不写就没有默认值）。
  {
    const editEntries = ['hud','colhead','colAct','rowTool','laneMeta','spacerMark','dock','tbpanel','inlineEdit'];
    const leak = editEntries.filter((n) => Cap.can(n,'deskView') || Cap.can(n,'touchView'));
    ok(leak.length === 0, '只读卡片仍启用了编辑入口：' + leak.join(' / '));
    // 就地编辑四场景同语义（桌面双击 / 触摸双敲），长按是叠加而非替代 —— 不该出现 swap。
    ok(Cap.can('inlineEdit','deskEdit') && Cap.can('inlineEdit','touchEdit') &&
       !Cap.isSwap('inlineEdit','deskEdit') && !Cap.isSwap('inlineEdit','touchEdit'),
      '就地编辑在桌面 / 触摸应同为 on，且不是 swap');
    // 格级动作（数据标签 / 节点锚点 / 连线）0.18.0 从上下文条挪到字符停靠条左侧，
    // 清单改名 `ACTS.dock`。原先它只有桌面能用（画布上的 ✎ 徽标），那是 CAP 里最后一处 swap。
    ok(Cap.ACTS.dock.length === 3 && Cap.ACTS.dock.indexOf('label') >= 0 &&
       Cap.ACTS.dock.indexOf('node') >= 0 && Cap.ACTS.dock.indexOf('link') >= 0,
      '格级动作清单缺失（应为 label / node / link，归在 ACTS.dock）');
    ok(!Cap.ACTS.cell, '格级动作仍留在上下文条（应已挪到停靠条左侧，ACTS.cell 不应存在）');
    ok(Cap.ACTS.row.indexOf('link') >= 0 && Cap.ACTS.col.indexOf('link') >= 0,
      '行 / 列动作未带上连线按钮（link 应与 label / node 同排，四套场景都带）');
    const swaps = Object.keys(Cap.CAP).filter((n) =>
      Cap.isSwap(n,'deskEdit') !== Cap.isSwap(n,'touchEdit'));
    ok(swaps.length === 0, '桌面与触摸仍有能力差异（swap 标注不一致）：' + swaps.join(' / '));
    ok(!Cap.CAP.cellLabel, 'cellLabel 徽标能力应已删除（改走 ACTS.dock）');
  }
  // 0.19.0：三组动作清单都必须**经过可用性过滤**才能进渲染 —— 直接原样喂给渲染
  // 就是「先把按钮画出来、点了才弹错误」，那是本版要消灭的体验。
  // 判据看「有没有那道 filter」，不锁具体表达式；再单独确认格子判据里真的查了总线字符
  // （label 只对总线格有意义，这是 openLabelEditor 的守卫条件）。
  {
    const t = read('src/editor/touch.js');
    ok(/COL_ACTS\.filter\(availCol\)/.test(t) && /ROW_ACTS\.filter\(availRow\)/.test(t) &&
       /DOCK_ACTS\.filter\(availCell\)/.test(t) &&
       /function availCell/.test(t) && /function availRow/.test(t) && /function availCol/.test(t) &&
       /Core\.BUS\.test\(sl\.w\)/.test(t) && /\.point/.test(t) && /\.gap/.test(t),
      '动作没有按可用性过滤（不可用的按钮又会被画出来，点了只能弹错误）');
    // 缓存键必须带上可用集：同一格把字符从 `0` 改成 `=` 之后 label 由隐藏变可用，
    // 只看「哪一格」会跳过重建、按钮停在旧状态。
    ok(/ctxActKey/.test(t) && /acts\.join\(','\)/.test(t),
      '面板缓存键没带上「可用动作集」（改完字符后按钮不会更新）');
  }
  ok(/var roW=Math\.max\(ACT_X\+PAD, 360\)/.test(shapesSrc),
    '只读画布宽度仍为幽灵列预留一格（右侧会多一条空白）');
  // 只读态没有字符条，触摸引导 toast 不适用，也不该出现在英文宿主页面里
  const touchSrc = read('src/editor/touch.js');
  ok(/isReadonly && ctx\.isReadonly\(\)\) return/.test(touchSrc),
    '只读态仍会弹触摸引导 toast');

  // ---- 零常驻文字：桌面用 aria-label 替代 tooltip，触摸端用图标 + 长按出名称 ----
  // <title> 在 SVG 里必然变成浏览器 tooltip，画布层一律不允许出现。
  ok(!/<title>/.test(shapesSrc), '画布层仍在使用 <title>（会显示成 tooltip 文字）');
  // 判据不锁某一种写法（原先锁的是 `role="button" aria-label="'+esc(title)`，那是行工具 /
  // 列按钮的拼法；0.15.1 把它们删掉后，锁就变成「指着不存在的东西」）。现在逐个点数：
  // 画布上每个按钮都必须在同一标签里带上 aria-label，新增按钮漏了立刻报。
  {
    const btns = (shapesSrc.match(/role="button"/g) || []).length;
    const labeled = (shapesSrc.match(/role="button"[^>]*aria-label="/g) || []).length;
    ok(btns > 0 && btns === labeled,
      '画布按钮缺少 aria-label（视觉无文字时读屏会失去名称）：' + btns + ' 个按钮 / ' + labeled + ' 处命名');
  }
  ok(/b\.setAttribute\('aria-label', 'Write ' \+ name\)/.test(touchSrc),
    '字符停靠条缺少 aria-label');
  // 0.15.1：画布上的行工具 / 列按钮 / SVG 字符条已删净 —— 渲染函数、命中分支、CSS 一起消失，
  // 全部改由上下文条（#tbpanel）承担。这里焊死，防止只加回一半：加了 `rowTools` 却没恢复
  // CSS（画出来是裸的）、或恢复了命中分支却没人产生那种命中（又是一条死路）。
  ok(!/rowTools|rowCtl|rowHint|'rowTool'/.test(shapesSrc) &&
     !/rowTool|colActBtn|charChip/.test(interSrc) &&
     !/\.rowCtl|\.rowHint|\.rowTool\b|\.colAct\b|\.colActBtn|\.charChip|\.chipWave/.test(cssSrc),
    '已删除的画布控件又长回来了（行工具 / 列按钮 / SVG 字符条）');
  // 触摸端：操作栏 4 个符号、标签页 2 个图标，上下文条随选中对象自动切换
  ok(!/data-panel=/.test(html), '触摸操作栏仍保留「对象 / 列」文字面板入口');
  ok(touchSrc.indexOf("className = 'ctxbtn'") >= 0 && /function renderContext/.test(touchSrc),
    '触摸端缺少上下文图标条（renderContext / ctxbtn）');
  // 底部三排（格 / 行 / 列）展示逻辑必须一致：溢出一律进下方的「⋯」区（0.25.0 定稿）。
  // 格级那排住在字符停靠条里，行 / 列在上下文条里，两处都靠 syncMoreHeight 把高度并进 --more-h。
  ok(/ctxMoreOpen/.test(touchSrc) && /tbmoreEl/.test(touchSrc) &&
     /syncMoreHeight\(\);/.test(touchSrc) &&
     /id="tbmore"/.test(html) && /id="charmore"/.test(html),
    '行列上下文条的溢出没有走下方「⋯」区（应与字符停靠条同一套：tbmoreEl + syncMoreHeight）');
  // 都不需要专门的关闭按钮：格级停靠条原先末尾的 ✕ 已删（取消选中走点画布空白 / Esc）。
  ok(!/data-clear/.test(touchSrc) && !/chipbtn\.clear/.test(cssSrc) && !/chipbtn\.clear/.test(touchSrc),
    '格级停靠条又长出 ✕ 关闭按钮（三排都不该有专门关闭按钮）');
  ok(/function bindLongName/.test(touchSrc) && /data-name/.test(touchSrc),
    '触摸端缺少「长按出名称」');

  // 手势分层（见 interaction-design.md）：触摸端「按下只是候选，抬手才确认」。
  // 这条模型一破，滑动看图就会顺手选中格子 / 弹面板 —— 也就是作者反馈的「移动与编辑冲突」。
  const gestureSrc = read('src/editor/interactions.js');
  ok(/function confirmTap\(/.test(gestureSrc) && /press=\{x:/.test(gestureSrc),
    '触摸端缺少 tap 确认模型（按下只记候选，抬手才执行）');
  // 判据看**行为**不看字面量写法：两轴都要有 12px 容差，且越线时同时作废 tap 候选与长按计时。
  ok(/Math\.abs\(cx-press\.x\)>12\|\|Math\.abs\(cy-press\.y\)>12/.test(gestureSrc) &&
     /press=null; clearLong\(\);/.test(gestureSrc),
    '触摸端滑动超过 12px 未作废候选 tap（或只判了一个轴）');
  ok(/if\(!x&&!y\)\{ x=p\.x; y=p\.y; \}/.test(gestureSrc),
    '抬手事件缺坐标时未回退到按下坐标（会把正常点按误判为滑动）');
  // 触摸后浏览器补发的兼容鼠标事件必须按「来源」判断，不能只靠时间窗：
  // 长按 >800ms 再抬手时窗口已过期，合成 mousedown 会被当成桌面点击。
  ok(/firesTouchEvents/.test(gestureSrc) && /function syntheticMouse\(/.test(gestureSrc),
    '触摸端未按 sourceCapabilities 识别合成鼠标事件（长按抬手会被当成一次点击）');
  // 触摸端长按打开的就地编辑框，不能被「焦点被画布抢走」导致的 blur 关掉
  ok(/Date\.now\(\)-openedAt<1200/.test(gestureSrc) && /inp\.focus\(\)/.test(gestureSrc),
    '就地编辑框缺少焦点抢回逻辑（触摸端一抬手输入框就消失）');
  // ---- 手势记账必须能自愈（0.14.3）-------------------------------------------
  // 真机上抬手事件会丢（系统手势 / 切后台 / 捕获丢失 / 全屏切换）。旧实现靠「pointerId
  // 记账里有几条」判断是不是第二根手指，一旦漏收一次 up，之后每次按下都被当成第二根手指
  // 而直接 return —— 画布从此对一切点按与拖动无反应（用户实测：尺子拖不动、点行没反应）。
  // 三条结构性要求，缺一条就会把整块画布锁死：
  //   ① 第二根手指用 PointerEvent 自带的 isPrimary 做权威判据（不能只看记账）；
  //   ② 手指滑出画布后仍要收到坐标 —— move/up/cancel 必须装在 document 上（capture），
  //      只挂 wrap 的话一滑出去事件就断，表现为「按下去跳到一个值，之后拖不动」；
  //   ③ 必须有清账兜底（捕获丢失 / 失焦 / 页面隐藏 / 手势间隔过长）。
  ok(/isPrimary===false&&tCount\(\)>1/.test(gestureSrc),
    '第二根手指的判定没有用 isPrimary（记账一旦漏收抬手，整块画布会锁死）');
  ok(/document\.addEventListener\('pointermove',function\(e\)\{[\s\S]{0,80}tActive/.test(gestureSrc) &&
     /document\.addEventListener\('pointerup',endPointer,true\)/.test(gestureSrc) &&
     /document\.addEventListener\('pointercancel'/.test(gestureSrc),
    '手势的 move / up / cancel 没有装在 document 上（手指滑出画布后拖动会断）');
  ok(/function tReset\(/.test(gestureSrc) && /lostpointercapture/.test(gestureSrc) &&
     /visibilitychange/.test(gestureSrc) && /T_GAP/.test(gestureSrc) && /T_HOLD/.test(gestureSrc),
    '手势记账缺少自愈（捕获丢失 / 失焦 / 页面隐藏 / 间隔过久都没有清账）');
  // setPointerCapture 传到的是一个「有 pointerId 的事件」：以前的 shim 没带 pointerId，
  // 这句捕获从来没生效过（注释说着生效，实际一次都没跑）。
  ok(/pointerId:e\.pointerId/.test(gestureSrc) && /wrap\.setPointerCapture\(e\.pointerId\)/.test(gestureSrc),
    '指针捕获没有真的生效（shim 丢了 pointerId）');
  // Esc 逐层：内层消费后外层不得接管
  ok(/if \(e\.defaultPrevented\) return;/.test(read('src/editor/embed-shell.js')),
    '嵌入壳未尊重内层已消费的 Esc（一次 Esc 会跨层退出）');
  // 滚动画布＝看更多：动作菜单让位。
  // 但 revealLane（把选中行滚到面板上方）自己也会触发 scroll，必须豁免那一次，
  // 否则「选中靠下的行 → 面板刚出现就被自己关掉」。
  ok(/addEventListener\('scroll'/.test(touchSrc) && /hideContext\(\)/.test(touchSrc) &&
     /selfScrollTop/.test(touchSrc),
    '滚动画布时未收起上下文条（矮卡片里会一直挡着波形）');
  ok(/Math\.abs\(ctx\.wrap\.scrollLeft - selfScrollTop\.left\)/.test(touchSrc) &&
     /Math\.abs\(ctx\.wrap\.scrollTop - selfScrollTop\.top\)/.test(touchSrc),
    '程序滚动豁免只比了纵向位置（用户横向滑动画布时面板收不起来）');

  // 纯 iframe 形态：内容靠 URL 片段带走，两种宿主共用一个编辑器页面
  const shellSrc = read('src/editor/embed-shell.js');
  ok(/iframeSnippet/.test(shareSrc) && /#wj=/.test(shareSrc),
    '嵌入面板缺少「纯 iframe」形态或其载荷片段');
  ok(/decodePayload/.test(shellSrc) && /wj/.test(shellSrc),
    '嵌入壳未读取 URL 片段载荷（无脚本宿主会退化成默认示例）');
  ok(fs.existsSync(path.join(ROOT, 'src/editor/payload.js')), '缺少载荷编解码模块 payload.js');
  // 矮卡片编辑：动作条会挤没画布 —— 进编辑时按需请求原生全屏，且只在真实手势下尝试。
  ok(/requestFullscreen/.test(shellSrc) && /userActivation/.test(shellSrc) && /isCramped/.test(shellSrc),
    '嵌入壳缺少「矮卡片进入编辑时按需请求全屏」的逻辑');
  ok(/allowfullscreen/.test(shareSrc) && /allowfullscreen/.test(read('embed.js')),
    '嵌入片段 / 加载器未放行 allowfullscreen（全屏请求会被宿主 iframe 拒绝）');
  // 全屏只为「手指」准备：细指针没有按钮折排问题，宿主页点一下就把整屏抢走反而更糟。
  ok(/import \{ TOUCH \} from '\.\/mode\.js'/.test(shellSrc) && /TOUCH && \(window\.innerWidth/.test(shellSrc),
    '矮卡片全屏未按指针类型收口（细指针嵌入卡点进编辑会抢全屏）');
  // 全屏里不能还按卡片宽压缩：图正好等于容器宽 ⇒ 没有滑动区间，宽图每格十几像素、点不中。
  ok(/state\.fsEdit/.test(shapesSrc) && /\.is-embed:fullscreen \.svgwrap/.test(cssSrc),
    '全屏编辑缺少「按 1:1 绘制 + 画布可滑动」的规则（波形图在全屏里动不了）');
  // 全屏里「完成」是唯一出口：小按钮的 click 会被滚动吞掉，必须走 pointerup 主通道 + 全屏放大避让。
  ok(/hint\.addEventListener\('pointerup'/.test(shellSrc) && /hint\.addEventListener\('click'/.test(shellSrc),
    '完成按钮缺少 pointerup 主通道 / click 兜底（全屏里点击可能被吞）');
  ok(/is-embed:fullscreen \.embedhint/.test(read('src/styles.css')) &&
     /env\(safe-area-inset/.test(read('src/styles.css')),
    '全屏编辑未放大完成按钮或未避开安全区（刘海 / 系统栏）');
  // 往返无损：这份载荷会直接进 iframe 的 src，坏一个字符整张图就没了
  ok(decodePayload(encodePayload(EXAMPLE)) === EXAMPLE, '载荷编解码往返不一致（example）');
  {
    let tricky = true;
    for (const t of ['', "{ signal: [ { name: 'a', wave: '01' } ] }", '中文注释 // ünïcode 🚀', 'x'.repeat(3000)]) {
      if (decodePayload(encodePayload(t)) !== t) tricky = false;
    }
    ok(tricky, '载荷编解码在空串 / 非 ASCII / 长文本上往返不一致');
    ok(/^[A-Za-z0-9_-]*$/.test(encodePayload(EXAMPLE)), '载荷出现需要再转义的字符（不是 base64url）');
  }
  // 压缩单行源码进入代码视图前要排成多行（data-wavejson / URL 片段塞进来的都是压缩单行）。
  // 判据：① 单行变多行且语义等价；② 已分行 / 带注释的源码原样保留（emitIR 会丢注释，不能碰）。
  {
    const min = "{ signal: [ { name: 'clk', wave: 'p....' }, { name: 'dat', wave: 'x.3x', data: ['A'] } ] }";
    const pretty = Core.formatSource(min);
    ok(pretty.indexOf('\n') >= 3, '压缩单行源码未被格式化成多行');
    ok(Core.canon(Core.buildIR(pretty)) === Core.canon(Core.buildIR(min)), '格式化后语义不等价');
    ok(Core.formatSource(EXAMPLE) === EXAMPLE, '已分行且带注释的源码被误格式化（注释会丢）');
    ok(Core.formatSource("// only comment\n{ signal: [ { name: 'a', wave: '01' } ] }").indexOf('// only comment') === 0,
      '带注释的源码被误格式化');
    ok(Core.formatSource('{ bad source') === '{ bad source', '无法解析的源码被改动');
    // 载入链路两处都要调用 formatSource（setSource 宿主指令 + hashPayload URL 片段）
    ok(/Core\.formatSource\(d\.wavejson\)/.test(shellSrc) && /Core\.formatSource\(seeded\)/.test(shellSrc),
      '嵌入载入链路未接入格式化（代码视图仍会挤成一行）');
  }
  // 动作清单已集中到 cap.js（ACTS），touch.js 只引用；两边任一处脱钩都算失败。
  // 行动作 15 个：12 个行编辑 + 分组三件套（group / spanUp / spanDown）。
  // 分组动作必须在行动作里 —— 「从 0 建组」的唯一入口就是它（组名只在组已存在时才可点）。
  ok(Cap.ACTS.row.length === 15 && Cap.ACTS.row.indexOf('name') >= 0 &&
     ['group', 'spanUp', 'spanDown'].every((k) => Cap.ACTS.row.indexOf(k) >= 0) &&
     Cap.ACTS.col.length === 5 && Cap.ACTS.col.indexOf('insert') >= 0 &&
     Cap.ACTS.row.indexOf('link') >= 0 && Cap.ACTS.col.indexOf('link') >= 0 &&
     /ROW_ACTS = Cap\.ACTS\.row/.test(touchSrc) && /COL_ACTS = Cap\.ACTS\.col/.test(touchSrc),
    '上下文动作集缺失或被改成文字面板');

  // 箭头语法（教程 Step 8）：解析 <from><shape><to>，shape 含 < > ~ - | +。
  // 判据看**机制**而不是某一行实现：形状必须是「显式表」（`-|` 与 `|-` 各登记一种，
  // 不能靠数竖线猜），箭头只能由 `<`/`>` 触发（不许默认补一个末端箭头替用户宣布方向）。
  ok(/function parseEdge\(/.test(shapesSrc) && /function arrowTri\(/.test(shapesSrc) &&
     /function edgePath\(/.test(shapesSrc) && /EDGE_SHAPES/.test(shapesSrc) &&
     /'-\|':\s*'hv'/.test(shapesSrc) && /'\|-':\s*'vh'/.test(shapesSrc) &&
     /parseEdge\(e\)/.test(shapesSrc) &&
     /if \(pe\.end\)/.test(shapesSrc) && !/!explicitArrow/.test(shapesSrc),
    'edge 形状表缺失 / 形状靠猜 / 默认补了箭头');
  // 纯 node 行（无 wave）必须保留锚点：否则引用它的 edge 找不到端点（教程 Sharp lines 样例）。
  ok(/var nn = n > 0 \? n :/.test(read('src/core/ir.js')),
    '只有 node、没有 wave 的行会丢锚点，导致 edge 找不到端点');
  // 空行（spacer）的口径来自官方教程 Step 4「Spacers and Gaps」：**就是空对象 `{}`**，
  // 没有 `{spacer: N}` 这种写法（wavedrom 3.5.0 的 lib 里没有这个字段，rec() 对任何对象都只算一行）。
  // 三条必须同时成立：① 判定为「没有 name/wave/node/data」——与上游的「一行什么都不画」一致，
  // 且不会把 `{ node: ... }` 这种只有锚点的行吃掉；② emit 时写回原文（`l.raw`），
  // 否则改组名触发全量重生成会把用户写的 `{ spacer: 20 }` 悄悄改成 `{}`；③ canon 带上原文。
  const irSrc2 = read('src/core/ir.js');
  ok(/!prop\(item,'name'\) && !prop\(item,'wave'\) && !prop\(item,'node'\) && !prop\(item,'data'\)/.test(irSrc2) &&
     /function spacerSrc\(l\)\{ return l\.raw\|\|'\{\}'; \}/.test(irSrc2) &&
     /enc\(spacerSrc\(l\)\)/.test(irSrc2) && /raw:l\.raw/.test(irSrc2),
    '空行（spacer）的判定或原文保留被改坏了（`{ spacer: 20 }` 会被改成 `{}`，或被误判成信号行）');
  // 分组可编辑（教程 Step 5 的双向缺口）：regroup 改变 groupPath，点组名 `[A/B]` 打开输入框。
  ok(/case 'regroup'/.test(read('src/core/ir.js')) && /function openGroupEditor\(/.test(read('src/editor/interactions.js')),
    '分组改名 / 重分组（regroup / openGroupEditor）缺失');
  ok(/laneGroupName/.test(shapesSrc) && /laneGroupName/.test(read('src/editor/interactions.js')),
    '分组名不可点改（缺 laneGroupName 命中或入口）');
  // 分组显示（0.9.28）：UI 必须画成上游 render-groups 那样 —— 左侧花括号 + 竖排组名，
  // 行名后缀里不再挂 `[组名]`。退回旧写法（只挂后缀不画括号）就用这条拦住。
  // 括号与命中区必须带**这一层**的完整路径（`data-group`）：只带行 id 时，点外层括号会去改
  // 该行最内层的那一段（实测点 `out` 改掉了 `out/in`）。交互层也必须按这个属性回查。
  ok(/function groupRuns\(/.test(shapesSrc) && /class="groupBrace"/.test(shapesSrc) &&
     /rotate\(-90 /.test(shapesSrc) && !/laneGroupName[^\n]*>\[' \+/.test(shapesSrc) &&
     /data-group="'\+esc\(gpath\)/.test(shapesSrc) &&
     /getAttribute\('data-group'\)/.test(interSrc),
    '分组未画成「左侧花括号 + 竖排组名」，或括号没带本层路径（点外层括号会改错层）');
  // 组路径的输入语义（0.11.1）：`/名字` = 在本层下加一层、首段等于本层名时按相对解释、
  // 清空 = 退出这一层 —— 三者都在 resolveGroupPath 里，缺一个就会退回「第二层加不了层 /
  // 写 b/c 把整组搬出父层 / 混选清空一路退到顶层」。输入框还必须**全选**：
  // 光标落在末尾时敲一个字符会粘成 `a/bc`（第二层尤其容易撞上）。
  // 「打开又关掉 = 什么都不改」（0.11.2）：预填值重新解析不一定等于原值（一级组里的行预填 `a`，
  // 单段按「加一层」解释 → `a/a`），所以必须两道闸 —— 输入值没变不提交、解析路径没变不提交。
  // 少了任何一道，点开 group rows 再取消就会凭空多一层。
  ok(/v!==ed\.initial/.test(interSrc) && /function groupPathChanged\(path,target\)/.test(interSrc) &&
     /if\(!groupPathChanged\(path,target\)\) return;/.test(interSrc),
    '就地输入又会在「没改内容」时提交（点开 group rows 再取消会凭空多一层）');
  // 组路径的输入模型（0.12.0 定稿）：**输入框里就是完整路径**，一级一段，空 = 无组。
  // 绝不允许再给「单段」加语义 —— 单段既可能是在建一级组、也可能是在退到一级组，
  // 猜哪边都会错一半（0.11.x 就先后踩过「裸名字=加层」「/名字=加层」「首段纠偏」三种推断）。
  // 加层 / 减层是输入框右侧的显式按钮（pathSteps → `+` / `−`），文本只表达结果。
  // 组路径只有一条规则：**输入框里的文本就是完整路径**（一级一段，空 = 无组）。
  // 既不许按写法推断层级，也不许在输入框旁边加「加一层 / 减一层」按钮 —— 那与直接在路径
  // 文本上编辑重复（路径本身已经是全局描述，末尾写一段就是加层、删一段就是减层）。
  ok(/function groupPathOf\(raw\)/.test(interSrc) &&
     !/bareBase|resolveGroupPath|charAt\(0\)==='\/'/.test(interSrc) &&
     !/pathSteps|inline-step/.test(interSrc) && !/\.inline-step\{/.test(cssSrc),
    '组路径重新变成「按写法推断层级」或又加了额外按钮（应只有一条：输入框文本 = 完整路径）');

  // ---- 对标审计（0.14.0）：不建模的行级内容必须原样留住 ----
  // 全量重生成（分组改名 / 增删行）会把整篇源码重排一遍。根级的 head / foot / config / gaps
  // 早就按原文保住了，**行级的 over / under 与 piece-wise wave 却会被吞掉** —— 这是同一类
  // 「我们不认识的字段就当它不存在」的 bug，只是发生在第二层。
  const PRESERVE = "{ signal: [\n  { name: 'a', wave: '01.0', over: '..2.' },\n  { name: 'p', wave: ['pw', { d: 'M 0 0 L 1 1' }] }\n], config: { hscale: 2 } }";
  const pv = Core.buildIR(PRESERVE);
  ok(pv.lanes[0].extras.length === 1 && pv.lanes[0].extras[0].key === 'over',
    '行级未建模属性（over / under）没被收集，全量重生成会把它删掉');
  ok(typeof pv.lanes[1].waveRaw === 'string' && pv.lanes[1].waveRaw.indexOf("'pw'") >= 0,
    'piece-wise 的数组 wave 没保留原文');
  const pvOut = Core.emitIR(pv);
  ok(/over:\s*'\.\.2\.'/.test(pvOut) && pvOut.indexOf("['pw'") >= 0,
    '全量重生成丢掉了行级原文：' + pvOut.replace(/\s+/g, ' ').slice(0, 120));
  ok(Core.canon(Core.buildIR(pvOut)) === Core.canon(pv),
    'I1 不成立（行级 extras / waveRaw 没进 canon）');
  // 反过来：用户真的按字符改了那一行，就该如实写回字符序列，而不是继续写旧路径
  ok(Core.emitIR(Core.applyOp(pv, { t: 'setSlot', lanes: [pv.lanes[1].id], tick: 2, v: '1' })).indexOf("['pw'") < 0,
    'piece-wise 行改过字符后仍写回旧路径（改动看起来没生效）');
  ok(pv.config && pv.config.hscale === 2, 'config 没有解析出来（hscale 无法影响渲染）');
  // hscale 只在渲染层生效：clamp 到 1..8，非数字 / 0 / 负数 → 1
  ok(hscaleOf({ config: { hscale: 3 } }) === 3 && hscaleOf({ config: { hscale: 99 } }) === HSCALE_MAX &&
     hscaleOf({ config: { hscale: 0 } }) === 1 && hscaleOf(null) === 1 && hscaleOf({ config: {} }) === 1,
    'config.hscale 的取值口径不对（应 clamp 1..' + HSCALE_MAX + '）');
  // 数字组名（`[1, {…}]`）是合法 WaveJSON，不能被读成「没有名字的组」
  ok(Core.buildIR("{ signal: [[1, { name:'a', wave:'01' }]] }").lanes[0].groupPath[0] === '1',
    '数字组名被丢弃');
  // 报错要指向下一步：reg 是另一种图，不是「坏掉的时序图」
  try { Core.buildIR('{ reg: [{ bits: 3 }] }'); ok(false, 'reg 图没有报错'); }
  catch (e) { ok(/register diagram/.test(e.message), 'reg 图的报错口径不清：' + e.message); }
  try { Core.buildIR('{ signal: {} }'); ok(false, 'signal 不是数组却没报错'); }
  catch (e) { ok(/signal must be an array/.test(e.message), 'signal 类型报错口径不清：' + e.message); }

  // ---- 英文优先：运行时字符串不得出现中日韩字符（注释不算） ----
  const runtimeFiles = ['src/editor/shapes.js', 'src/editor/interactions.js',
    'src/editor/touch.js', 'src/editor/index.js', 'src/editor/share.js',
    'src/editor/embed-shell.js', 'src/editor/waveform.js', 'src/editor/mode.js',
    'src/editor/geometry.js', 'src/editor/payload.js', 'src/editor/ui.js', 'src/main.js',
    'src/core/example.js', 'src/core/util.js', 'embed.js'];
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
  // 聚合成**一条**断言：以前每个 import 各算一条，于是「删掉一个未使用的 import」会让总数变少，
  // 报出来的 n/n 不稳定、也没人知道到底少的是哪一类检查。判据本身不变。
  const broken = [];
  for (const file of modules) {
    const src = read(file);
    const re = /(?:from|import)\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;   // 无第三方运行时依赖；裸说明符交给浏览器报错
      const target = path.resolve(path.dirname(path.join(ROOT, file)), spec);
      if (!fs.existsSync(target)) broken.push(file + ' → ' + spec);
    }
  }
  ok(broken.length === 0, '存在失效的相对 import：' + broken.slice(0, 3).join('；'));

  // 运行时文件里不得出现「导入了但没用」的名字（0.14.0 清掉 6 个：EMBED / chipGlyph / chipDesc /
  // esc / cut / Core）。这类残留不会报错，只会在读代码时制造「它好像有别的用途」的错觉。
  const idle = [];
  for (const file of modules) {
    const src = read(file);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const im = /import\s*\{([^}]*)\}\s*from/g;
    let g;
    while ((g = im.exec(code)) !== null) {
      for (const raw of g[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (!name) continue;
        if (code.split(new RegExp('\\b' + name + '\\b')).length - 1 <= 1) idle.push(file + ' → ' + name);
      }
    }
  }
  ok(idle.length === 0, '存在导入了但没用的名字：' + idle.slice(0, 4).join('；'));
}

try {
  check();
  console.log('TimingBench selfcheck OK · ' + passed + '/' + passed + ' 断言通过');
} catch (e) {
  console.error('TimingBench selfcheck FAILED · ' + passed + ' 断言通过后：' + e.message);
  process.exit(1);
}
