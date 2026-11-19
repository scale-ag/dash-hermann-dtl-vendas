"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const B = DATA.build, META = DATA.meta;
/* vendas válidas (já deduplicadas no build); reembolsadas ficam de fora das métricas */
const SALES = DATA.sales.filter(s=>!s.rf), REFUNDS = DATA.sales.filter(s=>s.rf);
const TAX = B.tax_factor || 1.0;   // imposto da mídia paga (Meta Ads) — toggle "Imposto Meta"
const NI = '(não identificado)';
const MAIN_SHORT = B.main_product_short || 'Produto principal';

/* localStorage é por ORIGEM (scale-ag.github.io é compartilhado por todas as
   dashs da conta): metas e larguras de coluna levam o nome do repo na chave. */
const LS_NS = (location.pathname.split('/').filter(Boolean)[0]||'local');
const LS_METAS = 'dm_metas:'+LS_NS, LS_COLW = 'dm_colw:'+LS_NS;
function lsGet(k,def){ try{ const v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>(v==null||!isFinite(v))?'-':'R$ '+nf2.format(v);
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const num2f=v=>(v==null||!isFinite(v))?'-':nf2.format(v);
const roasf=v=>(v==null||!isFinite(v))?'-':nf2.format(v)+'x';
const dimf=v=>v==null?'-':String(v);
const norm=s=>(s==null?'':String(s)).trim().toLowerCase();
const brdate=d=>{ if(!d) return '-'; const p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const weekday=d=>{ const dt=new Date(d+'T00:00:00'); return isNaN(dt)?'':WD[dt.getDay()]; };
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/* nome curto da campanha: tira o prefixo comum "DTL | E6-VEN | P2-FRIO | CONV | " (só p/ tabelas estreitas) */
const campShort=s=>{ s=String(s==null?'':s); const i=s.indexOf('CONV | '); return i>=0?s.slice(i+7):s; };
const shortName=(s,n)=>{ s=String(s||'—'); n=n||24; return s.length>n?s.slice(0,n-1)+'…':s; };

/* ---------------- date helpers ---------------- */
function pad(n){return String(n).padStart(2,'0');}
function dstr(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
function addDays(s,n){const dt=new Date(s+'T00:00:00');dt.setDate(dt.getDate()+n);return dstr(dt);}
const TODAY = B.today || B.date_max;

/* ---------------- STATE ---------------- */
const STATE = {
  page:'geral', from:(()=>{const [y,m]=TODAY.split('-'); return `${y}-${m}-01`;})(), to:TODAY, preset:'mes', tax:true,
  selDays:new Set(),
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),   // filtro cruzado (aba Meta Ads)
  oSelC:new Set(),                                     // filtro de campanha (aba Otimização)
  sort:{}, colw: lsGet(LS_COLW,{}),
};
const taxf = ()=> STATE.tax ? TAX : 1;

function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
const salesActive = ()=> SALES.filter(s=>dateActive(s.d));
const metaActive  = ()=> META.filter(m=>dateActive(m.d));

/* ---------------- agregação ----------------
   Meta: sp=gasto (sem imposto) · im=impressões · cl=cliques no link · lpv=views da página ·
         ic=checkouts iniciados · rc=alcance.
   Hotmart: vd=vendas do produto principal · ft=faturamento do principal ·
            vu/fu=upsell (DNA Expert 6m) · vdn/fdn=downsell (DNA Expert 3m) · vl/fl=LTV (outras compras
            posteriores do comprador do front, ex.: Sala Educacional — fora do ROAS do funil).
            Upsell/downsell/LTV ficam com o anúncio que trouxe o COMPRADOR do front (build.py).
   Estimado (aba Otimização): ve/fe = vendas/faturamento do principal após o rateio do gap,
            fue = upsell+downsell estimados (R$) · fle = LTV estimado (R$).
   Regra de ouro: acumulativas SOMAM; taxas RECALCULAM dos totais. CPA/ROAS só com gasto > 0. */
const newAgg=()=>({sp:0,im:0,cl:0,lpv:0,ic:0,rc:0,vd:0,ft:0,vu:0,fu:0,vdn:0,fdn:0,vl:0,fl:0,ve:0,fe:0,fue:0,fle:0});
function addMeta(a,r){ a.sp+=r.sp; a.im+=r.im; a.cl+=r.cl; a.lpv+=r.lpv; a.ic+=r.ic; a.rc+=r.rc; }
function addSale(a,s){
  if(s.role==='front'){ a.vd+=1; a.ft+=s.v; } else if(s.role==='up'){ a.vu+=1; a.fu+=s.v; }
  else if(s.role==='down'){ a.vdn+=1; a.fdn+=s.v; } else { a.vl+=1; a.fl+=s.v; } }
function addEst(a,e){
  if(e.role==='front'){ a.ve+=e.w; a.fe+=e.w*e.v; } else if(e.role==='ltv'){ a.fle+=e.w*e.v; } else { a.fue+=e.w*e.v; } }
function derive(a){
  const g=a.sp*taxf(), fF=a.ft+a.fu+a.fdn, fL=fF+a.fl;
  return {gasto:g, impr:a.im, clicks:a.cl, lpv:a.lpv, ic:a.ic, reach:a.rc,
    vendas:a.vd, fatFront:a.ft, fat:fF, fatL:fL, vu:a.vu, vdn:a.vdn, fud:a.fu+a.fdn, fl:a.fl,
    aov:a.vd?fF/a.vd:null, takeUp:a.vd?a.vu/a.vd:null, takeDown:(a.vd-a.vu)>0?a.vdn/(a.vd-a.vu):null,
    /* BACK = tudo que o comprador do front compra depois: upsell + downsell + Sala/LTV */
    fatBack:a.fu+a.fdn+a.fl, fatTotal:fL,
    roasBack:a.sp>0?(a.fu+a.fdn+a.fl)/g:null, roasTotal:a.sp>0?fL/g:null,
    cpm:a.im?g/a.im*1000:null, freq:a.rc?a.im/a.rc:null,
    ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    connect:a.cl?a.lpv/a.cl:null, cplpv:a.lpv?g/a.lpv:null,
    convPg:a.lpv?a.ic/a.lpv:null, cpic:a.ic?g/a.ic:null,
    convCk:a.ic?a.vd/a.ic:null,
    cpa:(a.vd&&a.sp>0)?g/a.vd:null, ticket:a.vd?a.ft/a.vd:null,
    roas:a.sp>0?fF/g:null, roasFront:a.sp>0?a.ft/g:null, roasL:a.sp>0?fL/g:null, res:fF-g, resL:fL-g, resT:fL-g};
}
function deriveE(a){
  const d=derive(a), g=d.gasto;
  d.ve=a.ve; d.fe=a.fe; d.fue=a.fue; d.fle=a.fle; d.fatE=a.fe+a.fue;
  d.cpaE=(a.ve>=0.05&&a.sp>0)?g/a.ve:null;
  d.roasE=a.sp>0?(a.fe+a.fue)/g:null; d.roasLE=a.sp>0?(a.fe+a.fue+a.fle)/g:null;
  d.roasFE=a.sp>0?a.fe/g:null; d.roasBE=a.sp>0?(a.fue+a.fle)/g:null; d.roasTE=d.roasLE; d.fatTE=a.fe+a.fue+a.fle;
  d.convCkE=a.ic?a.ve/a.ic:null;
  return d;
}
function buildAgg(fS,fM,dim){
  const m={}, get=k=>m[k]||(m[k]=newAgg());
  fM.forEach(r=>addMeta(get(r[dim]),r));
  fS.forEach(s=>{ if(s[dim]!=null) addSale(get(s[dim]),s); });
  return m;
}
function totals(fS,fM){ const a=newAgg(); fM.forEach(r=>addMeta(a,r)); fS.forEach(s=>addSale(a,s)); return a; }
function daily(fS,fM){
  const days={}, g=d=>days[d]||(days[d]=Object.assign(newAgg(),{d}));
  fM.forEach(r=>{ if(r.d) addMeta(g(r.d),r); });
  fS.forEach(s=>{ if(s.d) addSale(g(s.d),s); });
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
}

/* ---------------- RATEIO DO GAP (vendas estimadas) ----------------
   Venda paga com anúncio identificado pela UTM -> peso 1 no próprio anúncio.
   Venda paga SEM anúncio identificado (UTM antiga só com ID, ou campanha só por ID) ->
   rateada entre os anúncios ativos NO MESMO DIA proporcionalmente aos CHECKOUTS
   iniciados no Meta (fallback: views da página → cliques → gasto), restrita à
   campanha/conjunto quando eles são conhecidos. Sem atividade no dia, usa a
   campanha no período todo. É uma ESTIMATIVA — sempre rotulada como "est.". */
const SEP='\u0001';
const EST = (function(){
  const idx={day:{},dayC:{},dayCA:{},camp:{},campA:{}};
  const push=(o,k,v)=>{ (o[k]||(o[k]=[])).push(v); };
  META.forEach(m=>{ if(!m.d) return;
    push(idx.day,m.d,m); push(idx.dayC,m.d+SEP+m.camp,m); push(idx.dayCA,m.d+SEP+m.camp+SEP+m.adset,m);
    push(idx.camp,m.camp,m); push(idx.campA,m.camp+SEP+m.adset,m); });
  const weights=rows=>{
    for(const k of ['ic','lpv','cl','sp']){
      let s=0; rows.forEach(r=>{ s+=r[k]; });
      if(s>0){ const w={}; rows.forEach(r=>{ if(r[k]>0){ const key=r.camp+SEP+r.adset+SEP+r.ad; w[key]=(w[key]||0)+r[k]/s; } }); return w; }
    }
    return null;
  };
  const out=[];
  SALES.forEach(s=>{
    if(s.src!=='meta') return;
    const base={d:s.d, role:s.role, main:s.main, v:s.v, lvl:s.lvl};
    if(s.lvl==='ad'){ out.push(Object.assign(base,{camp:s.camp,adset:s.adset,ad:s.ad,w:1,est:0})); return; }
    const pools=[];
    if(s.lvl==='adset'){ pools.push(idx.dayCA[s.d+SEP+s.camp+SEP+s.adset]); pools.push(idx.campA[s.camp+SEP+s.adset]); }
    if(s.lvl==='adset'||s.lvl==='camp'){ pools.push(idx.dayC[s.d+SEP+s.camp]); pools.push(idx.camp[s.camp]); }
    else pools.push(idx.day[s.d]);
    let w=null; for(const p of pools){ if(p&&p.length){ w=weights(p); if(w) break; } }
    if(!w){ out.push(Object.assign(base,{camp:s.camp,adset:s.adset,ad:s.ad,w:1,est:0,orphan:1})); return; }
    Object.entries(w).forEach(([k,x])=>{ const p=k.split(SEP); out.push(Object.assign({},base,{camp:p[0],adset:p[1],ad:p[2],w:x,est:1})); });
  });
  return out;
})();
const estActive = ()=> EST.filter(e=>dateActive(e.d));

/* ---------------- generic interactive table ---------------- */
/* cfg: {id, cols:[{key,label,type,dim?,heat?:'gasto'|'leads',cls?}], rows:[{k,cells:{}, raw?}],
        total:{}, selectable, selSet, onSelect } */
// medição de texto (canvas) p/ auto-largura de coluna — "caiba o nome inteiro" (dim)
// e auto-ajuste em duplo-clique na borda, como Google Sheets / Looker Studio.
let _measureCtx=null;
function textWidth(s, font){
  if(!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  _measureCtx.font=font;
  return _measureCtx.measureText(s==null?'':String(s)).width;
}
const fmtStd=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='num2'?num2f(v):t==='date'?brdate(v):t==='html'?'':dimf(v);
const FONT_DIM='500 12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_NUM='12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_HEAD='700 11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
function autoDimWidth(cfg,c){
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_DIM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_DIM); if(w>max) max=w; }
  return Math.max(140, Math.min(1000, Math.round(max)+46)); // + padding (10+10) + folga p/ seta de ordenação
}
function autoColWidth(cfg,c){
  if(c.type==='dim') return autoDimWidth(cfg,c);
  // cabeçalho é renderizado em CAIXA ALTA com letter-spacing: mede assim (+8%)
  let max=textWidth(String(c.label||'').toUpperCase(),FONT_HEAD)*1.08;
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_NUM); if(w>max) max=w; });
  // Total Geral é renderizado em negrito: mede em negrito
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),'700 '+FONT_NUM); if(w>max) max=w; }
  return Math.max(60, Math.min(260, Math.round(max)+30));
}
function colWidth(cfg,c){ const saved=(STATE.colw[cfg.id]||{})[c.key];
  // dimensão nunca trunca: mesmo com largura salva (redimensionada à mão numa
  // sessão anterior), nunca fica MENOR que o necessário p/ caber o nome mais
  // longo de agora — senão um nome novo/maior que o salvo volta a cortar com "…".
  if(c.type==='dim'){ const auto=autoDimWidth(cfg,c); return saved?Math.max(saved,auto):auto; }
  if(saved) return saved;
  if(c.w) return c.w;
  if(c.type==='date') return 96;
  if(c.type==='html') return 92;
  // métricas: nunca menor que o conteúdo (inclui o Total Geral, ex.: "R$ 119.993,33") nem que o cabeçalho
  const auto=autoColWidth(cfg,c);
  if(c.type==='brl') return Math.max(110, auto);
  return Math.max(92, auto); }
/* colunas sticky (cfg.cols[i].stk === 'l'|'r'): posicionadas com position:sticky
   DENTRO da mesma <table> (1 único container de scroll, nativo) — o offset
   (left/right, em px) é a soma acumulada da largura das colunas sticky que vêm
   antes dela (ver stkOffsets). Com sticky nativo numa tabela só, não há nada
   para sincronizar — o navegador cuida da posição em todos os frames. */
function stkOffsets(cols, widths){
  const leftIdx=[], rightIdx=[];
  cols.forEach((c,i)=>{ if(c.stk==='l') leftIdx.push(i); else if(c.stk==='r') rightIdx.push(i); });
  const leftOff={}, rightOff={};
  let acc=0; leftIdx.forEach(i=>{ leftOff[i]=acc; acc+=widths[i]; });
  acc=0; for(let j=rightIdx.length-1;j>=0;j--){ const i=rightIdx[j]; rightOff[i]=acc; acc+=widths[i]; }
  return {leftOff, rightOff, lastLeft:leftIdx[leftIdx.length-1], firstRight:rightIdx[0]};
}
function renderTable(cfg){
  const table=document.getElementById(cfg.id); if(!table) return;
  table.classList.toggle('dt-center', !!cfg.center);   // Mar01: dados centralizados
  const fit=!!cfg.fit;                                  // fit: cabe 100% da largura, sem scroll
  table.classList.toggle('dt-fit', fit);
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && c.type==='dim'){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  // métricas de custo sempre com "R$" (mesmo em tabelas densas/fit) — % nas de taxa, sem símbolo nas demais
  const fmt=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='num2'?num2f(v):t==='date'?brdate(v):t==='html'?(v==null?'-':String(v)):dimf(v);
  const widths=fit?[]:cfg.cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
  // modo fit: dimensão/data com largura fixa; colunas numéricas dividem o resto por igual
  const fitW=c=> c.w?c.w+'px' : c.type==='date'?'74px' : c.type==='dim'?(c.big?'210px':'116px') : '';
  const colgroup='<colgroup>'+cfg.cols.map((c,i)=>{
    const w=fit?fitW(c):(widths[i]+'px'); return `<col${w?` style="width:${w}"`:''}>`;
  }).join('')+'</colgroup>';
  const esc=s=>String(s==null?'':s).replace(/"/g,'&quot;');
  const stkCls=c=>c.stk?' stk-'+c.stk:'';
  const hasStk=cfg.cols.some(c=>c.stk);
  let STK=hasStk?stkOffsets(cfg.cols, fit?cfg.cols.map(c=>c.w||100):widths):null;
  const stkEdgeCls=(c,i)=> STK&&((c.stk==='l'&&i===STK.lastLeft)||(c.stk==='r'&&i===STK.firstRight)) ? ' stk-edge' : '';
  const stkStyle=(c,i)=> !STK?'' : c.stk==='l'?`left:${STK.leftOff[i]}px;` : c.stk==='r'?`right:${STK.rightOff[i]}px;` : '';
  let thead='<thead><tr>'+cfg.cols.map((c,i)=>{
    const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
    return `<th class="${c.type==='dim'?'dim ':''}${sc}${stkCls(c)}${stkEdgeCls(c,i)}" data-k="${c.key}" data-ci="${i}" title="${esc(c.label)}" style="${stkStyle(c,i)}">${c.label}${fit?'':'<span class="rsz"></span>'}</th>`;
  }).join('')+'</tr></thead>';
  // title = valor SEMPRE completo (mesmo em fit, onde a célula pode abreviar/cortar) — passe o mouse p/ ver
  let tbody='<tbody>'+rows.map(r=>{
    const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
    const tds=cfg.cols.map((c,i)=>{
      const v=r.cells[c.key]; const style=[];
      if(c.heat && ext[c.key]) style.push(`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`);
      const ss=stkStyle(c,i); if(ss) style.push(ss);
      const cls=(c.type==='dim'?'dim':'')+(c.cls&&c.cls(r)?' '+c.cls(r):'')+stkCls(c)+stkEdgeCls(c,i);
      const ttl=c.type==='html'?'':` title="${esc(fmtStd(c.type,v))}"`;
      return `<td class="${cls}" style="${style.join(';')}" data-ci="${i}"${ttl}>${fmt(c.type,v)}</td>`;
    }).join('');
    return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
  }).join('')+'</tbody>';
  let tfoot='';
  if(cfg.total){ tfoot='<tfoot><tr>'+cfg.cols.map((c,i)=>{
    const v=cfg.total[c.key]; const isFirst=i===0&&v==null;
    return `<td class="${c.type==='dim'?'dim':''}${stkCls(c)}${stkEdgeCls(c,i)}" data-ci="${i}" style="${stkStyle(c,i)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=fit?'100%':totalW+'px';
  table.innerHTML=colgroup+thead+tbody+tfoot;
  const cols=table.querySelector('colgroup').children;
  // sort handlers
  table.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderTable(cfg);
    });
  });
  // resize handlers (drag right border) -> resize the <col>, grow the table
  if(!fit) table.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, ci=+th.dataset.ci, x0=e.clientX;
      const w0=cols[ci].offsetWidth, tw0=table.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); cols[ci].style.width=nw+'px'; table.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
        if(hasStk){ widths[ci]=nw; STK=stkOffsets(cfg.cols,widths);
          table.querySelectorAll('[data-ci]').forEach(el=>{ const i=+el.dataset.ci, cc=cfg.cols[i];
            if(cc.stk==='l') el.style.left=STK.leftOff[i]+'px'; else if(cc.stk==='r') el.style.right=STK.rightOff[i]+'px'; }); } };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; lsSet(LS_COLW,STATE.colw); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
    // duplo-clique na borda = auto-ajustar largura ao conteúdo (como Sheets/Looker)
    g.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, c=cfg.cols.find(x=>x.key===k);
      const nw=autoColWidth(cfg,c);
      STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
      lsSet(LS_COLW,STATE.colw);
      renderTable(cfg);
    });
  });
  // row select
  if(cfg.selectable && cfg.onSelect){
    table.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
  // hook pós-renderização (roda de novo em CADA re-render, inclusive ao ordenar,
  // pra chips/cores customizados nunca sumirem ao clicar num cabeçalho)
  if(cfg.afterRender) cfg.afterRender(table, rows);
}
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante). */
const HEAT_HUE={gasto:'--heat-gasto', leads:'--heat-leads', vendas:'--heat-vendas', roas:'--heat-roas'};
function heat(v,lo,hi,kind){
  if(v==null||!isFinite(v)||!HEAT_HUE[kind]) return 'transparent';
  // hi===lo (só 1 dia com valor, ou todos iguais): intensidade máxima, em vez
  // de sumir o heatmap por falta de variação.
  const t=hi===lo?1:Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  const c=hx2rgb(cvar(HEAT_HUE[kind]));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.06+0.5*t).toFixed(3)})`;
}
function toggleSet(set,key,ctrl,others){
  if(ctrl){ set.has(key)?set.delete(key):set.add(key); }
  else { const only=set.has(key)&&set.size===1; set.clear(); if(!only) set.add(key); }
  if(others) others.forEach(s=>s.clear());
}

/* ---------------- funil ---------------- */
function funnelHTML(steps){ return steps.map(s=>`
    <div class="step ${s[3]?'na':''} ${s[4]||''}"><div class="step-main"><div class="m-label">${s[0]}</div><div class="m-val"${s[5]!=null&&isFinite(s[5])?` data-full="${s[1]}" data-raw="${s[5]}"`:''}>${s[1]}</div></div>
    <div class="secs">${s[2].map(x=>`<div><span class="s-label">${x[0]}</span><span class="s-val">${x[1]}</span></div>`).join('')}</div></div>`).join(''); }
function shortMoney(v){
  const a=Math.abs(v);
  if(a>=1e6) return 'R$ '+nf2.format(v/1e6)+' mi';
  if(a>=1e3) return 'R$ '+nf2.format(v/1e3)+' mil';
  return null;
}
function fitFunnelValues(){
  document.querySelectorAll('.m-val[data-raw]').forEach(el=>{
    el.textContent=el.dataset.full;
    if(el.scrollWidth>el.clientWidth+1){ const sh=shortMoney(+el.dataset.raw); if(sh) el.textContent=sh; }
  });
}
window.addEventListener('resize',()=>{ try{ fitFunnelValues(); }catch(e){} });
/* Funil de tráfego direto: Gasto → Impressões → Cliques → Views da página → Checkouts → Vendas → Faturamento */
function funnelSteps(t){
  const dv=derive(t), g=dv.gasto;
  return [
    ['Gasto Total', brl(g), [], false, 'hl-gasto', g],
    ['Impressões', intf(t.im), [['CPM',brl(dv.cpm)],['Frequência',num2f(dv.freq)]]],
    ['Cliques no link', intf(t.cl), [['CTR',pct(dv.ctr)],['CPC',brl(dv.cpc)]]],
    ['Views da página', intf(t.lpv), [['Connect',pct(dv.connect)],['Custo/view',brl(dv.cplpv)]]],
    ['Checkouts iniciados', intf(t.ic), [['Conv. página',pct(dv.convPg)],['Custo/checkout',brl(dv.cpic)]]],
    ['Vendas front · '+MAIN_SHORT, intf(t.vd), [['CPA',brl(dv.cpa)],['Conv. checkout',pct(dv.convCk)]], false, 'hl-lead'],
    ['Back (up · down · Sala)', brl(dv.fatBack), [['ROAS back',roasf(dv.roasBack)],['Up·Down·Sala',intf(t.vu)+'·'+intf(t.vdn)+'·'+intf(t.vl)]], false, '', dv.fatBack],
    ['Faturamento total', brl(dv.fatTotal), [['ROAS front',roasf(dv.roasFront)],['ROAS total',roasf(dv.roasTotal)]], false, 'hl-fat', dv.fatTotal],
  ];
}

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
const cpaOf=x=>(x.vd&&x.sp>0)?+((x.sp*taxf())/x.vd).toFixed(2):null;
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const cV=cvar('--chart-vendas'), cG=cvar('--chart-gasto'), cF=cvar('--chart-fat'), cC=cvar('--chart-cpa')||cink();
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Vendas front',data:d.map(x=>x.vd),backgroundColor:cV,yAxisID:'y',borderRadius:3,order:4},
      {type:'line',label:'Gasto',data:d.map(x=>+(x.sp*taxf()).toFixed(2)),borderColor:cG,backgroundColor:cG,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:2},
      {type:'line',label:'Faturamento total',data:d.map(x=>+(x.ft+x.fu+x.fdn+x.fl).toFixed(2)),borderColor:cF,backgroundColor:cF,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:1},
      {type:'line',label:'CPA',data:d.map(cpaOf),borderColor:cC,backgroundColor:cC,yAxisID:'y1',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,borderDash:[5,4],order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
let _measureCtx2=null;
function fitAxisLabel(label, maxPx){
  if(!_measureCtx2) _measureCtx2=document.createElement('canvas').getContext('2d');
  _measureCtx2.font='10px '+((Chart.defaults&&Chart.defaults.font&&Chart.defaults.font.family)||'sans-serif');
  let s=String(label);
  if(_measureCtx2.measureText(s).width<=maxPx) return s;
  while(s.length>1 && _measureCtx2.measureText(s+'…').width>maxPx) s=s.slice(0,-1);
  return s.trimEnd()+'…';
}
function hbar(id, items, valFn, colorFn, top, unit){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  unit=unit||'vendas';
  let arr=items.slice().sort((a,b)=>valFn(b)-valFn(a)); if(top) arr=arr.slice(0,top);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabels],
    data:{labels:arr.map(x=>x.label), datasets:[{label:unit,data:arr.map(valFn),backgroundColor:arr.map(colorFn||(()=>cvar('--chart-vendas'))),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:28}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>intf(c.raw)+' '+unit}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10},callback:function(v){ return fitAxisLabel(this.getLabelForValue(v), Math.max(60,(this.chart.width-28)/2-16)); }},grid:{display:false}}}}});
}
const barLabels={id:'barLabels',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(!v)return; ctx.fillText(intf(v),el.x+5,el.y);});ctx.restore();}};

const fmtByType=t=> t==='brl'?brl : t==='num'?num2f : t==='x'?roasf : pct;
function indChart(id, d, series){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const mut=cmuted(), dual=series.some(s=>s.axis==='y1');
  const tick=t=>v=>fmtByType(t)(v);
  charts[id]=new Chart(el,{type:'line',
    data:{labels:d.map(x=>x.d.slice(5)), datasets:series.map(s=>({label:s.label,
      data:d.map(x=>{const v=s.fn(x); return v==null||!isFinite(v)?null:v;}),
      borderColor:s.color,backgroundColor:s.color,yAxisID:s.axis||'y',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25}))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const s=series[c.datasetIndex]; return s.label+': '+(c.raw==null?'-':fmtByType(s.type)(c.raw));}}}},
      scales:Object.assign({x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:tick(series[0].type)},grid:{color:cgrid()}}},
        dual?{y1:{position:'right',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:tick(series.find(s=>s.axis==='y1').type)},grid:{display:false}}}:{})}});
}
function renderIndicadores(d){
  const pal=chartPalette(), dd=x=>derive(x);
  indChart('mIndCpmCtr', d, [
    {label:'CPM',fn:x=>dd(x).cpm,type:'brl',axis:'y',color:cvar('--chart-gasto')||pal[2]},
    {label:'CTR',fn:x=>dd(x).ctr,type:'pct',axis:'y1',color:pal[0]}]);
  indChart('mIndConv', d, [
    {label:'Connect (views/cliques)',fn:x=>dd(x).connect,type:'pct',axis:'y',color:pal[3]},
    {label:'Conv. página (checkouts/views)',fn:x=>dd(x).convPg,type:'pct',axis:'y1',color:pal[1]}]);
  indChart('mIndCpa', d, [
    {label:'CPA',fn:x=>dd(x).cpa,type:'brl',axis:'y',color:cvar('--chart-cpa')||pal[4]},
    {label:'ROAS total',fn:x=>dd(x).roasTotal,type:'x',axis:'y1',color:cvar('--chart-fat')||pal[1]}]);
}
/* Donut: checkouts iniciados (Meta) que viraram venda (Hotmart) */
function donutConv(id, vendas, ic){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const nao=Math.max(0,ic-vendas);
  charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:['Virou venda','Não converteu'],datasets:[{data:[vendas,nao],
      backgroundColor:[cvar('--good'),cvar('--bar-noq')],borderColor:cvar('--surface'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+intf(c.raw)+(ic?' ('+pct(c.raw/ic)+')':'')}}}}});
  const el2=document.getElementById('mConvPct'); if(el2) el2.textContent=pct(ic?vendas/ic:null);
}
/* CPA por dimensão por dia — 1 linha por membro, legenda HTML própria (nunca trunca),
   clique na legenda/linha filtra a tabela (selDim). Com seleção ativa plota só os selecionados. */
function cpaByDimChart(id, fS, fM, agg, dim, selSet){
  destroy(id); const el=document.getElementById(id); const legEl=document.getElementById(id+'Legend');
  if(!el) return;
  const days=[...new Set([...fS,...fM].filter(r=>r.d).map(r=>r.d))].sort();
  const members=[...new Set(fS.map(r=>r[dim]))].filter(m=>m!=null&&m!==NI&&agg[m]&&agg[m].sp>0).sort((a,b)=>{
    const ca=derive(agg[a]).cpa, cb=derive(agg[b]).cpa;
    if(ca==null&&cb==null) return 0; if(ca==null) return 1; if(cb==null) return -1; return ca-cb;
  });
  const pal=chartPalette(), mut=cmuted();
  const dimChar={'camp':'C','adset':'A','ad':'D'}[dim]||'C';
  const plotMembers=(selSet&&selSet.size)?members.filter(m=>selSet.has(m)):members;
  const dsets=plotMembers.map(mv=>{
    const idx=members.indexOf(mv);
    const spDay={}, vDay={}; days.forEach(d=>{spDay[d]=0; vDay[d]=0;});
    fM.forEach(r=>{ if(r[dim]===mv && r.d!=null && spDay[r.d]!=null) spDay[r.d]+=r.sp; });
    fS.forEach(r=>{ if(r[dim]===mv && r.role==='front' && r.d!=null && vDay[r.d]!=null) vDay[r.d]+=1; });
    const data=days.map(d=>(vDay[d]>0&&spDay[d]>0)?+((spDay[d]*taxf())/vDay[d]).toFixed(2):null);
    const col=pal[idx%pal.length];
    return {label:String(mv), data, borderColor:col, backgroundColor:col, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true};
  });
  charts[id]=new Chart(el,{type:'line',
    data:{labels:days.map(d=>d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
      onClick:(e,act)=>{ if(act.length){ const i=act[0].datasetIndex; if(i!=null&&dsets[i]) selDim(dimChar,dsets[i].label,false); } },
      plugins:{legend:{display:false},
        tooltip:{displayColors:true,callbacks:{title:()=>'', label:c=>[c.dataset.label,(c.raw==null?'-':brl(c.raw))+' / venda']}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()},beginAtZero:true}}}
  });
  if(legEl){
    legEl.innerHTML=members.length?members.map((mv,idx)=>{
      const col=pal[idx%pal.length], cpa=derive(agg[mv]).cpa, sel=!!(selSet&&selSet.has(mv));
      return `<div class="cl-row${sel?' sel':''}" data-mv="${escHtml(mv)}" title="${escHtml(mv)}">`
        +`<span class="cl-swatch" style="background:${col}"></span>`
        +`<span class="cl-name">${escHtml(mv)}</span>`
        +`<span class="cl-val">${brl(cpa)}</span></div>`;
    }).join(''):'<div class="cl-row" style="cursor:default"><span class="cl-name" style="color:var(--muted)">Sem vendas identificadas com gasto no período.</span></div>';
    legEl.querySelectorAll('.cl-row[data-mv]').forEach(row=>row.addEventListener('click',()=>selDim(dimChar,row.dataset.mv,false)));
  }
}

/* ---------------- KPI cards ---------------- */
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

const ROLE_LBL=Object.assign({front:'Front',up:'Upsell',down:'Downsell',ltv:'LTV'},B.roles||{});
const SRC_LABEL={meta:'Meta Ads (pago)',organico:'Orgânico',hotmart:'Hotmart (vitrine/agente)',sem_utm:'Sem UTM'};
const countBy=(arr,fn)=>{ const m={}; arr.forEach(x=>{ const k=fn(x); if(k==null) return; m[k]=(m[k]||0)+1; }); return Object.entries(m).map(([label,n])=>({label,n})); };

/* ---------------- PAGE 1: Visão Geral (e espelho no Insights de IA) ---------------- */
const GERAL_IDS={sala:'gSala',salaChart:'gSalaChart',salaPill:'salaPill',funnel:'geralFunnel',kpis2:'geralKpis2',combo:'gCombo',orig:'gOrig',prod:'gProd',plat:'gPlat',pos:'gPos',daily:'gDaily'};
const REL_IDS  ={funnel:'relFunnel', kpis2:'relKpis2', combo:'rCombo',orig:'rOrig',prod:'rProd',plat:'rPlat',pos:'rPos',daily:'rDaily'};
function renderGeral(){ renderGeralCore(GERAL_IDS); }
function renderGeralCore(ids){
  const fS=salesActive(), fM=metaActive();
  const t=totals(fS,fM), dv=derive(t), g=dv.gasto;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(funnelSteps(t)); fitFunnelValues();
  const dd=daily(fS,fM), nDays=dd.length||1;
  const mS=fS.filter(s=>s.src==='meta');
  const adAgg=buildAgg(mS.filter(s=>s.ad!==NI),fM,'ad');
  let topAd=null; Object.entries(adAgg).forEach(([ad,a])=>{ if(a.vd>0&&(topAd==null||a.vd>topAd.n)) topAd={ad,n:a.vd}; });
  const comCpa=dd.filter(x=>x.vd>0&&x.sp>0).map(x=>({d:x.d,v:(x.sp*taxf())/x.vd}));
  const melhorDia=comCpa.length?comCpa.reduce((a,b)=>b.v<a.v?b:a):null;
  const main=fS.filter(s=>s.role==='front'), nMeta=main.filter(s=>s.src==='meta').length;
  const frontBuyers=new Set(fS.filter(s=>s.role==='front').map(s=>s.b));
  const salaBuyers=new Set(fS.filter(s=>s.role==='ltv'&&s.via==='comprador').map(s=>s.b));
  const nOrg=main.filter(s=>s.src==='organico'||s.src==='hotmart').length, nSem=main.filter(s=>s.src==='sem_utm').length;
  const nIg=mS.filter(s=>s.plat==='Instagram').length, nFb=mS.filter(s=>s.plat==='Facebook').length;
  const nRf=REFUNDS.filter(s=>dateActive(s.d)).length;
  const k2=[
    {label:'Vendas por dia (média)',val:numf(t.vd/nDays),aux:brl(g/nDays)+' de gasto/dia'},
    {label:'Ticket médio do funil (AOV)',val:brl(dv.aov),aux:'= CPA de equilíbrio (ROAS 1,0)'},
    {label:'Take rate do upsell',val:pct(dv.takeUp),aux:intf(t.vu)+' de '+intf(t.vd)+' compradores · '+brl(t.fu)},
    {label:'Take rate do downsell',val:pct(dv.takeDown),aux:intf(t.vdn)+' de '+intf(Math.max(0,t.vd-t.vu))+' que recusaram · '+brl(t.fdn)},
    {label:'ROAS do back',val:roasf(dv.roasBack),aux:'upsell '+brl(t.fu)+' · downsell '+brl(t.fdn)+' · Sala '+brl(t.fl)},
    {label:'Resultado total',val:brl(dv.resT),aux:'Fat. total − gasto'+(dv.fatTotal?' · margem '+pct(dv.resT/dv.fatTotal):'')},
    {label:'Sala (LTV) dos compradores',val:brl(t.fl),aux:intf(t.vl)+' compra(s) · ROAS só front '+roasf(dv.roasFront)},
    {label:'Conversão na Sala (LTV)',val:pct(frontBuyers.size?salaBuyers.size/frontBuyers.size:null),aux:intf(salaBuyers.size)+' de '+intf(frontBuyers.size)+' compradores · LTV/comprador '+brl(frontBuyers.size?t.fl/frontBuyers.size:null)},
    {label:'% vendas via Meta (UTM)',val:pct(t.vd?nMeta/t.vd:null),aux:intf(nOrg)+' orgânico/Hotmart · '+intf(nSem)+' sem UTM'},
    {label:'Top anúncio (vendas)',val:topAd?intf(topAd.n):'-',aux:topAd?shortName(topAd.ad):'—'},
    {label:'Melhor dia (CPA)',val:melhorDia?brl(melhorDia.v):'-',aux:melhorDia?brdate(melhorDia.d)+' · '+weekday(melhorDia.d):'—'},
    {label:'Proporção IG:FB',val:nFb?numf(nIg/nFb)+':1':(nIg?'∞':'-'),aux:intf(nIg)+' Instagram · '+intf(nFb)+' Facebook'+(nRf?' · '+nRf+' reembolso(s)':'')},
  ];
  document.getElementById(ids.kpis2).innerHTML=k2.map(kpiCard).join('');
  comboChart(ids.combo, dd);
  if(ids.sala) renderSala(ids);
  hbar(ids.orig, countBy(fS,s=>SRC_LABEL[s.src]||s.src), x=>x.n, ()=>cvar('--chart-vendas'));
  hbar(ids.prod, countBy(fS,s=>(ROLE_LBL[s.role]||s.role)+' · '+s.pr), x=>x.n, x=>x.label.startsWith('Front')?cvar('--chart-vendas'):(x.label.startsWith('LTV')?cvar('--chart-est'):cvar('--chart-back')));
  hbar(ids.plat, countBy(mS,s=>s.plat), x=>x.n, ()=>cvar('--chart-vendas'));
  hbar(ids.pos, countBy(mS,s=>s.pos), x=>x.n, ()=>cvar('--chart-back'), 10);
  const dl=dd.slice().reverse();
  renderTable({id:ids.daily, cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date',w:84},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},
  {key:'ic',label:'Checkouts',type:'int'},
  {key:'vendas',label:'Vendas',type:'int',heat:'vendas'},{key:'cpa',label:'CPA',type:'brl'},
  {key:'fat',label:'Fat. total',type:'brl'},{key:'roasF',label:'ROAS front',type:'num2'},{key:'roas',label:'ROAS total',type:'num2',heat:'roas'},
];
function dailyCells(x,d,isTotal){
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d), gasto:d.gasto, cpm:d.cpm, ctr:d.ctr, connect:d.connect,
    ic:d.ic, vendas:d.vendas, cpa:d.cpa, fat:d.fatTotal, roasF:d.roasFront, roas:d.roasTotal};
}

/* ---------------- Sala Educacional · evento de terça (LTV) ----------------
   Turma da terça T = compradores do front com 1ª compra de qua (T−6) a ter (T).
   Conversão da turma = quantos desses compradores já compraram a Sala (LTV vinculado pelo comprador), até hoje.
   Semana do evento T = vendas da Sala com data real de compra de ter (T) a seg (T+6). */
const tueOnOrAfter=d=>{ const dt=new Date(d+'T00:00:00'); dt.setDate(dt.getDate()+((2-dt.getDay()+7)%7)); return dstr(dt); };
const tueOnOrBefore=d=>{ const dt=new Date(d+'T00:00:00'); dt.setDate(dt.getDate()-((dt.getDay()-2+7)%7)); return dstr(dt); };
function renderSala(ids){
  const firstFront={};
  SALES.forEach(s=>{ if(s.role==='front'&&(!firstFront[s.b]||s.d<firstFront[s.b])) firstFront[s.b]=s.d; });
  const W={}, g=T=>W[T]||(W[T]={T,novos:0,conv:new Set(),fatTurma:0,ev:0,fatEv:0});
  Object.values(firstFront).forEach(d=>{ g(tueOnOrAfter(d)).novos++; });
  SALES.forEach(s=>{ if(s.role!=='ltv') return;
    if(s.via==='comprador'&&firstFront[s.b]){ const w=g(tueOnOrAfter(firstFront[s.b])); w.conv.add(s.b); w.fatTurma+=s.v; }
    const e=g(tueOnOrBefore(s.dp||s.d)); e.ev++; e.fatEv+=s.v; });
  const winActive=T=>{ for(let i=0;i<7;i++){ if(dateActive(addDays(T,-i))) return true; } return false; };
  const rows=Object.values(W).filter(w=>winActive(w.T)&&(w.novos||w.ev)).sort((a,b)=>a.T<b.T?1:-1);
  const st=T=>T>TODAY?'próxima terça':(T===TODAY?'hoje':'realizada');
  renderTable({id:ids.sala, center:true,
    cols:[{key:'T',label:'Terça',type:'date'},{key:'st',label:'Evento',type:'dim',w:96},
      {key:'novos',label:'Turma (front)',type:'int'},{key:'nc',label:'Compraram Sala',type:'int',heat:'vendas'},
      {key:'cv',label:'Conversão',type:'pct'},{key:'lpc',label:'LTV/comprador',type:'brl'},
      {key:'ev',label:'Vendas na semana',type:'int'},{key:'fatEv',label:'Fat. na semana',type:'brl'}],
    rows:rows.map(w=>({k:w.T,cells:{T:w.T,st:st(w.T),novos:w.novos,nc:w.conv.size,cv:w.novos?w.conv.size/w.novos:null,
      lpc:w.novos?w.fatTurma/w.novos:null,ev:w.ev,fatEv:w.fatEv}})),
    total:(()=>{ const n=rows.reduce((x,w)=>x+w.novos,0), c=rows.reduce((x,w)=>x+w.conv.size,0), f=rows.reduce((x,w)=>x+w.fatTurma,0);
      return {T:null,st:'',novos:n,nc:c,cv:n?c/n:null,lpc:n?f/n:null,ev:rows.reduce((x,w)=>x+w.ev,0),fatEv:rows.reduce((x,w)=>x+w.fatEv,0)}; })()});
  const pill=document.getElementById(ids.salaPill);
  if(pill){ const n=rows.reduce((x,w)=>x+w.ev,0), f=rows.reduce((x,w)=>x+w.fatEv,0); pill.textContent=intf(n)+' vendas · '+brl(f); }
  const id=ids.salaChart; destroy(id); const el=document.getElementById(id); if(!el) return;
  const asc=rows.slice().reverse(), mut=cmuted();
  charts[id]=new Chart(el,{data:{labels:asc.map(w=>brdate(w.T).slice(0,5)),datasets:[
      {type:'bar',label:'Vendas da Sala (semana do evento)',data:asc.map(w=>w.ev),backgroundColor:cvar('--chart-est'),borderRadius:3,yAxisID:'y',order:2},
      {type:'line',label:'Conversão da turma',data:asc.map(w=>w.novos?+(w.conv.size/w.novos*100).toFixed(2):null),borderColor:cvar('--chart-vendas'),backgroundColor:cvar('--chart-vendas'),borderWidth:2,pointRadius:3,tension:.25,spanGaps:true,yAxisID:'y1',order:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='y1'?c.dataset.label+': '+nf2.format(c.raw||0)+'%':c.dataset.label+': '+intf(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:cgrid()},title:{display:true,text:'Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>v+'%'},grid:{display:false}}}}});
}

/* ---------------- PAGE 2: Meta Ads ---------------- */
/* Só vendas com UTM de Meta Ads; filtro cruzado bidirecional Campanha/Conjunto/Anúncio. */
function metaScope(ex){ let fS=salesActive().filter(s=>s.src==='meta'), fM=metaActive();
  if(ex!=='C'&&STATE.mSelC.size){ fS=fS.filter(r=>STATE.mSelC.has(r.camp)); fM=fM.filter(r=>STATE.mSelC.has(r.camp)); }
  if(ex!=='A'&&STATE.mSelA.size){ fS=fS.filter(r=>STATE.mSelA.has(r.adset)); fM=fM.filter(r=>STATE.mSelA.has(r.adset)); }
  if(ex!=='D'&&STATE.mSelAd.size){ fS=fS.filter(r=>STATE.mSelAd.has(r.ad)); fM=fM.filter(r=>STATE.mSelAd.has(r.ad)); }
  return {fS,fM}; }
function selDim(dim,key,ctrl){
  const sets={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}, s=sets[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const sole=s.has(key)&&s.size===1&&!Object.entries(sets).some(([k2,x])=>k2!==dim&&x.size);
    Object.values(sets).forEach(x=>x.clear()); if(!sole) s.add(key); }
  renderMeta();
}
const lvlChip=l=>l==='ad'?'<span class="lvl-chip l-ad">anúncio</span>':(l==='adset'||l==='camp')?'<span class="lvl-chip l-camp">só campanha</span>':'<span class="lvl-chip l-none">sem campanha</span>';
function renderMeta(){
  const F=metaScope(null), fS=F.fS, fM=F.fM;
  const t=totals(fS,fM);
  document.getElementById('metaFunnel').innerHTML=funnelHTML(funnelSteps(t)); fitFunnelValues();
  const dMeta=daily(fS,fM);
  comboChart('mCombo', dMeta);
  renderIndicadores(dMeta);
  hbar('mVendAd', countBy(fS.filter(s=>s.role==='front'&&s.ad!==NI),s=>s.ad), x=>x.n, ()=>cvar('--chart-vendas'), 10);
  donutConv('mConvDonut', t.vd, t.ic);
  const adAggM=buildAgg(fS,fM,'ad');
  const topRows=Object.entries(adAggM).filter(([k,a])=>k!==NI&&a.sp>0&&a.vd>0).map(([ad,a])=>{const d=derive(a);
    return {k:ad, cells:{dim:ad,vendas:a.vd,cpa:d.cpa,roas:d.roasTotal,rb:d.roasBack,gasto:d.gasto,ic:a.ic}, _o:d.cpa};})
    .sort((a,b)=>a._o-b._o).slice(0,10);
  renderTable({id:'mTopCpa', center:true,
    cols:[{key:'dim',label:'Anúncios',type:'dim',big:true},{key:'vendas',label:'Vendas',type:'int'},
      {key:'cpa',label:'CPA',type:'brl'},{key:'roas',label:'ROAS total',type:'num2'},{key:'rb',label:'ROAS back',type:'num2'},{key:'gasto',label:'Gasto',type:'brl'},
      {key:'ic',label:'Checkouts',type:'int'}],
    rows:topRows});
  const dl=dMeta.slice().reverse();
  renderTable({id:'tDaily', cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
  const hcols=[
    {key:'dim',label:'',type:'dim',big:true,stk:'l'},{key:'gasto',label:'Gasto',type:'brl',stk:'l'},
    {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},{key:'cpc',label:'CPC',type:'brl'},
    {key:'lpv',label:'Views pág.',type:'int'},{key:'connect',label:'Connect',type:'pct'},
    {key:'ic',label:'Checkouts',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
    {key:'vendas',label:'Vendas',type:'int'},{key:'cpa',label:'CPA',type:'brl'},
    {key:'ff',label:'Fat. front',type:'brl'},{key:'rf',label:'ROAS front',type:'num2'},
    {key:'vu',label:'Upsells',type:'int'},{key:'vdn',label:'Downsells',type:'int'},{key:'vl',label:'Sala',type:'int'},
    {key:'fb',label:'Fat. back',type:'brl'},{key:'rb',label:'ROAS back',type:'num2'},
    {key:'rt',label:'ROAS total',type:'num2'},
  ];
  const hcells=(k,a)=>{const d=derive(a);
    return {dim:k,gasto:d.gasto,im:a.im,cpm:d.cpm,cl:a.cl,ctr:d.ctr,cpc:d.cpc,lpv:a.lpv,connect:d.connect,
      ic:a.ic,cpic:d.cpic,vendas:a.vd,cpa:d.cpa,ff:a.ft,rf:d.roasFront,vu:a.vu,vdn:a.vdn,vl:a.vl,
      fb:d.fatBack,rb:d.roasBack,rt:d.roasTotal};};
  const hierRows=map=>Object.entries(map).map(([k,a])=>({k, cells:hcells(k,a)}));
  const Sc=metaScope('C'), Sa=metaScope('A'), Sd=metaScope('D');
  const aggC=buildAgg(Sc.fS,Sc.fM,'camp'), aggA=buildAgg(Sa.fS,Sa.fM,'adset'), aggD=buildAgg(Sd.fS,Sd.fM,'ad');
  renderTable({id:'tCamp', cols:hcols.map((c,i)=>i===0?{...c,label:'Campanha'}:c), rows:hierRows(aggC), total:hcells(null,totals(Sc.fS,Sc.fM)),
    selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', cols:hcols.map((c,i)=>i===0?{...c,label:'Conjunto'}:c), rows:hierRows(aggA), total:hcells(null,totals(Sa.fS,Sa.fM)),
    selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', cols:hcols.map((c,i)=>i===0?{...c,label:'Anúncio'}:c), rows:hierRows(aggD), total:hcells(null,totals(Sd.fS,Sd.fM)),
    selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});
  cpaByDimChart('chCamp', Sc.fS, Sc.fM, aggC, 'camp', STATE.mSelC);
  cpaByDimChart('chAdset', Sa.fS, Sa.fM, aggA, 'adset', STATE.mSelA);
  cpaByDimChart('chAd', Sd.fS, Sd.fM, aggD, 'ad', STATE.mSelAd);
  // lista de vendas do período (Meta pago)
  const q=fS.slice().sort((a,b)=>(a.d<b.d?1:a.d>b.d?-1:(b.h||0)-(a.h||0)));
  document.getElementById('qCount').textContent=q.length+' vendas';
  renderTable({id:'tVendas',
    cols:[{key:'d',label:'Data',type:'date'},{key:'nm',label:'Nome',type:'dim'},{key:'role',label:'Papel',type:'dim',w:96},{key:'pr',label:'Produto',type:'dim'},
      {key:'v',label:'Valor',type:'brl'},{key:'plat',label:'Plataforma',type:'dim'},{key:'pos',label:'Posicionamento',type:'dim'},
      {key:'lvl',label:'Rastreio',type:'html',w:110},{key:'via',label:'Atribuição',type:'dim',w:120},{key:'ad',label:'Anúncio',type:'dim'},
      {key:'camp',label:'Campanha',type:'dim',big:true},{key:'em',label:'E‑mail',type:'dim',w:200},{key:'ph',label:'Telefone',type:'dim',w:110}],
    rows:q.map((s,i)=>({k:'s'+i, cells:{d:s.dp||s.d,nm:s.nm,role:ROLE_LBL[s.role]||s.role,pr:s.pr,v:s.v,plat:s.plat,pos:s.pos||'—',lvl:lvlChip(s.lvl),via:s.via==='comprador'?'via comprador':'UTM própria',ad:s.ad,camp:s.camp,em:s.em,ph:s.ph}}))});
}

/* ---------------- Metas & parâmetros (compartilhadas: Otimização + Insights) ---------------- */
const SAMPLE_MIN_SPEND=(B.sample_min_spend!=null?B.sample_min_spend:150);
/* CPA de EQUILÍBRIO do funil (todo o histórico): faturamento front+upsell+downsell ÷ compradores do front.
   É o CPA máximo para o funil empatar (ROAS 1,0) — padrão da Meta CPA quando o build não fixa uma. */
const EQ_CPA=(()=>{ let f=0,n=0; SALES.forEach(s=>{ if(s.role==='front'){ n++; f+=s.v; } else if(s.role==='up'||s.role==='down') f+=s.v; }); return n?Math.round(f/n):null; })();
const METAS_DEFAULT={
  cpa:(B.meta_cpa!=null?B.meta_cpa:EQ_CPA), roas:(B.meta_roas!=null?B.meta_roas:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:2), nDias:(B.n_dias_corte!=null?B.n_dias_corte:3),
};
function loadMetas(){
  const saved=lsGet(LS_METAS,{})||{}, m={...METAS_DEFAULT};
  ['cpa','roas'].forEach(k=>{ if(saved[k]!=null&&isFinite(saved[k])) m[k]=saved[k]; else if(k in saved && saved[k]===null) m[k]=null; });
  if(saved.volMin!=null&&isFinite(saved.volMin)&&saved.volMin>=1) m.volMin=saved.volMin;
  if(saved.nDias!=null&&isFinite(saved.nDias)&&saved.nDias>=1) m.nDias=saved.nDias;
  return m;
}
const METAS=loadMetas();
function saveMetas(){ lsSet(LS_METAS,METAS); }
/* custo vs meta (menor=melhor): verde ≤ meta · amarelo até +30% · vermelho acima */
function metaColorClass(v,meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v<=meta) return 'mc-green'; if(v<=meta*1.3) return 'mc-yellow'; return 'mc-red';
}
/* ROAS vs meta (maior=melhor) */
function roasColorClass(v,meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v>=meta) return 'mc-green'; if(v>=meta/1.3) return 'mc-yellow'; return 'mc-red';
}
/* DECISÃO do anúncio/campanha (usa vendas ESTIMADAS = UTM + rateio do gap):
   - sem amostra (gasto < mínimo e vendas < volume mín.) -> Observar
   - com meta de CPA: vendas ≥ volume mín. -> CPA ≤ meta Escalar · até +30% Manter · acima Cortar;
     vendas < volume mín. -> Cortar se já gastou o teto (meta×1,3) com CPA corrente acima dele, senão Observar
   - sem meta de CPA, com meta de ROAS: mesma lógica pelo ROAS
   - sem metas -> Manter (ou Observar sem volume) */
function decision(a){
  const d=deriveE(a), g=d.gasto, vol=a.ve;
  if(a.sp<SAMPLE_MIN_SPEND && vol<METAS.volMin) return 'observar';
  if(METAS.cpa!=null&&METAS.cpa>0){
    const teto=METAS.cpa*1.3;
    if(vol<METAS.volMin){ const cur=vol>0?g/vol:Infinity; return (g>=teto&&cur>teto)?'cortar':'observar'; }
    const c=g/vol; return c<=METAS.cpa?'escalar':(c<=teto?'manter':'cortar');
  }
  if(METAS.roas!=null&&METAS.roas>0){
    if(vol<METAS.volMin) return 'observar';
    const r=d.roasTE; return r>=METAS.roas?'escalar':(r>=METAS.roas/1.3?'manter':'cortar');
  }
  return vol<METAS.volMin?'observar':'manter';
}
const STATUS_CHIP={
  escalar:'<span class="rel-chip c-green">Escalar</span>', manter:'<span class="rel-chip c-blue">Manter</span>',
  observar:'<span class="rel-chip c-yellow">Observar</span>', cortar:'<span class="rel-chip c-red">Cortar</span>',
};
const statusChip=s=>STATUS_CHIP[s]||STATUS_CHIP.observar;
const DEC_ORDER={escalar:0,manter:1,cortar:2,observar:3};
function renderMetasNote(){
  const cpa=METAS.cpa==null?'<b>não definida</b>':'<b>'+brl(METAS.cpa)+'</b>';
  const roas=METAS.roas==null?'<b>não definida</b>':'<b>'+roasf(METAS.roas)+'</b>';
  const html=`Referência ativa — Meta CPA: ${cpa}${METAS.cpa===EQ_CPA&&EQ_CPA!=null?' (= CPA de equilíbrio do funil)':''} · Meta ROAS: ${roas} · Amostra mínima: <b>${brl(SAMPLE_MIN_SPEND)}</b> de gasto ou <b>${intf(METAS.volMin)} vendas</b> · alerta de corte após <b>${intf(METAS.nDias)} dias</b> seguidos gastando sem venda. `
    +(METAS.cpa==null&&METAS.roas==null?'Preencha uma meta para classificar Escalar/Cortar. ':'')
    +'Código de cor (CPA): <span class="mc-lg mc-green">verde ≤ meta</span> <span class="mc-lg mc-yellow">amarelo até +30%</span> <span class="mc-lg mc-red">vermelho acima</span>.';
  document.querySelectorAll('[data-metas-note]').forEach(el=>{ el.innerHTML=html; });
}
function syncMetasInputs(){
  document.querySelectorAll('input[data-meta]').forEach(el=>{ const v=METAS[el.dataset.meta]; el.value=(v==null?'':v); });
  renderMetasNote();
}

/* ---------------- agregação estimada por anúncio / campanha ---------------- */
/* chave do anúncio = Campanha + Conjunto + Anúncio (o mesmo criativo pode rodar em vários conjuntos) */
function estAgg(fS,fM,fE,keyFn){
  const m={}, get=(k,r)=>m[k]||(m[k]=Object.assign(newAgg(),{camp:r.camp,adset:r.adset,ad:r.ad}));
  fM.forEach(r=>addMeta(get(keyFn(r),r),r));
  fS.forEach(s=>{ if(s.src==='meta') addSale(get(keyFn(s),s),s); });
  fE.forEach(e=>addEst(get(keyFn(e),e),e));
  return m;
}
const adKey=r=>r.camp+SEP+r.adset+SEP+r.ad;
/* dias SEGUIDOS (até o fim do período) com gasto e sem venda (UTM + estimada < 0,05) */
function noSaleStreaks(fM,fE){
  const sp={}, vd={};
  fM.forEach(r=>{ if(r.sp>0){ const k=adKey(r); (sp[k]||(sp[k]={}))[r.d]=(sp[k][r.d]||0)+r.sp; } });
  fE.forEach(e=>{ const k=adKey(e); (vd[k]||(vd[k]={}))[e.d]=(vd[k][e.d]||0)+e.w; });
  const out={};
  Object.entries(sp).forEach(([k,days])=>{
    const ds=Object.keys(days).sort().reverse(); let n=0;
    for(const d of ds){ if(((vd[k]||{})[d]||0)>=0.05) break; n++; }
    out[k]=n;
  });
  return out;
}
function adPool(fS,fM,fE){
  const agg=estAgg(fS,fM,fE,adKey), streak=noSaleStreaks(fM,fE);
  return Object.entries(agg).filter(([k,a])=>a.sp>0).map(([k,a])=>({k,a,dec:decision(a),dsv:streak[k]||0}));
}
function sampleOk(a){ return a.sp>=SAMPLE_MIN_SPEND || a.ve>=METAS.volMin; }
function cmpBest(x,y){ const sx=sampleOk(x.a), sy=sampleOk(y.a); if(sx!==sy) return sx?-1:1;
  if(Math.abs(x.a.ve-y.a.ve)>1e-9) return y.a.ve-x.a.ve;
  const cx=deriveE(x.a).cpaE, cy=deriveE(y.a).cpaE; return (cx==null?Infinity:cx)-(cy==null?Infinity:cy); }
const AD_COLS=[
  {key:'ad',label:'Anúncio',type:'dim',big:true,stk:'l'},{key:'status',label:'Decisão',type:'dim',w:104},
  {key:'camp',label:'Campanha',type:'dim'},{key:'adset',label:'Conjunto',type:'dim'},
  {key:'gasto',label:'Gasto',type:'brl'},{key:'cpm',label:'CPM',type:'brl'},{key:'ctr',label:'CTR',type:'pct'},
  {key:'cpc',label:'CPC',type:'brl'},{key:'connect',label:'Connect',type:'pct'},
  {key:'ic',label:'Checkouts',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
  {key:'vd',label:'Vendas UTM',type:'int'},{key:'ve',label:'Vendas est.',type:'num',cls:()=> 'est'},
  {key:'cpaE',label:'CPA est.',type:'brl'},
  {key:'roasFE',label:'ROAS front est.',type:'num2'},{key:'roasBE',label:'ROAS back est.',type:'num2'},{key:'roasTE',label:'ROAS total est.',type:'num2'},
  {key:'dsv',label:'Dias s/ venda',type:'int'},
];
function renderAdDecisionTable(id,list){
  const rows=list.map(it=>{ const a=it.a, d=deriveE(a);
    return {k:it.k, _state:it.dec, _cpa:d.cpaE, _roas:d.roasTE, cells:{ad:a.ad,status:'',camp:campShort(a.camp),adset:a.adset,
      gasto:d.gasto,cpm:d.cpm,ctr:d.ctr,cpc:d.cpc,connect:d.connect,ic:a.ic,cpic:d.cpic,
      vd:a.vd,ve:a.ve,cpaE:d.cpaE,roasFE:d.roasFE,roasBE:d.roasBE,roasTE:d.roasTE,dsv:it.dsv}}; });
  renderTable({id, cols:AD_COLS, rows, center:true,
    afterRender:(table,sorted)=>{
      table.querySelectorAll('tbody tr').forEach((tr,i)=>{ const it=sorted[i]; if(!it) return; const tds=tr.querySelectorAll('td');
        AD_COLS.forEach((c,ci)=>{ const td=tds[ci]; if(!td) return;
          if(c.key==='status') td.innerHTML=statusChip(it._state);
          if(c.key==='cpaE'){ const mc=metaColorClass(it._cpa,METAS.cpa); if(mc) td.classList.add(mc); }
          if(c.key==='roasTE'){ const mc=roasColorClass(it._roas,METAS.roas); if(mc) td.classList.add(mc); }
          if(c.key==='dsv' && it.cells.dsv>=METAS.nDias) td.classList.add('mc-red');
        }); });
    }});
}

/* ---------------- PAGE 3: Otimização ---------------- */
function periodHeader(nameId,rangeId){
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  document.getElementById(nameId).textContent=STATE.selDays.size?'Dias selecionados':(pr?pr[1]:'Personalizado');
  let txt='';
  if(STATE.selDays.size){ const ds=[...STATE.selDays].sort(); txt=ds.map(brdate).join(', '); }
  else if(STATE.from&&STATE.to){ const n=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
    txt=`${brdate(STATE.from)} a ${brdate(STATE.to)}`+(n>0?` · ${n} dia${n>1?'s':''}`:''); }
  document.getElementById(rangeId).textContent=txt;
}
function renderOtm(){
  periodHeader('otmPeriodName','otmPeriodRange');
  renderMetasNote();
  const fS=salesActive(), fM=metaActive(), fE=estActive();
  const t=totals(fS,fM), dv=derive(t);
  const main=fS.filter(s=>s.role==='front'), mS=fS.filter(s=>s.src==='meta');
  const nMetaMain=main.filter(s=>s.src==='meta').length;
  const lv=l=>mS.filter(s=>l.includes(s.lvl));
  const sAd=lv(['ad']), sCamp=lv(['adset','camp']), sNone=lv(['none']);
  const fatOf=a=>a.reduce((x,s)=>x+s.v,0);
  const nOut=fS.filter(s=>s.src!=='meta').length;
  const back=fS.filter(s=>s.role==='up'||s.role==='down'), viaBuyer=back.filter(s=>s.via==='comprador').length;
  const k=[
    {label:'Vendas reais (Hotmart)',val:intf(main.length),aux:brl(fatOf(main))+' · '+MAIN_SHORT},
    {label:'Vendas com UTM do Meta',val:intf(nMetaMain),aux:pct(main.length?nMetaMain/main.length:null)+' das vendas do produto'},
    {label:'Checkouts no Meta (pixel)',val:intf(t.ic),aux:t.ic?numf(nMetaMain/t.ic*100)+' vendas a cada 100 checkouts':'—'},
    {label:'Rastreio até o anúncio',val:pct(mS.length?sAd.length/mS.length:null),aux:intf(sAd.length)+' de '+intf(mS.length)+' vendas pagas (UTM c/ nome)'},
    {label:'Rastreio só até a campanha',val:pct(mS.length?sCamp.length/mS.length:null),aux:intf(sCamp.length)+' vendas · UTM antiga (só ID)'},
    {label:'Sem campanha identificada',val:intf(sNone.length),aux:brl(fatOf(sNone))+' · ID fora do mapa'},
    {label:'Orgânico + Hotmart + sem UTM',val:intf(nOut),aux:pct(fS.length?nOut/fS.length:null)+' de todas as vendas'},
    {label:'Upsell + downsell',val:intf(back.length),aux:brl(fatOf(back))+' · '+intf(viaBuyer)+' atribuídos pelo comprador do front'},
  ];
  document.getElementById('otmGapKpis').innerHTML=k.map(kpiCard).join('');
  gapChart('oGapChart', fS, fM);
  // vendas pagas sem anúncio identificado, por ID
  const g={};
  mS.filter(s=>s.lvl!=='ad').forEach(s=>{ const key=(s.camp||'')+SEP+(s.ids||'—');
    const x=g[key]||(g[key]={camp:s.camp,ids:s.ids||'—',n:0,v:0,last:s.d,lvl:s.lvl}); x.n++; x.v+=s.v; if(s.d>x.last) x.last=s.d; });
  renderTable({id:'oIds', center:true,
    cols:[{key:'ids',label:'IDs no UTM (co · t)',type:'dim'},{key:'camp',label:'Campanha',type:'dim'},
      {key:'n',label:'Vendas',type:'int'},{key:'v',label:'Fat.',type:'brl'},{key:'last',label:'Última',type:'date'},{key:'lvl',label:'Nível',type:'html',w:104}],
    rows:Object.entries(g).sort((a,b)=>b[1].n-a[1].n).map(([key,x])=>({k:key,cells:{ids:x.ids,camp:campShort(x.camp),lvl:lvlChip(x.lvl),n:x.n,v:x.v,last:x.last}}))});
  const nMap=Object.keys(B.camp_id_map||{}).length;
  document.getElementById('otmGapNote').innerHTML=
    `<b>Por que existe gap:</b> o Gerenciador do Meta perde parte das compras (bloqueio de cookies, iOS, checkout na Hotmart), então aqui a fonte de verdade é a <b>venda da Hotmart</b> com a UTM. `
    +`Até <b>13/11</b> a UTM trazia só IDs (campanha/anúncio); desde <b>14/11</b> traz os nomes (casamento exato até o anúncio). `
    +`A campanha da UTM antiga é resolvida pelo mapa ID → nome (${nMap} campanha${nMap===1?'':'s'} mapeada${nMap===1?'':'s'}). `
    +`As vendas sem anúncio identificado são <b>rateadas</b> entre os anúncios ativos no mesmo dia pela proporção de <b>checkouts iniciados</b> do Meta (estimativa, coluna “Vendas est.”). `
    +(B.meta_has_ids?'A aba de Queries já tem colunas de ID — o casamento por ID está ativo.':'<b>Para fechar o gap de vez:</b> adicione as colunas <b>Campaign ID, Ad Set ID e Ad ID</b> na query do Meta — o build detecta sozinho e casa as vendas antigas até o anúncio.');
  // decisão por campanha
  const campAgg=estAgg(fS,fM,fE,r=>r.camp);
  const campRows=Object.entries(campAgg).map(([c,a])=>{ const d=deriveE(a);
    return {k:c,_state:a.sp>0?decision(a):'observar',_cpa:d.cpaE,_roas:d.roasTE,cells:{camp:c,status:'',gasto:d.gasto,ctr:d.ctr,connect:d.connect,ic:a.ic,cpic:d.cpic,
      vd:a.vd,ve:a.ve,cpaE:d.cpaE,fe:d.fatTE,roasFE:d.roasFE,roasBE:d.roasBE,roasTE:d.roasTE}}; }).sort((x,y)=>y.cells.gasto-x.cells.gasto);
  const CC=[{key:'camp',label:'Campanha',type:'dim',big:true,stk:'l'},{key:'status',label:'Decisão',type:'dim',w:104},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'ctr',label:'CTR',type:'pct'},{key:'connect',label:'Connect',type:'pct'},
    {key:'ic',label:'Checkouts',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
    {key:'vd',label:'Vendas UTM',type:'int'},{key:'ve',label:'Vendas est.',type:'num',cls:()=>'est'},
    {key:'cpaE',label:'CPA est.',type:'brl'},{key:'fe',label:'Fat. total est.',type:'brl'},
    {key:'roasFE',label:'ROAS front est.',type:'num2'},{key:'roasBE',label:'ROAS back est.',type:'num2'},{key:'roasTE',label:'ROAS total est.',type:'num2'}];
  const tc=Object.assign(newAgg(),{}); Object.values(campAgg).forEach(a=>{ Object.keys(tc).forEach(k=>{ tc[k]+=a[k]||0; }); });
  const td=deriveE(tc);
  renderTable({id:'oCamp', cols:CC, rows:campRows, center:true,
    total:{camp:null,status:'',gasto:td.gasto,ctr:td.ctr,connect:td.connect,ic:tc.ic,cpic:td.cpic,vd:tc.vd,ve:tc.ve,cpaE:td.cpaE,fe:td.fatTE,roasFE:td.roasFE,roasBE:td.roasBE,roasTE:td.roasTE},
    selectable:true, selSet:STATE.oSelC, onSelect:(key,e)=>{ toggleSet(STATE.oSelC,key,e&&(e.ctrlKey||e.metaKey)); renderOtm(); },
    afterRender:(table,sorted)=>{ table.querySelectorAll('tbody tr').forEach((tr,i)=>{ const it=sorted[i]; if(!it) return; const tds=tr.querySelectorAll('td');
      CC.forEach((c,ci)=>{ const tdd=tds[ci]; if(!tdd) return;
        if(c.key==='status') tdd.innerHTML=statusChip(it._state);
        if(c.key==='cpaE'){ const mc=metaColorClass(it._cpa,METAS.cpa); if(mc) tdd.classList.add(mc); }
        if(c.key==='roasTE'){ const mc=roasColorClass(it._roas,METAS.roas); if(mc) tdd.classList.add(mc); } }); }); }});
  // decisão por anúncio
  let pool=adPool(fS,fM,fE);
  if(STATE.oSelC.size) pool=pool.filter(it=>STATE.oSelC.has(it.a.camp));
  pool.sort((x,y)=>(DEC_ORDER[x.dec]-DEC_ORDER[y.dec])||cmpBest(x,y));
  renderAdDecisionTable('oAds',pool);
  const cnt=pool.reduce((m,it)=>{ m[it.dec]=(m[it.dec]||0)+1; return m; },{});
  document.getElementById('otmAdCount').textContent=pool.length+' anúncios com gasto'+(STATE.oSelC.size?' · filtrado':'')
    +' · '+(cnt.escalar||0)+' escalar · '+(cnt.cortar||0)+' cortar';
  document.getElementById('otmAdsNote').innerHTML='Cada linha é um anúncio <b>dentro do seu conjunto</b> (o mesmo criativo em conjuntos diferentes aparece separado). Ordem: Escalar → Manter → Cortar → Observar e, dentro de cada grupo, mais vendas estimadas. <b>Vendas est.</b> = vendas da UTM + rateio das vendas sem anúncio identificado (checkouts do dia). <b>Dias s/ venda</b> = dias seguidos, até o fim do período, gastando sem venda (vermelho ≥ N dias do painel).';
  renderAlerts(pool, t);
  // posicionamento & plataforma
  const pos={}; mS.forEach(s=>{ const key=s.pos||'Sem posicionamento (UTM antiga)'; const x=pos[key]||(pos[key]={n:0,v:0,plat:s.plat}); x.n++; x.v+=s.v; });
  const plat={}; mS.forEach(s=>{ const x=plat[s.plat]||(plat[s.plat]={n:0,v:0}); x.n++; x.v+=s.v; });
  const nm=mS.length||1;
  renderTable({id:'oPos', center:true,
    cols:[{key:'k',label:'Posicionamento / plataforma',type:'dim',big:true},{key:'n',label:'Vendas',type:'int',heat:'vendas'},{key:'p',label:'% vendas',type:'pct'},{key:'v',label:'Fat.',type:'brl'}],
    rows:[...Object.entries(pos).sort((a,b)=>b[1].n-a[1].n).map(([k,x])=>({k:'p'+k,cells:{k:k,n:x.n,p:x.n/nm,v:x.v}})),
          ...Object.entries(plat).sort((a,b)=>b[1].n-a[1].n).map(([k,x])=>({k:'f'+k,cells:{k:'Plataforma · '+k,n:x.n,p:x.n/nm,v:x.v}}))],
    total:{k:null,n:mS.length,p:1,v:fatOf(mS)}});
  hourChart('oHour', mS);
}
function gapChart(id, fS, fM){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const days={}; const g=d=>days[d]||(days[d]={ad:0,camp:0,none:0,out:0,ic:0});
  fM.forEach(r=>{ if(r.d) g(r.d).ic+=r.ic; });
  fS.forEach(s=>{ const x=g(s.d); if(s.src!=='meta') x.out++; else if(s.lvl==='ad') x.ad++; else if(s.lvl==='none') x.none++; else x.camp++; });
  const ds=Object.keys(days).sort(), mut=cmuted();
  charts[id]=new Chart(el,{data:{labels:ds.map(d=>d.slice(5)),datasets:[
      {type:'bar',label:'Meta · anúncio identificado',data:ds.map(d=>days[d].ad),backgroundColor:cvar('--good'),stack:'v',order:3},
      {type:'bar',label:'Meta · só campanha',data:ds.map(d=>days[d].camp),backgroundColor:cvar('--yellow'),stack:'v',order:3},
      {type:'bar',label:'Meta · sem campanha',data:ds.map(d=>days[d].none),backgroundColor:cvar('--bad'),stack:'v',order:3},
      {type:'bar',label:'Orgânico / sem UTM',data:ds.map(d=>days[d].out),backgroundColor:cvar('--bar-noq'),stack:'v',order:3},
      {type:'line',label:'Checkouts (Meta)',data:ds.map(d=>days[d].ic),borderColor:cvar('--chart-ic'),backgroundColor:cvar('--chart-ic'),borderWidth:2,pointRadius:2,tension:.25,order:0,yAxisID:'y1'},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}}},
      scales:{x:{stacked:true,ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{stacked:true,beginAtZero:true,ticks:{color:mut,font:{size:10},precision:0},grid:{color:cgrid()},title:{display:true,text:'Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',beginAtZero:true,ticks:{color:mut,font:{size:10},precision:0},grid:{display:false},title:{display:true,text:'Checkouts',color:mut,font:{size:10}}}}}});
}
function hourChart(id, mS){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const h=new Array(24).fill(0); mS.forEach(s=>{ if(s.h!=null) h[s.h]++; });
  charts[id]=new Chart(el,{type:'bar',data:{labels:h.map((_,i)=>pad(i)+'h'),datasets:[{label:'Vendas',data:h,backgroundColor:cvar('--chart-vendas'),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:cmuted(),font:{size:9}},grid:{display:false}},y:{beginAtZero:true,ticks:{color:cmuted(),precision:0,font:{size:10}},grid:{color:cgrid()}}}}});
}
/* Sinais de otimização — regras determinísticas sobre o período ativo */
function renderAlerts(pool, t){
  const host=document.getElementById('otmAlerts'); if(!host) return;
  const li=(it,txt)=>`<li><b>${escHtml(shortName(it.a.ad,40))}</b> <span style="color:var(--muted)">(${escHtml(shortName(it.a.adset,28))})</span> — ${txt}</li>`;
  const cards=[];
  const esc=pool.filter(it=>it.dec==='escalar').sort((x,y)=>y.a.ve-x.a.ve).slice(0,6);
  cards.push({c:'a-green',h:'Escalar',p:'CPA estimado dentro da meta, com volume mínimo de vendas.',items:esc.map(it=>{const d=deriveE(it.a); return li(it,`${numf(it.a.ve)} vendas est. · CPA <b>${brl(d.cpaE)}</b> · ROAS total ${roasf(d.roasTE)} (back ${roasf(d.roasBE)})`);})});
  const cut=pool.filter(it=>it.dec==='cortar').sort((x,y)=>y.a.sp-x.a.sp).slice(0,6);
  cards.push({c:'a-red',h:'Cortar',p:'CPA acima do teto (meta +30%) ou já gastou o teto sem vender.',items:cut.map(it=>{const d=deriveE(it.a); return li(it,`gasto <b>${brl(d.gasto)}</b> · ${numf(it.a.ve)} vendas est. · CPA ${brl(d.cpaE)}`);})});
  const streak=pool.filter(it=>it.dsv>=METAS.nDias&&it.dec!=='cortar').sort((x,y)=>y.dsv-x.dsv).slice(0,6);
  cards.push({c:'a-yellow',h:`${intf(METAS.nDias)}+ dias gastando sem vender`,p:'Ainda sem decisão de corte, mas sem venda (UTM nem estimada) nos últimos dias com gasto.',items:streak.map(it=>li(it,`<b>${it.dsv} dias</b> seguidos · gasto ${brl(deriveE(it.a).gasto)}`))});
  const sum=k=>pool.reduce((s,it)=>s+it.a[k],0);
  const accCon=sum('cl')?sum('lpv')/sum('cl'):null;
  const con=pool.filter(it=>it.a.cl>=40&&accCon&&derive(it.a).connect!=null&&derive(it.a).connect<accCon*0.8).sort((x,y)=>derive(x.a).connect-derive(y.a).connect).slice(0,6);
  cards.push({c:'a-yellow',h:'Connect rate baixo',p:`Views da página ÷ cliques abaixo de 80% da média da conta (${pct(accCon)}) — clique que não carrega a página.`,items:con.map(it=>li(it,`connect <b>${pct(derive(it.a).connect)}</b> · ${intf(it.a.cl)} cliques`))});
  const accCk=sum('ic')?sum('ve')/sum('ic'):null;
  const ck=pool.filter(it=>it.a.ic>=8&&accCk&&(it.a.ve/it.a.ic)<accCk*0.5).sort((x,y)=>y.a.ic-x.a.ic).slice(0,6);
  cards.push({c:'a-yellow',h:'Checkout que não fecha',p:`Muitos checkouts e poucas vendas (abaixo de 50% da conversão média checkout→venda de ${pct(accCk)}).`,items:ck.map(it=>li(it,`${intf(it.a.ic)} checkouts · ${numf(it.a.ve)} vendas est. (${pct(it.a.ve/it.a.ic)})`))});
  const fS=salesActive().filter(s=>s.src==='meta'), nAd=fS.filter(s=>s.lvl==='ad').length;
  const cov=fS.length?nAd/fS.length:null;
  cards.push({c:'',h:'Qualidade do rastreio',p:`${pct(cov)} das vendas pagas do período casaram até o anúncio pela UTM.`,items:[
    cov!=null&&cov<0.8?'<li>Decisões de anúncio usam o <b>rateio por checkouts</b> (coluna “Vendas est.”) — confira a coluna “Vendas UTM” antes de cortar.</li>':'<li>Rastreio bom: a coluna “Vendas UTM” já é suficiente para decidir.</li>',
    B.meta_has_ids?'':'<li>Adicione <b>Campaign ID · Ad Set ID · Ad ID</b> na query do Meta para casar também as vendas da UTM antiga.</li>',
    '<li>Mantenha o padrão de UTM com nome: <code>s=Meta-Ads|m={{adset.name}}|c={{campaign.name}}|co={{ad.name}}|t={{placement}}|utm_id={{campaign.id}}</code>.</li>'].filter(Boolean)});
  const nItems=cards.reduce((n,c)=>n+(c.h==='Qualidade do rastreio'?0:c.items.length),0);
  document.getElementById('otmAlertCount').textContent=nItems+' sinais';
  host.innerHTML=cards.map(c=>`<div class="otm-alert ${c.c}"><h4>${c.h}</h4><p>${c.p}</p>${c.items.length?`<ul>${c.items.join('')}</ul>`:'<div class="otm-empty">Nenhum no período.</div>'}</div>`).join('');
}

/* ---------------- PAGE 4: Insights de IA ---------------- */
function relBriefKey(){ if(STATE.selDays.size) return null; return STATE.preset||null; }
const QUAD_TITLES={
  quadro1_resumo:'1 · Resumo executivo e saúde do funil', quadro2_diagnostico:'2 · Diagnóstico do funil',
  quadro3_campeoes:'3 · Campanhas, estruturas e anúncios campeões', quadro4_acoes:'4 · Ações priorizadas',
};
function renderRelBrief(){
  const wrap=document.getElementById('relBrief'), stampEl=document.getElementById('relBriefStamp');
  const bf=DATA.briefings||{}, per=bf.periodos||{}, key=relBriefKey();
  stampEl.textContent=bf.generated_at?`Insights gerados por IA · última atualização ${bf.generated_at}`:'';
  if(!Object.keys(per).length){ wrap.innerHTML='<div class="rel-brief-empty">Os insights por IA ainda não foram gerados. Enquanto isso, use a aba <b>Otimização</b> — os sinais de escalar/cortar lá são calculados ao vivo.</div>'; return; }
  if(!key||!per[key]){ wrap.innerHTML='<div class="rel-brief-empty">Insights disponíveis para os períodos predefinidos. Selecione um deles no seletor de período.</div>'; return; }
  const item=per[key];
  if(item.quadro1_resumo||item.quadro2_diagnostico||item.quadro3_campeoes||item.quadro4_acoes){
    wrap.innerHTML=`<div class="rel-quad-grid">${Object.keys(QUAD_TITLES).map(k=>`<div class="rel-quad-card"><h4>${QUAD_TITLES[k]}</h4><div class="rel-quad-body rel-brief">${item[k]||'<p>—</p>'}</div></div>`).join('')}</div>`;
    return;
  }
  wrap.innerHTML=item.html||item.texto||'<div class="rel-brief-empty">Sem conteúdo.</div>';
}
function renderRelAds(){
  const pool=adPool(salesActive(),metaActive(),estActive()).sort(cmpBest);
  renderAdDecisionTable('relTop',pool);
  const av=pool.filter(it=>sampleOk(it.a)).length;
  document.getElementById('relTopCount').textContent=av+' avaliado'+(av===1?'':'s')+' de '+pool.length+' anúncio'+(pool.length===1?'':'s')+' com gasto';
}
function renderRelatorio(){
  renderGeralCore(REL_IDS);
  periodHeader('relPeriodName','relPeriodRange');
  renderMetasNote();
  renderRelAds();
  renderRelBrief();
}
/* ---------------- date presets ---------------- */
const PRESETS=[
  ['hoje','Hoje',()=>[TODAY,TODAY]],
  ['ontem','Ontem',()=>[addDays(TODAY,-1),addDays(TODAY,-1)]],
  ['3d','3 dias',()=>[addDays(TODAY,-2),TODAY]],
  ['7d','7 dias',()=>[addDays(TODAY,-6),TODAY]],
  ['14d','14 dias',()=>[addDays(TODAY,-13),TODAY]],
  ['30d','30 dias',()=>[addDays(TODAY,-29),TODAY]],
  ['mes','Este mês',()=>{const [y,m]=TODAY.split('-');return [`${y}-${m}-01`,TODAY];}],
  ['mespass','Mês passado',()=>{const dt=new Date(TODAY+'T00:00:00');const f=new Date(dt.getFullYear(),dt.getMonth()-1,1);const l=new Date(dt.getFullYear(),dt.getMonth(),0);return [dstr(f),dstr(l)];}],
  ['todo','Todo período',()=>[B.date_min,B.date_max]],
];
/* rótulo do botão de período — mostra o intervalo aplicado dentro do próprio botão */
function syncDateInputs(){
  const el=document.getElementById('periodBtnLabel'); if(!el) return;
  if(STATE.selDays.size){ el.textContent=STATE.selDays.size+(STATE.selDays.size>1?' dias selecionados':' dia selecionado'); return; }
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  if(STATE.from&&STATE.to) el.textContent=brdate(STATE.from)+' – '+brdate(STATE.to)+(pr?' · '+pr[1]:'');
  else el.textContent='Selecionar período';
}
function applyPreset(id){ const p=PRESETS.find(x=>x[0]===id); if(!p)return; const [f,t]=p[2]();
  STATE.from=f; STATE.to=t; STATE.preset=id; STATE.selDays.clear(); ppClose(); syncDateInputs(); renderAll(); }

/* ---- popover do seletor de período (estilo Data Studio) ---- */
const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_PT=['D','S','T','Q','Q','S','S'];
const PP={from:null,to:null,preset:'',fromView:'',toView:''};
function ymView(ds){ return (ds||TODAY).slice(0,7); }
function shiftView(view,delta){ const [y,m]=view.split('-').map(Number); const dt=new Date(y,m-1+delta,1); return dt.getFullYear()+'-'+pad(dt.getMonth()+1); }
function ppIsOpen(){ const pop=document.getElementById('periodPop'); return pop && !pop.hidden; }
function ppOpen(){
  PP.from=STATE.from; PP.to=STATE.to; PP.preset=STATE.selDays.size?'':STATE.preset;
  PP.fromView=ymView(STATE.from); PP.toView=ymView(STATE.to);
  document.getElementById('periodPop').hidden=false;
  document.getElementById('periodBtn').setAttribute('aria-expanded','true');
  ppRenderAll();
}
function ppClose(){ const pop=document.getElementById('periodPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('periodBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function ppRenderAll(){ ppRenderPresets(); ppRenderCal('from'); ppRenderCal('to'); ppRenderRange(); }
function ppRenderPresets(){
  const host=document.getElementById('ppPresets');
  host.innerHTML=PRESETS.map(p=>`<button class="pp-preset ${PP.preset===p[0]?'active':''}" data-p="${p[0]}">${p[1]}</button>`).join('');
  host.querySelectorAll('.pp-preset').forEach(c=>c.addEventListener('click',()=>{
    const p=PRESETS.find(x=>x[0]===c.dataset.p); const [f,t]=p[2]();
    PP.from=f; PP.to=t; PP.preset=p[0]; PP.fromView=ymView(f); PP.toView=ymView(t); ppRenderAll();
  }));
}
function ppRenderCal(side){
  const host=document.getElementById(side==='from'?'ppCalFrom':'ppCalTo');
  const view=side==='from'?PP.fromView:PP.toView;
  const [y,m]=view.split('-').map(Number);
  const startDow=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<span class="pp-day empty"></span>';
  for(let d=1;d<=dim;d++){
    const ds=view+'-'+pad(d);
    const inR=PP.from&&PP.to&&ds>=PP.from&&ds<=PP.to, isEdge=(ds===PP.from||ds===PP.to);
    const cls=['pp-day']; if(inR) cls.push('in'); if(ds===PP.from) cls.push('edge-l'); if(ds===PP.to) cls.push('edge-r'); if(isEdge) cls.push('sel');
    cells+=`<button class="${cls.join(' ')}" data-side="${side}" data-d="${ds}">${d}</button>`;
  }
  host.innerHTML=`<div class="pp-cal-head"><span class="pp-cal-title">${side==='from'?'Data de início':'Data de término'}</span></div>
    <div class="pp-cal-nav"><button class="pp-nav" data-nav="-1">‹</button><span class="pp-cal-month">${MONTHS_PT[m-1]} ${y}</span><button class="pp-nav" data-nav="1">›</button></div>
    <div class="pp-dow">${DOW_PT.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pp-grid">${cells}</div>`;
  host.querySelectorAll('.pp-nav').forEach(b=>b.addEventListener('click',()=>{
    const nv=shiftView(view,+b.dataset.nav); if(side==='from') PP.fromView=nv; else PP.toView=nv; ppRenderCal(side);
  }));
  host.querySelectorAll('.pp-day[data-d]').forEach(b=>b.addEventListener('click',()=>ppPickDay(side,b.dataset.d)));
}
function ppPickDay(side,ds){
  PP.preset='';
  if(side==='from'){ PP.from=ds; if(PP.to&&PP.from>PP.to) PP.to=PP.from; }
  else { PP.to=ds; if(PP.from&&PP.to<PP.from) PP.from=PP.to; }
  ppRenderAll();
}
function ppRenderRange(){
  const el=document.getElementById('ppRange');
  if(PP.from&&PP.to){ const n=Math.round((new Date(PP.to+'T00:00:00')-new Date(PP.from+'T00:00:00'))/86400000)+1;
    el.textContent=brdate(PP.from)+' – '+brdate(PP.to)+(n>0?' · '+n+(n>1?' dias':' dia'):''); }
  else el.textContent='Selecione as datas';
}
function ppApply(){
  if(!PP.from||!PP.to){ ppClose(); return; }
  STATE.from=PP.from; STATE.to=PP.to; STATE.preset=PP.preset||''; STATE.selDays.clear();
  ppClose(); syncDateInputs(); renderAll();
}


/* ---------------- navigation & boot ---------------- */
const PAGES={geral:'Visão Geral',meta:'Meta Ads',otm:'Otimização',rel:'Insights de IA'};
function setPage(p){ if(!PAGES[p]) p='geral'; STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  Object.keys(PAGES).forEach(k=>document.getElementById('page-'+k).classList.toggle('active',k===p));
  document.getElementById('ptitle').textContent=PAGES[p];
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'','#'+p);
  renderAll();
}
function renderAll(){ if(STATE.page==='meta') renderMeta(); else if(STATE.page==='otm') renderOtm(); else if(STATE.page==='rel') renderRelatorio(); else renderGeral(); }

function applyTheme(){ const t=localStorage.getItem('dm_theme'); if(t==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); }
try{ applyTheme(); }catch(e){}
document.getElementById('themeBtn').addEventListener('click',()=>{ const dark=document.documentElement.getAttribute('data-theme')==='dark'; try{ localStorage.setItem('dm_theme',dark?'light':'dark'); }catch(e){} if(dark) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); renderAll(); });

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
document.getElementById('taxToggle').addEventListener('click',function(){ STATE.tax=!STATE.tax; this.classList.toggle('on',STATE.tax); renderAll(); });
document.getElementById('periodBtn').addEventListener('click',e=>{ e.stopPropagation(); ppIsOpen()?ppClose():ppOpen(); });
document.getElementById('ppApply').addEventListener('click',ppApply);
document.getElementById('ppCancel').addEventListener('click',ppClose);
document.getElementById('periodPop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{ if(ppIsOpen()) ppClose(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ppIsOpen()) ppClose(); });
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.mSelC.clear();STATE.mSelA.clear();STATE.mSelAd.clear();STATE.oSelC.clear();STATE.selDays.clear(); applyPreset('mes'); });
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

/* painel de Metas & parâmetros (Otimização + Insights, sincronizados) — edita ao vivo e salva em localStorage */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const rerender=()=>{ if(STATE.page==='otm') renderOtm(); else if(STATE.page==='rel') renderRelAds(); };
  document.querySelectorAll('input[data-meta]').forEach(el=>el.addEventListener('input',()=>{
    const k=el.dataset.meta, v=num(el);
    if(k==='cpa'||k==='roas') METAS[k]=(v!=null&&v>0)?v:null;
    else METAS[k]=(v!=null&&v>=1)?Math.round(v):METAS_DEFAULT[k];
    document.querySelectorAll(`input[data-meta="${k}"]`).forEach(o=>{ if(o!==el) o.value=el.value; });
    saveMetas(); renderMetasNote(); rerender();
  }));
  document.querySelectorAll('[data-metas-reset]').forEach(b=>b.addEventListener('click',()=>{
    Object.assign(METAS,METAS_DEFAULT); try{ localStorage.removeItem(LS_METAS); }catch(e){} syncMetasInputs(); rerender(); }));
  syncMetasInputs();
})();

document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build '+B.build_id;
document.getElementById('buildFoot2').textContent='· build '+B.build_id;

syncDateInputs();
setPage((location.hash||'#geral').slice(1));

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);
