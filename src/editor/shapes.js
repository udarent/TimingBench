// 时序图 SVG 结构：HUD / 列头 / 行工具 / 数据标签徽标 / 弧线 /
// 候选字符条 / redraw。只负责「把 state 画成图」，不处理事件、不回写源码。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc, cut } from '../core/util.js';
import { TOUCH } from './mode.js';
import { waveGlyph, waveGap, chipGlyph, chipDesc } from './waveform.js';

var T=TOUCH;   // 本模块内的 T 只表示 coarse 指针标志（波形图元里的 T 是上沿 y 坐标，已移到 waveform.js）
var CELL=G.CELL, NAME_W=G.NAME_W, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD, ACT_W=G.ACT_W;
var CMD_Y=G.CMD_Y, CMD_H=G.CMD_H, COL_Y=G.COL_Y, ACT_H=G.ACT_H;
var CHIP_W=G.CHIP_W, CHIP_H=G.CHIP_H, CHIP_STEP=G.CHIP_STEP;
var XS=G.XS, CHIPS_W=G.CHIPS_W;

export function createShapes(ctx){
  var state=ctx.state, wrap=ctx.wrap;
  function hudBtn(x,cmd,txt,title,on,dim){
    var bw=T?44:26, br=T?8:5, fs=T?18:13;
    return '<g class="hudBtn" data-cmd="'+cmd+'" role="button" aria-label="'+esc(title)+'">'+
      '<rect x="'+x+'" y="'+CMD_Y+'" width="'+bw+'" height="'+CMD_H+'" rx="'+br+'" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line)')+'" stroke-width="0.7" opacity="'+(dim?'.4':'1')+'"/>'+
      '<text x="'+(x+bw/2)+'" y="'+(CMD_Y+CMD_H/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+fs+'" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(txt)+'</text></g>';
  }
  // HUD 是卡片顶栏：坐标相对视口，随横向 / 纵向滚动反向位移，始终钉在可视区左上角。
  // 背景宽度取可视宽度而不是整张画布，避免顶栏拉成一条超出卡片的长带。
  function hudSVG(viewW){
    var sy=wrap.scrollTop;
    var o=['<g class="hudBar" transform="translate('+wrap.scrollLeft+','+sy+')">'];
    o.push('<rect x="0" y="0" width="'+viewW+'" height="'+(T?CMD_Y+CMD_H+4:COL_Y-4)+'" fill="var(--bg)"/>');
    var x=PAD;
    function cmd(c,t,title,dim,on){ o.push(hudBtn(x,c,t,title,!!on,dim)); x+=T?50:31; }
    cmd('undo','↶','Undo (Ctrl+Z)',!state.undo.length);
    cmd('redo','↷','Redo (Ctrl+Y)',!state.redo.length);
    cmd('link','◇',state.linkMode?'Linking: click the second cell · K to exit · arrows to move · Enter to pick':'Link mode: click two cells, or press K then arrows + Enter',false,state.linkMode);
    cmd('embed','<>','Embed code: a snippet you can paste into your page',false,false);
    o.push('</g>');
    return o.join('');
  }



  // 列头 + / − / |：悬停才显现；第 N 个「幽灵列头」只承担末尾追加周期
  function colBtn(c,cx,k,act,txt,title,on){
    if(T) return '';   // 触摸端列操作移到选中列后出现的上下文图标条，避免 11px 命中区
    var x=cx-18+k*12.5, w=11;
    return '<g class="colActBtn" data-cact="'+act+'" data-c="'+c+'" role="button" aria-label="'+esc(title)+'">'+
      '<rect x="'+x+'" y="'+(COL_Y+22)+'" width="'+w+'" height="18" rx="3" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line2)')+'" stroke-width="0.6"/>'+
      '<text x="'+(x+w/2)+'" y="'+(COL_Y+31)+'" text-anchor="middle" dominant-baseline="central" font-size="10" fill="'+(on?'var(--accent)':'var(--muted)')+'">'+esc(txt)+'</text></g>';
  }

  // 行工具：只保留互不重复的修改；行重排已统一交给行首拖拽把手
  function rowTools(l,y,ACT_X){
    if(T) return '';   // 触摸端行工具移到选中行后出现的上下文图标条
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
  function dragHandle(l,y){
    if(T) return '';   // 触摸端改用「↑ 上移 / ↓ 下移」，不与原生滚动抢手势
    return '<g class="rowDrag" data-drag="'+l.id+'" role="button" aria-label="Drag to reorder this row">'+
      '<rect x="'+(PAD+2)+'" y="'+(y+8)+'" width="16" height="32" rx="3" fill="transparent"/>'+
      '<text x="'+(PAD+10)+'" y="'+(y+24)+'" text-anchor="middle" dominant-baseline="central" font-size="13" fill="var(--muted)" pointer-events="none">⠿</text></g>';
  }

  // 数据标签的唯一编辑入口：长在总线块右下角的 ✎ 徽标，单击就地编辑 data 标签
  function cellLabelHit(l,i,x0,y,label){
    if(T) return '';   // 触摸端数据标签由长按/点标签徽标编辑，不在画布画 hover 徽标
    // 画在数据块下缘、格子底部：避开中心的标签文字与顶部的节点锚点
    var bx=x0+CELL-15, by=y+30, txt=label?String(label):'';
    return '<g class="cellLabel" data-lane="'+l.id+'" data-tick="'+i+'" data-label="1">'+
      ''+
      '<rect x="'+bx+'" y="'+by+'" width="13" height="11" fill="transparent"/>'+
      '<g class="badge"><rect x="'+bx+'" y="'+by+'" width="13" height="11" rx="3" fill="var(--panel)" stroke="var(--line2)" stroke-width="0.7"/>'+
      '<text x="'+(bx+6.5)+'" y="'+(by+8)+'" text-anchor="middle" font-size="9" fill="var(--muted)">✎</text></g></g>';
  }

  // 弧线：唯一「编辑 / 删除 edge」入口是双击弧线本体；清空字符串即删除
  function edgeArcs(ir){
    var map={};
    ir.lanes.forEach(function(l,li){
      if(l.kind!=='signal') return;
      l.node.forEach(function(ch,t){ if(ch&&ch!=='.'&&!map[ch]) map[ch]={x:XS+t*CELL+CELL/2,y:TOP+li*ROW_H+7}; });
    });
    var o=[];
    ir.edges.forEach(function(e,i){
      var s=String(e), head=s.trim().split(/\s+/)[0]||'', a=map[head.charAt(0)], b=map[head.charAt(head.length-1)];
      if(!a||!b) return;
      var d='M'+a.x+','+a.y+' C'+(a.x+10)+','+(a.y-26)+' '+(b.x-10)+','+(b.y-26)+' '+b.x+','+b.y;
      // 连线模式下弧线命中带让位给同一区域的波形格：端点由 rect.cell 统一接收
      o.push('<g class="edgeArc" data-eidx="'+i+'" role="button" aria-label="Edit edge '+esc(s)+'">'+
        '<path d="'+d+'" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".75" pointer-events="none"/>'+
        '<path d="'+d+'" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="'+(T?20:8)+'" pointer-events="'+(state.linkMode?'none':'stroke')+'"/>');
      var rest=s.slice(head.length).trim();
      if(rest){
        var mx=(a.x+b.x)/2, my=(a.y+b.y)/2-22, lw=Math.max(22,rest.length*6+10);
        o.push('<rect x="'+(mx-lw/2)+'" y="'+(my-9)+'" width="'+lw+'" height="16" rx="4" fill="var(--panel)" stroke="var(--line)" stroke-width="0.5" pointer-events="none"/>'+
          '<text x="'+mx+'" y="'+(my+1)+'" text-anchor="middle" dominant-baseline="central" font-size="9" fill="var(--accent)" pointer-events="none">'+esc(cut(rest,18))+'</text>');
      }
      o.push('</g>');
    });
    return o.join('');
  }

  // 底部上下文条：普通状态选中格才出现字符条；连线模式整条留白（两种操作互斥，
  // 也不再画任何指示圆点）。
  // 卡片口径：字符条按**可视宽度**换行（只扩纵向、不超横向），整组钉在可视区底部 ——
  // 内容矮于视口时仍落在画布底部；内容高于视口时向上吸附，随纵向滚动保持可见。
  function actionBar(y,W,perRow,viewW,barH,barLeft){
    var sy=wrap.scrollTop, oy=Math.min(0, sy+wrap.clientHeight-barH-8-y);
    var o=['<g class="charChips" transform="translate('+wrap.scrollLeft+','+oy+')">'];
    if(!state.linkMode&&state.selCell){
      // 底板只在字符条真正出现时铺，避免无选中时挡住底部波形
      o.push('<rect x="0" y="'+y+'" width="'+viewW+'" height="'+barH+'" fill="var(--bg)"/>');
    }
    o.push('<line x1="'+PAD+'" y1="'+y+'" x2="'+(viewW-PAD)+'" y2="'+y+'" stroke="var(--line)" stroke-width="0.5"/>');
    if(!state.linkMode&&state.selCell){
      Core.ALL.forEach(function(v,i){
        var on=state.ch===v;
        var bx=barLeft+(i%perRow)*CHIP_STEP, by=y+6+Math.floor(i/perRow)*(CHIP_H+6), cy=by+CHIP_H/2;
        o.push('<g class="charChip'+(on?' on':'')+'" data-ch="'+esc(v)+'" role="button" aria-label="Write '+esc(v)+' — '+esc(chipDesc(v))+'">'+
          '<rect x="'+bx+'" y="'+by+'" width="'+CHIP_W+'" height="'+CHIP_H+'" rx="5" fill="var(--panel)" stroke="var(--line2)" stroke-width="0.7"/>'+
          '<g class="chipWave" transform="translate('+bx+','+by+')">'+chipGlyph(v)+'</g>'+
          '<text x="'+(bx+CHIP_W/2)+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" font-size="'+(T?15:11)+'" font-family="var(--mono)" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(v)+'</text></g>');
      });
    }
    o.push('</g>');
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
    var N=ir.ticks, ACT_X=XS+N*CELL;
    // 卡片可视宽度：操作层按它排布，保证所有按钮不用横向滚动就能点到。
    // 最小 240 防止未布局（隐藏标签页）时算出 0 列。
    var viewW=Math.max(240, Math.round(wrap.clientWidth||0)||360);
    var viewH=Math.max(0, Math.round(wrap.clientHeight||0));
    // 波形层仍按内容撑宽并允许横向滚动；但至少铺满卡片，便于钉住的顶栏 / 底栏有落脚宽度。
    // 只读态（嵌入卡片默认）不画行工具，也就不再为它预留 ACT_W —— 否则卡片右侧会空出一条
    // 永远点不到的带子，占掉缩放后本可以画波形的宽度。
    var W=Math.max(ACT_X+(state.readonly?PAD:ACT_W)+PAD, viewW, 560), bottom=TOP+ir.lanes.length*ROW_H;
    // 零行时波形区高度为 0，占位行需要占一行高度，否则会被算到画布外
    var isEmpty=ir.lanes.length===0;
    if(isEmpty) bottom=TOP+ROW_H;
    var actY=bottom+4;
    // 可视宽度够放下整排时，仍从波形起点 XS 起排（与格子对齐，保持原版式观感）；
    // 放不下才退到卡片左缘用满整行宽度，靠多行纵向堆叠消化。
    var barLeft=(XS+Core.ALL.length*CHIP_STEP+PAD<=viewW)?XS:PAD;
    var perRow=Math.max(1, Math.min(Core.ALL.length, Math.floor((viewW-barLeft-PAD)/CHIP_STEP)));
    var rows=Math.ceil(Core.ALL.length/perRow);
    // 只读态不画字符条，也不需要为它预留高度（否则卡片底部会留一条空白）
    var barH=state.readonly?0:Math.max(ACT_H,(state.selCell?rows*(CHIP_H+6)+12:ACT_H));
    // 嵌入卡片：高度只按内容算（宿主据此设 iframe 高度，避免下方留一片空白）；
    // 整页模式：内容高于视口时抬高到视口高度，让钉住的底栏有可见滚动终点。
    var contentH=actY+barH+20;
    var H=state.embedCard?contentH:Math.max(contentH, viewH), c, x;
    // 嵌入只读卡片：整张图按卡片宽度等比缩小，让波形一次全显示 —— 读者不会去横向拖一张
    // 只读卡片。进入编辑后 fit=1，恢复 1:1 + 滚动，保证点选精度。
    // 只改 svg 的渲染尺寸，viewBox 仍是内部坐标 ⇒ 所有图元几何、getBBox 与就地编辑的
    // 坐标换算都不受影响，波形层指纹也不受影响。
    var fit=(state.embedCard&&state.readonly)?Math.min(1, viewW/W):1;
    var outW=fit<1?viewW:W;
    var outH=fit<1?Math.round(H*outW/W):H;
    state.barY=actY; state.barH=barH; state.viewW=viewW; state.fit=fit;
    // 高度上报用缩放后的真实像素高，否则宿主会按原始高设 iframe，底部留一片空白。
    state.contentH=state.embedCard?outH:contentH;
    state.W=W; state.H=H;
    var o=['<svg width="'+outW+'" height="'+outH+'" viewBox="0 0 '+W+' '+H+'" class="'+(state.linkMode?'linkMode':'')+'" role="img" aria-label="Timing diagram editor">'];
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(TOP-12)+'" fill="var(--bg)"/>');
    // 只读（嵌入卡片默认态）：不画 HUD、不画字符条，只留波形本身。
    if(!state.readonly) o.push(hudSVG(viewW));
    for(c=0;c<=N;c++){ x=XS+c*CELL; o.push('<line x1="'+x+'" y1="'+(TOP-10)+'" x2="'+x+'" y2="'+bottom+'" stroke="var(--line)" stroke-width="0.5"/>'); }
    // 零行空态不画列头：0 个周期时列号与「末尾追加」都没有意义，
    // 而幽灵列头的 + 会正好压在占位行上。
    for(c=0;c<=N&&!isEmpty;c++){
      var cx=XS+c*CELL+CELL/2, selc=state.sel===c, ghost=c===N;
      var gapc=ghost?false:ir.lanes.some(function(l){ return l.kind==='signal'&&l.slots[c]&&l.slots[c].gap; });
      o.push('<g class="colhead'+(selc?' sel':'')+(ghost?' ghost':'')+'" data-c="'+c+'" role="img" aria-label="Column '+c+(ghost?' — append a cycle':'')+'">');
      // 整列列头透明命中区：让悬停 / 点击落在列头上，而不是落到背景矩形
      o.push('<rect x="'+(XS+c*CELL+1)+'" y="'+(COL_Y-2)+'" width="'+(CELL-2)+'" height="'+(TOP-COL_Y-2)+'" fill="transparent"/>');
      var cw=T?Math.min(CELL-2,44):30, ch=T?28:20;
      o.push('<rect x="'+(cx-cw/2)+'" y="'+COL_Y+'" width="'+cw+'" height="'+ch+'" rx="4" fill="'+(selc?'var(--accent-bg)':'transparent')+'" stroke="'+(selc?'var(--accent)':'var(--line)')+'" stroke-width="0.5" '+(ghost?'stroke-dasharray="2 2"':'')+'/>');
      o.push('<text x="'+cx+'" y="'+(COL_Y+ch/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+(T?13:11)+'" fill="'+(selc?'var(--accent)':'var(--muted)')+'">'+c+'</text>');
      o.push('<g class="colAct">'+colBtn(c,cx,0,'insert','+',ghost?'Append a cycle at the end':'Insert a cycle before column '+c));
      if(!ghost) o.push(colBtn(c,cx,1,'delete','−','Delete the cycle of column '+c)+
        colBtn(c,cx,2,'gap','|','Toggle the phase line on column '+c,gapc));
      o.push('</g></g>');
    }
    if(isEmpty) o.push(emptyRow(W));
    ir.lanes.forEach(function(l,li){
      var y=TOP+li*ROW_H;
      var yT=y+Math.round(ROW_H*0.25), yM=y+Math.round(ROW_H*0.48), yB=y+Math.round(ROW_H*0.71);
      var cellH=ROW_H-10, i, hi=state.selLane===l.id, laneBadges=[];
      o.push('<g class="laneGrp'+(hi?' sel':'')+'" data-lane="'+l.id+'">');
      o.push('<rect class="laneRow" data-lane="'+l.id+'" x="'+PAD+'" y="'+(y+1)+'" width="'+(W-PAD*2)+'" height="'+(ROW_H-2)+'" rx="3" fill="'+(hi?'var(--accent-bg)':'transparent')+'" style="cursor:pointer"/>');
      o.push(dragHandle(l,y));
      if(l.kind==='spacer'){
        o.push('<line x1="'+XS+'" y1="'+yM+'" x2="'+ACT_X+'" y2="'+yM+'" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="2 5"/>');
        o.push('<text x="'+(XS+8)+'" y="'+(yM-6)+'" font-size="9" fill="var(--muted)">spacer</text>');
        o.push(rowTools(l,y,ACT_X)); o.push('</g>');
        return;
      }
      var gname=l.groupPath.length?' <tspan fill="var(--muted)" font-size="10">['+esc(l.groupPath.join('/'))+']</tspan>':'';
      o.push('<text class="laneName" data-lane="'+l.id+'" x="'+(NAME_W-8)+'" y="'+yM+'" text-anchor="end" dominant-baseline="central" font-size="12" fill="var(--ink)">'+
        '<tspan class="laneNameText" data-act="name">'+esc(l.name)+'</tspan>'+
        '<tspan class="laneMeta" data-act="phase" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> φ'+l.phase+'</tspan>'+
        '<tspan class="laneMeta" data-act="period" data-lane="'+l.id+'" font-size="9" fill="var(--muted)"> T'+l.period+'</tspan>'+gname+'</text>');
      // 相邻两状态点决定过渡沿：只有显式状态点才带，repeater 沿用上一状态画稳态
      // 画布按全局 N 个周期绘制；wave 较短的行，尾部缺失周期按 repeater 延续补画并留出可续写格子
      var lastPoint=null, lastW=l.slots.length?l.slots[l.slots.length-1].w:'x';
      for(i=0;i<N;i++){
        var s=i<l.slots.length?l.slots[i]:null, x0=XS+i*CELL, w=s?s.w:lastW;
        var isPoint=s?(s.point&&!s.gap):false, prevCh=isPoint?lastPoint:null;
        if(isPoint) lastPoint=w;
        var glyph=waveGlyph(w,prevCh,x0,yT,yM,yB,CELL,{label:s&&isPoint?s.label:null});
        o.push(s?glyph:'<g class="tailSlot" role="img" aria-label="Undefined period — tap to extend">'+glyph+'</g>');
        if(s&&s.gap) o.push(waveGap(x0,yT,yB));
        o.push('<rect class="cell'+(s?'':' tailCell')+'" data-lane="'+l.id+'" data-tick="'+i+'"'+(s?'':' data-tail="1"')+
          ' x="'+(x0+1)+'" y="'+(y+3)+'" width="'+(CELL-2)+'" height="'+cellH+'" fill="transparent" style="cursor:crosshair"/>');
        if(s&&s.point&&!s.gap&&Core.BUS.test(s.w)) laneBadges.push(cellLabelHit(l,i,x0,y,s.label));
      }
      o.push('<line x1="'+XS+'" y1="'+(y+ROW_H)+'" x2="'+ACT_X+'" y2="'+(y+ROW_H)+'" stroke="var(--line)" stroke-width="0.5"/>');
      o.push('<rect class="waveZone" data-lane="'+l.id+'" x="'+XS+'" y="'+(y+Math.round(ROW_H*0.19))+'" width="'+(N*CELL)+'" height="'+Math.round(ROW_H*0.46)+'" fill="none" stroke="none" pointer-events="none"/>');
      o.push(rowTools(l,y,ACT_X));
      // 徽标留在行图元组内，才能用 .laneGrp:hover 控制显隐
      o.push(laneBadges.join(''));
      o.push('</g>');
    });
    o.push(edgeArcs(ir));
    if(!state.readonly) o.push(actionBar(actY,W,perRow,viewW,barH,barLeft));
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
  // 只改位移、不重绘：波形滚动时把操作层重新钉回可视区。
  function syncPinned(){
    var sx=wrap.scrollLeft, sy=wrap.scrollTop;
    var hud=wrap.querySelector('g.hudBar');
    if(hud) hud.setAttribute('transform','translate('+sx+','+sy+')');
    var chips=wrap.querySelector('g.charChips');
    if(chips&&state.barY!=null){
      var oy=Math.min(0, sy+wrap.clientHeight-state.barH-8-state.barY);
      chips.setAttribute('transform','translate('+sx+','+oy+')');
    }
  }

  ctx.redraw=redraw;
  ctx.syncPinned=syncPinned;
  return { redraw:redraw, syncPinned:syncPinned };
}
