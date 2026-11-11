// 单周期波形图元：参考上游默认皮肤的外观规范自行绘制（实线 / 斜线阴影 / 虚线 /
// 箭头 / 总线配色）。纯函数，主画布与候选字符条共用；无状态、无 DOM。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc } from '../core/util.js';
import { TOUCH } from './mode.js';

var CHIP_W=G.CHIP_W;
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
  function chipGlyph(v){ return waveGlyph(v,null,0,TOUCH?7:5,TOUCH?22:13,TOUCH?37:21,CHIP_W,{arrowX:3}); }
  function chipDesc(v){
    if(Core.BUS.test(v)) return (v==='='||v==='2')?'总线数据块（白）':'总线数据块 · 配色 '+(Number(v)+5);
    if(Core.CLOCK.test(v)) return {
      p:'时钟 · 上升沿起始', P:'时钟 · 上升沿起始 + 箭头',
      n:'时钟 · 下降沿起始', N:'时钟 · 下降沿起始 + 箭头',
      h:'高电平 · 起始上升沿', H:'高电平 · 上升沿 + 箭头',
      l:'低电平 · 起始下降沿', L:'低电平 · 下降沿 + 箭头'}[v];
    return {'1':'高电平','0':'低电平','x':'未知态（斜线阴影）','z':'高阻（中间实线）','u':'上拉（高电平虚线）','d':'下拉（低电平虚线）'}[v]||'波形字符';
  }

export { waveGlyph, waveGap, chipGlyph, chipDesc };
