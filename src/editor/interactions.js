// 图形侧交互：命中解析、foreignObject 就地编辑、整行/整列工具、两点式 edge 连线、
// 键盘与拖拽。只产生 EditOp 交给 ctx.commit()，不直接改源码、不画辅助 UI。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc, cut } from '../core/util.js';
import { TOUCH } from './mode.js';

var CELL=G.CELL, ROW_H=G.ROW_H, TOP=G.TOP, PAD=G.PAD;
var XS=G.XS;

export function attachInteractions(ctx){
  var state=ctx.state, code=ctx.code, wrap=ctx.wrap;
  function findLane(id){
    var l=null;
    if(state.ir&&id) state.ir.lanes.forEach(function(x){ if(x.id===id) l=x; });
    return l;
  }

  // 就地编辑器：foreignObject 直接挂在目标 SVG 里，横向滚动时跟着图元一起走
  function svgRoot(){ return wrap.querySelector('svg'); }
  function closeInline(doCommit){
    if(!ctx.inlineCtx) return;
    var ed=ctx.inlineCtx, v=ed.input.value;
    ctx.inlineCtx=null;
    if(ed.fo&&ed.fo.parentNode) ed.fo.parentNode.removeChild(ed.fo);
    if(doCommit){ try{ ed.apply(v); }catch(e){ ctx.notify('就地编辑失败：'+e.message,true); } }
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
    inp.title=opts.title||'Enter 确认 · Esc 取消 · 失焦自动提交';
    inp.placeholder=opts.placeholder||'';
    fo.appendChild(inp); svg.appendChild(fo);
    ctx.inlineCtx={apply:apply,input:inp,fo:fo};
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); closeInline(true); }
      else if(e.key==='Escape'){ e.preventDefault(); closeInline(false); }
    });
    inp.addEventListener('blur',function(){ closeInline(true); });
    try{ inp.focus(); inp.select(); }catch(e){}
    if(opts.msg) ctx.notify(opts.msg);
  }
  function cellAt(e){
    var g=e.target;
    while(g&&g!==wrap){
      if(g.getAttribute){
        var ln=g.getAttribute('data-lane');
        if(g.classList&&g.classList.contains('hudBtn')) return {cmd:g.getAttribute('data-cmd')};
        if(g.classList&&g.classList.contains('rowDrag')) return {drag:g.getAttribute('data-drag'),lane:g.getAttribute('data-drag')};
        if(g.classList&&g.classList.contains('charChip')) return {ch:g.getAttribute('data-ch')};
        if(g.classList&&g.classList.contains('rowTool')) return {tool:g.getAttribute('data-act'),lane:ln};
        if(g.classList&&g.classList.contains('colActBtn')) return {cact:g.getAttribute('data-cact'),col:+g.getAttribute('data-c')};
        if(g.classList&&g.classList.contains('cellLabel')) return {label:1,lane:ln,tick:+g.getAttribute('data-tick')};
        if(g.classList&&g.classList.contains('nodeAnchor')) return {anchor:1,lane:ln,tick:+g.getAttribute('data-tick'),node:g.getAttribute('data-node')||''};
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
      case 'phase': return { val:String(l.phase), title:'相位 phase', label:'相位', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)?{t:'setPhase',lane:l.id,v:n}:null; } };
      case 'period': return { val:String(l.period), title:'周期 period（≥1）', label:'周期', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)&&n>=1?{t:'setPeriod',lane:l.id,v:n}:null; } };
      case 'wave': return { val:Core.laneWave(l), title:'整行 wave 字符串', label:'整行 wave', wide:true,
        makeOp:function(v){ return {t:'setWave',lane:l.id,v:v}; } };
      case 'data': return { val:Core.laneLabels(l).join(' '), title:'整行 data 标签（空格分隔，留空删除字段）', label:'整行 data', wide:true,
        makeOp:function(v){ return {t:'setLabels',lane:l.id,v:v}; } };
      case 'node': return { val:l.node.join('').replace(/\.+$/,''), title:'整行 node 标记串', label:'整行 node', wide:true,
        makeOp:function(v){ return {t:'setNodeStr',lane:l.id,v:v}; } };
    }
    return null;
  }
  function openRowEditor(laneId,act){
    var l=findLane(laneId); if(!l) return;
    if(l.kind==='spacer'){ ctx.notify('空行（spacer）没有可编辑字段，可用悬停该行显现的工具增删',true); return; }
    var spec=rowSpec(l,act); if(!spec) return;
    var anchor=spec.wide
      ? wrap.querySelector('rect.waveZone[data-lane="'+laneId+'"]')
      : spec.meta
        ? wrap.querySelector('tspan.laneMeta[data-act="'+act+'"][data-lane="'+laneId+'"]')
        : wrap.querySelector('g.rowTool[data-act="'+act+'"][data-lane="'+laneId+'"] rect');
    if(!anchor) return;
    openInline(anchor,spec.val,function(v){
      var op=spec.makeOp(v);
      if(!op){ ctx.notify('输入无效：'+(act==='phase'?'相位需为数字':'周期需为 ≥1 的数字'),true); return; }
      ctx.commit(op,spec.label+' → '+v);
    },{ title:spec.title+' · Enter 确认 / Esc 取消', placeholder:spec.title, width:spec.width,
        msg:'就地编辑 '+spec.label+'：输入框是时序图里的 foreignObject，Enter 或点击别处回写源码' });
  }
  function handleTool(act,laneId){
    if(act==='wave'||act==='data'||act==='node'){ openRowEditor(laneId,act); return; }
    if(act==='del'){ state.selLane=null; ctx.commit({t:'deleteLane',lane:laneId},'删除该行'); return; }
    if(act==='add'||act==='spacer'){
      var at=0; state.ir.lanes.forEach(function(x,i){ if(x.id===laneId) at=i+1; });
      var id='ln'+Date.now().toString(36);
      ctx.commit({t:'addLane',id:id,name:'new',at:at,kind:act==='spacer'?'spacer':'signal'},act==='spacer'?'新增空行（spacer）':'新增信号行');
    }
  }
  function handleColAct(act,c){
    if(act==='insert') ctx.commit({t:'insertTick',tick:c},'插入周期 @ t'+c);
    else if(act==='delete') ctx.commit({t:'deleteTick',tick:c},'删除周期 @ t'+c);
    else if(act==='gap') ctx.commit({t:'toggleGap',tick:c},'切换相位线 @ t'+c);
  }
  function openEdgeEditor(i){
    var cur=state.ir&&state.ir.edges[i]; if(cur===undefined) return;
    var anchor=wrap.querySelector('g.edgeArc[data-eidx="'+i+'"]'); if(!anchor) return;
    openInline(anchor,cur,function(v){
      var t=v.trim(), arr=state.ir.edges.slice();
      if(!t) arr.splice(i,1); else arr[i]=t;
      ctx.commit({t:'setEdges',v:arr},'编辑 edge → '+(t||'删除'));
    },{ title:'edge · Enter 确认 / Esc 取消 / 清空即删除', placeholder:'a~>b t1', width:170,
        msg:'就地编辑弧线：改完按 Enter 即回写源码的 edge 数组' });
  }

  // 状态写入的唯一操作：给「选中格」一个字符，写入后自动右移
  function writeChar(v){
    var sc=state.selCell;
    if(!sc||!state.ir){ ctx.notify('请先单击一个波形格，再写入字符',true); return; }
    var N=state.ir.ticks;
    state.ch=v;
    var nt=Math.min(sc.tick+1,N-1);
    state.selCell={lane:sc.lane,tick:nt};
    ctx.commit({t:'setSlot',lanes:[sc.lane],tick:sc.tick,v:v},'写入 '+v+' @ t'+sc.tick,false,true);
    ctx.notify('写入 '+v+' → 选中格右移到 t'+nt+'；继续敲字符可连写波形');
  }

  // 两点式连线：点第一个锚点 → 预览曲线跟随鼠标 → 点第二个锚点，一次提交 node + edge
  function handleAnchor(a){
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===a.lane) li=i; });
    if(li<0||state.ir.lanes[li].kind!=='signal') return;
    if(!state.connect){
      state.connect={lane:a.lane,tick:a.tick,node:a.node,li:li};
      ctx.redraw(); ctx.focusCanvas();
      ctx.notify('连线：已选 '+(a.node||'空锚点')+' @ t'+a.tick+' · 点第二个节点锚点（移动鼠标可预览，Esc 取消）');
      return;
    }
    var s=state.connect;
    if(s.lane===a.lane&&s.tick===a.tick){ state.connect=null; ctx.redraw(); ctx.notify('已取消连线：起点与终点相同'); return; }
    if(!ctx.syncCode()){ state.connect=null; ctx.redraw(); return; }
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
    if(!na||!nb||na===nb){ state.connect=null; ctx.redraw(); ctx.notify('连线失败：可用节点字符不足或两端相同',true); return; }
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
    state.connect=null;
    ctx.commit(ops,'两点连线 '+na+' → '+nb,false,true);
    ctx.notify('连线完成：'+newHead+' → 已回写源码 node / edge（合并为一次撤销）');
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
      if(Core.ALL.indexOf(t)<0){ ctx.notify('波形字符只能是 '+Core.ALL.join('')+' 中的一个，已忽略输入',true); return; }
      ctx.commit({t:'setSlot',lanes:[laneId],tick:tick,v:t},'就地改波形字符 → '+t);
    },{ title:'波形字符 · Enter 确认 / Esc 取消', placeholder:'1 / 0 / x / 4 / P …', width:126,
        msg:'双击任意格子都是同一个输入框：就地改这一格的波形字符（尾部续写格写入即续长 wave）' });
  }
  function openNodeEditor(laneId,tick,curNode){
    var l=findLane(laneId); if(!l||l.kind==='spacer'||tick>=l.slots.length) return;
    var target=cellTarget(laneId,tick); if(!target) return;
    var n=l.node[tick], cur=(curNode&&curNode!=='.')?curNode:(n&&n!=='.'?n:'');
    openInline(target,cur,function(v){
      var t=String(v).trim().charAt(0)||'.';
      ctx.commit({t:'setNode',lane:laneId,tick:tick,v:t},'就地编辑节点标记 → '+(t==='.'?'清除':t));
    },{ title:'节点标记（单字符）· Enter 确认 / Esc 取消', placeholder:'a', width:110,
        msg:'双击节点锚点改该格 node 标记：单字符，留空清除' });
  }
  function openLabelEditor(laneId,tick){
    var l=findLane(laneId); if(!l||l.kind==='spacer') return;
    var sl=l.slots[tick];
    if(!sl||!sl.point||sl.gap||!Core.BUS.test(sl.w)){ ctx.notify('该格不是数据块，没有 data 标签',true); return; }
    var target=cellTarget(laneId,tick); if(!target) return;
    openInline(target,sl.label||'',function(v){
      var t=String(v).trim();
      ctx.commit({t:'setLabel',lane:laneId,tick:tick,v:t},'就地编辑数据标签 → '+(t||'空'));
    },{ title:'数据标签 · Enter 确认 / Esc 取消 / 清空即删除', placeholder:'标签', width:140,
        msg:'单击总线块右下角的 ✎ 徽标改该格 data 标签：可含空格，清空即删除' });
  }
  function openInlineFor(s){
    if(s.edgeIdx!==undefined){ openEdgeEditor(s.edgeIdx); return; }
    if(s.nameLane){
      var l=findLane(s.nameLane); if(!l||l.kind==='spacer') return;
      var el=wrap.querySelector('text.laneName[data-lane="'+s.nameLane+'"] tspan.laneNameText');
      openInline(el,l.name,function(v){ ctx.commit({t:'rename',lane:s.nameLane,v:v},'重命名 → '+v); },
        { title:'信号名 · Enter 确认 / Esc 取消', placeholder:'信号名', width:140,
          msg:'就地编辑信号名：改完按 Enter 或点击别处即回写源码' });
      return;
    }
    if(s.lane===undefined||s.tick===undefined) return;
    openCellCharEditor(s.lane,s.tick);
  }

  // 就地编辑的唯一入口：双击（桌面）/ 双敲 / 长按（触摸）都走这里
  function openEditorFor(c){
    if(!c) return;
    if(c.anchor){ state.connect=null; ctx.painting=null; ctx.redraw(); openNodeEditor(c.lane,c.tick,c.node); return; }
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
    if(c.anchor) return 'a'+c.lane+'@'+c.tick;
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
    if(c.edgeIdx!==undefined||c.nameLane||c.anchor) return true;
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
      openEditorFor(p.c);
    },480);
  }

  function handleDown(e,isTouch){
    if(e.button!==undefined&&e.button!==0) return;
    // 就地输入框也在 SVG 里，点它自己不能触发结算
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('class')==='inline-edit') return;
    var c=cellAt(e); // 先解析命中目标，避免提交编辑后的重绘让 e.target 变成游离节点
    var dbl=isTouch?touchDetail(c):(e.detail>1?2:1);
    if(ctx.inlineCtx) closeInline(true);
    if(state.connect&&!(c&&c.anchor)){ state.connect=null; ctx.redraw(); }
    if(!c) return;
    if(c.cmd){ if(dbl>1) return; e.preventDefault(); ctx.doCmd(c.cmd); return; }
    if(c.drag){
      if(isTouch||dbl>1) return;   // 触摸端行重排交给操作栏，不与原生滚动抢手势
      e.preventDefault();
      var di=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===c.drag) di=i; });
      if(di<0) return;
      state.drag={ laneId:c.drag, from:di, to:di, base:{ir:state.ir,src:code.value,sel:state.sel} };
      ctx.focusCanvas(); ctx.notify('拖动第 '+(di+1)+' 行：移到目标位置松手重排（Esc 取消）');
      return;
    }
    if(c.ch!==undefined){ if(dbl>1) return; e.preventDefault(); writeChar(c.ch); return; }
    if(c.label){ if(dbl>1) return; e.preventDefault(); openLabelEditor(c.lane,c.tick); return; }
    if(c.anchor){
      e.preventDefault();
      if(dbl>1){ openEditorFor(c); return; }
      handleAnchor(c); return;
    }
    if(c.tool){ if(dbl>1) return; e.preventDefault(); handleTool(c.tool,c.lane); return; }
    if(c.cact){ if(dbl>1) return; e.preventDefault(); state.sel=c.col; handleColAct(c.cact,c.col); return; }
    if(c.meta){ if(dbl>1) return; e.preventDefault(); openRowEditor(c.lane,c.meta); return; }
    if(c.col!==undefined){ if(dbl>1) return; e.preventDefault(); state.sel=c.col; ctx.redraw(); ctx.status(); return; }
    if(c.edgeIdx!==undefined){
      if(dbl>1){ e.preventDefault(); openEditorFor(c); return; }
      e.preventDefault(); state.selLane=null; ctx.redraw(); return;
    }
    if(dbl>1){
      e.preventDefault();
      if(!editable(c)) return;
      openEditorFor(c);
      return;
    }
    if(c.nameLane||c.rowLane){ state.selLane=c.nameLane||c.rowLane; ctx.redraw(); return; }
    // 单击格子只选中，不写入；写入统一由 writeChar（键盘 / 字符条）完成
    e.preventDefault();
    if(isTouch){
      state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
      state.sel=null; ctx.painting=null; ctx.redraw();
      startLong(c,e.clientX,e.clientY);
      return;
    }
    ctx.focusCanvas();
    state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
    ctx.painting={ lane:c.lane, ticks:[], v:state.ch, base:{ir:state.ir,src:code.value,sel:state.sel}, moved:false };
    ctx.redraw();
  }
  function showDropLine(to){
    var svg=svgRoot(); if(!svg) return;
    var ln=svg.querySelector('line.dropLine');
    if(!ln){ ln=document.createElementNS('http://www.w3.org/2000/svg','line'); ln.setAttribute('class','dropLine'); svg.appendChild(ln); }
    var y=TOP+to*ROW_H;
    ln.setAttribute('x1',PAD); ln.setAttribute('x2',state.W-PAD); ln.setAttribute('y1',y); ln.setAttribute('y2',y);
  }
  function showConnectPreview(mx,my){
    var svg=svgRoot(); if(!svg||!state.connect) return;
    var p=svg.querySelector('path.connectPreview');
    if(!p){ p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('class','connectPreview'); svg.appendChild(p); }
    var a=state.connect, ax=XS+a.tick*CELL+CELL/2, ay=TOP+a.li*ROW_H+(TOUCH?11:7);
    p.setAttribute('d','M'+ax+','+ay+' C'+(ax+10)+','+(ay-26)+' '+(mx-10)+','+(my-26)+' '+mx+','+my);
  }

  wrap.addEventListener('mousedown',function(e){
    if(Date.now()<ignoreMouseUntil) return;   // 触摸后浏览器合成的 mousedown 不再重复执行
    handleDown(e,false);
  });
  wrap.addEventListener('mousemove',function(e){
    var svg=svgRoot();
    if(state.drag&&svg){
      var yy=e.clientY-svg.getBoundingClientRect().top;
      var to=Math.max(0,Math.min(state.ir.lanes.length,Math.round((yy-TOP)/ROW_H)));
      state.drag.to=to; showDropLine(to); return;
    }
    if(state.connect&&svg){
      var r=svg.getBoundingClientRect();
      showConnectPreview(e.clientX-r.left,e.clientY-r.top);
    }
    var hc=cellAt(e);
    if(!ctx.painting||!e.buttons) return;
    var c=hc;
    if(!c||c.lane===undefined||c.tick===undefined||c.lane!==ctx.painting.lane||ctx.painting.ticks.indexOf(c.tick)>=0) return;
    ctx.painting.ticks.push(c.tick); ctx.painting.moved=true;
    state.ch=ctx.painting.v; state.selCell={lane:c.lane,tick:c.tick};
    ctx.commit({t:'setSlot',lanes:[c.lane],tick:c.tick,v:ctx.painting.v},'漫刷 @ t'+c.tick,true,true);
  });
  document.addEventListener('mouseup',function(){
    if(Date.now()<ignoreMouseUntil) return;
    if(state.drag){
      var d=state.drag; state.drag=null;
      var svg=svgRoot(), ln=svg&&svg.querySelector('line.dropLine'); if(ln&&ln.parentNode) ln.parentNode.removeChild(ln);
      var from=d.from, to=d.to, steps=(to>from?to-1:to)-from;
      if(steps&&state.ir){
        var dir=steps>0?'down':'up';
        for(var k=0;k<Math.abs(steps);k++){
          var idx=from+(steps>0?k:-k), lane=state.ir.lanes[idx]; if(!lane) break;
          ctx.commit({t:'moveLane',lane:lane.id,v:dir},'拖动重排',true,true);
        }
        state.undo.push(d.base); if(state.undo.length>60) state.undo.shift(); state.redo.length=0;
        state.selLane=state.ir.lanes[from+steps]?state.ir.lanes[from+steps].id:null;
        ctx.notify('拖动重排：第 '+(from+1)+' 行 → 第 '+(from+steps+1)+' 行（整段合并为一次撤销）');
        ctx.status();
      } else ctx.notify('拖动取消：行顺序未变');
      ctx.redraw(); ctx.focusCanvas(); ctx.painting=null; return;
    }
    if(!ctx.painting) return;
    var p=ctx.painting; ctx.painting=null;
    if(p.moved){
      state.undo.push(p.base); if(state.undo.length>60) state.undo.shift(); state.redo.length=0;
      ctx.notify('漫刷完成：'+p.ticks.length+' 个槽合并为一次撤销');
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
    if(longPress&&(Math.abs((e.clientX||0)-longPress.x)>12||Math.abs((e.clientY||0)-longPress.y)>12)) clearLong();
  });
  function endPointer(e){ if(e.pointerType!=='mouse') clearLong(); }
  document.addEventListener('pointerup',endPointer);
  document.addEventListener('pointercancel',endPointer);

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
      var t=e.touches&&e.touches[0]; if(!t||!longPress) return;
      if(Math.abs(t.clientX-longPress.x)>12||Math.abs(t.clientY-longPress.y)>12) clearLong();
    },{passive:true});
    document.addEventListener('touchend',clearLong,{passive:true});
    document.addEventListener('touchcancel',clearLong,{passive:true});
  }

  document.addEventListener('keydown',function(e){
    var t=e.target||{}, typing=/^(TEXTAREA|INPUT|SELECT)$/.test(t.tagName||'')||t.isContentEditable;
    if(e.key==='Escape'&&state.drag){
      state.drag=null; var dl=svgRoot()&&svgRoot().querySelector('line.dropLine');
      if(dl&&dl.parentNode) dl.parentNode.removeChild(dl);
      ctx.redraw(); ctx.notify('已取消拖动'); return;
    }
    if(e.key==='Escape'&&state.connect){ state.connect=null; ctx.redraw(); ctx.notify('已取消连线'); return; }
    if((e.ctrlKey||e.metaKey)&&/^(z|y)$/i.test(e.key)&&!typing){
      if(e.preventDefault) e.preventDefault();
      ctx.doCmd((e.shiftKey||/^y$/i.test(e.key))?'redo':'undo'); return;
    }
    if(typing) return;
    if(e.key==='Escape'&&state.selCell){
      if(e.preventDefault) e.preventDefault();
      state.selCell=null; ctx.redraw(); return;
    }
    var sc=state.selCell;
    if(!sc||!state.ir) return;
    var k=e.key, N=state.ir.ticks;
    if(Core.ALL.indexOf(k)>=0){ if(e.preventDefault) e.preventDefault(); writeChar(k); return; }
    if(k==='Enter'){ if(e.preventDefault) e.preventDefault(); openInlineFor({lane:sc.lane,tick:sc.tick}); return; }
    if(k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown'){
      if(e.preventDefault) e.preventDefault();
      var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===sc.lane) li=i; });
      if(k==='ArrowLeft') state.selCell={lane:sc.lane,tick:Math.max(0,sc.tick-1)};
      else if(k==='ArrowRight') state.selCell={lane:sc.lane,tick:Math.min(N-1,sc.tick+1)};
      else { var nl=state.ir.lanes[Math.max(0,Math.min(state.ir.lanes.length-1,li+(k==='ArrowUp'?-1:1)))];
        state.selCell={lane:nl.id,tick:sc.tick}; state.selLane=nl.id; }
      ctx.redraw(); return;
    }
  });
  ctx.svgRoot=svgRoot;
  ctx.findLane=findLane;
  ctx.closeInline=closeInline;
  ctx.openInline=openInline;
  // 触摸操作栏复用的动作（同一命令、同一 EditOp，不新增第二套编辑路径）
  ctx.openRowEditor=openRowEditor;
  ctx.openCellCharEditor=openCellCharEditor;
  ctx.openLabelEditor=openLabelEditor;
  ctx.openNodeEditor=openNodeEditor;
  ctx.openEdgeEditor=openEdgeEditor;
  ctx.openInlineFor=openInlineFor;
  ctx.openEditorFor=openEditorFor;
  ctx.handleTool=handleTool;
  ctx.handleColAct=handleColAct;
  ctx.cancelModes=function(){
    state.connect=null; state.selCell=null; state.sel=null; state.selLane=null;
    state.drag=null; ctx.painting=null; ctx.closeInline(false); ctx.redraw();
  };
}
