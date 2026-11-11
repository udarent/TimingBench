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
    return '<g class="hudBtn" data-cmd="'+cmd+'"><title>'+esc(title)+'</title>'+
      '<rect x="'+x+'" y="'+CMD_Y+'" width="'+bw+'" height="'+CMD_H+'" rx="'+br+'" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line)')+'" stroke-width="0.7" opacity="'+(dim?'.4':'1')+'"/>'+
      '<text x="'+(x+bw/2)+'" y="'+(CMD_Y+CMD_H/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+fs+'" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(txt)+'</text></g>';
  }
  function hudSVG(W){
    var o=[], x=PAD;
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(T?CMD_Y+CMD_H+4:COL_Y-4)+'" fill="var(--bg)"/>');
    function cmd(c,t,title,dim,on){ o.push(hudBtn(x,c,t,title,!!on,dim)); x+=T?50:31; }
    cmd('undo','↶','撤销（Ctrl+Z）',!state.undo.length);
    cmd('redo','↷','重做（Ctrl+Y）',!state.redo.length);
    cmd('link','◇',state.linkMode?'连线中：点第二个波形格完成；键盘 K 退出、方向键移光标、Enter 选端点':'连线：点两个波形格，或按 K 后用方向键 + Enter 选端点',false,state.linkMode);
    return o.join('');
  }



  // 列头 + / − / |：悬停才显现；第 N 个「幽灵列头」只承担末尾追加周期
  function colBtn(c,cx,k,act,txt,title,on){
    if(T) return '';   // 触摸端列操作移到操作栏的「列」面板，避免 11px 命中区
    var x=cx-18+k*12.5, w=11;
    return '<g class="colActBtn" data-cact="'+act+'" data-c="'+c+'"><title>'+esc(title)+'</title>'+
      '<rect x="'+x+'" y="'+(COL_Y+22)+'" width="'+w+'" height="18" rx="3" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line2)')+'" stroke-width="0.6"/>'+
      '<text x="'+(x+w/2)+'" y="'+(COL_Y+31)+'" text-anchor="middle" dominant-baseline="central" font-size="10" fill="'+(on?'var(--accent)':'var(--muted)')+'">'+esc(txt)+'</text></g>';
  }

  // 行工具：只保留互不重复的修改；行重排已统一交给行首拖拽把手
  function rowTools(l,y,ACT_X){
    if(T) return '';   // 触摸端行工具移到操作栏的「对象」面板
    var o=[], x=ACT_X+4, isSp=l.kind==='spacer';
    function add(act,txt,w,title){
      o.push('<g class="rowTool" data-act="'+act+'" data-lane="'+l.id+'" style="cursor:pointer"><title>'+esc(title)+'</title>'+
        '<rect x="'+x+'" y="'+(y+8)+'" width="'+w+'" height="20" rx="4" stroke="var(--line2)" stroke-width="0.6"/>'+
        '<text x="'+(x+w/2)+'" y="'+(y+18)+'" text-anchor="middle" dominant-baseline="central" fill="var(--ink)">'+esc(txt)+'</text></g>');
      x+=w+3;
    }
    if(!isSp){
      add('wave','~',20,'整行 wave 字符串 · 单击就地编辑');
      add('data','=',20,'整行 data 标签串 · 单击就地编辑');
      add('node','◇',20,'整行 node 标记串 · 单击就地编辑');
    }
    add('add','+',20,'在此行下方新增信号');
    add('spacer','∅',20,'在此行下方新增空行 spacer');
    add('del','✕',20,'删除该行');
    return '<g class="rowCtl">'+o.join('')+'</g>'+
      '<text class="rowHint" x="'+(ACT_X+8)+'" y="'+(y+23)+'" font-size="13" fill="var(--muted)">⋯</text>';
  }

  // 行首拖拽把手：行位置调整的唯一交互
  function dragHandle(l,y){
    if(T) return '';   // 触摸端改用「↑ 上移 / ↓ 下移」，不与原生滚动抢手势
    return '<g class="rowDrag" data-drag="'+l.id+'"><title>按住拖动，把这一行放到别的位置</title>'+
      '<rect x="'+(PAD+2)+'" y="'+(y+8)+'" width="16" height="32" rx="3" fill="transparent"/>'+
      '<text x="'+(PAD+10)+'" y="'+(y+24)+'" text-anchor="middle" dominant-baseline="central" font-size="13" fill="var(--muted)" pointer-events="none">⠿</text></g>';
  }

  // 数据标签的唯一编辑入口：长在总线块右下角的 ✎ 徽标，单击就地编辑 data 标签
  function cellLabelHit(l,i,x0,y,label){
    if(T) return '';   // 触摸端数据标签由「对象」面板的「数据标签」按钮编辑
    // 画在数据块下缘、格子底部：避开中心的标签文字与顶部的节点锚点
    var bx=x0+CELL-15, by=y+30, txt=label?String(label):'';
    return '<g class="cellLabel" data-lane="'+l.id+'" data-tick="'+i+'" data-label="1">'+
      '<title>单击编辑该数据块标签 · 当前：'+(txt?esc(cut(txt,18)):'（空）')+' · 清空即删除</title>'+
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
      o.push('<g class="edgeArc" data-eidx="'+i+'"><title>双击编辑 edge：'+esc(s)+' · 清空即删除</title>'+
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
  // 也不再画任何指示圆点）。触摸端字符条按可用宽度换行成多行大格子；桌面仍是单行。
  function actionBar(y,W,perRow){
    var o=['<line x1="'+PAD+'" y1="'+y+'" x2="'+(W-PAD)+'" y2="'+y+'" stroke="var(--line)" stroke-width="0.5"/>'];
    if(!state.linkMode&&state.selCell){
      Core.ALL.forEach(function(v,i){
        var on=state.ch===v;
        var bx=XS+(i%perRow)*CHIP_STEP, by=y+6+Math.floor(i/perRow)*(CHIP_H+6), cy=by+CHIP_H/2;
        o.push('<g class="charChip'+(on?' on':'')+'" data-ch="'+esc(v)+'"><title>写入 '+esc(v)+' · '+esc(chipDesc(v))+' · 背景图案即写入后该格的波形</title>'+
          '<rect x="'+bx+'" y="'+by+'" width="'+CHIP_W+'" height="'+CHIP_H+'" rx="5" fill="var(--panel)" stroke="var(--line2)" stroke-width="0.7"/>'+
          '<g class="chipWave" transform="translate('+bx+','+by+')">'+chipGlyph(v)+'</g>'+
          '<text x="'+(bx+CHIP_W/2)+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" font-size="'+(T?15:11)+'" font-family="var(--mono)" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(v)+'</text></g>');
      });
    }
    return o.join('');
  }

  function redraw(){
    // 重绘会替换 SVG DOM；未提交的就地编辑先结算，再用最新 IR 重建整张图
    if(ctx.inlineCtx) ctx.closeInline(true);
    var ir=state.ir; if(!ir) return;
    var N=ir.ticks, ACT_X=XS+N*CELL;
    var W=Math.max(ACT_X+ACT_W+PAD, T?0:CHIPS_W, 560), bottom=TOP+ir.lanes.length*ROW_H;
    var actY=bottom+4;
    var perRow=T?Math.max(1,Math.floor((W-XS-PAD)/CHIP_STEP)):Core.ALL.length;
    var rows=Math.ceil(Core.ALL.length/perRow);
    var barH=T?Math.max(ACT_H,(state.selCell?rows*(CHIP_H+6)+12:ACT_H)):ACT_H;
    var H=actY+barH+20, c, x;
    state.W=W; state.H=H;
    var o=['<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" class="'+(state.linkMode?'linkMode':'')+'" role="img"><title>可编辑时序图</title>'];
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(TOP-12)+'" fill="var(--bg)"/>');
    o.push(hudSVG(W));
    for(c=0;c<=N;c++){ x=XS+c*CELL; o.push('<line x1="'+x+'" y1="'+(TOP-10)+'" x2="'+x+'" y2="'+bottom+'" stroke="var(--line)" stroke-width="0.5"/>'); }
    for(c=0;c<=N;c++){
      var cx=XS+c*CELL+CELL/2, selc=state.sel===c, ghost=c===N;
      var gapc=ghost?false:ir.lanes.some(function(l){ return l.kind==='signal'&&l.slots[c]&&l.slots[c].gap; });
      o.push('<g class="colhead'+(selc?' sel':'')+(ghost?' ghost':'')+'" data-c="'+c+'"><title>列 '+c+(ghost?' · 末尾追加周期':' · 悬停显现列操作')+'</title>');
      // 整列列头透明命中区：让悬停 / 点击落在列头上，而不是落到背景矩形
      o.push('<rect x="'+(XS+c*CELL+1)+'" y="'+(COL_Y-2)+'" width="'+(CELL-2)+'" height="'+(TOP-COL_Y-2)+'" fill="transparent"/>');
      var cw=T?Math.min(CELL-2,44):30, ch=T?28:20;
      o.push('<rect x="'+(cx-cw/2)+'" y="'+COL_Y+'" width="'+cw+'" height="'+ch+'" rx="4" fill="'+(selc?'var(--accent-bg)':'transparent')+'" stroke="'+(selc?'var(--accent)':'var(--line)')+'" stroke-width="0.5" '+(ghost?'stroke-dasharray="2 2"':'')+'/>');
      o.push('<text x="'+cx+'" y="'+(COL_Y+ch/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+(T?13:11)+'" fill="'+(selc?'var(--accent)':'var(--muted)')+'">'+c+'</text>');
      o.push('<g class="colAct">'+colBtn(c,cx,0,'insert','+',ghost?'在末尾追加一个周期':'在列 '+c+' 前插入一个周期'));
      if(!ghost) o.push(colBtn(c,cx,1,'delete','−','删除列 '+c+' 对应的周期')+
        colBtn(c,cx,2,'gap','|','切换列 '+c+' 的相位线（该列唯一入口）',gapc));
      o.push('</g></g>');
    }
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
        o.push(s?glyph:'<g class="tailSlot"><title>源码 wave 未定义该周期 · 按 repeater 延续 · 点此可续写</title>'+glyph+'</g>');
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
    o.push(actionBar(actY,W,perRow));
    // 连线模式只画端点光标（键盘操作定位），不画普通选中框、不弹字符条
    if(state.linkMode&&state.linkCursor){
      var lci=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.linkCursor.lane) lci=k; });
      if(lci>=0&&state.linkCursor.tick<N) o.push('<rect class="linkCursor" x="'+(XS+state.linkCursor.tick*CELL+1)+'" y="'+(TOP+lci*ROW_H+3)+'" width="'+(CELL-2)+'" height="'+(ROW_H-10)+'" rx="3"><title>连线端点光标 · 方向键移动 · Enter 选为端点</title></rect>');
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
