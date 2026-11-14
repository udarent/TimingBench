// 图形侧交互：命中解析、foreignObject 就地编辑、整行/整列工具、两点式 edge 连线、
// 完整键盘操作层与拖拽。连线与时序编辑共用 rect.cell 命中区，由 state.linkMode 互斥分派；
// 键盘另有独立的 linkCursor 端点光标，保证不用鼠标也能完成全部编辑。
// 只产生 EditOp 交给 ctx.commit()，不直接改源码、不画辅助 UI。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { TOUCH } from './mode.js';
import { esc, cut } from '../core/util.js';

var CELL=G.CELL, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD;
// 行名区宽度按内容自适应 → 波形起点 XS 是运行时值，必须每次现读 G.XS，
// 不能像以前那样在模块加载时缓存一份（名字变长变短后它会过期）。

export function attachInteractions(ctx){
  var state=ctx.state, code=ctx.code, wrap=ctx.wrap;
  function findLane(id){
    var l=null;
    if(state.ir&&id) state.ir.lanes.forEach(function(x){ if(x.id===id) l=x; });
    return l;
  }

  // 阻止类提示的图形目标：优先给「被拦住的那个图元」，让红环落在用户刚点的地方
  function laneRowEl(id){ return wrap.querySelector('rect.laneRow[data-lane="'+id+'"]'); }

  // 就地编辑器：foreignObject 直接挂在目标 SVG 里，横向滚动时跟着图元一起走
  function svgRoot(){ return wrap.querySelector('svg'); }
  function closeInline(doCommit,restoreFocus){
    if(!ctx.inlineCtx) return;
    var ed=ctx.inlineCtx, v=ed.input.value;
    ctx.inlineCtx=null;
    if(ed.fo&&ed.fo.parentNode) ed.fo.parentNode.removeChild(ed.fo);
    if(doCommit){ try{ ed.apply(v); }catch(e){ ctx.notify('Inline edit failed: '+e.message,true); } }
    // 键盘结算（Enter / Esc）后把焦点还给画布，否则必须再点一次画布才能继续纯键盘编辑。
    // 失焦提交不抢焦点：用户可能正点进源码框。
    if(restoreFocus) ctx.focusCanvas();
  }
  function openInline(el,value,apply,opts){
    opts=opts||{};
    closeInline(false);
    var svg=svgRoot(); if(!el||!svg) return;
    var bb;
    try{ bb=el.getBBox(); }catch(e){ return; }
    var w=Math.max(34,Math.min(opts.width||bb.width,320)), h=22;
    var x=Math.max(0,Math.min(bb.x,state.W-w-2)), y=Math.max(0,Math.min(bb.y-2,state.H-h-2));
    var fo=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    fo.setAttribute('class','inline-fo');
    fo.setAttribute('x',x); fo.setAttribute('y',y); fo.setAttribute('width',w); fo.setAttribute('height',h);
    var inp=document.createElementNS('http://www.w3.org/1999/xhtml','input');
    inp.setAttribute('class','inline-edit');
    inp.setAttribute('spellcheck','false'); inp.setAttribute('autocomplete','off');
    inp.value=(value===undefined||value===null)?'':String(value);
    inp.title=opts.title||'Enter to confirm · Esc to cancel';
    inp.placeholder=opts.placeholder||'';
    fo.appendChild(inp); svg.appendChild(fo);
    ctx.inlineCtx={apply:apply,input:inp,fo:fo};
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); closeInline(true,true); }
      else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeInline(false,true); }
    });
    // 触摸端有个坑：长按 480ms 打开就地编辑后抬手，浏览器会把焦点交给被摸的画布，
    // 一次 blur 就把刚出现的输入框关掉 —— 用户根本来不及打字。这里区分「焦点被画布抢走」
    // 与「用户真的切走」（点源码框 / 切标签页 / 点其它控件），只对前者把焦点抢回来。
    var openedAt=Date.now();
    inp.addEventListener('blur',function(){
      var ae=document.activeElement;
      if(TOUCH&&Date.now()-openedAt<1200&&
         (ae===document.body||ae===wrap||(ae&&wrap.contains(ae)))){
        try{ inp.focus(); }catch(e){}
        return;
      }
      closeInline(true);
    });
    try{ inp.focus(); inp.select(); }catch(e){}
  }
  function cellAt(e){
    var g=e.target;
    while(g&&g!==wrap){
      if(g.getAttribute){
        var ln=g.getAttribute('data-lane');
        if(g.classList&&g.classList.contains('charChip')) return {ch:g.getAttribute('data-ch')};
        if(g.classList&&g.classList.contains('emptyRow')) return {empty:1};
        if(g.classList&&g.classList.contains('rowTool')) return {tool:g.getAttribute('data-act'),lane:ln};
        if(g.classList&&g.classList.contains('colActBtn')) return {cact:g.getAttribute('data-cact'),col:+g.getAttribute('data-c')};
        if(g.classList&&g.classList.contains('edgeArc')) return {edgeIdx:+g.getAttribute('data-eidx')};
        if(g.classList&&g.classList.contains('laneMeta')) return {meta:g.getAttribute('data-act'),lane:ln};
        if(g.classList&&g.classList.contains('colhead')) return {col:+g.getAttribute('data-c')};
        if(g.classList&&g.classList.contains('laneName')) return {nameLane:ln};
        if(g.classList&&g.classList.contains('cell')) return {lane:ln,tick:+g.getAttribute('data-tick')};
        if(g.classList&&g.classList.contains('laneRow')) return {rowLane:ln};
      }
      g=g.parentNode;
    }
    return null;
  }

  // 每个行内工具 / 图元徽标对应的就地编辑规格
  function rowSpec(l,act){
    switch(act){
      case 'phase': return { val:String(l.phase), title:'phase', label:'phase', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)?{t:'setPhase',lane:l.id,v:n}:null; } };
      case 'period': return { val:String(l.period), title:'period (>=1)', label:'period', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)&&n>=1?{t:'setPeriod',lane:l.id,v:n}:null; } };
      case 'wave': return { val:Core.laneWave(l), title:'row wave', label:'row wave', wide:true,
        makeOp:function(v){ return {t:'setWave',lane:l.id,v:v}; } };
      case 'data': return { val:Core.laneLabels(l).join(' '), title:'row data (space separated, empty removes)', label:'row data', wide:true,
        makeOp:function(v){ return {t:'setLabels',lane:l.id,v:v}; } };
      case 'node': return { val:l.node.join('').replace(/\.+$/,''), title:'row node', label:'row node', wide:true,
        makeOp:function(v){ return {t:'setNodeStr',lane:l.id,v:v}; } };
    }
    return null;
  }
  function openRowEditor(laneId,act){
    var l=findLane(laneId); if(!l) return;
    if(l.kind==='spacer'){ ctx.notify('Spacer rows have no editable field',true,laneRowEl(laneId)); return; }
    var spec=rowSpec(l,act); if(!spec) return;
    var anchor=spec.wide
      ? wrap.querySelector('rect.waveZone[data-lane="'+laneId+'"]')
      : spec.meta
        ? wrap.querySelector('tspan.laneMeta[data-act="'+act+'"][data-lane="'+laneId+'"]')
        : wrap.querySelector('g.rowTool[data-act="'+act+'"][data-lane="'+laneId+'"] rect');
    if(!anchor) return;
    openInline(anchor,spec.val,function(v){
      var op=spec.makeOp(v);
      if(!op){ ctx.notify('Invalid input: '+(act==='phase'?'phase must be a number':'period must be a number >= 1'),true,anchor); return; }
      ctx.commit(op,spec.label+' → '+v);
    },{ title:spec.title+' · Enter to confirm / Esc to cancel', placeholder:spec.title, width:spec.width });
  }
  function handleTool(act,laneId){
    if(act==='wave'||act==='data'||act==='node'){ openRowEditor(laneId,act); return; }
    if(act==='del'){ state.selLane=null; ctx.commit({t:'deleteLane',lane:laneId},'delete row'); return; }
    if(act==='add'||act==='spacer'){
      var at=0; state.ir.lanes.forEach(function(x,i){ if(x.id===laneId) at=i+1; });
      var id='ln'+Date.now().toString(36);
      ctx.commit({t:'addLane',id:id,name:'new',at:at,kind:act==='spacer'?'spacer':'signal'},act==='spacer'?'add spacer':'add signal row');
    }
  }
  function handleColAct(act,c){
    if(act==='insert') ctx.commit({t:'insertTick',tick:c},'insert cycle @ t'+c);
    else if(act==='delete') ctx.commit({t:'deleteTick',tick:c},'delete cycle @ t'+c);
    else if(act==='gap') ctx.commit({t:'toggleGap',tick:c},'toggle phase line @ t'+c);
  }
  function openEdgeEditor(i){
    var cur=state.ir&&state.ir.edges[i]; if(cur===undefined) return;
    // 端点节点字符缺失的 edge 没有可见弧线；键盘编辑时退到选中格作为输入框锚点，
    // 保证任何一条 edge 都能改 / 清空删除，不必依赖鼠标能否命中曲线。
    var sc=state.selCell;
    var anchor=wrap.querySelector('g.edgeArc[data-eidx="'+i+'"]') ||
      (sc?cellTarget(sc.lane,sc.tick):null) || wrap.querySelector('rect.waveZone');
    if(!anchor) return;
    openInline(anchor,cur,function(v){
      var t=v.trim(), arr=state.ir.edges.slice();
      if(!t) arr.splice(i,1); else arr[i]=t;
      ctx.commit({t:'setEdges',v:arr},'edit edge -> '+(t||'remove'));
    },{ title:'edge · Enter to confirm / Esc to cancel / empty removes', placeholder:'a~>b t1', width:170 });
  }

  // 状态写入的唯一操作：给「选中格」一个字符，写入后自动右移
  function writeChar(v,dir){
    var sc=state.selCell;
    if(!sc||!state.ir){ ctx.notify('Select a cell first (Tab / F6 focuses the canvas)',true); return; }
    var N=state.ir.ticks;
    state.ch=v;
    var nt=dir==='left'?Math.max(0,sc.tick-1):Math.min(sc.tick+1,N-1);
    state.selCell={lane:sc.lane,tick:nt};
    ctx.commit({t:'setSlot',lanes:[sc.lane],tick:sc.tick,v:v},'write '+v+' @ t'+sc.tick,false,true);
    // 触摸端：每次写入后把新选中格带进可视区（底部停靠条占掉的那一条不算可视区）
    if(TOUCH&&ctx.revealSel) ctx.revealSel();
  }

  // 把选中格挪进可视区：横向居中、纵向避开底部停靠条。
  // 只在「已经在编辑态、选中又变了」时调用 —— 从只读切进编辑那一下由嵌入壳做锚定，
  // 两者都动滚动就会互相打架，手指底下的东西会跳。
  function revealSel(){
    var sc=state.selCell; if(!sc||!state.ir||!wrap.clientWidth) return;
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===sc.lane) li=i; });
    if(li<0) return;
    // 视图可能是等比缩小过的（触摸端 / 卡片），状态里一律是**用户坐标**，
    // 而 scrollLeft / clientWidth 是像素 —— 先乘 fit 再比较，否则滚到错地方。
    var k=state.fit||1;
    var cx=(G.XS+sc.tick*CELL+CELL/2)*k, cy=(TOP+li*ROW_H+ROW_H/2)*k;
    var vw=wrap.clientWidth, vh=wrap.clientHeight-Math.max(0,state.barH||0);
    var maxL=Math.max(0,wrap.scrollWidth-vw), maxT=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
    var left=wrap.scrollLeft, top=wrap.scrollTop;
    if(cx<left+CELL*k*0.6||cx>left+vw-CELL*k*0.6) left=Math.min(maxL,Math.max(0,cx-vw/2));
    if(cy<top+ROW_H*k*0.6||cy>top+vh-ROW_H*k*0.6) top=Math.min(maxT,Math.max(0,cy-vh/2));
    if(left!==wrap.scrollLeft) wrap.scrollLeft=left;
    if(top!==wrap.scrollTop) wrap.scrollTop=top;
  }

  // 触摸端选中一行后，上下文条会从底部升起；把这一行滚到「条上方」的可视区里，
  // 否则矮卡片（嵌入 340px）里被选中的行正好藏在面板后面，点 up / down 时看不见效果。
  function revealLane(laneId,bottomPad){
    if(!state.ir||!wrap.clientWidth) return;
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===laneId) li=i; });
    if(li<0) return;
    var k=state.fit||1;                        // 用户坐标 → 像素，见 revealSel 的说明
    var cy=(TOP+li*ROW_H+ROW_H/2)*k;
    var vh=wrap.clientHeight-Math.max(0,state.barH||0)-Math.max(0,bottomPad||0);
    if(vh<ROW_H*k*2) vh=ROW_H*k*2;             // 卡片太矮时至少保证两行之内的判断可用
    var maxT=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
    var top=wrap.scrollTop;
    if(cy<top+ROW_H*k*0.6||cy>top+vh-ROW_H*k*0.6) top=Math.min(maxT,Math.max(0,cy-vh/2));
    if(top!==wrap.scrollTop) wrap.scrollTop=top;
  }

  // 两点式连线：仅在 linkMode 下由 rect.cell 分派进来，端点与时序编辑是同一片格子。
  // 点第一个格子 → 预览曲线跟随鼠标 → 点第二个格子，node + edge 合并一次提交；
  // 成线（或失败）后自动退出连线模式，回到普通时序编辑。
  function nodeChar(laneId,tick){
    var l=findLane(laneId);
    return l&&l.node&&l.node[tick]&&l.node[tick]!=='.'?l.node[tick]:'';
  }
  function handleAnchor(a){
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===a.lane) li=i; });
    if(li<0||state.ir.lanes[li].kind!=='signal') return;
    if(!state.connect){
      state.connect={lane:a.lane,tick:a.tick,node:a.node,li:li};
      ctx.redraw(); ctx.focusCanvas();
      return;
    }
    var s=state.connect;
    if(s.lane===a.lane&&s.tick===a.tick){ state.connect=null; ctx.redraw(); ctx.notify('Start point cleared, pick a cell again'); return; }
    if(!ctx.syncCode()){ state.connect=null; state.linkMode=false; state.linkCursor=null; ctx.redraw(); return; }
    var used={}, ops=[];
    state.ir.lanes.forEach(function(l){ (l.node||[]).forEach(function(ch){ if(ch&&ch!=='.') used[ch]=1; }); });
    function ensure(o){
      if(o.node) return o.node;
      for(var i=0;i<26;i++){
        var ch=String.fromCharCode(97+i);
        if(!used[ch]){ used[ch]=1; ops.push({t:'setNode',lane:o.lane,tick:o.tick,v:ch}); return ch; }
      }
      return null;
    }
    var na=ensure(s), nb=ensure(a);
    if(!na||!nb||na===nb){
      var badAt={lane:s.lane,tick:s.tick};
      state.connect=null; state.linkMode=false; state.linkCursor=null; ctx.redraw();
      ctx.notify('Link failed: not enough node letters, or both ends are the same',true,cellTarget(badAt.lane,badAt.tick));
      return;
    }
    var arr=state.ir.edges.slice(), newHead=na+'~>'+nb, found=-1, oldHead='';
    arr.forEach(function(t,i){
      var h=String(t).trim().split(/\s+/)[0]||'';
      if(h.charAt(0)===na&&h.charAt(h.length-1)===nb){ found=i; oldHead=h; }
    });
    if(found>=0){
      var rest=String(arr[found]).slice(oldHead.length).trim();
      arr[found]=newHead+(rest?' '+rest:'');
    } else arr.push(newHead);
    ops.push({t:'setEdges',v:arr});
    state.connect=null; state.linkMode=false; state.linkCursor=null;
    ctx.commit(ops,'link '+na+' -> '+nb,false,true);
  }

  // 统一的格子双击：无论该格当前是 1 / 4 / x 还是尾部续写格，恒为编辑「这一格的波形字符」
  // 节点标记与数据标签不再按波形内容分派，各自回到自己的图元上（锚点 / ✎ 徽标）
  function cellTarget(laneId,tick){
    return wrap.querySelector('rect.cell[data-lane="'+laneId+'"][data-tick="'+tick+'"]');
  }
  function openCellCharEditor(laneId,tick){
    var l=findLane(laneId); if(!l||l.kind==='spacer') return;
    var target=cellTarget(laneId,tick); if(!target) return;
    var sl=l.slots[tick], cur=sl?sl.w:(l.slots.length?l.slots[l.slots.length-1].w:'x');
    openInline(target,cur,function(v){
      var t=String(v).trim();
      if(Core.ALL.indexOf(t)<0){ ctx.notify('Allowed wave characters: '+Core.ALL.join(''),true,target); return; }
      ctx.commit({t:'setSlot',lanes:[laneId],tick:tick,v:t},'edit wave char -> '+t);
    },{ title:'wave character · Enter to confirm / Esc to cancel', placeholder:'1 / 0 / x / 4 / P ...', width:126 });
  }
  function openNodeEditor(laneId,tick,curNode){
    var l=findLane(laneId); if(!l||l.kind==='spacer'||tick>=l.slots.length) return;
    var target=cellTarget(laneId,tick); if(!target) return;
    var n=l.node[tick], cur=(curNode&&curNode!=='.')?curNode:(n&&n!=='.'?n:'');
    openInline(target,cur,function(v){
      var t=String(v).trim().charAt(0)||'.';
      ctx.commit({t:'setNode',lane:laneId,tick:tick,v:t},'edit node marker -> '+(t==='.'?'clear':t));
    },{ title:'node marker (single char) · Enter to confirm / Esc to cancel', placeholder:'a', width:110 });
  }
  function openLabelEditor(laneId,tick){
    var l=findLane(laneId); if(!l||l.kind==='spacer') return;
    var sl=l.slots[tick];
    if(!sl||!sl.point||sl.gap||!Core.BUS.test(sl.w)){ ctx.notify('This cell is not a data block',true,cellTarget(laneId,tick)); return; }
    var target=cellTarget(laneId,tick); if(!target) return;
    openInline(target,sl.label||'',function(v){
      var t=String(v).trim();
      ctx.commit({t:'setLabel',lane:laneId,tick:tick,v:t},'edit data label -> '+(t||'empty'));
    },{ title:'data label · Enter to confirm / Esc to cancel / empty removes', placeholder:'label', width:140 });
  }
  function openInlineFor(s){
    if(s.edgeIdx!==undefined){ openEdgeEditor(s.edgeIdx); return; }
    if(s.nameLane){
      var l=findLane(s.nameLane); if(!l||l.kind==='spacer') return;
      var el=wrap.querySelector('text.laneName[data-lane="'+s.nameLane+'"] tspan.laneNameText');
      openInline(el,l.name,function(v){ ctx.commit({t:'rename',lane:s.nameLane,v:v},'rename -> '+v); },
        { title:'signal name · Enter to confirm / Esc to cancel', placeholder:'name', width:140 });
      return;
    }
    if(s.lane===undefined||s.tick===undefined) return;
    openCellCharEditor(s.lane,s.tick);
  }

  // 就地编辑的唯一入口：双击（桌面）/ 双敲 / 长按（触摸）都走这里
  function openEditorFor(c){
    if(!c) return;
    var snap={lane:c.lane,tick:c.tick,nameLane:c.nameLane,edgeIdx:c.edgeIdx};
    if(!(snap.nameLane||snap.edgeIdx!==undefined||(snap.lane!==undefined&&snap.tick!==undefined))) return;
    ctx.painting=null; state.connect=null;
    ctx.redraw(); openInlineFor(snap);
  }

  // ---- 统一输入层 -------------------------------------------------------
  // 鼠标：mousedown / mousemove / mouseup（保留桌面拖拽漫刷与既有验收）
  // 触摸 / 笔：pointerdown / move / up / cancel，共用同一组命令与 EditOp
  // 触摸端不调 preventDefault，原生滚动与双指缩放照常可用；双击由「同目标 330ms
  // 内两次点按」识别，长按 480ms 是就地编辑的备用入口。
  var lastTap=null, longPress=null, longTimer=null, ignoreMouseUntil=0;

  function hitKey(c){
    if(!c) return '';
    if(c.edgeIdx!==undefined) return 'e'+c.edgeIdx;
    if(c.nameLane) return 'n'+c.nameLane;
    if(c.lane!==undefined&&c.tick!==undefined)
      return 'c'+c.lane+'@'+c.tick+'|'+(c.label?'l':'')+(c.tool||'')+(c.cact||'')+(c.meta||'');
    return JSON.stringify(c);
  }
  function touchDetail(c){
    var now=Date.now(), key=hitKey(c);
    if(lastTap&&lastTap.key===key&&now-lastTap.time<330){ lastTap=null; return 2; }
    lastTap={key:key,time:now}; return 1;
  }
  function clearLong(){
    if(longTimer){ clearTimeout(longTimer); longTimer=null; }
    longPress=null;
  }
  function editable(c){
    if(!c) return false;
    if(c.edgeIdx!==undefined||c.nameLane) return true;
    return c.lane!==undefined&&c.tick!==undefined&&
      c.label===undefined&&c.tool===undefined&&c.cact===undefined&&
      c.meta===undefined&&c.ch===undefined&&c.col===undefined&&c.rowLane===undefined;
  }
  function startLong(c,x,y){
    clearLong();
    if(!editable(c)) return;
    longPress={x:x,y:y,c:c};
    longTimer=setTimeout(function(){
      longTimer=null;
      var p=longPress; longPress=null;
      if(!p) return;
      lastTap=null;
      press=null;          // 长按已经消费了这次按压，抬手时不再当成 tap 重复执行
      openEditorFor(p.c);
    },480);
  }

  // ---- 触摸输入状态机 ---------------------------------------------------
  // 手指按下 ≠ 点了。触摸端把「按下」只当候选：抬手时位移 ≤12px、时长 ≤500ms
  // 才确认是一次 tap，确认之后才改选中 / 执行命令 / 进编辑。画布上滑动（看别的列、
  // 看下面的行）因此永远不会顺手选中格子或弹面板 —— 「移动」与「编辑」不再靠猜。
  // 桌面（鼠标）仍是按下即分派：那里有拖拽漫刷与行重排，需要 mousedown 就建状态。
  var press=null;

  function handleDown(e,isTouch){
    if(e.button!==undefined&&e.button!==0) return;
    // 就地输入框也在 SVG 里，点它自己不能触发结算
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('class')==='inline-edit') return;

    if(isTouch){
      // 只记候选，什么都不改：滑动（pan）与点按（tap）在抬手时才分得清
      press={x:e.clientX||0, y:e.clientY||0, c:cellAt(e), t:Date.now()};
      if(!state.readonly) startLong(press.c, press.x, press.y);   // 长按＝就地编辑的第二入口
      return;
    }

    // 桌面只读态：点一下进编辑并顺手选中被点的格子，本次点击不产生任何编辑
    if(state.readonly){
      e.preventDefault&&e.preventDefault();
      var rc=cellAt(e);
      var hit=rc&&rc.lane!==undefined&&rc.tick!==undefined&&!rc.cmd?{lane:rc.lane,tick:rc.tick}:null;
      if(hit){ state.selCell=hit; state.selLane=hit.lane; state.sel=null; }
      if(ctx.requestEdit) ctx.requestEdit(hit?{x:e.clientX,y:e.clientY,cell:hit}:null);
      return;
    }
    dispatchTarget(cellAt(e), e, false);
  }

  // 命中目标的分派：桌面在 mousedown 调用，触摸在 tap 确认后调用 —— 两边共用同一份逻辑，
  // 差别只在双击识别方式（鼠标 e.detail / 触摸的 330ms 同目标二次 tap）与是否建拖拽状态。
  function dispatchTarget(c,e,isTouch){
    // 先解析命中目标，避免提交编辑后的重绘让 e.target 变成游离节点
    var dbl=isTouch?touchDetail(c):(e.detail>1?2:1);
    if(ctx.inlineCtx) closeInline(true);
    if(!c){
      // 点到画布空白 = 清掉选中。四场景一致：桌面本来有 Esc，触摸端没有键盘 ——
      // 这条手势就是触摸端唯一的「取消选中」，让底部动作行（#tbpanel）成为唯一的上下文入口。
      if(state.selCell||state.selLane||(state.sel!==null&&state.sel!==undefined)){
        state.selCell=null; state.sel=null; state.selLane=null; ctx.redraw();
      }
      return;
    }
    // 零行空态占位行：整块就是一个「加第一条信号行」的按钮
    if(c.empty){
      if(dbl>1) return;
      e.preventDefault();
      ctx.commit({t:'addLane',id:'ln'+Date.now().toString(36),name:'new',at:0,kind:'signal'},'add signal row');
      return;
    }
    // 全局命令（撤销 / 重做 / 连线开关）在两种模式下都可用
    if(c.cmd){ if(dbl>1) return; e.preventDefault(); ctx.doCmd(c.cmd); return; }
    // 互斥分派：连线模式开启时，同一片 rect.cell 只作为连线端点，其余编辑入口
    // 一律不响应；关闭时完全走时序编辑链路，不会因为点到波形就误触发连线。
    if(state.linkMode){
      if(dbl>1){ e.preventDefault(); return; }
      // 落在波形格区域内的命中（含数据标签徽标）一律视为同一操作区域；弧线命中带已在绘制层让位，列头 / 行工具 / 字符条 / 弧线一概不响应。
      if(c.lane!==undefined&&c.tick!==undefined){
        e.preventDefault();
        var el=findLane(c.lane);
        if(!el||el.kind!=='signal'||!el.slots[c.tick]){
          ctx.notify('That period is not defined in the source yet',true,cellTarget(c.lane,c.tick)); return;
        }
        state.linkCursor={lane:c.lane,tick:c.tick};
        handleAnchor({lane:c.lane,tick:c.tick,node:nodeChar(c.lane,c.tick)});
      }
      return;
    }
    if(c.ch!==undefined){ if(dbl>1) return; e.preventDefault(); writeChar(c.ch); return; }
    if(c.tool){ if(dbl>1) return; e.preventDefault(); handleTool(c.tool,c.lane); return; }
    if(c.cact){ if(dbl>1) return; e.preventDefault(); state.sel=c.col; handleColAct(c.cact,c.col); return; }
    if(c.meta){ if(dbl>1) return; e.preventDefault(); openRowEditor(c.lane,c.meta); return; }
    if(c.col!==undefined){
      if(dbl>1) return;
      e.preventDefault(); state.sel=c.col;
      // 列选中与格 / 行选中互斥 —— **四场景一致**（原先只在触摸端清，桌面点列头后面板
      // 仍停在「格级动作」上，因为 renderContext 的优先级是 格 > 列 > 行）。0.9.12 修行
      // 分支时漏了这一处，同一个 `if(TOUCH)` 的残留。
      state.selCell=null; state.selLane=null;
      ctx.redraw(); ctx.status(); return;
    }
    if(c.nameLane||c.rowLane){
      state.selLane=c.nameLane||c.rowLane;
      // 行选中与格 / 列选中互斥 —— 四场景一致。桌面现在也靠上下文条改行列（行工具与
      // 列头按钮已撤），若不清掉 selCell，renderContext 会因「有格子选中」而把面板收起来，
      // 表现为「点了行但右侧面板不出现」。
      state.selCell=null; state.sel=null;
      // 双击 / 双敲才进就地编辑；单击只选中行（否则面板会被 inlineCtx 抑制掉）
      if(dbl>1){ e.preventDefault(); if(editable(c)) openEditorFor(c); return; }
      ctx.redraw(); return;
    }

    // 其余目标（格子、行内空白）双击 / 双敲 → 就地编辑
    if(dbl>1){
      e.preventDefault();
      if(!editable(c)) return;
      openEditorFor(c);
      return;
    }
    if(c.edgeIdx!==undefined){
      if(dbl>1){ e.preventDefault(); openEditorFor(c); return; }
      e.preventDefault(); state.selLane=null; ctx.redraw(); return;
    }
    // 单击格子只选中，不写入；写入统一由 writeChar（键盘 / 字符条）完成
    e.preventDefault();
    if(isTouch){
      state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
      state.sel=null; ctx.painting=null; ctx.redraw();
      return;
    }
    state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
    ctx.painting={ lane:c.lane, ticks:[], v:state.ch, base:{ir:state.ir,src:code.value,sel:state.sel}, moved:false };
    // 先建立选中再聚焦：focus 事件的 ensureSelCell 看到已有选中格就不会多绘一次
    ctx.focusCanvas();
    ctx.redraw();
  }
  // 屏幕坐标 → SVG 用户坐标。视图可能是等比缩小过的（触摸端 / 看卡片），
  // 所以必须按 viewBox 与渲染尺寸的比例换算，不能拿 clientX-rect.left 直接当用户坐标 ——
  // 那是 1:1 时代的老假设，缩放后预览弧线会整体偏移。
  function svgXY(cx,cy){
    var svg=svgRoot(); if(!svg) return {x:cx,y:cy};
    var r=svg.getBoundingClientRect(), vb=svg.viewBox&&svg.viewBox.baseVal;
    var kx=(vb&&r.width)?vb.width/r.width:1, ky=(vb&&r.height)?vb.height/r.height:1;
    return {x:(cx-r.left)*kx+(vb?vb.x:0), y:(cy-r.top)*ky+(vb?vb.y:0)};
  }

  function showConnectPreview(mx,my){
    var svg=svgRoot(); if(!svg||!state.connect) return;
    var p=svg.querySelector('path.connectPreview');
    if(!p){ p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('class','connectPreview'); svg.appendChild(p); }
    var a=state.connect, ax=G.XS+a.tick*CELL+CELL/2, ay=TOP+a.li*ROW_H+7;
    p.setAttribute('d','M'+ax+','+ay+' C'+(ax+10)+','+(ay-26)+' '+(mx-10)+','+(my-26)+' '+mx+','+my);
  }

  // 触摸后浏览器会补发一套兼容鼠标事件。只靠 800ms 时间窗挡不住长按：按住 1.2 秒再抬手，
  // 窗口早就过期，合成的 mousedown 会被当成桌面点击 —— 表现为「长按打开就地编辑，
  // 一抬手编辑框被关掉、格子反而被选中」，只读卡片里更糟（长按抬手直接进了编辑态）。
  // 有 sourceCapabilities 就按「这次事件是否由触摸产生」判断，时间窗只作老浏览器兜底。
  function syntheticMouse(e){
    if(e.sourceCapabilities&&e.sourceCapabilities.firesTouchEvents) return true;
    return Date.now()<ignoreMouseUntil;
  }
  wrap.addEventListener('mousedown',function(e){
    if(syntheticMouse(e)) return;
    handleDown(e,false);
  });
  wrap.addEventListener('mousemove',function(e){
    var svg=svgRoot();
    if(state.connect&&svg){
      var q=svgXY(e.clientX,e.clientY); showConnectPreview(q.x,q.y);
    }
    var hc=cellAt(e);
    if(!ctx.painting||!e.buttons) return;
    var c=hc;
    if(!c||c.lane===undefined||c.tick===undefined||c.lane!==ctx.painting.lane||ctx.painting.ticks.indexOf(c.tick)>=0) return;
    ctx.painting.ticks.push(c.tick); ctx.painting.moved=true;
    state.ch=ctx.painting.v; state.selCell={lane:c.lane,tick:c.tick};
    ctx.commit({t:'setSlot',lanes:[c.lane],tick:c.tick,v:ctx.painting.v},'paint @ t'+c.tick,true,true);
  });
  document.addEventListener('mouseup',function(e){
    if(e&&syntheticMouse(e)) return;
    if(!ctx.painting) return;
    var p=ctx.painting; ctx.painting=null;
    if(p.moved){
      state.undo.push(p.base); if(state.undo.length>60) state.undo.shift(); state.redo.length=0;
    }
  });

  // 非鼠标指针：统一转成不阻止默认行为的轻量事件对象，保留原生滚动
  function pointerShim(e){
    return { target:e.target, button:0, detail:0, clientX:e.clientX||0, clientY:e.clientY||0,
             preventDefault:function(){} };
  }
  wrap.addEventListener('pointerdown',function(e){
    if(e.pointerType==='mouse') return;
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('class')==='inline-edit') return;
    if(e.isTrusted) ignoreMouseUntil=Date.now()+800;
    handleDown(pointerShim(e),true);
  });
  wrap.addEventListener('pointermove',function(e){
    if(e.pointerType==='mouse') return;
    // 手指移动超过 12px 就判定为「滑动看图」（pan）：作废候选 tap 与长按计时，
    // 本次手势不产生任何选中 / 弹出 / 编辑 —— 这是「移动 vs 编辑」的分界线。
    if(press&&(Math.abs((e.clientX||0)-press.x)>12||Math.abs((e.clientY||0)-press.y)>12)){
      press=null; clearLong();
    }
    if(longPress&&(Math.abs((e.clientX||0)-longPress.x)>12||Math.abs((e.clientY||0)-longPress.y)>12)) clearLong();
    // 触摸端也跟手画连线预览曲线：记录第一个端点后，曲线末端跟着手指走
    if(state.connect){
      var svg=svgRoot();
      if(svg){
        var q2=svgXY(e.clientX||0,e.clientY||0); showConnectPreview(q2.x,q2.y);
      }
    }
  });
  // 抬手才算数：位移 ≤12px、时长 ≤500ms 才是一次 tap，其余一律视为滑动（不改任何状态）。
  function confirmTap(cx,cy){
    var p=press; press=null;
    clearLong();
    if(!p) return;
    var x=cx, y=cy;
    // 少数合成事件 / 老设备在抬手事件上不带坐标（都是 0）：退回按下时的位置，
    // 否则一次正常的点按会被算成「滑了很远」而失效。
    if(!x&&!y){ x=p.x; y=p.y; }
    if(Math.abs(x-p.x)>12||Math.abs(y-p.y)>12) return;
    if(Date.now()-p.t>500) return;
    if(state.readonly){
      var rc=p.c;
      var hit=rc&&rc.lane!==undefined&&rc.tick!==undefined&&!rc.cmd?{lane:rc.lane,tick:rc.tick}:null;
      if(hit){ state.selCell=hit; state.selLane=hit.lane; state.sel=null; }
      if(ctx.requestEdit) ctx.requestEdit({x:p.x,y:p.y,cell:hit});
      return;
    }
    // p.c 为 null = 点在画布空白：同样派发，dispatchTarget 用它清选中（触摸端没有 Esc，
    // 这是唯一取消手势）；有命中时是普通的图元点击。
    dispatchTarget(p.c, {clientX:p.x, clientY:p.y, detail:0, preventDefault:function(){}}, true);
  }
  function endPointer(e){
    if(e.pointerType==='mouse') return;
    confirmTap(e.clientX,e.clientY);
  }
  document.addEventListener('pointerup',endPointer);
  document.addEventListener('pointercancel',function(e){
    if(e.pointerType!=='mouse'){ clearLong(); press=null; }
  });

  // 没有 Pointer Events 的老浏览器：用 touch 事件回退，命中点交给 elementFromPoint
  if(typeof window!=='undefined'&&!window.PointerEvent){
    function touchShim(e){
      var t=e.touches&&e.touches[0]?e.touches[0]:(e.changedTouches&&e.changedTouches[0]);
      if(!t) return null;
      var target=document.elementFromPoint(t.clientX,t.clientY)||e.target;
      return { target:target, button:0, detail:0, clientX:t.clientX, clientY:t.clientY,
               preventDefault:function(){} };
    }
    wrap.addEventListener('touchstart',function(e){
      var s=touchShim(e); if(!s) return;
      if(e.isTrusted) ignoreMouseUntil=Date.now()+800;
      handleDown(s,true);
    },{passive:true});
    wrap.addEventListener('touchmove',function(e){
      var t=e.touches&&e.touches[0]; if(!t) return;
      if(press&&(Math.abs(t.clientX-press.x)>12||Math.abs(t.clientY-press.y)>12)){ press=null; clearLong(); }
      if(longPress&&(Math.abs(t.clientX-longPress.x)>12||Math.abs(t.clientY-longPress.y)>12)) clearLong();
      if(state.connect){
        var svg=svgRoot();
        if(svg){ var q3=svgXY(t.clientX,t.clientY); showConnectPreview(q3.x,q3.y); }
      }
    },{passive:true});
    document.addEventListener('touchend',function(e){
      var t=e.changedTouches&&e.changedTouches[0];
      confirmTap(t?t.clientX:0, t?t.clientY:0);
    },{passive:true});
    document.addEventListener('touchcancel',function(){ clearLong(); press=null; },{passive:true});
  }

  // ---- 键盘：不用鼠标完成全部编辑 -------------------------------------------
  // 普通状态：方向键 / Home / End 移动选中格，波形字符直通写入，Enter 系列就地编辑，
  // 单字母命令覆盖行 / 列 / 对象 / 弧线 / 重排 / 连线；连线模式另有一套端点光标分派。
  // 两种模式仍互斥：连线模式下字符写入、就地编辑与选中一律不响应。
  var NAV=/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/;
  function prevent(e){ if(e.preventDefault) e.preventDefault(); }
  function otherControl(){
    var ae=document.activeElement;
    return !!(ae&&ae!==document.body&&ae!==wrap&&!wrap.contains(ae)&&
      /^(BUTTON|A|SELECT|TEXTAREA|INPUT)$/.test(ae.tagName||''));
  }
  function sigIndex(from,dir){
    var ls=state.ir.lanes, i=from;
    for(var n=0;n<ls.length;n++){
      i+=dir;
      if(i<0||i>=ls.length) return from;
      if(ls[i].kind==='signal') return i;
    }
    return from;
  }
  function firstSig(){ var ls=state.ir.lanes; for(var i=0;i<ls.length;i++) if(ls[i].kind==='signal') return i; return -1; }
  function lastSig(){ var ls=state.ir.lanes; for(var i=ls.length-1;i>=0;i--) if(ls[i].kind==='signal') return i; return -1; }
  function ensureSel(){
    if(!state.ir||state.linkMode) return null;
    if(!state.selCell) ctx.ensureSelCell();
    return ctx.clampSel();
  }
  function moveSel(k,e){
    var sc=ensureSel(); if(!sc) return;
    var N=state.ir.ticks, ls=state.ir.lanes, li=-1;
    ls.forEach(function(l,i){ if(l.id===sc.lane) li=i; });
    var nt=sc.tick, ni=li;
    if(k==='ArrowLeft') nt=Math.max(0,sc.tick-1);
    else if(k==='ArrowRight') nt=Math.min(N-1,sc.tick+1);
    else if(k==='Home') nt=0;
    else if(k==='End') nt=N-1;
    else ni=sigIndex(li,k==='ArrowUp'?-1:1);
    if(e.ctrlKey||e.metaKey){
      if(k==='Home') ni=firstSig();
      if(k==='End') ni=lastSig();
    }
    if(ni<0) ni=li;
    state.selCell={lane:(ls[ni]||ls[li]).id,tick:nt};
    state.selLane=state.selCell.lane;
    ctx.redraw();
  }
  function moveLaneByKeyboard(dir){
    var sc=ensureSel(); if(!sc) return;
    ctx.commit({t:'moveLane',lane:sc.lane,v:dir},dir==='up'?'move row up':'move row down');
    ctx.clampSel(); ctx.redraw();
  }
  function editEdge(next){
    var n=state.ir.edges.length;
    if(!n){ ctx.notify('No edges yet — press K to create one',true); return; }
    if(next) state.edgeIdx=((state.edgeIdx||0)+1)%n;
    if(state.edgeIdx>=n) state.edgeIdx=0;
    ctx.openEdgeEditor(state.edgeIdx);
  }
  function command(k,e,sc){
    if(e.ctrlKey||e.metaKey||e.altKey) return false;
    var lane=findLane(sc.lane);
    function needSignal(){
      if(!lane||lane.kind==='spacer'){ ctx.notify('This is a spacer row — move to a signal row first',true,laneRowEl(sc.lane)); return false; }
      return true;
    }
    switch(k){
      case 'k': ctx.setLinkMode(true); return true;                       // 连线模式开关
      case 'r': if(needSignal()) ctx.openInlineFor({nameLane:sc.lane}); return true;
      case 'w': case 'a': case 's': case 'f': case 't':                  // 整行 / 相位 / 周期
        if(needSignal()) ctx.openRowEditor(sc.lane,{w:'wave',a:'data',s:'node',f:'phase',t:'period'}[k]);
        return true;
      case 'b': if(needSignal()) ctx.openLabelEditor(sc.lane,sc.tick); return true;
      case 'e': case 'E': editEdge(k==='E'); return true;                 // 编辑 / 切换弧线
      case 'o': case 'O': case 'X':                                       // 增行 / 空行 / 删行
        ctx.handleTool(k==='o'?'add':k==='O'?'spacer':'del',sc.lane);
        ctx.clampSel(); ctx.redraw(); return true;
      case '+': case '-': case 'g': case 'A':                            // 列增删 / 相位线 / 末尾追加
        ctx.handleColAct(k==='+'||k==='A'?'insert':k==='-'?'delete':'gap',
                         k==='A'?state.ir.ticks:sc.tick);
        ctx.clampSel(); ctx.redraw(); return true;
    }
    return false;
  }
  function linkKeys(e){
    var k=e.key;
    if(k==='Escape'||k==='k'||k==='K'){ prevent(e); ctx.setLinkMode(false); return; }
    var lc=state.linkCursor;
    if(k==='Enter'||k===' '||k==='Spacebar'){
      prevent(e);
      if(!lc){ ctx.notify('No signal rows available as link endpoints',true); return; }
      var l=findLane(lc.lane);
      if(!l||l.kind!=='signal'||!l.slots[lc.tick]){
        ctx.notify('That period is not defined in the source yet',true,cellTarget(lc.lane,lc.tick)); return;
      }
      handleAnchor({lane:lc.lane,tick:lc.tick,node:nodeChar(lc.lane,lc.tick)});
      return;
    }
    if(NAV.test(k)){
      prevent(e);
      if(lc&&state.ir){
        var N=state.ir.ticks, ls=state.ir.lanes, li=-1;
        ls.forEach(function(l,i){ if(l.id===lc.lane) li=i; });
        var nt=lc.tick, ni=li;
        if(k==='ArrowLeft') nt=Math.max(0,lc.tick-1);
        else if(k==='ArrowRight') nt=Math.min(N-1,lc.tick+1);
        else if(k==='Home') nt=0;
        else if(k==='End') nt=N-1;
        else ni=sigIndex(li,k==='ArrowUp'?-1:1);
        if(ni<0) ni=li;
        state.linkCursor={lane:(ls[ni]||ls[li]).id,tick:nt};
        ctx.redraw();
      }
      return;
    }
    // 连线模式：波形字符、命令键、就地编辑一律不响应
  }

  document.addEventListener('keydown',function(e){
    var t=e.target||{}, typing=/^(TEXTAREA|INPUT|SELECT)$/.test(t.tagName||'')||t.isContentEditable;
    // F6 在源码框里也能用；Tab 按浏览器默认顺序同样可达画布
    if(e.key==='F6'){
      prevent(e);
      var ae=document.activeElement;
      ctx.focusPane(ae===code?'diagram':((ae===wrap||wrap.contains(ae))?'src':'diagram'));
      return;
    }
    if(e.key==='Escape'&&state.linkMode){ ctx.setLinkMode(false); return; }
    if((e.ctrlKey||e.metaKey)&&/^(z|y)$/i.test(e.key)&&!typing){
      prevent(e); ctx.doCmd((e.shiftKey||/^y$/i.test(e.key))?'redo':'undo'); return;
    }
    if(typing||otherControl()) return;
    // 只读态不响应任何编辑键；Esc 由卡片外层负责退出编辑态。
    if(state.readonly) return;
    if(state.linkMode){ linkKeys(e); return; }
    var k=e.key;
    // Esc 逐层退出：就地编辑框 → 选中（本节）→ 编辑态（embed-shell 那一层）。
    // 这一层必须 stopPropagation，否则一次 Esc 同时清选中又退出编辑，用户分不清发生了什么。
    if(k==='Escape'&&(state.selCell||state.selLane||state.sel!==null&&state.sel!==undefined)){
      prevent(e); e.stopPropagation();
      state.selCell=null; state.selLane=null; state.sel=null;
      if(ctx.closeCharDock) ctx.closeCharDock();
      ctx.redraw(); return;
    }
    var sc=ensureSel(); if(!sc||!state.ir) return;
    var ctrl=e.ctrlKey||e.metaKey;
    if(!ctrl&&!e.altKey&&Core.ALL.indexOf(k)>=0){ prevent(e); writeChar(k); return; }
    // 节点字符没有专属锚点：选中格后 Shift+Enter 就地编辑该格 node
    if(k==='Enter'&&e.shiftKey){
      prevent(e);
      var nl=findLane(sc.lane);
      ctx.openNodeEditor(sc.lane,sc.tick,nl?nl.node[sc.tick]:''); return;
    }
    if(k==='Enter'){ prevent(e); ctx.openInlineFor({lane:sc.lane,tick:sc.tick}); return; }
    // Ctrl+↑ / ↓ 重排当前行（与方向键换格区分开）
    if(ctrl&&(k==='ArrowUp'||k==='ArrowDown')){
      prevent(e); moveLaneByKeyboard(k==='ArrowUp'?'up':'down'); return;
    }
    if(NAV.test(k)){
      prevent(e);
      if(e.shiftKey&&(k==='ArrowLeft'||k==='ArrowRight')){
        // 键盘漫刷：写入当前字符并沿方向移动，等价于按住鼠标横向拖过
        writeChar(state.ch||'1',k==='ArrowLeft'?'left':'right');
        return;
      }
      moveSel(k,e); return;
    }
    if(command(k,e,sc)) prevent(e);
  });
  ctx.svgRoot=svgRoot;
  ctx.findLane=findLane;
  ctx.closeInline=closeInline;
  ctx.openInline=openInline;
  // 触摸操作栏复用的动作（同一命令、同一 EditOp，不新增第二套编辑路径）
  ctx.openRowEditor=openRowEditor;
  ctx.openCellCharEditor=openCellCharEditor;
  ctx.writeChar=writeChar;
  ctx.revealSel=revealSel;
  ctx.revealLane=revealLane;
  ctx.openLabelEditor=openLabelEditor;
  ctx.openNodeEditor=openNodeEditor;
  ctx.openEdgeEditor=openEdgeEditor;
  ctx.openInlineFor=openInlineFor;
  ctx.openEditorFor=openEditorFor;
  ctx.handleTool=handleTool;
  ctx.handleColAct=handleColAct;
  ctx.cancelModes=function(){
    state.connect=null; state.linkMode=false; state.linkCursor=null;
    state.selCell=null; state.sel=null; state.selLane=null;
    ctx.painting=null; ctx.closeInline(false); ctx.redraw();
  };
}
