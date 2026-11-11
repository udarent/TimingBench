// 时序图 SVG 结构：HUD / 列头 / 行工具 / 节点锚点 / 数据标签徽标 / 弧线 /
// 候选字符条 / redraw。只负责「把 state 画成图」，不处理事件、不回写源码。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc, cut } from '../core/util.js';
import { waveGlyph, chipGlyph, chipDesc } from './waveform.js';

var CELL=G.CELL, NAME_W=G.NAME_W, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD, ACT_W=G.ACT_W;
var CMD_Y=G.CMD_Y, CMD_H=G.CMD_H, COL_Y=G.COL_Y, ACT_H=G.ACT_H;
var CHIP_W=G.CHIP_W, CHIP_H=G.CHIP_H, CHIP_STEP=G.CHIP_STEP;
var XS=G.XS, CHIPS_W=G.CHIPS_W;

export function createShapes(ctx){
  var state=ctx.state, wrap=ctx.wrap;
  function hudBtn(x,cmd,txt,title,on,dim){
    return '<g class="hudBtn" data-cmd="'+cmd+'"><title>'+esc(title)+'</title>'+
      '<rect x="'+x+'" y="'+CMD_Y+'" width="26" height="'+CMD_H+'" rx="5" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line)')+'" stroke-width="0.7" opacity="'+(dim?'.4':'1')+'"/>'+
      '<text x="'+(x+13)+'" y="'+(CMD_Y+CMD_H/2)+'" text-anchor="middle" dominant-baseline="central" font-size="13" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(txt)+'</text></g>';
  }
  function hudSVG(W){
    var o=[], x=PAD;
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(COL_Y-4)+'" fill="var(--bg)"/>');
    function cmd(c,t,title,dim){ o.push(hudBtn(x,c,t,title,false,dim)); x+=31; }
    cmd('undo','↶','撤销（Ctrl+Z）',!state.undo.length);
    cmd('redo','↷','重做（Ctrl+Y）',!state.redo.length);
    return o.join('');
  }



  // 列头 + / − / |：悬停才显现；第 N 个「幽灵列头」只承担末尾追加周期
  function colBtn(c,cx,k,act,txt,title,on){
    var x=cx-18+k*12.5, w=11;
    return '<g class="colActBtn" data-cact="'+act+'" data-c="'+c+'"><title>'+esc(title)+'</title>'+
      '<rect x="'+x+'" y="'+(COL_Y+22)+'" width="'+w+'" height="18" rx="3" fill="'+(on?'var(--accent-bg)':'var(--panel)')+'" stroke="'+(on?'var(--accent)':'var(--line2)')+'" stroke-width="0.6"/>'+
      '<text x="'+(x+w/2)+'" y="'+(COL_Y+31)+'" text-anchor="middle" dominant-baseline="central" font-size="10" fill="'+(on?'var(--accent)':'var(--muted)')+'">'+esc(txt)+'</text></g>';
  }

  // 行工具：只保留互不重复的修改；行重排已统一交给行首拖拽把手
  function rowTools(l,y,ACT_X){
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
    return '<g class="rowDrag" data-drag="'+l.id+'"><title>按住拖动，把这一行放到别的位置</title>'+
      '<rect x="'+(PAD+2)+'" y="'+(y+8)+'" width="16" height="32" rx="3" fill="transparent"/>'+
      '<text x="'+(PAD+10)+'" y="'+(y+24)+'" text-anchor="middle" dominant-baseline="central" font-size="13" fill="var(--muted)" pointer-events="none">⠿</text></g>';
  }

  // 节点锚点：波形上真正可点的「连线对象」。有字符的是实心带字母，无字符的是淡空心圆
  function nodeAnchor(l,i,x0,y){
    var nch=l.node[i]&&l.node[i]!=='.'?l.node[i]:'';
    var ax=x0+CELL/2, ay=y+7;
    var picked=state.connect&&state.connect.lane===l.id&&state.connect.tick===i;
    return '<g class="nodeAnchor'+(nch?' has':' empty')+(picked?' picked':'')+'" data-lane="'+l.id+'" data-tick="'+i+'" data-node="'+esc(nch)+'">'+
      '<title>'+(nch?'节点 '+nch:'空锚点')+' · 单击作为连线端点 · 双击编辑该格节点字符</title>'+
      '<rect x="'+(ax-9)+'" y="'+(y+1)+'" width="18" height="14" fill="transparent"/>'+
      '<circle cx="'+ax+'" cy="'+ay+'" r="3.2" fill="'+(nch?'var(--accent)':'var(--bg)')+'" stroke="var(--accent)" stroke-width="0.9"/>'+
      (nch?'<text x="'+(ax+6)+'" y="'+(ay+3)+'" font-size="9" fill="var(--accent)">'+esc(nch)+'</text>':'')+'</g>';
  }

  // 数据标签的唯一编辑入口：长在总线块右下角的 ✎ 徽标，单击就地编辑 data 标签
  function cellLabelHit(l,i,x0,y,label){
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
      o.push('<g class="edgeArc" data-eidx="'+i+'"><title>双击编辑 edge：'+esc(s)+' · 清空即删除</title>'+
        '<path d="'+d+'" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".75" pointer-events="none"/>'+
        '<path d="'+d+'" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="8" pointer-events="stroke"/>');
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

  // 参考上游默认皮肤外观规范自行绘制的波形图元
  // 主画布与候选字符条共用同一个 waveGlyph，保证「图案即写入结果」
  var BUS_CLASS={'=':'bus2','2':'bus2','3':'bus3','4':'bus4','5':'bus5','6':'bus6','7':'bus7','8':'bus8','9':'bus9'};
  function waveLevel(ch,T,M,B){
    if(/[1hHu]/.test(ch)) return T;
    if(/[0lLd]/.test(ch)) return B;
    if(Core.BUS.test(ch)||Core.CLOCK.test(ch)||ch==='x') return null;
    return M;
  }
  function waveHatch(X,x1,T,B,W){
    var o=[], dy=B-T, step=Math.max(3,W/7), k, sx, ex, a, b;
    for(k=-6;k<=10;k++){
      sx=X+k*step; ex=sx+dy; a=Math.max(X,sx); b=Math.min(x1,ex);
      if(b<=a) continue;
      o.push('<path class="waveHair" d="M'+a+','+(B-(a-sx))+' L'+b+','+(B-(b-sx))+'"/>');
    }
    return o.join('');
  }
  function waveArrow(ax,T,B,up){
    var y0=up?(T+3):(B-3), y1=up?(T+11):(B-11);
    return '<path class="waveArrow" d="M'+(ax-3)+','+y1+' L'+ax+','+y0+' L'+(ax+3)+','+y1+' Q'+ax+','+(y1-2)+' '+(ax-3)+','+y1+' z"/>';
  }
  // 相位线：两条 S 曲线 + 白色遮罩（参考上游默认皮肤的视觉风格，自行绘制）
  function waveGap(X,T,B){
    var t=T-2, b=B+2;
    var mask='M'+(X+7)+','+t+' L'+(X+3)+','+t+' C'+(X-2)+','+t+' '+(X-2)+','+b+' '+(X-7)+','+b+' L'+(X-3)+','+b+' C'+(X+2)+','+b+' '+(X+2)+','+t+' '+(X+7)+','+t+' z';
    var c1='M'+(X-7)+','+b+' C'+(X-2)+','+b+' '+(X-2)+','+t+' '+(X+3)+','+t;
    var c2='M'+(X-3)+','+b+' C'+(X+2)+','+b+' '+(X+2)+','+t+' '+(X+7)+','+t;
    return '<g class="waveGapG" pointer-events="none"><path d="'+mask+'" fill="var(--bg)" stroke="none"/>'+
      '<path class="waveInk" d="'+c1+'"/><path class="waveInk" d="'+c2+'"/></g>';
  }
  function waveGlyph(ch,prev,X,T,M,B,W,opt){
    var o=[], x1=X+W, o2=opt||{}, ax=o2.arrowX===undefined?X:o2.arrowX;
    var px=X+3, ex=X+Math.min(W*0.24,9);
    if(Core.BUS.test(ch)){
      var pts=[X+3,T,x1-3,T,x1,M,x1-3,B,X+3,B,X,M].join(',');
      o.push('<polygon class="waveBus '+(BUS_CLASS[ch]||'bus2')+'" points="'+pts+'"/>');
      var lb=o2.label;
      if(lb!==null&&lb!==undefined&&lb!==''){
        var txt=String(lb);
        o.push('<text class="waveLabel" x="'+(X+W/2)+'" y="'+(M+1)+'" text-anchor="middle" dominant-baseline="central">'+esc(txt.length>5?txt.slice(0,4)+'…':txt)+'</text>');
      }
    } else if(Core.CLOCK.test(ch)){
      var up=/[pPhH]/.test(ch), a, b, lev, from;
      if(/[pPnN]/.test(ch)){
        a=up?B:T; b=up?T:B;
        o.push('<path class="waveInk" d="M'+X+','+a+' V'+b+' H'+(X+W/2)+' V'+a+' H'+x1+'"/>');
      } else {
        lev=up?T:B; from=up?B:T;
        o.push('<path class="waveInk" d="M'+X+','+from+' V'+lev+' H'+x1+'"/>');
      }
      if(/[PHNL]/.test(ch)) o.push(waveArrow(ax,T,B,up));
    } else if(ch==='x'){
      o.push('<path class="waveInk" d="M'+X+','+T+' H'+x1+'"/><path class="waveInk" d="M'+X+','+B+' H'+x1+'"/>');
      o.push(waveHatch(X,x1,T,B,W));
    } else {
      var cy=waveLevel(ch,T,M,B); if(cy===null) cy=M;
      var py=prev?waveLevel(prev,T,M,B):null;
      var vary=(py!==null&&Math.abs(py-cy)>1);
      var d=vary?'M'+X+','+py+' H'+px+' L'+ex+','+cy+' H'+x1:'M'+X+','+cy+' H'+x1;
      o.push('<path class="'+(ch==='d'||ch==='u'?'waveDash':'waveInk')+'" d="'+d+'"/>');
    }
    return '<g class="waveGlyph" data-w="'+esc(ch)+'" pointer-events="none">'+o.join('')+'</g>';
  }

  // 候选字符背后的单周期缩略波形：与主画布同一个 waveGlyph
  function chipGlyph(v){ return waveGlyph(v,null,0,5,13,21,CHIP_W,{arrowX:3}); }
  function chipDesc(v){
    if(Core.BUS.test(v)) return (v==='='||v==='2')?'总线数据块（白）':'总线数据块 · 配色 '+(Number(v)+5);
    if(Core.CLOCK.test(v)) return {
      p:'时钟 · 上升沿起始', P:'时钟 · 上升沿起始 + 箭头',
      n:'时钟 · 下降沿起始', N:'时钟 · 下降沿起始 + 箭头',
      h:'高电平 · 起始上升沿', H:'高电平 · 上升沿 + 箭头',
      l:'低电平 · 起始下降沿', L:'低电平 · 下降沿 + 箭头'}[v];
    return {'1':'高电平','0':'低电平','x':'未知态（斜线阴影）','z':'高阻（中间实线）','u':'上拉（高电平虚线）','d':'下拉（低电平虚线）'}[v]||'波形字符';
  }

  // 底部上下文条：选中格出现字符条，连线态只留一个指示点；不展示说明文字
  function actionBar(y,W){
    var o=['<line x1="'+PAD+'" y1="'+y+'" x2="'+(W-PAD)+'" y2="'+y+'" stroke="var(--line)" stroke-width="0.5"/>'];
    if(state.connect){
      o.push('<circle cx="'+(XS+8)+'" cy="'+(y+20)+'" r="4" fill="var(--accent)"><title>连线中：点第二个节点锚点完成，Esc 取消</title></circle>');
    } else if(state.selCell){
      var bx=XS, cy=y+6+CHIP_H/2;
      Core.ALL.forEach(function(v){
        var on=state.ch===v;
        o.push('<g class="charChip'+(on?' on':'')+'" data-ch="'+esc(v)+'"><title>写入 '+esc(v)+' · '+esc(chipDesc(v))+' · 背景图案即写入后该格的波形</title>'+
          '<rect x="'+bx+'" y="'+(y+6)+'" width="'+CHIP_W+'" height="'+CHIP_H+'" rx="5" fill="var(--panel)" stroke="var(--line2)" stroke-width="0.7"/>'+
          '<g class="chipWave" transform="translate('+bx+','+(y+6)+')">'+chipGlyph(v)+'</g>'+
          '<text x="'+(bx+CHIP_W/2)+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" font-size="11" font-family="var(--mono)" fill="'+(on?'var(--accent)':'var(--ink)')+'">'+esc(v)+'</text></g>');
        bx+=CHIP_STEP;
      });
    }
    return o.join('');
  }

  function redraw(){
    // 重绘会替换 SVG DOM；未提交的就地编辑先结算，再用最新 IR 重建整张图
    if(ctx.inlineCtx) ctx.closeInline(true);
    var ir=state.ir; if(!ir) return;
    var N=ir.ticks, ACT_X=XS+N*CELL;
    var W=Math.max(ACT_X+ACT_W+PAD, CHIPS_W, 560), bottom=TOP+ir.lanes.length*ROW_H;
    var actY=bottom+4, suiteY=actY+ACT_H+6;
    var H=suiteY+14, c, x;
    state.W=W; state.H=H;
    var o=['<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" class="'+(state.connect?'connecting':'')+'" role="img"><title>可编辑时序图</title>'];
    o.push('<rect x="0" y="0" width="'+W+'" height="'+(TOP-12)+'" fill="var(--bg)"/>');
    o.push(hudSVG(W));
    for(c=0;c<=N;c++){ x=XS+c*CELL; o.push('<line x1="'+x+'" y1="'+(TOP-10)+'" x2="'+x+'" y2="'+bottom+'" stroke="var(--line)" stroke-width="0.5"/>'); }
    for(c=0;c<=N;c++){
      var cx=XS+c*CELL+CELL/2, selc=state.sel===c, ghost=c===N;
      var gapc=ghost?false:ir.lanes.some(function(l){ return l.kind==='signal'&&l.slots[c]&&l.slots[c].gap; });
      o.push('<g class="colhead'+(selc?' sel':'')+(ghost?' ghost':'')+'" data-c="'+c+'"><title>列 '+c+(ghost?' · 末尾追加周期':' · 悬停显现列操作')+'</title>');
      // 整列列头透明命中区：让悬停 / 点击落在列头上，而不是落到背景矩形
      o.push('<rect x="'+(XS+c*CELL+1)+'" y="'+(COL_Y-2)+'" width="'+(CELL-2)+'" height="'+(TOP-COL_Y-2)+'" fill="transparent"/>');
      o.push('<rect x="'+(cx-15)+'" y="'+COL_Y+'" width="30" height="20" rx="4" fill="'+(selc?'var(--accent-bg)':'transparent')+'" stroke="'+(selc?'var(--accent)':'var(--line)')+'" stroke-width="0.5" '+(ghost?'stroke-dasharray="2 2"':'')+'/>');
      o.push('<text x="'+cx+'" y="'+(COL_Y+10)+'" text-anchor="middle" dominant-baseline="central" font-size="11" fill="'+(selc?'var(--accent)':'var(--muted)')+'">'+c+'</text>');
      o.push('<g class="colAct">'+colBtn(c,cx,0,'insert','+',ghost?'在末尾追加一个周期':'在列 '+c+' 前插入一个周期'));
      if(!ghost) o.push(colBtn(c,cx,1,'delete','−','删除列 '+c+' 对应的周期')+
        colBtn(c,cx,2,'gap','|','切换列 '+c+' 的相位线（该列唯一入口）',gapc));
      o.push('</g></g>');
    }
    var anchors=[];
    ir.lanes.forEach(function(l,li){
      var y=TOP+li*ROW_H, yT=y+12, yM=y+23, yB=y+34, i, hi=state.selLane===l.id, laneBadges=[];
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
          ' x="'+(x0+1)+'" y="'+(y+3)+'" width="'+(CELL-2)+'" height="38" fill="transparent" style="cursor:crosshair"/>');
        if(s) anchors.push(nodeAnchor(l,i,x0,y));
        if(s&&s.point&&!s.gap&&Core.BUS.test(s.w)) laneBadges.push(cellLabelHit(l,i,x0,y,s.label));
      }
      o.push('<line x1="'+XS+'" y1="'+(y+ROW_H)+'" x2="'+ACT_X+'" y2="'+(y+ROW_H)+'" stroke="var(--line)" stroke-width="0.5"/>');
      o.push('<rect class="waveZone" data-lane="'+l.id+'" x="'+XS+'" y="'+(y+9)+'" width="'+(N*CELL)+'" height="22" fill="none" stroke="none" pointer-events="none"/>');
      o.push(rowTools(l,y,ACT_X));
      // 徽标留在行图元组内，才能用 .laneGrp:hover 控制显隐
      o.push(laneBadges.join(''));
      o.push('</g>');
    });
    o.push(edgeArcs(ir));
    // 锚点画在弧线之上，避免连线命中区抢走「点连接对象」
    o.push(anchors.join(''));
    o.push(actionBar(actY,W));
    if(state.selCell){
      var sli=-1; ir.lanes.forEach(function(l,k){ if(l.id===state.selCell.lane) sli=k; });
      if(sli>=0&&state.selCell.tick<N) o.push('<rect class="cellSel" x="'+(XS+state.selCell.tick*CELL+1)+'" y="'+(TOP+sli*ROW_H+3)+'" width="'+(CELL-2)+'" height="38" rx="3"/>');
    }
    o.push('</svg>');
    wrap.innerHTML=o.join('');
    ctx.renderGutter();
  }
  ctx.redraw=redraw;
  return { redraw:redraw };
}
