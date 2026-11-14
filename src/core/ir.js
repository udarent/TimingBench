// Canonical IR 内核：Parser / buildIR / emitIR / canon / 16 类 EditOp / patchSource。
// 纯 JS，零 DOM、零依赖；Node 自检与浏览器运行时共用同一份实现。
export const Core = (function () {
  'use strict';
  var BUS = /[=2-9]/, LEVEL = /[01xzud]/, CLOCK = /[pPnNhHlL]/;
  var ALL = ['0','1','x','z','u','d','p','P','n','N','h','l','H','L','=','2','3','4','5','6','7','8','9'];

  function Parser(src) { this.s = src; this.i = 0; }
  Parser.prototype.ws = function () {
    while (this.i < this.s.length) {
      var c = this.s[this.i];
      if (/\s/.test(c)) { this.i++; continue; }
      if (c === '/' && this.s[this.i+1] === '/') { while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++; continue; }
      if (c === '/' && this.s[this.i+1] === '*') { this.i += 2; while (this.i < this.s.length && !(this.s[this.i] === '*' && this.s[this.i+1] === '/')) this.i++; this.i += 2; continue; }
      break;
    }
  };
  Parser.prototype.err = function (m) { var e = new Error(m + ' @' + this.i); e.pos = this.i; throw e; };
  Parser.prototype.value = function () {
    this.ws(); var s = this.i, c = this.s[this.i];
    if (c === '{') return this.obj();
    if (c === '[') return this.arr();
    if (c === '"' || c === "'") return this.str();
    if (c === '-' || /[0-9]/.test(c)) { var m = /^-?\d+(?:\.\d+)?/.exec(this.s.slice(this.i)); if (!m) this.err('bad number'); this.i += m[0].length; return { k:'num', v:Number(m[0]), s:s, e:this.i }; }
    var id = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
    if (id) { this.i += id[0].length; var v = id[0]==='true'?true:id[0]==='false'?false:id[0]; return { k:'id', v:v, s:s, e:this.i }; }
    this.err('unexpected token ' + c);
  };
  Parser.prototype.str = function () {
    var q = this.s[this.i], s = this.i; this.i++; var out = '';
    var escMap = { n:'\n', r:'\r', t:'\t', b:'\x08', f:'\x0c', v:'\x0b', '0':'\x00' };
    while (this.i < this.s.length) {
      var c = this.s[this.i++];
      if (c === '\\') {
        var n = this.s[this.i++];
        if (n === 'u') { var h = this.s.slice(this.i,this.i+4); if (/^[0-9a-fA-F]{4}$/.test(h)) { out += String.fromCharCode(parseInt(h,16)); this.i += 4; } else out += n; continue; }
        if (n === 'x') { var h2 = this.s.slice(this.i,this.i+2); if (/^[0-9a-fA-F]{2}$/.test(h2)) { out += String.fromCharCode(parseInt(h2,16)); this.i += 2; } else out += n; continue; }
        out += Object.prototype.hasOwnProperty.call(escMap,n) ? escMap[n] : n;
        continue;
      }
      if (c === q) break;
      out += c;
    }
    return { k:'str', v:out, s:s, e:this.i, quote:q };
  };
  Parser.prototype.obj = function () {
    var s = this.i; this.i++; var props = []; this.ws();
    if (this.s[this.i] === '}') { this.i++; return { k:'obj', props:props, s:s, e:this.i }; }
    for (;;) {
      this.ws(); var ks = this.i;
      var keyNode = (this.s[this.i]==='"'||this.s[this.i]==="'") ? this.str() : (function(p){ var m=/^[A-Za-z_$][\w$]*/.exec(p.s.slice(p.i)); if(!m) p.err('bad key'); p.i+=m[0].length; return {v:m[0]}; })(this);
      var key = keyNode.v;
      this.ws(); if (this.s[this.i] !== ':') this.err('expected :'); this.i++;
      var val = this.value();
      props.push({ key:key, val:val, s:ks, e:this.i, vs:val.s, ve:val.e });
      this.ws();
      if (this.s[this.i] === ',') { this.i++; this.ws(); if (this.s[this.i] === '}') { this.i++; break; } continue; }
      if (this.s[this.i] === '}') { this.i++; break; }
      this.err('expected , or }');
    }
    return { k:'obj', props:props, s:s, e:this.i };
  };
  Parser.prototype.arr = function () {
    var s = this.i; this.i++; var items = []; this.ws();
    if (this.s[this.i] === ']') { this.i++; return { k:'arr', items:items, s:s, e:this.i }; }
    for (;;) {
      items.push(this.value()); this.ws();
      if (this.s[this.i] === ',') { this.i++; this.ws(); if (this.s[this.i] === ']') { this.i++; break; } continue; }
      if (this.s[this.i] === ']') { this.i++; break; }
      this.err('expected , or ]');
    }
    return { k:'arr', items:items, s:s, e:this.i };
  };

  function prop(o,k) { if(!o||o.k!=='obj') return null; for(var i=0;i<o.props.length;i++) if(o.props[i].key===k) return o.props[i]; return null; }
  function numOf(o,k,d){ var p=prop(o,k); return p&&p.val.k==='num'?p.val.v:d; }
  function strOf(o,k,d){ var p=prop(o,k); return p&&p.val.k==='str'?p.val.v:d; }
  function dataOf(o){ var p=prop(o,'data'); if(!p) return null;
    if(p.val.k==='str') return { form:'str', list:p.val.v.split(/\s+/).filter(function(x){return x.length;}), range:[p.val.s,p.val.e] };
    if(p.val.k==='arr') return { form:'arr', list:p.val.items.map(function(x){return String(x.v);}), range:[p.val.s,p.val.e] };
    return null; }

  function parseWave(w, dataList) {
    var slots=[], subs=[], di=0, prev='x', pending='';
    for (var i=0;i<w.length;i++) {
      var c=w[i];
      if (c==='<'||c==='>') { pending+=c; continue; }
      if (pending) { subs.push({ at:slots.length, s:pending }); pending=''; }
      var rep = (c==='.'||c==='|');
      var point = !rep;
      var wv = point ? (rep?'x':c) : prev;
      var label = null;
      if (point && !rep && BUS.test(c)) label = (dataList && di<dataList.length) ? dataList[di++] : '';
      slots.push({ w:wv, point:point, gap:(c==='|'), label:label });
      prev = wv;
    }
    if (pending) subs.push({ at:slots.length, s:pending });
    return { slots:slots, subs:subs, consumed:di };
  }

  function normalizeSlots(l) {
    var prev='x';
    for (var i=0;i<l.slots.length;i++) {
      var s=l.slots[i];
      if (s.point && !s.gap) { prev=s.w; }
      else { s.w=prev; s.label=null; }
    }
  }

  function makeLane(item, groupPath, id, src) {
    var w=strOf(item,'wave',''), d=dataOf(item), nd=strOf(item,'node',null);
    var pw=parseWave(w, d?d.list:[]);
    var slots=pw.slots, n=slots.length;
    var node=[];
    // 只有 node、没有 wave 的行（教程 `{ node: '...g..h' }`）用它自己的 node 字符串定长，
    // 否则会因 slots 为空而丢掉锚点、引用它的 edge 找不到端点。有 slots 的行仍按 slots 定长
    // （保持既有行为与往返不变量：node 与 slots 一一对应）。
    var nn = n > 0 ? n : (nd ? nd.length : 0);
    for (var i=0;i<nn;i++) node.push(nd && i<nd.length ? nd[i] : '.');
    var lane = {
      id:id, kind:'signal', name:strOf(item,'name','sig'), phase:numOf(item,'phase',0), period:numOf(item,'period',1),
      groupPath:groupPath.slice(), slots:slots, subs:pw.subs, node:node,
      dataForm:d?d.form:null, range:[item.s,item.e],
      orig:{ wave:w, name:strOf(item,'name','sig'), data:d?d.list.slice():null, node:nd, phase:numOf(item,'phase',0), period:numOf(item,'period',1) }
    };
    ['wave','name','data','node','phase','period'].forEach(function(k){ var p=prop(item,k);
      lane[k+'Range'] = p?[p.val.s,p.val.e]:null; lane[k+'PropRange'] = p?[p.s,p.e]:null; });
    normalizeSlots(lane);
    return lane;
  }

  function collect(items, groupPath, out, src, warnings) {
    items.forEach(function(item) {
      if (item.k==='obj') {
        if (!item.props.length) { out.push({ id:'l'+out.length, kind:'spacer', name:'', groupPath:groupPath.slice(), slots:[], subs:[], node:[], range:[item.s,item.e], orig:{} }); return; }
        out.push(makeLane(item, groupPath, 'l'+out.length, src));
      } else if (item.k==='arr') {
        var g = (item.items[0] && item.items[0].k==='str') ? item.items[0].v : '';
        collect(item.items.slice(1), groupPath.concat([g]), out, src, warnings);
      }
    });
  }

  function buildIR(src) {
    var p=new Parser(src); p.ws();
    var wrapped=false;
    if (p.s[p.i]==='(') { p.i++; wrapped=true; }
    var root=p.value();
    if (root.k!=='obj') throw new Error('根节点必须是对象');
    p.ws();
    if (wrapped) { if (p.s[p.i]!==')') throw new Error('缺少右括号'); p.i++; p.ws(); }
    if (p.i < p.s.length) throw new Error('根对象后存在多余内容 @'+p.i);
    var sig=prop(root,'signal'); if(!sig||sig.val.k!=='arr') throw new Error('缺少 signal 数组');
    var lanes=[], warnings=[];
    collect(sig.val.items, [], lanes, src, warnings);
    var N=0; lanes.forEach(function(l){ if(l.kind==='signal'){ N=Math.max(N,l.slots.length); normalizeSlots(l); } });
    var edges=[], extras=[];
    root.props.forEach(function(pr){
      if(pr.key==='signal') return;
      if(pr.key==='edge' && pr.val.k==='arr'){ edges=pr.val.items.map(function(x){return String(x.v);}); return; }
      extras.push({ key:pr.key, text:src.slice(pr.s,pr.e), range:[pr.s,pr.e] });
    });
    return { ticks:N, lanes:lanes, edges:edges, extras:extras, raw:src, rootRange:[root.s,root.e], warnings:warnings, rev:0 };
  }

  function quote(s,q){ q=q||"'"; return q+String(s).replace(/\\/g,'\\\\').replace(new RegExp(q,'g'),'\\'+q)
    .replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t')
    .replace(/\x08/g,'\\b').replace(/\x0c/g,'\\f').replace(/\x0b/g,'\\v').replace(/\x00/g,'\\0')+q; }
  function qmap(a){ return a.map(function(x){return quote(x);}).join(', '); }
  function subsAt(l,at){ var s=''; l.subs.forEach(function(x){ if(x.at===at) s+=x.s; }); return s; }
  function laneWave(l){
    var out='';
    for(var i=0;i<l.slots.length;i++){
      out+=subsAt(l,i);
      var s=l.slots[i];
      if(s.gap) out+='|'; else if(!s.point) out+='.'; else out+=s.w;
    }
    return out+subsAt(l,l.slots.length);
  }
  function laneLabels(l){ return l.slots.filter(function(s){return s.point&&!s.gap&&BUS.test(s.w)&&s.label!==null;}).map(function(s){return s.label;}); }
  function needData(l){ var a=laneLabels(l); return a.length>0 && (l.dataForm!==null || a.some(function(x){return x!=='';})); }

  function emitLane(l){
    if(l.kind==='spacer') return '{}';
    var labels=laneLabels(l), parts=[];
    parts.push('name: '+quote(l.name));
    parts.push('wave: '+quote(laneWave(l)));
    if(needData(l)) parts.push('data: '+(l.dataForm==='str'&&labels.every(function(x){return x&&!/\s/.test(x);}) ? quote(labels.join(' ')) : '['+qmap(labels)+']'));
    if(l.node.some(function(x){return x!=='.';})) parts.push('node: '+quote(l.node.join('')));
    if(l.phase) parts.push('phase: '+l.phase);
    if(l.period!==1) parts.push('period: '+l.period);
    return '{ '+parts.join(', ')+' }';
  }
  function emitGroup(items,depth){
    var out=[], i=0;
    while(i<items.length){
      var l=items[i];
      if(l.kind==='spacer'){ out.push('{}'); i++; continue; }
      if(l.groupPath.length>depth){
        var g=l.groupPath[depth], sub=[];
        while(i<items.length && items[i].groupPath.length>depth && items[i].groupPath[depth]===g){ sub.push(items[i]); i++; }
        out.push('['+quote(g)+', '+emitGroup(sub,depth+1).join(', ')+']');
      } else { out.push(emitLane(l)); i++; }
    }
    return out;
  }
  function emitIR(ir){
    var body=emitGroup(ir.lanes,0).map(function(s){return '  '+s;}).join(',\n');
    var tail='';
    if(ir.edges.length) tail+=',\n  edge: ['+qmap(ir.edges)+']';
    ir.extras.forEach(function(x){ tail+=',\n  '+x.text; });
    return '{ signal: [\n'+body+'\n]'+tail+'\n}';
  }

  function enc(s){ s=String(s); return s.length+':'+s+';'; }
  function canon(ir){
    var parts=[];
    ir.lanes.forEach(function(l){
      if(l.kind==='spacer'){ parts.push(enc('~'+enc(l.groupPath.join('/')))); return; }
      var ss=l.slots.map(function(s){ return enc(s.w)+enc(s.point?'P':'r')+enc(s.gap?'G':'-')+enc(s.label===null?'':s.label); }).join('');
      parts.push(enc(enc(l.name)+enc(String(l.phase))+enc(String(l.period))+enc(l.groupPath.join('/'))+enc(l.node.join(''))+enc(laneWave(l))+enc(ss)));
    });
    parts.push(enc('E'+ir.edges.map(enc).join('')));
    return parts.join('');
  }

  function clone(ir){
    return { ticks:ir.ticks, rev:ir.rev, raw:ir.raw, rootRange:ir.rootRange.slice(), warnings:ir.warnings.slice(),
      edges:ir.edges.slice(), extras:ir.extras.map(function(x){return {key:x.key,text:x.text,range:x.range.slice()};}),
      lanes:ir.lanes.map(function(l){
        return { id:l.id, kind:l.kind, name:l.name, phase:l.phase, period:l.period, groupPath:l.groupPath.slice(),
          slots:l.slots.map(function(s){ var o={w:s.w,point:s.point,gap:s.gap,label:s.label};
            if(s.saved) o.saved={w:s.saved.w,label:s.saved.label}; return o; }),
          subs:l.subs.map(function(s){return {at:s.at,s:s.s};}), node:l.node.slice(), dataForm:l.dataForm,
          range:l.range.slice(),
          waveRange:l.waveRange?l.waveRange.slice():null, nameRange:l.nameRange?l.nameRange.slice():null,
          dataRange:l.dataRange?l.dataRange.slice():null, nodeRange:l.nodeRange?l.nodeRange.slice():null,
          phaseRange:l.phaseRange?l.phaseRange.slice():null, periodRange:l.periodRange?l.periodRange.slice():null,
          wavePropRange:l.wavePropRange?l.wavePropRange.slice():null, namePropRange:l.namePropRange?l.namePropRange.slice():null,
          dataPropRange:l.dataPropRange?l.dataPropRange.slice():null, nodePropRange:l.nodePropRange?l.nodePropRange.slice():null,
          phasePropRange:l.phasePropRange?l.phasePropRange.slice():null, periodPropRange:l.periodPropRange?l.periodPropRange.slice():null,
          orig:{ wave:l.orig.wave, name:l.orig.name, data:l.orig.data?l.orig.data.slice():null, node:l.orig.node, phase:l.orig.phase, period:l.orig.period } };
      }) };
  }

  function labelList(v){
    if(Array.isArray(v)) return v.map(function(x){return String(x);});
    var s=String(v===undefined||v===null?'':v).trim();
    return s?s.split(/\s+/):[];
  }
  function retick(n){
    var t=0; n.lanes.forEach(function(l){ if(l.kind==='signal') t=Math.max(t,l.slots.length); }); n.ticks=t;
  }
  function nextLaneId(n){
    var used={}, i=0; n.lanes.forEach(function(l){ used[l.id]=1; });
    while(used['l'+i]) i++;
    return 'l'+i;
  }
  // 尾部续写：wave 比全局周期数短时，先按 repeater 语义补齐到目标周期再落笔；
  // 只在确实扩展时返回 true，避免影响原本范围内的写入。
  function ensureTail(l,tick){
    if(l.kind!=='signal'||l.slots.length>tick) return false;
    var last=l.slots.length?l.slots[l.slots.length-1].w:'x';
    while(l.slots.length<=tick){ l.slots.push({w:last,point:false,gap:false,label:null}); l.node.push('.'); }
    return true;
  }

  function applyOp(ir,op){
    var n=clone(ir), changed=true;
    switch(op.t){
      case 'setSlot': {
        var ext=false;
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||(op.lanes&&op.lanes.indexOf(l.id)<0)) return;
          if(ensureTail(l,op.tick)) ext=true;
          var v=op.v; if(v==='auto'){ var cur=l.slots[op.tick].w; v=ALL[(ALL.indexOf(cur)+1+ALL.length)%ALL.length]||'1'; }
          l.slots[op.tick]={ w:v, point:true, gap:false, label:BUS.test(v)?'':null }; normalizeSlots(l); });
        if(ext) retick(n);
        break;
      }
      case 'setLabel':
        n.lanes.forEach(function(l){ if(l.id===op.lane&&op.tick<l.slots.length){ var s=l.slots[op.tick]; if(s.point&&!s.gap&&BUS.test(s.w)) s.label=op.v; } });
        break;
      case 'setNode':
        n.lanes.forEach(function(l){ if(l.id===op.lane&&op.tick<l.slots.length) l.node[op.tick]=op.v||'.'; });
        break;
      case 'rename':
        n.lanes.forEach(function(l){ if(l.id===op.lane) l.name=String(op.v); });
        break;
      case 'setWave':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          var pw=parseWave(String(op.v||''), laneLabels(l)), oldNode=l.node.slice();
          l.slots=pw.slots; l.subs=pw.subs; l.node=[];
          for(var wi=0;wi<l.slots.length;wi++) l.node.push(wi<oldNode.length?oldNode[wi]:'.');
          normalizeSlots(l);
        });
        retick(n);
        break;
      case 'setLabels':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          var list=labelList(op.v), k=0;
          // bus 点的 label 必须全为字符串：混入 null 会让 emit 的 data 数组与 marker 顺序错位
          if(!list.length) l.dataForm=null;
          l.slots.forEach(function(s){
            if(s.point&&!s.gap&&BUS.test(s.w)) s.label=k<list.length?list[k++]:'';
            else s.label=null;
          });
        });
        break;
      case 'setNodeStr':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          var s=String(op.v||''), out=[];
          for(var ni=0;ni<l.slots.length;ni++) out.push(ni<s.length?s[ni]:'.');
          l.node=out;
        });
        break;
      case 'moveLane':
        var mi=-1; n.lanes.forEach(function(l,i){ if(l.id===op.lane) mi=i; });
        var mj=mi+(op.v==='up'?-1:1);
        if(mi>=0&&mj>=0&&mj<n.lanes.length){ var mtmp=n.lanes[mi]; n.lanes[mi]=n.lanes[mj]; n.lanes[mj]=mtmp; }
        break;
      case 'setPhase': case 'setPeriod':
        n.lanes.forEach(function(l){ if(l.id===op.lane) l[op.t==='setPhase'?'phase':'period']=op.v; });
        break;
      case 'setEdges': n.edges=op.v.slice(); break;
      case 'toggleGap':
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||op.tick>=l.slots.length) return;
          var s=l.slots[op.tick];
          if(s.gap){
            if(s.saved){ s.point=true; s.gap=false; s.w=s.saved.w; s.label=s.saved.label; delete s.saved; }
            else s.gap=false;
          } else {
            if(s.point) s.saved={w:s.w,label:s.label};
            s.gap=true; s.point=false; s.label=null;
          }
          normalizeSlots(l); });
        break;
      case 'insertTick':
        n.lanes.forEach(function(l){ if(l.kind!=='signal') return;
          var at=Math.min(op.tick,l.slots.length), prev=at>0?l.slots[at-1].w:'x';
          l.slots.splice(at,0,{w:prev,point:false,gap:false,label:null}); l.node.splice(at,0,'.');
          l.subs.forEach(function(s){ if(s.at>=at) s.at++; }); normalizeSlots(l); });
        n.ticks++;
        break;
      case 'deleteTick':
        if(n.ticks<=1){ changed=false; break; }
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||op.tick>=l.slots.length) return;
          l.slots.splice(op.tick,1); l.node.splice(op.tick,1);
          l.subs.forEach(function(s){ if(s.at>op.tick) s.at--; }); normalizeSlots(l); });
        n.ticks--;
        break;
      case 'addLane': {
        var aid=op.id||nextLaneId(n);
        var aat=(op.at===undefined?n.lanes.length:Math.max(0,Math.min(n.lanes.length,op.at)));
        var fresh;
        if(op.kind==='spacer'){
          fresh={ id:aid, kind:'spacer', name:'', phase:0, period:1, groupPath:[], slots:[], subs:[], node:[], dataForm:null,
            range:[0,0], orig:{}, fresh:true };
        } else {
          fresh={ id:aid, kind:'signal', name:op.name||'new', phase:0, period:1, groupPath:[], slots:[], subs:[], node:[], dataForm:null,
            range:[0,0], waveRange:null, nameRange:null, dataRange:null, nodeRange:null, phaseRange:null, periodRange:null,
            wavePropRange:null, namePropRange:null, dataPropRange:null, nodePropRange:null, phasePropRange:null, periodPropRange:null,
            orig:{wave:'',name:op.name||'new',data:null,node:null,phase:0,period:1}, fresh:true };
          for(var ai=0;ai<n.ticks;ai++){ fresh.slots.push({w:'x',point:ai===0,gap:false,label:null}); fresh.node.push('.'); }
          normalizeSlots(fresh);
        }
        n.lanes.splice(aat,0,fresh);
        break;
      }
      case 'deleteLane': n.lanes=n.lanes.filter(function(l){return l.id!==op.lane;}); break;
      // 分组改名 / 重分组：把 groupPath 恰好等于 old 的所有行（含 spacer）整体改成新路径。
      // 空路径 = 取消分组。分组结构变化无法用字面量补丁表达，patchSource 会回落全量 emit。
      case 'regroup': {
        var oldKey=String(op.old||'');
        n.lanes.forEach(function(l){ if(l.groupPath.join('/')===oldKey) l.groupPath=(op.path||[]).slice(); });
        break;
      }
      default: changed=false;
    }
    if(changed){ n.rev++; }
    return n;
  }

  function slotsEqual(a,b){
    if(a.length!==b.length) return false;
    for(var i=0;i<a.length;i++){ var x=a[i],y=b[i]; if(x.w!==y.w||x.point!==y.point||x.gap!==y.gap||x.label!==y.label) return false; }
    return true;
  }
  function subsSig(l){ return l.subs.map(function(s){return s.at+':'+s.s;}).join(','); }
  // 在对象末尾追加字段：复用已有的尾逗号，避免生成 " , , key: ..." 这类非法源码
  function fieldInsert(range,src,texts){
    var i=range[1]-1, body=texts.join(', ');
    while(i>range[0] && /\s/.test(src[i-1])) i--;
    if(i>range[0] && src[i-1]===',') return { s:i-1, e:i, txt:', '+body+',' };
    return { s:i, e:i, txt:', '+body+' ' };
  }
  // 删除整个属性（含分隔逗号），用于不再需要 data 字段时
  function fieldDelete(propRange,src){
    var st=propRange[0], en=propRange[1], j=st;
    while(j>0 && /\s/.test(src[j-1])) j--;
    if(src[j-1]===',') st=j-1;
    else { var k=en; while(k<src.length && /\s/.test(src[k])) k++; if(src[k]===',') en=k+1; }
    return { s:st, e:en, txt:'' };
  }

  function patchSource(ir,newIR){
    var src=ir.raw, edits=[], fallback=false;
    // 行集合 / 顺序 / 分组结构变化无法用字面量补丁表达，必须走全量 emit
    if(ir.lanes.map(function(l){return l.id;}).join('|')!==newIR.lanes.map(function(l){return l.id;}).join('|')) fallback=true;
    if(ir.lanes.length===newIR.lanes.length) ir.lanes.forEach(function(ol,i){
      if(newIR.lanes[i] && ol.groupPath.join('/')!==newIR.lanes[i].groupPath.join('/')) fallback=true;
    });
    newIR.lanes.forEach(function(nl){
      var ol=null; ir.lanes.forEach(function(l){ if(l.id===nl.id) ol=l; });
      if(!ol){ fallback=true; return; }
      if(nl.fresh){ fallback=true; return; }
      if(nl.kind==='spacer'||ol.kind==='spacer') return;
      var waveChanged = !slotsEqual(ol.slots,nl.slots) || subsSig(ol)!==subsSig(nl);
      if(waveChanged){ if(!nl.waveRange){ fallback=true; return; } edits.push({s:nl.waveRange[0],e:nl.waveRange[1],txt:quote(laneWave(nl),src[nl.waveRange[0]])}); }
      if(nl.name!==ol.orig.name){ if(!nl.nameRange){ fallback=true; return; } edits.push({s:nl.nameRange[0],e:nl.nameRange[1],txt:quote(nl.name,src[nl.nameRange[0]])}); }
      var adds=[];
      var oldLabels=ol.orig.data||[], newLabels=laneLabels(nl), effective=oldLabels.slice(0,laneLabels(ol).length);
      var need = needData(nl), oldNeed = ol.dataRange!==null && effective.length>0;
      var dataChanged = (need||oldNeed) && (effective.join('\u0001')!==newLabels.join('\u0001') || need!==oldNeed);
      if(dataChanged){
        var q0 = nl.dataRange?src[nl.dataRange[0]]:(nl.waveRange?src[nl.waveRange[0]]:"'");
        var txt = (nl.dataForm==='str'&&newLabels.length&&newLabels.every(function(x){return x&&!/\s/.test(x);})) ? quote(newLabels.join(' '),q0) : '['+qmap(newLabels)+']';
        if(!need){
          // 字段不再需要：删除整个属性，而不是写 data:null（标签按空格分词，null 会抛错）
          if(nl.dataPropRange) edits.push(fieldDelete(nl.dataPropRange,src));
          else if(nl.dataRange) fallback=true;
        }
        else if(nl.dataRange) edits.push({s:nl.dataRange[0],e:nl.dataRange[1],txt:txt});
        else adds.push('data: '+txt);
      }
      var nodeStr=nl.node.join(''), oldNode=ol.orig.node||'';
      if(nodeStr.replace(/\.+$/,'')!==oldNode.replace(/\.+$/,'')){
        if(nl.nodeRange) edits.push({s:nl.nodeRange[0],e:nl.nodeRange[1],txt:quote(nodeStr,src[nl.nodeRange[0]])});
        else adds.push('node: '+quote(nodeStr));
      }
      [['phase','phaseRange'],['period','periodRange']].forEach(function(pair){
        var k=pair[0], r=pair[1], def=k==='phase'?0:1;
        if(nl[k]===ol.orig[k]) return;
        if(nl[r]) edits.push({s:nl[r][0],e:nl[r][1],txt:String(nl[k])});
        else if(nl[k]!==def) adds.push(k+': '+nl[k]);
      });
      if(adds.length){
        if(!nl.range || nl.range[1]<=nl.range[0]) fallback=true;
        else edits.push(fieldInsert(nl.range,src,adds));
      }
    });
    if(ir.edges.map(enc).join('')!==newIR.edges.map(enc).join('')) fallback=true;
    if(fallback) return { src:emitIR(newIR), patched:false, ratio:0, edits:0 };
    var mark={}, ok=true;
    edits.forEach(function(e){ for(var i=e.s;i<e.e;i++){ if(mark[i]) ok=false; mark[i]=1; } });
    if(!ok) return { src:emitIR(newIR), patched:false, ratio:0, edits:0 };
    edits.sort(function(a,b){return b.s-a.s;});
    var out=src, replaced=0;
    edits.forEach(function(e){ out=out.slice(0,e.s)+e.txt+out.slice(e.e); replaced+=(e.e-e.s); });
    var untouched=src.length-replaced;
    return { src:out, patched:true, ratio:out.length?Math.max(0,Math.min(1,untouched/out.length)):1, edits:edits.length };
  }

  function materialize(n){
    if(n.k==='obj'){ var o={}; n.props.forEach(function(p){o[p.key]=materialize(p.val);}); return o; }
    if(n.k==='arr') return n.items.map(materialize);
    return n.v;
  }
  function parseObject(src){ var p=new Parser(src); p.ws(); if(p.s[p.i]==='(') p.i++; return materialize(p.value()); }

  return { buildIR:buildIR, emitIR:emitIR, canon:canon, applyOp:applyOp, patchSource:patchSource, clone:clone,
    laneWave:laneWave, laneLabels:laneLabels, quote:quote, enc:enc, parseObject:parseObject, normalizeSlots:normalizeSlots,
    BUS:BUS, LEVEL:LEVEL, CLOCK:CLOCK, ALL:ALL };
})();
