// 时序图 SVG 结构：HUD / 列头 / 行工具 / 数据标签徽标 / 弧线 /
// 候选字符条 / redraw。只负责「把 state 画成图」，不处理事件、不回写源码。
import { Core } from '../core/ir.js';
import { G, lanePeriod, laneShift, laneChars, cellGeo, hscaleOf, PHASE_MAX } from './geometry.js';
import { esc, cut } from '../core/util.js';
import { TOUCH } from './mode.js';
import * as Cap from './cap.js';
import { waveGlyph, waveGap, busClassOf, fitLabel } from './waveform.js';

var T=TOUCH;   // 本模块内的 T 只表示 coarse 指针标志（波形图元里的 T 是上沿 y 坐标，已移到 waveform.js）
// 基准格宽（桌面 38 / 触摸 48）。文档里的 config.hscale 会把它乘掉，所以 CELL 是
// **每次 redraw 现算**的：BASE_CELL 是常量，CELL 是这一帧的值。
var BASE_CELL=G.CELL, CELL=BASE_CELL;
var NAME_W=G.NAME_W, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD, ACT_W=G.ACT_W;
var COL_Y=G.COL_Y;
var XS=G.XS;
// 分组每嵌套一层要在行名左侧让出的槽宽（花括号 + 竖排组名占这一条）。
// 取「格宽的 0.63」—— 与上游一致（WaveDrom 层间距 25 / 格宽 40 = 0.63）；层间距太窄时
// 竖排组名会贴着内层括号，长组名还会顶到行名。
var GSLOT=T?30:24;

export function createShapes(ctx){
  var state=ctx.state, wrap=ctx.wrap;
  // 当前场景（desk|touch × Edit|Card）。所有「画不画某个控件」的判据一律查 cap.js 的能力表：
  // `can('laneMeta')` 读起来就是「这个场景该不该画 φ/T 徽标」，比 `if(T||state.readonly)` 好审。
  // 仍直接读 T / readonly 的地方都是**布局派生**（因为没画控件而少留的高度 / 少留的边距），
  // 不是能力 —— 那条界线见 cap.js 顶部注释。
  var SC='deskEdit';
  function can(name){ return Cap.can(name,SC); }

  // ---- 行名区宽度自适应 ----------------------------------------------------
  // 行名区不该为「可能出现的长名字」常年留白：名字短就窄，长度决定宽度。
  // 测量用离屏 SVG 真实文本（字体 / 字号与画布一致），不按字符数估算 —— 中英文混排、
  // 分组名 `[Master]` 的 10px 小字都能精确算进去。测完即丢，画布上不留痕迹。
  var measEl=null, measTxt=null, measKey='', measW=0;
  function measure(text,size){
    if(!measEl){
      measEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
      measEl.setAttribute('class','measure');
      measEl.setAttribute('aria-hidden','true');
      measTxt=document.createElementNS('http://www.w3.org/2000/svg','text');
      measEl.appendChild(measTxt);
      document.body.appendChild(measEl);
    }
    measTxt.textContent=text;
    measTxt.setAttribute('font-size',String(size));
    try{ return measTxt.getBBox().width; }catch(e){ return text.length*size*0.6; }
  }
  // 最宽的一行行名（名字 + φ/T）。只读态不画 φ/T（`laneMeta` 能力关闭），
  // 所以更窄 —— 这是内容差异，不是「另一套版式」：两态用同一个算法，只是喂进去的文本不同。
  // 分组名不再算进来：它改画在左侧的括号旁（竖排），见 groupRuns 的用法。
  function nameBlockWidth(ir){
    var l, w, max=0, withMeta=can('laneMeta');
    for(var i=0;i<ir.lanes.length;i++){
      l=ir.lanes[i];
      if(l.kind==='spacer') continue;         // spacer 行不画行名
      w=measure(l.name,12);
      if(withMeta){
        w+=measure(' φ'+l.phase,9)+measure(' T'+l.period,9);
      }
      if(w>max) max=w;
    }
    return max;
  }

  // 分组区间：把 `groupPath` 相同的连续行收敛成「一段」，供左侧括号使用（上游同款做法）。
  // 第 d 层里，凡是 groupPath 长度 > d 且前 d+1 段相同的连续行就是一段；单行分组也成段。
  // 返回 [{name, depth, from, to}]，from / to 是行下标（含）。depthMax 可由调用方传入，
  // 这样行名左界与括号绘制共用同一次扫描（两边都要知道「最深嵌套几层」）。
  function groupDepth(lanes){
    var d=0;
    lanes.forEach(function(l){ if((l.groupPath||[]).length>d) d=l.groupPath.length; });
    return d;
  }
  function groupRuns(lanes, depthMax){
    var out=[];
    if(depthMax===undefined) depthMax=groupDepth(lanes);
    for(var d=0; d<depthMax; d++){
      var i=0;
      while(i<lanes.length){
        var gp=lanes[i].groupPath||[];
        if(gp.length<=d){ i++; continue; }
        var pref=gp.slice(0,d+1).join('/'), j=i;
        while(j+1<lanes.length){
          var g2=lanes[j+1].groupPath||[];
          if(g2.length<=d || g2.slice(0,d+1).join('/')!==pref) break;
          j++;
        }
        out.push({name:gp[d], depth:d, from:i, to:j});
        i=j+1;
      }
    }
    return out;
  }

  // 行首拖拽把手：行位置调整的唯一交互
  // 只读卡片不画：没有拖拽这回事，画出来只是个不能用的点心。

  // 一次解析 edge 字符串：<from><shape><to> [label]
  // shape 是一段**字面 token**，不是「数一数几个竖线」：`-|` 与 `|-` 是两种不同的折线
  // （先横后竖 / 先竖后横），`-~` 与 `~-` 是两种不同的渐变曲线。上游 arc-shape.js 就是一张
  // switch 表；我们照同一套**语义**建自己的表（路径公式是自己的，只对齐「画哪种线、箭头指向
  // 哪一端、标签贴在哪」）。`<` / `>` 只表示两端的箭头。
  function parseEdge(s) {
    var m = /^([A-Za-z0-9_]+)([<>~\-|+]*)([A-Za-z0-9_]+)(?:\s+([\s\S]*))?$/.exec(String(s).trim());
    if (!m) return null;
    var tok = m[2] || '';
    return {
      from: m[1], to: m[3], label: (m[4] || '').trim(),
      start: tok.indexOf('<') >= 0, end: tok.indexOf('>') >= 0,
      shape: tok.replace(/[<>]/g, '')
    };
  }
  // 形状表：key 是去掉箭头后的 token，值是折线种类。表里没有的写法回落 spline ——
  // 仍然画得出来、不报错，源码也一个字不动（上游对未知形状画一条红线，那是在报错，
  // 而这里的输入是用户手写的文本，画成看得懂的样子比画一条红线有用）。
  var EDGE_SHAPES = {
    '': 'spline', '~': 'spline',
    '-': 'line',
    '-|': 'hv', '|-': 'vh', '-|-': 'hvh',
    '-~': 'swing1', '~-': 'swing2',
    '+': 'tee'
  };
  // 端点箭头：三角沿切线方向指到 tip（back/half 与旧实现一致，保证 a~>b 的 d 逐字节不变）
  function arrowTri(tip, from) {
    var ux = tip.x - from.x, uy = tip.y - from.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    var back = 7.5, half = 3.2;
    var abx = tip.x - ux * back, aby = tip.y - uy * back, apx = -uy, apy = ux;
    return 'M' + tip.x + ',' + tip.y + ' L' + (abx + apx * half) + ',' + (aby + apy * half) +
      ' L' + (abx - apx * half) + ',' + (aby - apy * half) + ' z';
  }
  // 形状 → 路径。endFrom / startFrom 是「箭头背后那一点」，给切线方向用。
  function edgePath(a, b, shape) {
    var kind = EDGE_SHAPES[shape] || 'spline';
    var i, pts;
    if (kind === 'spline' || kind === 'swing1' || kind === 'swing2') {
      var dx = b.x - a.x, dy = b.y - a.y, c1, c2;
      if (kind === 'spline') { c1 = { x: a.x + 10, y: a.y - 26 }; c2 = { x: b.x - 10, y: b.y - 26 }; }
      // swing1（`-~`）：离开起点时贴水平，末尾俯冲到目标
      else if (kind === 'swing1') { c1 = { x: a.x + 0.7 * dx, y: a.y }; c2 = { x: b.x - 0.05 * dx, y: b.y - 0.05 * dy }; }
      // swing2（`~-`）：离开起点时直接下沉，末尾贴着目标水平收
      else { c1 = { x: a.x + 0.05 * dx, y: a.y + 0.05 * dy }; c2 = { x: a.x + 0.3 * dx, y: b.y }; }
      return {
        d: 'M' + a.x + ',' + a.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + b.x + ',' + b.y,
        endFrom: c2, startFrom: c1, kind: kind
      };
    }
    pts = [{ x: a.x, y: a.y }];
    if (kind === 'line' || kind === 'tee') pts.push({ x: b.x, y: b.y });
    else if (kind === 'hv') { pts.push({ x: b.x, y: a.y }); pts.push({ x: b.x, y: b.y }); }
    else if (kind === 'vh') { pts.push({ x: a.x, y: b.y }); pts.push({ x: b.x, y: b.y }); }
    else { var mx = (a.x + b.x) / 2; pts.push({ x: mx, y: a.y }); pts.push({ x: mx, y: b.y }); pts.push({ x: b.x, y: b.y }); }
    var d = 'M' + pts[0].x + ',' + pts[0].y;
    for (i = 1; i < pts.length; i++) d += ' L' + pts[i].x + ',' + pts[i].y;
    return { d: d, endFrom: pts[pts.length - 2], startFrom: pts[1], kind: kind };
  }
  // 标签锚点：贴着这条线的**留白处**，而不是一律「中点上方 22px」——
  // L 形 / Z 形的中点落在竖线或拐角上，压在线上就看不清了。
  function edgeLabelAt(a, b, kind) {
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (kind === 'hv') return { x: b.x - 8, y: my, anchor: 'end' };
    if (kind === 'vh') return { x: a.x + 8, y: my, anchor: 'start' };
    if (kind === 'hvh') return { x: mx + 8, y: my, anchor: 'start' };
    if (kind === 'line' || kind === 'tee') return { x: mx, y: my - 12, anchor: 'middle' };
    return { x: mx, y: my - 22, anchor: 'middle' };
  }
  // 弧线：唯一「编辑 / 删除 edge」入口是双击弧线本体；清空字符串即删除
  function edgeArcs(ir) {
    var map = {};
    ir.lanes.forEach(function (l, li) {
      if (l.kind !== 'signal') return;
      l.node.forEach(function (ch, t) { if (ch && ch !== '.' && !map[ch]) map[ch] = { x: cellGeo(l, t).cx, y: TOP + li * ROW_H + 7 }; });
    });
    var o = [];
    ir.edges.forEach(function (e, i) {
      var pe = parseEdge(e); if (!pe) return;
      var a = map[pe.from], b = map[pe.to];
      if (!a || !b) return;
      var g = edgePath(a, b, pe.shape), paths = [];
      // 曲线本体 + 箭头 + 命中带（顺序与旧实现一致：默认 a~>b 的 .edgeArc path 指纹不变）
      paths.push('<path d="' + g.d + '" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".75" pointer-events="none"/>');
      // 箭头只按 `<` / `>` 画 —— 没有箭头就是「没有方向」，别替用户补一个：
      // 上游 `a~b` 是一条无箭头的曲线，我们以前无条件补末端箭头，等于凭空宣布了因果方向。
      if (pe.end) paths.push('<path d="' + arrowTri(b, g.endFrom) + '" fill="var(--accent)" opacity=".85" pointer-events="none"/>');
      if (pe.start) paths.push('<path d="' + arrowTri(a, g.startFrom) + '" fill="var(--accent)" opacity=".85" pointer-events="none"/>');
      // `+` 是「两端各一个横杠」的接线端子（上游用 tee marker），不是箭头
      if (g.kind === 'tee') {
        var ux = b.x - a.x, uy = b.y - a.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
        var nx = -uy / ul * 5, ny = ux / ul * 5;
        paths.push('<path d="M' + (a.x - nx) + ',' + (a.y - ny) + ' L' + (a.x + nx) + ',' + (a.y + ny) +
          ' M' + (b.x - nx) + ',' + (b.y - ny) + ' L' + (b.x + nx) + ',' + (b.y + ny) +
          '" stroke="var(--accent)" stroke-width="1" pointer-events="none"/>');
      }
      // 连线模式下弧线命中带让位给同一区域的波形格：端点由 rect.cell 统一接收
      paths.push('<path d="' + g.d + '" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="' + (T ? 20 : 8) + '" pointer-events="' + (state.linkMode ? 'none' : 'stroke') + '"/>');
      var inner = paths.join('');
      if (pe.label) {
        var la = edgeLabelAt(a, b, g.kind), lw = Math.max(22, pe.label.length * 6 + 10);
        var lx = la.anchor === 'end' ? la.x - lw : la.anchor === 'start' ? la.x : la.x - lw / 2;
        inner += '<rect x="' + lx + '" y="' + (la.y - 9) + '" width="' + lw + '" height="16" rx="4" fill="var(--panel)" stroke="var(--line)" stroke-width="0.5" pointer-events="none"/>' +
          '<text x="' + la.x + '" y="' + (la.y + 1) + '" text-anchor="' + la.anchor + '" dominant-baseline="central" font-size="9" fill="var(--accent)" pointer-events="none">' + esc(cut(pe.label, 18)) + '</text>';
      }
      o.push('<g class="edgeArc" data-eidx="' + i + '" role="button" aria-label="Edit edge ' + esc(String(e)) + '">' + inner + '</g>');
    });
    return o.join('');
  }

  // 零行空态：没有信号行时画一块可点的虚线占位行（加号 + 淡方波），
  // 点它即新增第一条信号行。图形自己表达「这里能加一行」，画布上仍不出现任何文字，
  // 语义只走 aria-label。这里只画操作层的占位元素，不碰波形层图元与指纹。
  function emptyRow(W){
    var h=ROW_H, cy=TOP+h/2;
    var px=XS+Math.round(CELL*0.5), wx=XS+Math.round(CELL*1.6), ww=Math.round(CELL*2.2);
    return '<g class="emptyRow" data-act="addFirst" role="button" aria-label="Add the first signal row">'+
      '<rect x="'+(PAD+2)+'" y="'+(TOP+2)+'" width="'+(W-PAD*2-4)+'" height="'+(h-4)+'" rx="6" '+
        'fill="none" stroke="var(--line2)" stroke-width="1" stroke-dasharray="4 4"/>'+
      // 淡方波：提示「这里画的是时序」
      '<path class="emptyWave" d="M'+wx+','+(cy+7)+'H'+(wx+Math.round(ww*.3))+'V'+(cy-7)+
        'H'+(wx+Math.round(ww*.66))+'V'+(cy+7)+'H'+(wx+ww)+'" fill="none" '+
        'stroke="var(--muted)" stroke-width="1.2" opacity=".38" stroke-linejoin="round"/>'+
      // 加号：唯一的动作提示（圆角方形而不是圆点，避免与已删除的锚点小圆圈在视觉上撞形）
      '<rect class="plusBox" x="'+(px-(T?15:13))+'" y="'+(cy-(T?15:13))+'" width="'+(T?30:26)+'" height="'+(T?30:26)+'" rx="'+(T?15:13)+'" '+
        'fill="none" stroke="var(--accent)" stroke-width="1.2"/>'+
      '<path d="M'+(px-(T?6:5))+','+cy+'h'+(T?12:10)+'M'+px+','+(cy-(T?6:5))+'v'+(T?12:10)+'" '+
        'stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>'+
      '</g>';
  }

  function redraw(){
    // 重绘会替换 SVG DOM；未提交的就地编辑先结算，再用最新 IR 重建整张图
    if(ctx.inlineCtx) ctx.closeInline(true);
    var ir=state.ir; if(!ir) return;
    SC=Cap.sceneOf(state);                       // 先定场景，后面的判据全靠它
    // config.hscale：整条横轴按 hscale 放大（上游同款语义：字符占 period·hscale 个砖、
    // 格线每 hscale 个砖一条）。只改格宽，行高 / 字号 / 行名区一律不动 —— 这就是
    // 「把图拉宽」而不是「把图放大」。所有几何都从 CELL 派生，所以只在这里赋值一次。
    CELL=G.CELL=BASE_CELL*hscaleOf(ir);
    // 只读态与编辑态共用同一套排版（格子、行高、字号、网格都不变）：只读卡片只是
    // 「少画编辑控件」，不是另一套版式。行名区宽度在这里按内容重算（两态同一算法），
    // 避免任何调用方改动过后残留旧值。
    // 行名左界：桌面被行首拖拽把手顶到 PAD+18，触摸端不画把手、左界只有 PAD。
    // 行名区宽度按内容重算（getBBox 会强制布局，所以内容没变就不量）。测量键里**故意**
    // 用「拖动中的那一行的相位占位符」代替真实值：相位尺是连续拖动的，每 0.05 就可能让
    // `φ0.35` 多一位数字 → 行名区宽度跨过 8px 量化边界 → 波形原点跟着跳 → 指针→相位的
    // 换算被自己的位移污染（实测拖到 1.0 落在 0.8）。冻结这一行的相位后，拖动全过程
    // 版式纹丝不动，松手（phaseEdit 清空）时才按新值量一次。
    var nameKey=SC+'|'+ir.lanes.map(function(l){
      if(l.kind==='spacer') return '';
      var ph=(state.phaseEdit&&state.phaseEdit.lane===l.id)?'~':l.phase;
      return l.name+'/'+ph+'/'+l.period+'/'+(l.groupPath||[]).join('>');
    }).join(';');
    if(nameKey!==measKey){                       // 内容没变就不重复测量（getBBox 会强制布局）
      measKey=nameKey; measW=nameBlockWidth(ir);
    }
    // 行名左界就是内边距：行首拖拽把手已于 0.9.10 撤除，0.9.13 连图元一起删除，
    // 这里不再为它预留 18px。分组括号要占位：每嵌套一层就让出 GSLOT 宽的一条槽
    // （括号与竖排组名都画在行名左侧，先把这段宽度让出来，行名才不会被压住）。
    var gDepth=groupDepth(ir.lanes);
    var leftBound=PAD+gDepth*GSLOT;
    var minW=64, maxW=T?300:260;                 // 上下限：空图 / 超长名字（两态同值）
    // 右留 6 + 安全余量 10：离屏分段测量与画布上「名字 + 9px 的 φ/T」tspan 拼接有
    // 8~10px 的系统性出入（空格折叠与字距），靠固定余量兜住即可；
    // 实测下来行名左缘正好落在 leftBound 上，既不压拖拽把手也不浪费宽度。
    // 量化到 8px：行名区随输入逐像素变化时，波形会跟着横向挪，观感像抽搐。对齐到一个
    // 固定粒度后，小于一粒的改动不再重排，平移量也可预期。
    // 粒度不取格宽 CELL（桌面 38 / 触摸 48）：WaveDrom 把 xg 量化到 xs 是因为它的 xg 在
    // 120~180 量级，20px 步长只占一成；而行名区这里只有 65~140，38px 步长只剩两档，
    // 73 会被直接顶到 114 —— 左边空白当场翻倍，与「收缩行名区」的初衷相反。
    // 8px ≈ 一个窄字符宽、也 ≈ 触摸端一格的 1/6，相对粒度与 WaveDrom 相当。
    // 只向上取整：NAME_W 必须 ≥ rawW，否则行名左缘会顶出画布（实测差 2px 就越界）；
    // 代价是平均多让 4px，小于半个字。
    var rawW=Math.max(minW,Math.min(maxW,leftBound+measW+16));
    NAME_W=Math.min(maxW,Math.ceil(rawW/8)*8);
    XS=NAME_W+8;                                 // 行名右缘（NAME_W-6）到波形 8px
    // 其它模块（interactions 的键盘滚动定位、embed-shell 的进编辑锚定）读 G 的实时值
    G.NAME_W=NAME_W; G.XS=XS;
    var N=ir.ticks;
    // 全图列数（参考周期）：period≠1 的行一个字符占多列，行宽不再都等于字符数，
    // 所以按「最宽的那一行」定画布宽度。全为 period:1 时 COLS 恒等于 N（默认情形零变化）。
    // **负相位会让行变宽**：它把整行往右推，尾部会顶出原来的内容宽度 —— 正相位是往左推、
    // 由 lclip 把越界部分裁掉，不需要额外空间；负相位必须补出这段余量，否则行尾被切在画布外。
    var COLS=0, negExtent=0;
    ir.lanes.forEach(function(l){
      if(l.kind!=='signal') return;
      COLS=Math.max(COLS, laneChars(l,N)*lanePeriod(l));
      var sh=laneShift(l);
      if(sh<0) negExtent=Math.max(negExtent, -sh);
    });
    // negExtent 是周期数（可能含小数），乘 CELL 后作为右侧补宽；不参与列号循环（不新增列）。
    var ACT_X=XS+(COLS+negExtent)*CELL;
    // 卡片可视宽度：操作层按它排布，保证所有按钮不用横向滚动就能点到。
    // 最小 240 防止未布局（隐藏标签页）时算出 0 列。
    var viewW=Math.max(240, Math.round(wrap.clientWidth||0)||360);
    // 波形层仍按内容撑宽并允许横向滚动；但至少铺满卡片，便于钉住的顶栏 / 底栏有落脚宽度。
    // 只读态（嵌入卡片默认）两项都不需要：既没有行工具（不预留 ACT_W），也没有钉住的顶栏 /
    // 底栏（不需要铺满 viewW）。所以只按「内容宽」算，窄了就交给下面的 fit 等比缩小，
    // 比卡片窄就保持 1:1 并靠 .svgwrap svg 的 margin-inline:auto 居中 —— 卡片右侧不会再空出一条。
    // 只读卡片的「内部尺寸」：嵌入片段按 W/H 算 aspect-ratio，让 iframe 高度随宽度自适应，
    // 卡片底部不会再留一片空白（旧片段写死 height，窄卡片里就空出上百像素）。
    // 只读卡片不要再背「顶部给 HUD 留位置」这笔账：HUD 只在编辑态画，留着就是一圈死白。
    // 做法是把 viewBox 的 y 前移一段（图元坐标一个都没动，波形层指纹与桌面布局不受影响），
    // 底部与右侧也只留一点呼吸空间 —— 波形图本身尽量贴满卡片。
    var roTrimTop=Math.max(0, COL_Y-8);      // 裁到列号行上方 8px
    var roTrimBottom=12;                     // 最后一行下沿到卡片底
    // 只读态不画末尾的追加列，所以右侧只需容下最后一个真实格子的右边缘（= ACT_X - 1）。
    var roW=Math.max(ACT_X+PAD, 360);
    var roBottomY=(function(){
      return ir.lanes.length===0 ? TOP+ROW_H : TOP+ir.lanes.length*ROW_H;
    })();
    var roH=roBottomY+4+roTrimBottom-roTrimTop;
    state.roBox={w:roW, h:roH};
    // 下面这几处直接读 readonly / embedCard，是**布局**不是能力：
    // 列号行不画（能力表关了 colhead）→ 画布宽度不再为右侧 ACT_W 留位；
    // 只读卡片 → 顶部那一整条 HUD 区从 viewBox 里裁掉、整张图等比 fit。
    // 换句话说：能力回答「有没有」，布局回答「因此省下多少」。别把两者合并。
    var W=state.readonly ? roW : Math.max(ACT_X+ACT_W+PAD, viewW, 560);
    var bottom=TOP+ir.lanes.length*ROW_H;
    // 零行时波形区高度为 0，占位行需要占一行高度，否则会被算到画布外
    var isEmpty=ir.lanes.length===0;
    if(isEmpty) bottom=TOP+ROW_H;
    var actY=bottom+4;
    // 底部两条（动作 / 字符）现在是 .pane.diagram 里的真实 flex 子项，不再盖在画布上，
    // 所以画布不必为它们预留高度 —— 画布高度由 flex 自动让出，这里不记任何「底栏预留」。
    // 嵌入卡片：高度只按内容算（宿主据此设 iframe 高度，避免下方留一片空白）；
    // 整页模式：内容高于视口时抬高到视口高度，让钉住的底栏有可见滚动终点。
    // 只读嵌入卡片底部收到 12px（编辑态仍留 20，字符条 / 停靠条需要落点）
    var contentH=actY+((state.embedCard&&state.readonly)?roTrimBottom:20);
    // 画布高度**只由内容决定**（不再抬到视口高）。旧做法是「整页模式下把 SVG 拉到视口高」，
    // 那是给当时「底栏画在 SVG 里、要钉住」用的；底栏早已是画布外的真实 flex 子项。
    // 留在原地就成了另一种抖动源：停靠区一出现，视口变矮 → SVG 跟着变矮 → 又一次重排。
    var H=contentH, c, x;
    // 只读卡片把顶部那段「HUD 区」从 viewBox 里裁掉：渲染高度同步变矮，卡片不再顶着一条死白。
    var vbTop=(state.embedCard&&state.readonly)?roTrimTop:0;
    var vbH=H-vbTop;
    // 嵌入只读卡片：整张图按卡片宽度等比缩小，让波形一次全显示 —— 读者不会去横向拖一张
    // 只读卡片。进入编辑后 fit=1，恢复 1:1 + 滚动，保证点选精度。
    // 只改 svg 的渲染尺寸，viewBox 仍是内部坐标 ⇒ 所有图元几何、getBBox 与就地编辑的
    // 坐标换算都不受影响，波形层指纹也不受影响。
    // 只读卡片：按卡片宽度等比缩放，整张图一次全显示。上限 2 倍 —— 比卡片窄时也放大铺满
    // （SVG 是矢量，放大不糊），否则宽笔记里会左右各留一条；超过 2 倍才保持比例居中。
    // 进入编辑态回到 1:1 + 滚动，保证点选精度。
    // fit 规则（2026-11-14 起）：
    //   只读卡片 —— 等比缩到卡片宽，窄图最多放大 2 倍铺满（矢量不糊）；
    //   触摸端 / 卡片编辑态 —— 内容比容器宽就缩到容器宽，只缩不放大（手机上不必横向拖）；
    //   全屏编辑 —— 比屏幕宽按 1:1（靠滑动移动，格子回到可点尺寸），比屏幕窄最多放大 2 倍；
    //   桌面整页 —— 保持 1:1 + 横向滚动（宽屏装得下，缩了反而费眼）。
    // 纵向不参与 fit：行数随图变化，硬塞进一屏只会把字压糊。
    var rawFit = viewW > 0 ? viewW / W : 1;
    var fsBig = !!state.embedCard && !state.readonly && !!state.fsEdit;
    var fit = fsBig ? Math.min(2, Math.max(1, rawFit))
            : (state.embedCard && state.readonly) ? Math.min(2, rawFit)
            : (T || state.embedCard) ? Math.min(1, rawFit)
            : 1;
    var outW = fit < 1 ? viewW : Math.round(W * fit);
    var outH = Math.round(vbH * outW / W);
    // state.fit 记**真实渲染比**（outW/W，含取整误差），凡「用户坐标 ↔ 像素」的换算都用它。
    state.barY=actY; state.viewW=viewW; state.fit=outW/W;
    // 高度上报用缩放后的真实像素高，否则宿主会按原始高设 iframe，底部留一片空白。
    state.contentH=state.embedCard?outH:contentH;
    state.W=W; state.H=H;
    // xMidYMin：只读卡片把 svg 拉满视口时，比例若略有偏差，多出来的空间留在下方而不是
    // 上下均分 —— 图始终贴顶，进编辑时「把被点的格子钉回手指下」的换算不必再补一层偏移。
    // 尺寸精确时（桌面编辑态、比例匹配的只读卡片）meet 不产生任何缩放。
    var o=['<svg width="'+outW+'" height="'+outH+'" viewBox="0 '+vbTop+' '+W+' '+vbH+'" preserveAspectRatio="xMidYMin meet" class="'+(state.linkMode?'linkMode':'')+'" role="img" aria-label="Timing diagram editor">'];
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(TOP-12)+'" fill="var(--bg)"/>');
    // 只读（嵌入卡片默认态）：不画 HUD、不画字符条，只留波形本身。
    // 列网格：只读态没有列号行，所以从画面顶起；线型与编辑态一致（同一条竖线，不加虚线）。
    var gridTop=state.readonly?vbTop+4:(TOP-10);
    // 网格按**参考周期**铺满整张图（period≠1 的行更宽，网格必须跟到最右）；列号仍按字符序号
    // 编到 N —— 它是「第几个周期」的定位器，period:1 的行上两者重合（默认情形零变化）。
    for(c=0;c<=COLS;c++){
      x=XS+c*CELL;
      o.push('<line class="colGrid" x1="'+x+'" y1="'+gridTop+'" x2="'+x+'" y2="'+bottom+'" stroke="var(--line)" stroke-width="0.5"/>');
    }
    // 列号 + 列操作按钮是「编辑定位器」：只读卡片不需要（上游 WaveDrom 也从不画列号），
    // 整组不画。零行空态同样不画：0 个周期时列号与「末尾追加」都没有意义。
    if(can('colhead')) for(c=0;c<=N&&!isEmpty;c++){
      var cx=XS+c*CELL+CELL/2, selc=state.sel===c, ghost=c===N;
      var gapc=ghost?false:ir.lanes.some(function(l){ return l.kind==='signal'&&l.slots[c]&&l.slots[c].gap; });
      o.push('<g class="colhead'+(selc?' sel':'')+(ghost?' ghost':'')+'" data-c="'+c+'" role="img" aria-label="Column '+c+(ghost?' — append a cycle':'')+'">');
      // 整列列头透明命中区：让悬停 / 点击落在列头上，而不是落到背景矩形
      o.push('<rect x="'+(XS+c*CELL+1)+'" y="'+(COL_Y-2)+'" width="'+(CELL-2)+'" height="'+(TOP-COL_Y-2)+'" fill="transparent"/>');
      var cw=T?Math.min(CELL-2,44):30, ch=T?28:20;
      o.push('<rect x="'+(cx-cw/2)+'" y="'+COL_Y+'" width="'+cw+'" height="'+ch+'" rx="4" fill="'+(selc?'var(--accent-bg)':'transparent')+'" stroke="'+(selc?'var(--accent)':'var(--line)')+'" stroke-width="0.5" '+(ghost?'stroke-dasharray="2 2"':'')+'/>');
      o.push('<text x="'+cx+'" y="'+(COL_Y+ch/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+(T?13:11)+'" fill="'+(selc?'var(--accent)':'var(--muted)')+'">'+c+'</text>');
      o.push('</g>');
    }
    if(isEmpty) o.push(emptyRow(W));
    // phase 行：位移是**连续**的（见 geometry.js），越出波形起点的那部分裁掉即可 ——
    // 这里有意**不复刻**上游「整块丢掉行首半砖」的副作用（phase 0.1 时它会丢掉前 0.4 格的
    // 波形），我们保留完整波形、只裁掉越过起点的像素。只给 phase>0 的行建 clipPath，
    // 默认文档不产生任何额外 DOM。
    var clips=[];
    ir.lanes.forEach(function(l,li){
      if(l.kind!=='signal'||laneShift(l)<=0) return;
      var w=laneChars(l,N)*lanePeriod(l)*CELL;
      clips.push('<clipPath id="lclip-'+l.id+'"><rect x="'+XS+'" y="'+(TOP+li*ROW_H)+'" width="'+w+'" height="'+ROW_H+'"/></clipPath>');
    });
    if(clips.length) o.push('<defs>'+clips.join('')+'</defs>');
    // 行范围（分组用）：范围内的行一起高亮，看上去是「一段」而不是单选一行
    var spanSet={};
    (state.selRows||[]).forEach(function(id){ spanSet[id]=1; });
    ir.lanes.forEach(function(l,li){
      var y=TOP+li*ROW_H;
      var yT=y+Math.round(ROW_H*0.25), yM=y+Math.round(ROW_H*0.48), yB=y+Math.round(ROW_H*0.71);
      var cellH=ROW_H-10, i, hi=state.selLane===l.id||!!spanSet[l.id];
      o.push('<g class="laneGrp'+(hi?' sel':'')+'" data-lane="'+l.id+'">');
      // 选中底衬只铺到**内容右缘**（ACT_X，已含负相位补出的宽度）。原先它铺到 W-PAD*2，
      // 而 W 至少被 viewW / 560 撑大 —— 1440 窗口下 918 宽的底衬里 400 多像素盖在什么都
      // 没有的白区上，读起来像「表格选中行」，而不是「这条波形被选中」。
      // 点击面（下面的 laneRow）仍然整幅宽：点空白处也能选中这一行，那是另一个职责，
      // 所以底衬单独一个 rect 且 pointer-events:none，不参与命中。
      var hiW=Math.max(24,ACT_X-PAD);
      if(hi) o.push('<rect class="laneHi" x="'+PAD+'" y="'+(y+1)+'" width="'+hiW+
        '" height="'+(ROW_H-2)+'" rx="3" fill="var(--accent-bg)" pointer-events="none"/>');
      o.push('<rect class="laneRow" data-lane="'+l.id+'" x="'+PAD+'" y="'+(y+1)+'" width="'+(W-PAD*2)+'" height="'+(ROW_H-2)+'" rx="3" fill="transparent" style="cursor:pointer"/>');
      if(l.kind==='spacer'){
        // 只读卡片上这是一段纯留白（上游同样不画任何东西）；只有编辑态才给虚线 + 字样，
        // 否则读者会看到一条莫名其妙的「spacer」文字。
        if(can('spacerMark')){
          o.push('<line x1="'+XS+'" y1="'+yM+'" x2="'+ACT_X+'" y2="'+yM+'" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="2 5"/>');
          o.push('<text x="'+(XS+8)+'" y="'+(yM-6)+'" font-size="9" fill="var(--muted)">spacer</text>');
        }
        o.push('</g>');
        return;
      }
      // 相位 / 周期是「可点改」的编辑入口，只读卡片上撤掉。
      // 分组名不再挂在行名后面：它画在左侧括号旁（竖排，见下面的 groupRuns 渲染）。
      // φ / T 徽标：四场景都是「点一下就能改」的入口（0.17.0 起触摸端也接线）。
      // 0.14.2 曾把触摸端这两个字形断掉，理由是「点行名想选中、一偏就进了**相位尺**，紧接着的
      // 拖动变成改相位」—— 那个理由已经不成立：点 φ / T 现在打开的是**就地输入框**（Esc 就退），
      // 不再是一个会接管后续拖动的手势模式。触摸端字形只有 8~10px，所以另配放大命中区（见下）。
      var meta='', metaHit='';
      if(can('laneMeta')){
        meta='<tspan class="laneMeta" data-act="phase" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> φ'+l.phase+'</tspan>'+
             '<tspan class="laneMeta" data-act="period" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> T'+l.period+'</tspan>';
        if(T){
          // 两个字形**各自**一块透明命中区（宽度按实测字宽 + 3px，高度占满整行）：合成一块就分不出
          // 「点 φ 改相位」和「点 T 改周期」。只覆盖到字形，行名文字仍归 `data-act="name"`。
          var mR=NAME_W-6, wPer=measure(' T'+l.period,9), wPhi=measure(' φ'+l.phase,9);
          var mP=mR-wPer, mPL=mP-wPhi-3;
          metaHit='<rect class="laneMetaHit" data-act="phase" data-lane="'+l.id+'" x="'+mPL.toFixed(1)+
              '" y="'+(y+1)+'" width="'+(mP-mPL).toFixed(1)+'" height="'+(ROW_H-2)+
              '" fill="transparent" pointer-events="all" style="cursor:pointer"/>'+
            '<rect class="laneMetaHit" data-act="period" data-lane="'+l.id+'" x="'+(mP-1).toFixed(1)+
              '" y="'+(y+1)+'" width="'+(mR-mP+1).toFixed(1)+'" height="'+(ROW_H-2)+
              '" fill="transparent" pointer-events="all" style="cursor:pointer"/>';
        }
      }
      // 右缘留 6（原 8）：行名与波形之间的空隙由 geometry.js 的 XS 统一控制，
      // 这里只留字形本身的呼吸位，两处加起来正好 8px。
      o.push('<text class="laneName" data-lane="'+l.id+'" x="'+(NAME_W-6)+'" y="'+yM+'" text-anchor="end" dominant-baseline="central" font-size="12" fill="var(--ink)">'+
        '<tspan class="laneNameText" data-act="name">'+esc(l.name)+'</tspan>'+meta+'</text>');
      if(metaHit) o.push(metaHit);   // 压在字形之上，接住触摸端点按
      // 行级时间标尺：period 决定这一行的格宽（字符按比例横向拉伸），phase 决定整行左移量。
      // period=1 / phase=0 时这些值与改造前逐一相同（P=1、sh=0、cw=CELL、chars=N）。
      var P=lanePeriod(l), sh=laneShift(l), cw=P*CELL, chars=laneChars(l,N);
      var clipId=sh>0?('lclip-'+l.id):null;
      // 画布按全局 N 个周期绘制；wave 较短的行，尾部缺失周期按 repeater 延续补画并留出可续写格子
      var lastW=l.slots.length?l.slots[l.slots.length-1].w:'x';
      // bus 段合并：延续格（repeater / 超出行尾的补齐格）与相邻同段格之间不画斜边。
      // 判据用 slot 的 point 标志 —— 它正是「用户写了字符」与「延续而来」的分界。
      var wsAt=function(k){ var q=k<l.slots.length?l.slots[k]:null; return q?q.w:lastW; };
      var ptAt=function(k){ var q=k<l.slots.length?l.slots[k]:null; return q?(q.point&&!q.gap):false; };
      if(clipId) o.push('<g clip-path="url(#'+clipId+')">');
      for(i=0;i<chars;i++){
        var s=i<l.slots.length?l.slots[i]:null, x0=cellGeo(l,i).x0, w=s?s.w:lastW;
        // 上一格**实际画出来的字符**（含延续格归一化后的 w）：时钟字符要靠它判断边界处
        // 那条起沿是不是多余的。只传「最近一个显式状态点」会漏掉 `h...` / `l.` 这种
        // 延续同一电平的情况，于是每个延续格边界都多画一条竖线。
        var prevCh=i>0?wsAt(i-1):null;
        var gopt={};
        if(Core.BUS.test(w)){
          var ljoin=i>0&&!ptAt(i)&&Core.BUS.test(wsAt(i-1));
          var rjoin=(i+1<chars)&&!ptAt(i+1)&&Core.BUS.test(wsAt(i+1));
          gopt.seg=ljoin?(rjoin?'mid':'end'):(rjoin?'start':'only');
          gopt.cls=busClassOf(w);
        }
        var glyph=waveGlyph(w,prevCh,x0,yT,yM,yB,cw,gopt);
        o.push(s?glyph:'<g class="tailSlot" role="img" aria-label="Undefined period — tap to extend">'+glyph+'</g>');
        if(s&&s.gap) o.push(waveGap(x0,yT,yB));
        // 命中区裁到波形起点：phase 行的首格有一半落在行名区，不能让它压住行名抢点击。
        // period=1 / phase=0 时 rx=x0+1、宽=CELL-2，与改造前逐字节相同。
        var rx=Math.max(x0+1,XS);
        // 相位模式下这一行的格子光标改成左右箭头：用户不用试也知道「这里能横着拖」。
        var ccur=(state.phaseEdit&&state.phaseEdit.lane===l.id)?'ew-resize':'crosshair';
        o.push('<rect class="cell'+(s?'':' tailCell')+'" data-lane="'+l.id+'" data-tick="'+i+'"'+(s?'':' data-tail="1"')+
          ' x="'+rx+'" y="'+(y+3)+'" width="'+Math.max(1,x0+cw-1-rx)+'" height="'+cellH+'" fill="transparent" style="cursor:'+ccur+'"/>');
      }
      // ---- bus 段标签 ----------------------------------------------------
      // 一个**连续段**只画一条标签，画在段中心。上游就是这么定位的：`findLaneMarkers` 在每个
      // v-brick 连续段上取一个 marker，标签按 marker 顺序排。按格画会犯两个错：`=` 后接 `.`
      // 的段，标签偏在段首（默认示例里 `data` 就偏了整整一格）；长标签又因为只按**一格**宽
      // 估算而被无谓截断（明明整段有三四格的空位）。截断改为按段的实际像素宽算。
      var run=0;
      while(run<chars){
        if(!Core.BUS.test(wsAt(run))){ run++; continue; }
        var runEnd=run;
        while(runEnd+1<chars && Core.BUS.test(wsAt(runEnd+1)) && !ptAt(runEnd+1)) runEnd++;
        var lb=null;
        for(var q=run;q<=runEnd;q++){
          var sq=l.slots[q];
          if(sq&&sq.point&&!sq.gap&&sq.label!==null&&sq.label!==undefined&&sq.label!==''){ lb=sq.label; break; }
        }
        if(lb!==null){
          var lx0=cellGeo(l,run).x0, lx1=cellGeo(l,runEnd).x0+cellGeo(l,runEnd).w;
          o.push('<text class="waveLabel" x="'+((lx0+lx1)/2).toFixed(1)+'" y="'+(yM+1)+'" text-anchor="middle" dominant-baseline="central">'+
            esc(fitLabel(lb,Math.max(10,lx1-lx0-4),10))+'</text>');
        }
        run=runEnd+1;
      }
      o.push('<line x1="'+XS+'" y1="'+(y+ROW_H)+'" x2="'+ACT_X+'" y2="'+(y+ROW_H)+'" stroke="var(--line)" stroke-width="0.5"/>');
      o.push('<rect class="waveZone" data-lane="'+l.id+'" x="'+XS+'" y="'+(y+Math.round(ROW_H*0.19))+'" width="'+(chars*P*CELL)+'" height="'+Math.round(ROW_H*0.46)+'" fill="none" stroke="none" pointer-events="none"/>');
      // node 字母：上游会把 `node: '..a...'` 的 a / b 画成小字母标在锚点处，
      // 它是 edge 的可读锚点 —— 不画的话读者只看到一条曲线，不知道连的是哪两点。
      // 这属于「图的内容」，与 data 标签同类，不受零常驻文字约束。
      for(i=0;i<chars&&i<l.node.length;i++){
        var nc=l.node[i];
        if(!nc||nc==='.') continue;
        o.push('<text class="waveNode" x="'+(cellGeo(l,i).cx+8)+'" y="'+(yT-2)+'" text-anchor="middle" font-size="10" fill="var(--accent)">'+esc(nc)+'</text>');
      }
      if(clipId) o.push('</g>');
      // 相位模式（0.14.5）：**波形本身就是抓手**，不再画一条尺子 + 滑块。
      // 打开相位模式后，在这一行的波形上横向拖动就直接改 phase —— 手指往右拖，波形往右移。
      // 画面上只留两样东西（都不是控件）：
      //   · 这一行的淡底 —— 说明「现在拖这一行就是改相位」；
      //   · 顶部半周期刻度 —— 帮助判断「这一下拖了一格还是半格」。
      // 命中一律**穿透**（pointer-events:none）：拖动由交互层按「按下在哪一行」判定，
      // 这样点一下仍然能选中格子（否则整行都被这块遮住，点哪儿都选不中）。
      if(state.phaseEdit&&state.phaseEdit.lane===l.id){
        var prow=ACT_X-8-XS;
        var pgo=['<g class="phaseTrackG">',
          '<rect class="phaseTrack" data-lane="'+l.id+'" x="'+XS+'" y="'+(y+2)+'" width="'+prow+
            '" height="'+(ROW_H-4)+'" rx="4" fill="var(--accent)" fill-opacity="0.1" pointer-events="none"/>'];
        for(var pk=0; pk*0.5<=PHASE_MAX+1e-9; pk++){
          var ptx=XS+pk*0.5*CELL;
          if(ptx>XS+prow-2) break;
          pgo.push('<line x1="'+ptx+'" x2="'+ptx+'" y1="'+(y+3)+'" y2="'+(y+7)+
            '" stroke="var(--accent)" stroke-opacity="'+(pk%2?0.25:0.5)+'" stroke-width="1" pointer-events="none"/>');
        }
        // 行尾**不再画相位读数**（0.17.0 删）：行名旁那个 `φ0.35` 一直在显示同一个值，
        // 再在右侧画一个就是同一件事说两遍，还白占一段波形区。要改值就点左边那个 ——
        // 触摸端也给它（和旁边的 T）配了放大命中区，见上面 laneMetaHit。
        o.push(pgo.join(''));
      }
      o.push('</g>');
    });
    // 分组括号（对照上游 render-groups 的画法）：一条花括号从该组首行跨到末行，组名
    // **竖排**（rotate -90）贴在括号左侧；嵌套时逐层**向右**再让一格（外组在左、内组在右，
    // 与上游一致）。括号本身不吃事件（点它等于点这一行），组名在编辑态可点改。
    // 尺寸对齐上游：组名字号与行名相同（12）、离括号 10、描边实心（上游是不透明的 1px 线）。
    // 基线不设 dominant-baseline：上游用默认 alphabetic，字形从基线向**左**长；加了 central
    // 会让字形以基线为轴上下各伸一半，右半正好压到括号竖线上（实测重叠 2.5px）。
    var gEdit=can('laneMeta');
    groupRuns(ir.lanes, gDepth).forEach(function(g){
      var y0=TOP+g.from*ROW_H+4, y1=TOP+(g.to+1)*ROW_H-4, h=y1-y0;
      if(h<10) return;
      // bx 是括号的**起点**：钩子向右伸 5px，竖线落在 bx-5；组名放在 bx-10（与上游同值）。
      var bx=PAD+g.depth*GSLOT+GSLOT-6, cy=(y0+y1)/2, lx=bx-10;
      var brace='M'+bx+','+y0+' c -3,0 -5,2 -5,5 l 0,'+(h-10)+' c 0,3 2,5 5,5';
      // 编辑态的可点区：整条括号高度 × 本层槽位宽（原来只有竖排名字形本身 —— 实测 15×21px，
      // 触摸端 10×14px，手指根本点不中，等于「组只能靠源码改」）。它画在括号之前、
      // 只做命中，不改任何视觉。
      // 点它要改的是**这一层**（第 depth 层），不是该行最内层的路径 —— 所以带的是
      // 「前 depth+1 段」的完整路径（此前只带行 id，点外层括号会去改最内层那一段）。
      var gpath=ir.lanes[g.from].groupPath.slice(0,g.depth+1).join('/');
      var hit=gEdit?'<rect class="groupHit" data-group="'+esc(gpath)+'" x="'+(bx-GSLOT)+'" y="'+y0+
        '" width="'+GSLOT+'" height="'+h+'" fill="transparent" style="cursor:text"/>':'';
      o.push('<g class="groupBrace">'+
        '<path d="'+brace+'" fill="none" stroke="var(--accent)" stroke-width="1" pointer-events="none"/>'+hit+
        '<text class="laneGroupName"'+(gEdit?' data-act="group" data-group="'+esc(gpath)+'"':'')+
        ' x="'+lx+'" y="'+cy+'" transform="rotate(-90 '+lx+' '+cy+')" text-anchor="middle"'+
        ' font-size="12" fill="var(--accent)"'+(gEdit?' style="cursor:text"':'')+'>'+esc(g.name)+'</text>'+
        '</g>');
    });
    o.push(edgeArcs(ir));
    // 选中框 / 连线端点光标：框的是「一个字符格」，几何必须跟该行自己的标尺走
    // （period 行的格子更宽、phase 行整体左移）。helper 只在这里用，就放在用它的地方。
    function selBox(l, tick){
      var g=cellGeo(l,tick), x=Math.max(g.x0+1,XS);
      return {x:x, w:Math.max(1,g.x0+g.w-1-x)};
    }
    // 连线模式只画端点光标（键盘操作定位），不画普通选中框、不弹字符条
    if(state.linkMode&&state.linkCursor){
      var lcLane=null, lci=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.linkCursor.lane){ lci=k; lcLane=l; } });
      if(lcLane&&lci>=0&&state.linkCursor.tick<laneChars(lcLane,N)){
        var lb=selBox(lcLane,state.linkCursor.tick);
        o.push('<rect class="linkCursor" x="'+lb.x+'" y="'+(TOP+lci*ROW_H+3)+'" width="'+lb.w+'" height="'+(ROW_H-10)+'" rx="3" role="img" aria-label="Link endpoint cursor"></rect>');
      }
    }
    if(!state.linkMode&&state.selCell){
      var scLane=null, sli=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.selCell.lane){ sli=k; scLane=l; } });
      if(scLane&&sli>=0&&state.selCell.tick<laneChars(scLane,N)){
        var sb=selBox(scLane,state.selCell.tick);
        o.push('<rect class="cellSel" x="'+sb.x+'" y="'+(TOP+sli*ROW_H+3)+'" width="'+sb.w+'" height="'+(ROW_H-10)+'" rx="3"/>');
      }
    }
    o.push('</svg>');
    wrap.innerHTML=o.join('');
    ctx.renderGutter();
  }

  ctx.redraw=redraw;
  return { redraw:redraw };
}
