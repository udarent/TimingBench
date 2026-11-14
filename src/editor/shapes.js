// 时序图 SVG 结构：HUD / 列头 / 行工具 / 数据标签徽标 / 弧线 /
// 候选字符条 / redraw。只负责「把 state 画成图」，不处理事件、不回写源码。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc, cut } from '../core/util.js';
import { TOUCH } from './mode.js';
import { EMBED } from './embed.js';
import * as Cap from './cap.js';
import { waveGlyph, waveGap, chipGlyph, chipDesc, busClassOf } from './waveform.js';

var T=TOUCH;   // 本模块内的 T 只表示 coarse 指针标志（波形图元里的 T 是上沿 y 坐标，已移到 waveform.js）
var CELL=G.CELL, NAME_W=G.NAME_W, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD, ACT_W=G.ACT_W;
var COL_Y=G.COL_Y, ACT_H=G.ACT_H;
var CHIP_W=G.CHIP_W, CHIP_H=G.CHIP_H, CHIP_STEP=G.CHIP_STEP;
var XS=G.XS, CHIPS_W=G.CHIPS_W;
// 分组每嵌套一层要在行名左侧让出的槽宽（花括号 + 竖排组名占这一条）。
// 取「格宽的 0.63」—— 与上游一致（WaveDrom 层间距 25 / 格宽 40 = 0.63）；层间距太窄时
// 竖排组名会贴着内层括号，长组名还会顶到行名。
var GSLOT=T?30:24;

export function createShapes(ctx){
  var state=ctx.state, wrap=ctx.wrap;
  // 当前场景（desk|touch × Edit|Card）。所有「画不画某个控件」的判据一律查 cap.js 的能力表：
  // `can('rowTool')` 读起来就是「这个场景该不该画行工具」，比 `if(T||state.readonly)` 好审。
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



  // 列头 + / − / |：悬停才显现；第 N 个「幽灵列头」只承担末尾追加周期。
  // 竖直位置压在 COL_Y+16 … COL_Y+30 这一条：上边留给列号，下边正好抵到 TOP，
  // 不与第一行 laneRow 重叠 —— 否则按钮下沿会被行矩形盖住、点上去命中的是行。
  function colBtn(c,cx,k,act,txt,title,on){
    if(!can('colAct')) return '';   // 触摸端换成上下文图标条（swap）；只读态不提供列操作（off）
    var x=cx-18+k*12.5, w=11;
    return '<g class="colActBtn" data-cact="'+act+'" data-c="'+c+'" role="button" aria-label="'+esc(title)+'">'+
      '<rect x="'+x+'" y="'+(COL_Y+16)+'" width="'+w+'" height="14" rx="3" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line2)')+'" stroke-width="0.6"/>'+
      '<text x="'+(x+w/2)+'" y="'+(COL_Y+23)+'" text-anchor="middle" dominant-baseline="central" font-size="9" fill="'+(on?'var(--accent)':'var(--muted)')+'">'+esc(txt)+'</text></g>';
  }

  // 行工具：只保留互不重复的修改；行重排已统一交给行首拖拽把手
  // 只读卡片上整组撤掉：它们是编辑入口，点上去也只会被「点一下进编辑」拦下来。
  function rowTools(l,y,ACT_X){
    if(!can('rowTool')) return '';   // 触摸端换成上下文条（swap）；只读卡片整组撤掉（off）
    var o=[], x=ACT_X+4, isSp=l.kind==='spacer';
    function add(act,txt,w,title){
      o.push('<g class="rowTool" data-act="'+act+'" data-lane="'+l.id+'" role="button" aria-label="'+esc(title)+'" style="cursor:pointer">'+
        '<rect x="'+x+'" y="'+(y+8)+'" width="'+w+'" height="20" rx="4" stroke="var(--line2)" stroke-width="0.6"/>'+
        '<text x="'+(x+w/2)+'" y="'+(y+18)+'" text-anchor="middle" dominant-baseline="central" fill="var(--ink)">'+esc(txt)+'</text></g>');
      x+=w+3;
    }
    if(!isSp){
      add('wave','~',20,'Row wave string — click to edit');
      add('data','=',20,'Row data labels — click to edit');
      add('node','◇',20,'Row node markers — click to edit');
    }
    add('add','+',20,'Add a signal below this row');
    add('spacer','∅',20,'Add a spacer below this row');
    add('del','✕',20,'Delete this row');
    return '<g class="rowCtl">'+o.join('')+'</g>'+
      '<text class="rowHint" x="'+(ACT_X+8)+'" y="'+(y+23)+'" font-size="13" fill="var(--muted)">⋯</text>';
  }

  // 行首拖拽把手：行位置调整的唯一交互
  // 只读卡片不画：没有拖拽这回事，画出来只是个不能用的点心。

  // 一次解析 edge 字符串：<from><shape><to> [label]
  // shape 取教程列出的字符：`~` 曲线、`-` 水平、`|` 垂直、`+` 直角；`<` / `>` 是两端的箭头。
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
  // 端点箭头：三角沿切线方向指到 tip（back/half 与旧实现一致，保证 a~>b 的 d 逐字节不变）
  function arrowTri(tip, from) {
    var ux = tip.x - from.x, uy = tip.y - from.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    var back = 7.5, half = 3.2;
    var abx = tip.x - ux * back, aby = tip.y - uy * back, apx = -uy, apy = ux;
    return 'M' + tip.x + ',' + tip.y + ' L' + (abx + apx * half) + ',' + (aby + apy * half) +
      ' L' + (abx - apx * half) + ',' + (aby - apy * half) + ' z';
  }
  // 形状 → 路径。含 `~`（或空）走三次贝塞尔（控制点与旧实现一致）；其余（`-`/`|`/`+`）走正交折线：
  // 无竖段=直线，一段横+竖=L 形，两段横=Z 形 —— 对应教程的 Splines / Sharp lines 两类。
  function edgePath(a, b, shape) {
    if (shape.indexOf('~') >= 0 || shape === '') {
      var c1x = a.x + 10, c1y = a.y - 26, c2x = b.x - 10, c2y = b.y - 26;
      return {
        d: 'M' + a.x + ',' + a.y + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + b.x + ',' + b.y,
        endFrom: { x: c2x, y: c2y }, startFrom: { x: c1x, y: c1y }
      };
    }
    var vert = 0, horiz = 0, i;
    for (i = 0; i < shape.length; i++) { if (shape[i] === '|') vert++; else horiz++; }
    var pts = [{ x: a.x, y: a.y }];
    if (vert === 0) pts.push({ x: b.x, y: b.y });
    else if (horiz <= 1) { pts.push({ x: b.x, y: a.y }); pts.push({ x: b.x, y: b.y }); }
    else { var mx = (a.x + b.x) / 2; pts.push({ x: mx, y: a.y }); pts.push({ x: mx, y: b.y }); pts.push({ x: b.x, y: b.y }); }
    var d = 'M' + pts[0].x + ',' + pts[0].y;
    for (i = 1; i < pts.length; i++) d += ' L' + pts[i].x + ',' + pts[i].y;
    return { d: d, endFrom: pts[pts.length - 2], startFrom: pts[1] };
  }
  // 弧线：唯一「编辑 / 删除 edge」入口是双击弧线本体；清空字符串即删除
  function edgeArcs(ir) {
    var map = {};
    ir.lanes.forEach(function (l, li) {
      if (l.kind !== 'signal') return;
      l.node.forEach(function (ch, t) { if (ch && ch !== '.' && !map[ch]) map[ch] = { x: XS + t * CELL + CELL / 2, y: TOP + li * ROW_H + 7 }; });
    });
    var o = [];
    ir.edges.forEach(function (e, i) {
      var pe = parseEdge(e); if (!pe) return;
      var a = map[pe.from], b = map[pe.to];
      if (!a || !b) return;
      var g = edgePath(a, b, pe.shape), paths = [];
      // 曲线本体 + 末端 / 首端箭头 + 命中带（顺序与旧实现一致：默认 a~>b 的 .edgeArc path 指纹不变）
      paths.push('<path d="' + g.d + '" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".75" pointer-events="none"/>');
      var explicitArrow = pe.start || pe.end;
      if (pe.end || !explicitArrow) paths.push('<path d="' + arrowTri(b, g.endFrom) + '" fill="var(--accent)" opacity=".85" pointer-events="none"/>');
      if (pe.start) paths.push('<path d="' + arrowTri(a, g.startFrom) + '" fill="var(--accent)" opacity=".85" pointer-events="none"/>');
      // 连线模式下弧线命中带让位给同一区域的波形格：端点由 rect.cell 统一接收
      paths.push('<path d="' + g.d + '" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="' + (T ? 20 : 8) + '" pointer-events="' + (state.linkMode ? 'none' : 'stroke') + '"/>');
      var inner = paths.join('');
      if (pe.label) {
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 22, lw = Math.max(22, pe.label.length * 6 + 10);
        inner += '<rect x="' + (mx - lw / 2) + '" y="' + (my - 9) + '" width="' + lw + '" height="16" rx="4" fill="var(--panel)" stroke="var(--line)" stroke-width="0.5" pointer-events="none"/>' +
          '<text x="' + mx + '" y="' + (my + 1) + '" text-anchor="middle" dominant-baseline="central" font-size="9" fill="var(--accent)" pointer-events="none">' + esc(cut(pe.label, 18)) + '</text>';
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
    // 只读态与编辑态共用同一套排版（格子、行高、字号、网格都不变）：只读卡片只是
    // 「少画编辑控件」，不是另一套版式。行名区宽度在这里按内容重算（两态同一算法），
    // 避免任何调用方改动过后残留旧值。
    // 行名左界：桌面被行首拖拽把手顶到 PAD+18，触摸端不画把手、左界只有 PAD。
    var nameKey=SC+'|'+ir.lanes.map(function(l){
      return l.kind==='spacer'?'':(l.name+'/'+l.phase+'/'+l.period+'/'+(l.groupPath||[]).join('>'));
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
    G.CHIPS_W=XS+Core.ALL.length*CHIP_STEP+16;
    var N=ir.ticks, ACT_X=XS+N*CELL;
    // 卡片可视宽度：操作层按它排布，保证所有按钮不用横向滚动就能点到。
    // 最小 240 防止未布局（隐藏标签页）时算出 0 列。
    var viewW=Math.max(240, Math.round(wrap.clientWidth||0)||360);
    var viewH=Math.max(0, Math.round(wrap.clientHeight||0));
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
    // 所以画布不必为它们预留高度 —— barH 恒为 0，画布高度由 flex 自动让出。
    var barH=0;
    // 嵌入卡片：高度只按内容算（宿主据此设 iframe 高度，避免下方留一片空白）；
    // 整页模式：内容高于视口时抬高到视口高度，让钉住的底栏有可见滚动终点。
    // 只读嵌入卡片底部收到 12px（编辑态仍留 20，字符条 / 停靠条需要落点）
    var contentH=actY+barH+((state.embedCard&&state.readonly)?roTrimBottom:20);
    var H=state.embedCard?contentH:Math.max(contentH, viewH), c, x;
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
    state.barY=actY; state.barH=barH; state.viewW=viewW; state.fit=outW/W;
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
    for(c=0;c<=N;c++){
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
      // 列动作（+ − |）已收进上下文条：这里只在能力表允许时画（目前四场景都是 off，
      // 桌面改成「选中列 → 右侧面板」）。
      if(can('colAct')) o.push('<g class="colAct">'+colBtn(c,cx,0,'insert','+',ghost?'Append a cycle at the end':'Insert a cycle before column '+c)+
        (!ghost ? colBtn(c,cx,1,'delete','−','Delete the cycle of column '+c)+
        colBtn(c,cx,2,'gap','|','Toggle the phase line on column '+c,gapc) : '')+'</g>');
      o.push('</g>');
    }
    if(isEmpty) o.push(emptyRow(W));
    ir.lanes.forEach(function(l,li){
      var y=TOP+li*ROW_H;
      var yT=y+Math.round(ROW_H*0.25), yM=y+Math.round(ROW_H*0.48), yB=y+Math.round(ROW_H*0.71);
      var cellH=ROW_H-10, i, hi=state.selLane===l.id;
      o.push('<g class="laneGrp'+(hi?' sel':'')+'" data-lane="'+l.id+'">');
      o.push('<rect class="laneRow" data-lane="'+l.id+'" x="'+PAD+'" y="'+(y+1)+'" width="'+(W-PAD*2)+'" height="'+(ROW_H-2)+'" rx="3" fill="'+(hi?'var(--accent-bg)':'transparent')+'" style="cursor:pointer"/>');
      if(l.kind==='spacer'){
        // 只读卡片上这是一段纯留白（上游同样不画任何东西）；只有编辑态才给虚线 + 字样，
        // 否则读者会看到一条莫名其妙的「spacer」文字。
        if(can('spacerMark')){
          o.push('<line x1="'+XS+'" y1="'+yM+'" x2="'+ACT_X+'" y2="'+yM+'" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="2 5"/>');
          o.push('<text x="'+(XS+8)+'" y="'+(yM-6)+'" font-size="9" fill="var(--muted)">spacer</text>');
        }
        o.push(rowTools(l,y,ACT_X)); o.push('</g>');
        return;
      }
      // 相位 / 周期是「可点改」的编辑入口，只读卡片上撤掉。
      // 分组名不再挂在行名后面：它画在左侧括号旁（竖排，见下面的 groupRuns 渲染）。
      var meta=can('laneMeta')?'<tspan class="laneMeta" data-act="phase" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> φ'+l.phase+'</tspan>'+
        '<tspan class="laneMeta" data-act="period" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> T'+l.period+'</tspan>':'';
      // 右缘留 6（原 8）：行名与波形之间的空隙由 geometry.js 的 XS 统一控制，
      // 这里只留字形本身的呼吸位，两处加起来正好 8px。
      o.push('<text class="laneName" data-lane="'+l.id+'" x="'+(NAME_W-6)+'" y="'+yM+'" text-anchor="end" dominant-baseline="central" font-size="12" fill="var(--ink)">'+
        '<tspan class="laneNameText" data-act="name">'+esc(l.name)+'</tspan>'+meta+'</text>');
      // 相邻两状态点决定过渡沿：只有显式状态点才带，repeater 沿用上一状态画稳态
      // 画布按全局 N 个周期绘制；wave 较短的行，尾部缺失周期按 repeater 延续补画并留出可续写格子
      var lastPoint=null, lastW=l.slots.length?l.slots[l.slots.length-1].w:'x';
      // bus 段合并：延续格（repeater / 超出行尾的补齐格）与相邻同段格之间不画斜边。
      // 判据用 slot 的 point 标志 —— 它正是「用户写了字符」与「延续而来」的分界。
      var wsAt=function(k){ var q=k<l.slots.length?l.slots[k]:null; return q?q.w:lastW; };
      var ptAt=function(k){ var q=k<l.slots.length?l.slots[k]:null; return q?(q.point&&!q.gap):false; };
      for(i=0;i<N;i++){
        var s=i<l.slots.length?l.slots[i]:null, x0=XS+i*CELL, w=s?s.w:lastW;
        var isPoint=s?(s.point&&!s.gap):false, prevCh=isPoint?lastPoint:null;
        if(isPoint) lastPoint=w;
        var gopt={label:s&&isPoint?s.label:null};
        if(Core.BUS.test(w)){
          var ljoin=i>0&&!ptAt(i)&&Core.BUS.test(wsAt(i-1));
          var rjoin=(i+1<N)&&!ptAt(i+1)&&Core.BUS.test(wsAt(i+1));
          gopt.seg=ljoin?(rjoin?'mid':'end'):(rjoin?'start':'only');
          gopt.cls=busClassOf(w);
        }
        var glyph=waveGlyph(w,prevCh,x0,yT,yM,yB,CELL,gopt);
        o.push(s?glyph:'<g class="tailSlot" role="img" aria-label="Undefined period — tap to extend">'+glyph+'</g>');
        if(s&&s.gap) o.push(waveGap(x0,yT,yB));
        o.push('<rect class="cell'+(s?'':' tailCell')+'" data-lane="'+l.id+'" data-tick="'+i+'"'+(s?'':' data-tail="1"')+
          ' x="'+(x0+1)+'" y="'+(y+3)+'" width="'+(CELL-2)+'" height="'+cellH+'" fill="transparent" style="cursor:crosshair"/>');
      }
      o.push('<line x1="'+XS+'" y1="'+(y+ROW_H)+'" x2="'+ACT_X+'" y2="'+(y+ROW_H)+'" stroke="var(--line)" stroke-width="0.5"/>');
      o.push('<rect class="waveZone" data-lane="'+l.id+'" x="'+XS+'" y="'+(y+Math.round(ROW_H*0.19))+'" width="'+(N*CELL)+'" height="'+Math.round(ROW_H*0.46)+'" fill="none" stroke="none" pointer-events="none"/>');
      o.push(rowTools(l,y,ACT_X));
      // node 字母：上游会把 `node: '..a...'` 的 a / b 画成小字母标在锚点处，
      // 它是 edge 的可读锚点 —— 不画的话读者只看到一条曲线，不知道连的是哪两点。
      // 这属于「图的内容」，与 data 标签同类，不受零常驻文字约束。
      for(i=0;i<N&&i<l.node.length;i++){
        var nc=l.node[i];
        if(!nc||nc==='.') continue;
        o.push('<text class="waveNode" x="'+(XS+i*CELL+CELL/2+8)+'" y="'+(yT-2)+'" text-anchor="middle" font-size="10" fill="var(--accent)">'+esc(nc)+'</text>');
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
      o.push('<g class="groupBrace">'+
        '<path d="'+brace+'" fill="none" stroke="var(--accent)" stroke-width="1" pointer-events="none"/>'+
        '<text class="laneGroupName"'+(gEdit?' data-act="group" data-lane="'+ir.lanes[g.from].id+'"':'')+
        ' x="'+lx+'" y="'+cy+'" transform="rotate(-90 '+lx+' '+cy+')" text-anchor="middle"'+
        ' font-size="12" fill="var(--accent)"'+(gEdit?' style="cursor:text"':'')+'>'+esc(g.name)+'</text>'+
        '</g>');
    });
    o.push(edgeArcs(ir));
    // 连线模式只画端点光标（键盘操作定位），不画普通选中框、不弹字符条
    if(state.linkMode&&state.linkCursor){
      var lci=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.linkCursor.lane) lci=k; });
      if(lci>=0&&state.linkCursor.tick<N) o.push('<rect class="linkCursor" x="'+(XS+state.linkCursor.tick*CELL+1)+'" y="'+(TOP+lci*ROW_H+3)+'" width="'+(CELL-2)+'" height="'+(ROW_H-10)+'" rx="3" role="img" aria-label="Link endpoint cursor"></rect>');
    }
    if(!state.linkMode&&state.selCell){
      var sli=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.selCell.lane) sli=k; });
      if(sli>=0&&state.selCell.tick<N) o.push('<rect class="cellSel" x="'+(XS+state.selCell.tick*CELL+1)+'" y="'+(TOP+sli*ROW_H+3)+'" width="'+(CELL-2)+'" height="'+(ROW_H-10)+'" rx="3"/>');
    }
    o.push('</svg>');
    wrap.innerHTML=o.join('');
    ctx.renderGutter();
  }

  ctx.redraw=redraw;
  return { redraw:redraw };
}
