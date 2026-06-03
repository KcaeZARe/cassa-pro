import { useState, useEffect } from "react";
const STORAGE_KEY = "cassapro_v4";
const load = () => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; } };
const persist = (d) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} };

const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
const eur = (v, plus) => {
  const x = parseFloat(v);
  if (isNaN(x)) return "—";
  const abs = Math.abs(x).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x < 0) return "−€ " + abs;
  return (plus && x > 0 ? "+" : "") + "€ " + abs;
};
const ec = (v) => n(v) >= 0 ? "#4ade80" : "#f87171";
const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const dk = (y, m, d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const nextDk = (y, m, d) => { const dt = new Date(y, m, d + 1); return dk(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
const mk = (y, m) => `aggi_${y}_${m}`;
const vk = (y, m) => `versamenti_${y}_${m}`;

const pk = (y, m) => `personale_${y}_${m}`;
const emptyDipendente = () => ({ nome:"", stipendio:"", ore_mensili:"", maggiorazione:"25" });
const emptyPresenza = () => ({ entrata:"", uscita:"", tipo:"lavoro", straordinari:"", anticipo:"", nota:"" });
// tipo: lavoro | malattia | permesso | assenza | ferie

const emptyDay = () => ({
  bar:"", risto:"", pos_bar:"",
  tab_venduto:"", tab_pos:"", art_tabacchi:"",
  gratta_venduto:"", gratta_pagati:"",
  lotto_venduto:"", lotto_pagati:"",
  toto:"", virtual:"",
  lis:"", sisal:"", valori:"",
  dist_prelievo:"", dist_nota:"",
  slot_raccolto:"", slot_refill:"", slot_monete:"", slot_note:"",
  pf_oggi:"", pf_domani:"",
  monete_oggi:"", monete_domani:"",
  debiti_oggi:"", debiti_domani:"",
  arrotondamento:"",
  spese:[],
});

const emptySpesa = () => ({ dove:"", tipo:"merce", contante:"", elettronico:"", nota:"" });
const emptyVersamento = () => ({ importo:"", data:"", nota:"" });
const AGGI_LABEL = {
  "BAR_GRATTA E VINCI": "GRATTA E VINCI",
  "TAB_GRATTA E VINCI": "GRATTA E VINCI",
};
const aggiLabel = (v) => AGGI_LABEL[v] || v;
const emptyAggio = () => ({ importo:"", periodo:"" });
const AGGI_BAR_VOCI = ["SISAL","SCOMMESSE","PVR","SLOT","BAR_GRATTA E VINCI"];
const AGGI_TAB_VOCI = ["TABACCHI","TAB_GRATTA E VINCI","LOTTO","LIS","VALORI BOLLATI","SIR","FRANCOBOLLI"];
const emptyAggiMese = () => {
  const obj = {};
  [...AGGI_BAR_VOCI,...AGGI_TAB_VOCI].forEach(v => { obj[v] = [emptyAggio()]; });
  return obj;
};

function calcDay(t) {
  if (!t) return { tab_rim:0,gratta_rim:0,lotto_rim:0,spese_cont:0,spese_ele:0,pf_diff:0,monete_diff:0,debiti_diff:0,movimento:0,guadagno:0 };
  const tab_rim = n(t.tab_venduto) - n(t.tab_pos);
  const gratta_rim = n(t.gratta_venduto) - n(t.gratta_pagati);
  const lotto_rim = n(t.lotto_venduto) - n(t.lotto_pagati);
  const spese_cont = (t.spese||[]).reduce((s,x)=>s+n(x.contante),0);
  const spese_ele = (t.spese||[]).reduce((s,x)=>s+n(x.elettronico),0);
  const pf_diff = n(t.pf_oggi) - n(t.pf_domani);
  const monete_diff = n(t.monete_oggi) - n(t.monete_domani);
  const debiti_diff = n(t.debiti_oggi) - n(t.debiti_domani);
  const movimento =
    n(t.bar) + n(t.risto)
    + tab_rim + gratta_rim + lotto_rim
    + n(t.art_tabacchi) + n(t.toto) + n(t.virtual) + n(t.lis) + n(t.sisal) + n(t.valori)
    + n(t.dist_prelievo)
    + n(t.slot_raccolto) + n(t.slot_monete) - n(t.slot_refill)
    + pf_diff + monete_diff + debiti_diff
    - spese_cont
    + n(t.arrotondamento);
  const guadagno = n(t.bar) + n(t.risto) + n(t.pos_bar) + n(t.art_tabacchi) - spese_cont - spese_ele;
  return { tab_rim, gratta_rim, lotto_rim, spese_cont, spese_ele, pf_diff, monete_diff, debiti_diff, movimento, guadagno };
}

// UI atoms
const Lbl = ({c}) => <div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>{c}</div>;
const Inp = ({val,set,type="number",ph}) => (
  <input type={type} step={type==="number"?"0.01":undefined} value={val??""} onChange={e=>set(e.target.value)} placeholder={ph}
    style={{width:"100%",background:"#080e1c",color:"#e2e8f0",border:"1px solid #1e293b",borderRadius:7,padding:"9px 10px",fontSize:14,boxSizing:"border-box",fontFamily:"inherit"}}/>
);
const Calc = ({label,val,color}) => (
  <div style={{flex:"1 1 110px"}}>
    <Lbl c={label}/>
    <div style={{background:"#080e1c",border:`1px solid ${color||"#1e3a5f"}`,borderRadius:7,padding:"9px 10px",fontSize:14,fontWeight:700,color:color||"#60a5fa"}}>{eur(val)}</div>
  </div>
);
const Fld = ({label,val,set,flex="1 1 110px",type="number"}) => (
  <div style={{flex}}><Lbl c={label}/><Inp val={val} set={set} type={type}/></div>
);
const Row = ({children,mb=10}) => <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:mb}}>{children}</div>;
const Block = ({title,accent,children}) => (
  <div style={{background:"#0f1923",borderRadius:12,borderLeft:`4px solid ${accent}`,padding:"14px 14px 8px",marginBottom:14}}>
    <div style={{fontSize:11,fontWeight:800,color:accent,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>
    {children}
  </div>
);
const Stat = ({label,val,accent,big}) => (
  <div style={{background:"#0f1923",borderRadius:10,borderTop:`3px solid ${accent}`,padding:"12px 14px",flex:"1 1 140px"}}>
    <div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>{label}</div>
    <div style={{fontSize:big?20:15,fontWeight:800,color:accent,fontVariantNumeric:"tabular-nums"}}>{val}</div>
  </div>
);
const RRow = ({label,val,color,bold}) => (
  <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #080e1c",fontSize:bold?14:12,fontWeight:bold?800:400}}>
    <span style={{color:bold?"#e2e8f0":"#94a3b8"}}>{label}</span>
    <span style={{color:color||"#e2e8f0",fontWeight:700}}>{val}</span>
  </div>
);

const TABS = [
  {id:"incassi",label:"💰 Incassi"},
  {id:"giochi",label:"🎰 Giochi"},
  {id:"slot",label:"🕹️ Slot"},
  {id:"cassa",label:"🏦 Cassa"},
  {id:"spese",label:"📋 Spese"},
  {id:"versamenti",label:"🏛️ Versamenti"},
  {id:"aggi",label:"📑 Aggi"},
  {id:"personale",label:"👥 Personale"},
  {id:"riepilogo",label:"📊 Totali"},
];

export default function App() {
  const now = new Date();
  const [all, setAll] = useState(load);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }
  }, []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(now.getDate());
  const [tab, setTab] = useState("incassi");
  const [view, setView] = useState("day");
  const [flash, setFlash] = useState(false);

  const KEY = dk(year,month,day);
  const NKEY = nextDk(year,month,day);
  const MKEY = mk(year,month);
  const VKEY = vk(year,month);
  const today = all[KEY] || emptyDay();
  const calc = calcDay(today);
  const aggi = all[MKEY] || emptyAggiMese();
  const versamenti = all[VKEY] || [];

  const save = (updated) => { setAll(updated); persist(updated); setFlash(true); setTimeout(()=>setFlash(false),1200); };

  const upd = (f, v) => {
    const updatedDay = {...today, [f]: v};
    let updated = {...all, [KEY]: updatedDay};
    // Auto-fill next day's pf/monete/debiti "oggi" fields
    if (f === "pf_domani" || f === "monete_domani" || f === "debiti_domani") {
      const fieldMap = { pf_domani:"pf_oggi", monete_domani:"monete_oggi", debiti_domani:"debiti_oggi" };
      const nextDay = all[NKEY] || emptyDay();
      updated = {...updated, [NKEY]: {...nextDay, [fieldMap[f]]: v}};
    }
    save(updated);
  };

  const updSpesa = (i,f,v) => { const sp=[...(today.spese||[])]; sp[i]={...sp[i],[f]:v}; upd("spese",sp); };
  const addSpesa = () => upd("spese",[...(today.spese||[]),emptySpesa()]);
  const delSpesa = (i) => upd("spese",(today.spese||[]).filter((_,j)=>j!==i));

  // Versamenti
  const updVersamento = (i,f,v) => { const vs=[...versamenti]; vs[i]={...vs[i],[f]:v}; save({...all,[VKEY]:vs}); };
  const addVersamento = () => save({...all,[VKEY]:[...versamenti,emptyVersamento()]});
  const delVersamento = (i) => save({...all,[VKEY]:versamenti.filter((_,j)=>j!==i)});
  const totVersati = versamenti.reduce((s,x)=>s+n(x.importo),0);

  // Aggi
  const updAggio = (voce,i,f,v) => { const cur=[...(aggi[voce]||[emptyAggio()])]; cur[i]={...cur[i],[f]:v}; save({...all,[MKEY]:{...aggi,[voce]:cur}}); };
  const addAggio = (voce) => { const cur=[...(aggi[voce]||[])]; save({...all,[MKEY]:{...aggi,[voce]:[...cur,emptyAggio()]}}); };
  const delAggio = (voce,i) => { const cur=(aggi[voce]||[]).filter((_,j)=>j!==i); save({...all,[MKEY]:{...aggi,[voce]:cur.length?cur:[emptyAggio()]}}); };
  const totAggio = (voce) => (aggi[voce]||[]).reduce((s,x)=>s+n(x.importo),0);
  const totAggiBar = AGGI_BAR_VOCI.reduce((s,v)=>s+totAggio(v),0);
  const totAggiTab = AGGI_TAB_VOCI.reduce((s,v)=>s+totAggio(v),0);
  const totAggi = totAggiBar + totAggiTab;

  // ── PERSONALE ──
  const PKEY = pk(year, month);
  const personale = all[PKEY] || { dipendenti: [], presenze: {} };

  const savePers = (updated) => { save({...all, [PKEY]: updated}); };

  const addDipendente = () => {
    const dips = [...(personale.dipendenti||[]), emptyDipendente()];
    savePers({...personale, dipendenti: dips});
  };
  const updDipendente = (i, f, v) => {
    const dips = [...(personale.dipendenti||[])];
    dips[i] = {...dips[i], [f]: v};
    savePers({...personale, dipendenti: dips});
  };
  const delDipendente = (i) => {
    const dips = (personale.dipendenti||[]).filter((_,j)=>j!==i);
    savePers({...personale, dipendenti: dips});
  };

  const presKey = (dipIdx, d) => `${dipIdx}_${year}_${String(month+1).padStart(2,"0")}_${String(d).padStart(2,"0")}`;
  const getPresenza = (dipIdx, d) => (personale.presenze||{})[presKey(dipIdx,d)] || emptyPresenza();
  const updPresenza = (dipIdx, d, f, v) => {
    const pk2 = presKey(dipIdx, d);
    const presenze = {...(personale.presenze||{}), [pk2]: {...getPresenza(dipIdx,d), [f]: v}};
    savePers({...personale, presenze});
  };

  const calcOre = (entrata, uscita) => {
    if (!entrata || !uscita) return 0;
    const [eh, em] = entrata.split(":").map(Number);
    const [uh, um] = uscita.split(":").map(Number);
    if (isNaN(eh)||isNaN(uh)) return 0;
    const mins = (uh*60+um) - (eh*60+em);
    return Math.max(0, mins/60);
  };

  const calcMensile = (dipIdx) => {
    const dip = (personale.dipendenti||[])[dipIdx];
    if (!dip) return { ore:0, paga:0, straordinari:0, anticipi:0, totale:0 };
    const tariffa = n(dip.stipendio) / (n(dip.ore_mensili)||1);
    let oreTot = 0, straoTot = 0, anticipiTot = 0;
    const dim2 = new Date(year, month+1, 0).getDate();
    for (let d=1; d<=dim2; d++) {
      const p = getPresenza(dipIdx, d);
      if (p.tipo === "lavoro") oreTot += calcOre(p.entrata, p.uscita);
      straoTot += n(p.straordinari);
      anticipiTot += n(p.anticipo);
    }
    const paga = oreTot * tariffa;
    const totale = paga + straoTot - anticipiTot;
    return { ore: oreTot, paga, straordinari: straoTot, anticipi: anticipiTot, totale };
  };

  const TIPO_LABEL = { lavoro:"Lavoro", malattia:"Malattia", permesso:"Permesso", assenza:"Assenza", ferie:"Ferie" };
  const TIPO_COLOR = { lavoro:"#4ade80", malattia:"#f87171", permesso:"#fbbf24", assenza:"#f87171", ferie:"#60a5fa" };

  // Calcolo cassa accumulata (residuo mese precedente + movimenti mese corrente - versamenti)
  const days = dim(year, month);

  // Residuo mese precedente: prendo l'ultimo giorno del mese precedente
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevDays = dim(prevYear, prevMonth);
  let residuoPrecedente = 0;
  for (let d = prevDays; d >= 1; d--) {
    const pd = all[dk(prevYear, prevMonth, d)];
    if (pd) { residuoPrecedente = calcDay(pd).movimento; break; }
  }
  // Somma progressiva movimenti mese corrente
  const monthRows = Array.from({length:days},(_,i)=>{
    const d = all[dk(year,month,i+1)];
    const c = calcDay(d);
    return {day:i+1,data:d,calc:c};
  });
  // Un giorno è "reale" solo se ha almeno un incasso principale inserito
  const hasRealData = (d) => d && (n(d.bar) || n(d.risto) || n(d.tab_venduto) || n(d.art_tabacchi) || n(d.gratta_venduto) || n(d.lotto_venduto) || n(d.slot_raccolto) || n(d.dist_prelievo));
  const movMensile = monthRows.reduce((s,x)=>s+(hasRealData(x.data)?x.calc.movimento:0),0);
  const cassaAccumulata = residuoPrecedente + movMensile - totVersati;

  // Somma progressiva fino al giorno corrente
  const movFinoOggi = monthRows.filter(x=>x.day<=day).reduce((s,x)=>s+(hasRealData(x.data)?x.calc.movimento:0),0);
  const cassaOggi = residuoPrecedente + movFinoOggi - totVersati;

  const mGuadagno = monthRows.reduce((s,x)=>s+(hasRealData(x.data)?x.calc.guadagno:0),0);

  return (
    <div style={{minHeight:"100vh",background:"#05090f",color:"#e2e8f0",fontFamily:"'DM Mono','Courier New',monospace",maxWidth:700,margin:"0 auto",paddingBottom:60}}>

      {/* HEADER */}
      <div style={{background:"linear-gradient(180deg,#0d1526 0%,#05090f 100%)",padding:"18px 16px 10px",position:"sticky",top:0,zIndex:20,borderBottom:"1px solid #1e293b"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,letterSpacing:2,color:"#f8fafc"}}>◈ CASSA PRO</div>
            <div style={{fontSize:10,color:"#334155",letterSpacing:1}}>GESTIONE CONTABILE GIORNALIERA</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {flash&&<span style={{background:"#14532d",color:"#4ade80",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700}}>✓ SALVATO</span>}
            <button onClick={()=>setView(v=>v==="day"?"month":"day")}
              style={{background:"#1e293b",color:"#94a3b8",border:"1px solid #334155",padding:"6px 12px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              {view==="day"?"MESE ▸":"◂ GIORNO"}
            </button>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[
            {val:year,set:setYear,opts:[2023,2024,2025,2026].map(y=>({v:y,l:y}))},
            {val:month,set:setMonth,opts:MONTHS.map((m,i)=>({v:i,l:m}))},
            ...(view==="day"?[{val:day,set:setDay,opts:Array.from({length:days},(_,i)=>({v:i+1,l:i+1}))}]:[]),
          ].map((s,i)=>(
            <select key={i} value={s.val} onChange={e=>s.set(+e.target.value)}
              style={{flex:1,background:"#0d1526",color:"#e2e8f0",border:"1px solid #1e293b",padding:"7px 8px",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
              {s.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* ── VISTA MESE ── */}
      {view==="month"&&(
        <div style={{padding:16}}>
          <div style={{fontSize:16,fontWeight:800,marginBottom:16}}>{MONTHS[month]} {year}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
            <Stat label="Mov. mese" val={eur(movMensile)} accent="#4ade80" big/>
            <Stat label="Versato" val={eur(totVersati)} accent="#f87171"/>
            <Stat label="Cassa attuale" val={eur(cassaAccumulata)} accent={cassaAccumulata>=0?"#60a5fa":"#f87171"} big/>
            <Stat label="Guadagno mese" val={eur(mGuadagno)} accent="#a78bfa"/>
            <Stat label="Guadagno + Aggi" val={eur(mGuadagno+totAggi)} accent={mGuadagno+totAggi>=0?"#4ade80":"#f87171"} big/>
          </div>
          <div style={{background:"#0f1923",borderRadius:12,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"28px 1fr 1fr 1fr 1fr",padding:"10px 14px",background:"#080e1c",fontSize:9,color:"#475569",fontWeight:800,letterSpacing:1,gap:6}}>
              <span>G</span><span>MOV.</span><span>SPESE</span><span>GUAD.</span><span>CASSA</span>
            </div>
            {(() => {
              let cumulativo = residuoPrecedente - totVersati;
              return monthRows.map(({day:d,data,calc:c})=>{
                const reale = hasRealData(data);
                if (reale) cumulativo += c.movimento;
                return (
                  <div key={d} onClick={()=>{setDay(d);setView("day");}}
                    style={{display:"grid",gridTemplateColumns:"28px 1fr 1fr 1fr 1fr",padding:"10px 14px",fontSize:12,borderBottom:"1px solid #080e1c",gap:6,cursor:"pointer",opacity:reale?1:0.3}}>
                    <span style={{color:"#64748b",fontWeight:800}}>{d}</span>
                    <span style={{color:"#4ade80"}}>{reale?eur(c.movimento):"—"}</span>
                    <span style={{color:"#f87171"}}>{reale?eur(c.spese_cont+c.spese_ele):"—"}</span>
                    <span style={{color:reale?ec(c.guadagno):"#475569",fontWeight:700}}>{reale?eur(c.guadagno):"—"}</span>
                    <span style={{color:reale?ec(cumulativo):"#475569",fontWeight:700}}>{reale?eur(cumulativo):"—"}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ── VISTA GIORNO ── */}
      {view==="day"&&(
        <>
          <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #1e293b",background:"#05090f"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{flex:"0 0 auto",padding:"12px 12px",background:"transparent",color:tab===t.id?"#e2e8f0":"#475569",border:"none",borderBottom:tab===t.id?"2px solid #4ade80":"2px solid transparent",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{padding:16}}>

            {/* ── INCASSI ── */}
            {tab==="incassi"&&<>
              <Block title="Bar e Ristorazione" accent="#4ade80">
                <Row><Fld label="Bar (€)" val={today.bar} set={v=>upd("bar",v)}/><Fld label="Ristorante (€)" val={today.risto} set={v=>upd("risto",v)}/><Fld label="POS Bar (€)" val={today.pos_bar} set={v=>upd("pos_bar",v)}/></Row>
                <Row><Calc label="Bar+Risto contante" val={n(today.bar)+n(today.risto)} color="#4ade80"/><Calc label="POS Bar (solo guadagno)" val={n(today.pos_bar)} color="#a78bfa"/></Row>
              </Block>
              <Block title="Tabacchi" accent="#fbbf24">
                <Row><Fld label="Venduto (€)" val={today.tab_venduto} set={v=>upd("tab_venduto",v)}/><Fld label="POS Tabacchi (€)" val={today.tab_pos} set={v=>upd("tab_pos",v)}/><Calc label="Rimasti (V−POS)" val={calc.tab_rim} color="#fbbf24"/></Row>
              </Block>
              <Block title="Articoli Tabacchi" accent="#a3e635">
                <Row><Fld label="Incasso Articoli (€)" val={today.art_tabacchi} set={v=>upd("art_tabacchi",v)}/></Row>
                <div style={{fontSize:10,color:"#475569",marginBottom:6}}>↑ Entra nel movimento come il Bar</div>
              </Block>
              <Block title="Distributore Sigarette" accent="#f97316">
                <Row>
                  <Fld label="Prelievo (€)" val={today.dist_prelievo} set={v=>upd("dist_prelievo",v)}/>
                  <div style={{flex:"2 1 200px"}}><Lbl c="Ora e Note"/><Inp val={today.dist_nota} set={v=>upd("dist_nota",v)} type="text" ph="es. 14:30 — prelievo"/></div>
                </Row>
                <Row>
                  <Fld label="Slot POS (€)" val={today.dist_slot_pos} set={v=>upd("dist_slot_pos",v)}/>
                  <div style={{flex:2,display:"flex",alignItems:"flex-end",paddingBottom:10}}><span style={{fontSize:11,color:"#475569"}}>📝 Solo annotazione — non incide sui conti</span></div>
                </Row>
              </Block>
              <Block title="Arrotondamento" accent="#94a3b8">
                <Row><Fld label="± Arrotondamento (€)" val={today.arrotondamento} set={v=>upd("arrotondamento",v)}/><div style={{flex:2,display:"flex",alignItems:"flex-end",paddingBottom:10}}><span style={{fontSize:11,color:"#475569"}}>Valore ± per eliminare i decimali</span></div></Row>
              </Block>
            </>}

            {/* ── GIOCHI ── */}
            {tab==="giochi"&&<>
              <Block title="Gratta e Vinci" accent="#facc15">
                <Row><Fld label="Venduto (€)" val={today.gratta_venduto} set={v=>upd("gratta_venduto",v)}/><Fld label="Pagati ai clienti (€)" val={today.gratta_pagati} set={v=>upd("gratta_pagati",v)}/><Calc label="Rimasti (V−P)" val={calc.gratta_rim} color="#facc15"/></Row>
              </Block>
              <Block title="Lotto" accent="#f97316">
                <Row><Fld label="Venduto (€)" val={today.lotto_venduto} set={v=>upd("lotto_venduto",v)}/><Fld label="Pagati ai clienti (€)" val={today.lotto_pagati} set={v=>upd("lotto_pagati",v)}/><Calc label="Rimasti (V−P)" val={calc.lotto_rim} color="#f97316"/></Row>
              </Block>
              <Block title="Scommesse / Virtual / LIS / SISAL / Valori" accent="#34d399">
                <div style={{fontSize:10,color:"#475569",marginBottom:10}}>↓ Inserisci direttamente la rimanenza già calcolata</div>
                <Row><Fld label="Scommesse (€)" val={today.toto} set={v=>upd("toto",v)}/><Fld label="Virtual (€)" val={today.virtual} set={v=>upd("virtual",v)}/></Row>
                <Row><Fld label="LIS (€)" val={today.lis} set={v=>upd("lis",v)}/><Fld label="SISAL (€)" val={today.sisal} set={v=>upd("sisal",v)}/><Fld label="Valori Bollati (€)" val={today.valori} set={v=>upd("valori",v)}/></Row>
              </Block>
            </>}

            {/* ── SLOT ── */}
            {tab==="slot"&&<>
              <Block title="Slot Machine" accent="#e879f9">
                <Row>
                  <Fld label="Raccolto (€)" val={today.slot_raccolto} set={v=>upd("slot_raccolto",v)}/>
                  <Fld label="Monete Slot (€)" val={today.slot_monete} set={v=>upd("slot_monete",v)}/>
                  <Fld label="Refill versato (€)" val={today.slot_refill} set={v=>upd("slot_refill",v)}/>
                </Row>
                <Row>
                  <Calc label="Raccolto+Monete (+mov.)" val={n(today.slot_raccolto)+n(today.slot_monete)} color="#4ade80"/>
                  <Calc label="Refill (−mov.)" val={n(today.slot_refill)} color="#f87171"/>
                  <Calc label="Netto Slot" val={n(today.slot_raccolto)+n(today.slot_monete)-n(today.slot_refill)} color="#e879f9"/>
                </Row>
                <div style={{marginTop:4}}>
                  <Lbl c="Note Slot — solo annotazione, non incide sui conti"/>
                  <textarea value={today.slot_note||""} onChange={e=>upd("slot_note",e.target.value)}
                    placeholder="es. Slot 1: €200 ore 15:30, Slot 3: €150 ore 18:00..."
                    style={{width:"100%",background:"#080e1c",color:"#e2e8f0",border:"1px solid #1e293b",borderRadius:7,padding:10,fontSize:13,minHeight:80,boxSizing:"border-box",resize:"vertical",fontFamily:"inherit"}}/>
                </div>
              </Block>
            </>}

            {/* ── CASSA ── */}
            {tab==="cassa"&&<>
              <div style={{background:"#0f1923",borderRadius:10,padding:12,marginBottom:14,borderLeft:"4px solid #475569"}}>
                <div style={{fontSize:10,color:"#475569",fontWeight:800,letterSpacing:1,marginBottom:6}}>LOGICA PF / MONETE / DEBITI</div>
                <div style={{fontSize:11,color:"#64748b",lineHeight:1.7}}>
                  <b style={{color:"#e2e8f0"}}>Oggi</b> = valore lasciato ieri (precompilato automaticamente) → si <b style={{color:"#4ade80"}}>somma</b><br/>
                  <b style={{color:"#e2e8f0"}}>Domani</b> = quanto lasci stasera → si <b style={{color:"#f87171"}}>sottrae</b> e viene copiato automaticamente come "Oggi" di domani
                </div>
              </div>
              {[
                {title:"Fondo Cassa (PF)",accent:"#60a5fa",fOggi:"pf_oggi",fDom:"pf_domani",diff:calc.pf_diff},
                {title:"Monete Extra",accent:"#fbbf24",fOggi:"monete_oggi",fDom:"monete_domani",diff:calc.monete_diff},
                {title:"Debiti Clienti",accent:"#f87171",fOggi:"debiti_oggi",fDom:"debiti_domani",diff:calc.debiti_diff},
              ].map(c=>(
                <Block key={c.title} title={c.title} accent={c.accent}>
                  <Row>
                    <Fld label="Oggi (modificabile)" val={today[c.fOggi]} set={v=>upd(c.fOggi,v)}/>
                    <Fld label="Domani (lascio stasera)" val={today[c.fDom]} set={v=>upd(c.fDom,v)}/>
                    <Calc label="Impatto movimento" val={c.diff} color={c.diff>=0?"#4ade80":"#f87171"}/>
                  </Row>
                  <div style={{fontSize:10,color:"#475569",marginBottom:6}}>
                    ↑ "Oggi" è precompilato da ieri ma puoi modificarlo manualmente se necessario
                  </div>
                </Block>
              ))}
            </>}

            {/* ── SPESE ── */}
            {tab==="spese"&&<>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
                <Stat label="Contanti (−mov.)" val={eur(calc.spese_cont)} accent="#f87171"/>
                <Stat label="Elettronico (−guad.)" val={eur(calc.spese_ele)} accent="#fb923c"/>
                <Stat label="Totale spese" val={eur(calc.spese_cont+calc.spese_ele)} accent="#f87171" big/>
              </div>
              {(today.spese||[]).map((sp,i)=>(
                <div key={i} style={{background:"#0f1923",borderRadius:12,borderLeft:"4px solid #f87171",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontSize:10,color:"#f87171",fontWeight:800,letterSpacing:1}}>SPESA #{i+1}</span>
                    <button onClick={()=>delSpesa(i)} style={{background:"#450a0a",color:"#f87171",border:"none",borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                  </div>
                  <Row>
                    <div style={{flex:"2 1 160px"}}><Lbl c="Fornitore / Dove"/><Inp val={sp.dove} set={v=>updSpesa(i,"dove",v)} type="text" ph="es. LEKKERLAND, AFFITTO..."/></div>
                    <div style={{flex:"1 1 110px"}}>
                      <Lbl c="Tipo"/>
                      <select value={sp.tipo} onChange={e=>updSpesa(i,"tipo",e.target.value)}
                        style={{width:"100%",background:"#080e1c",color:"#e2e8f0",border:"1px solid #1e293b",padding:"9px 10px",borderRadius:7,fontSize:13,fontFamily:"inherit"}}>
                        <option value="merce">🛒 Merce</option>
                        <option value="fisso">🏢 Costo Fisso</option>
                      </select>
                    </div>
                  </Row>
                  <Row>
                    <Fld label="Contante (€) — toglie da mov." val={sp.contante} set={v=>updSpesa(i,"contante",v)}/>
                    <Fld label="Elettronico (€) — solo guad." val={sp.elettronico} set={v=>updSpesa(i,"elettronico",v)}/>
                  </Row>
                  <div><Lbl c="Dettaglio / Nota"/><Inp val={sp.nota} set={v=>updSpesa(i,"nota",v)} type="text" ph="es. SDM 230€, GALBANI 49€..."/></div>
                </div>
              ))}
              <button onClick={addSpesa} style={{width:"100%",background:"#1a0a0a",color:"#f87171",border:"1px dashed #7f1d1d",borderRadius:10,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Aggiungi Spesa</button>
            </>}

            {/* ── VERSAMENTI ── */}
            {tab==="versamenti"&&<>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
                <Stat label="Mov. accumulato (fino ad oggi)" val={eur(cassaOggi)} accent="#60a5fa" big/>
                <Stat label="Totale versato" val={eur(totVersati)} accent="#f87171"/>
                <Stat label="Cassa residua" val={eur(cassaOggi)} accent={cassaOggi>=0?"#4ade80":"#f87171"} big/>
              </div>
              <div style={{background:"#0f1923",borderRadius:10,padding:12,marginBottom:14,borderLeft:"4px solid #60a5fa"}}>
                <div style={{fontSize:10,color:"#475569",fontWeight:800,letterSpacing:1,marginBottom:4}}>COME FUNZIONA</div>
                <div style={{fontSize:11,color:"#64748b",lineHeight:1.7}}>
                  La cassa accumula i movimenti giornalieri dal mese precedente.<br/>
                  Ogni versamento in banca/cassa si <b style={{color:"#f87171"}}>sottrae</b> dal totale accumulato.<br/>
                  Il residuo si porta automaticamente al mese successivo.
                </div>
              </div>
              {versamenti.map((v,i)=>(
                <div key={i} style={{background:"#0f1923",borderRadius:12,borderLeft:"4px solid #60a5fa",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontSize:10,color:"#60a5fa",fontWeight:800,letterSpacing:1}}>VERSAMENTO #{i+1}</span>
                    <button onClick={()=>delVersamento(i)} style={{background:"#0a1a2a",color:"#60a5fa",border:"none",borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                  </div>
                  <Row>
                    <Fld label="Importo versato (€)" val={v.importo} set={val=>updVersamento(i,"importo",val)}/>
                    <Fld label="Data" val={v.data} set={val=>updVersamento(i,"data",val)} type="text" flex="1 1 130px"/>
                  </Row>
                  <div><Lbl c="Note (es. versamento BCC, bonifico...)"/><Inp val={v.nota} set={val=>updVersamento(i,"nota",val)} type="text" ph="es. Versamento BCC €5000 — sportello"/></div>
                </div>
              ))}
              <button onClick={addVersamento} style={{width:"100%",background:"#0a1a2a",color:"#60a5fa",border:"1px dashed #1e3a5f",borderRadius:10,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Aggiungi Versamento</button>
            </>}

            {/* ── AGGI ── */}
            {tab==="aggi"&&<>
              <div style={{fontSize:11,color:"#475569",marginBottom:14,lineHeight:1.6}}>Aggi di <b style={{color:"#e2e8f0"}}>{MONTHS[month]} {year}</b> — aggiungi una riga per ogni accredito ricevuto.</div>
              {[
                {title:"Aggi Bar",accent:"#4ade80",voci:AGGI_BAR_VOCI,totale:totAggiBar,rowColor:"#a3e635"},
                {title:"Aggi Tabacchi",accent:"#fb923c",voci:AGGI_TAB_VOCI,totale:totAggiTab,rowColor:"#fdba74"},
              ].map(gruppo=>(
                <Block key={gruppo.title} title={gruppo.title} accent={gruppo.accent}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                    <span style={{fontSize:11,color:"#64748b"}}>Totale</span>
                    <span style={{fontSize:16,fontWeight:800,color:gruppo.accent}}>{eur(gruppo.totale)}</span>
                  </div>
                  {gruppo.voci.map(voce=>(
                    <div key={voce} style={{marginBottom:14}}>
                      <div style={{fontSize:11,fontWeight:800,color:gruppo.rowColor,marginBottom:6}}>
                        {aggiLabel(voce)} <span style={{color:gruppo.accent,fontWeight:400,marginLeft:6}}>{eur(totAggio(voce))}</span>
                      </div>
                      {(aggi[voce]||[emptyAggio()]).map((ag,i)=>(
                        <div key={i} style={{display:"flex",gap:8,alignItems:"flex-end",marginBottom:6}}>
                          <div style={{flex:"1 1 90px"}}>{i===0&&<Lbl c="Importo (€)"/>}<Inp val={ag.importo} set={v=>updAggio(voce,i,"importo",v)}/></div>
                          <div style={{flex:"2 1 150px"}}>{i===0&&<Lbl c="Periodo"/>}<Inp val={ag.periodo} set={v=>updAggio(voce,i,"periodo",v)} type="text" ph="es. 01/09 - 07/09"/></div>
                          <button onClick={()=>delAggio(voce,i)} style={{background:"#111",color:"#475569",border:"1px solid #1e293b",borderRadius:6,padding:"9px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>✕</button>
                        </div>
                      ))}
                      <button onClick={()=>addAggio(voce)} style={{background:"transparent",color:gruppo.accent,border:`1px dashed ${gruppo.accent}44`,borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ accredito</button>
                    </div>
                  ))}
                </Block>
              ))}
            </>}


            {/* ── PERSONALE ── */}
            {tab==="personale"&&<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:12,color:"#475569"}}>{MONTHS[month]} {year}</div>
                <button onClick={addDipendente} style={{background:"#0a1a2a",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Dipendente</button>
              </div>

              {(personale.dipendenti||[]).length === 0 && (
                <div style={{textAlign:"center",color:"#475569",padding:40,fontSize:13}}>Nessun dipendente. Clicca "+ Dipendente" per iniziare.</div>
              )}

              {/* ANAGRAFICA DIPENDENTI */}
              {(personale.dipendenti||[]).map((dip,i)=>{
                const mens = calcMensile(i);
                const tariffa = n(dip.stipendio) / (n(dip.ore_mensili)||1);
                return (
                  <Block key={i} title={dip.nome||`Dipendente #${i+1}`} accent="#60a5fa">
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                      <span style={{fontSize:10,color:"#60a5fa",fontWeight:800,letterSpacing:1}}>DATI CONTRATTUALI</span>
                      <button onClick={()=>delDipendente(i)} style={{background:"#0a1a2a",color:"#f87171",border:"none",borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                    </div>
                    <Row>
                      <Fld label="Nome" val={dip.nome} set={v=>updDipendente(i,"nome",v)} type="text" flex="2 1 140px"/>
                      <Fld label="Stipendio base (€)" val={dip.stipendio} set={v=>updDipendente(i,"stipendio",v)}/>
                      <Fld label="Ore mensili contratto" val={dip.ore_mensili} set={v=>updDipendente(i,"ore_mensili",v)}/>
                    </Row>
                    <div style={{fontSize:11,color:"#64748b",marginBottom:12}}>
                      Tariffa oraria: <b style={{color:"#60a5fa"}}>{eur(tariffa)}/ora</b>
                    </div>

                    {/* RIEPILOGO MESE */}
                    <div style={{background:"#080e1c",borderRadius:8,padding:12,marginBottom:12}}>
                      <div style={{fontSize:10,color:"#475569",fontWeight:800,letterSpacing:1,marginBottom:8}}>RIEPILOGO {MONTHS[month].toUpperCase()}</div>
                      <RRow label="Ore lavorate" val={mens.ore.toFixed(1)+"h"} color="#4ade80"/>
                      <RRow label="Paga ordinaria" val={eur(mens.paga)} color="#4ade80"/>
                      <RRow label="Straordinari (manuale)" val={eur(mens.straordinari)} color="#fbbf24"/>
                      <RRow label="− Anticipi" val={eur(-mens.anticipi)} color="#f87171"/>
                      <RRow label="TOTALE DA PAGARE" val={eur(mens.totale)} color={mens.totale>=0?"#60a5fa":"#f87171"} bold/>
                    </div>

                    {/* PRESENZE GIORNALIERE */}
                    <div style={{fontSize:10,color:"#475569",fontWeight:800,letterSpacing:1,marginBottom:8}}>PRESENZE GIORNALIERE</div>
                    {Array.from({length:new Date(year,month+1,0).getDate()},(_,gi)=>{
                      const d = gi+1;
                      const p = getPresenza(i,d);
                      const ore = calcOre(p.entrata, p.uscita);
                      return (
                        <div key={d} style={{background:"#080e1c",borderRadius:8,padding:10,marginBottom:8,borderLeft:`3px solid ${TIPO_COLOR[p.tipo]||"#1e293b"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <span style={{fontSize:12,fontWeight:800,color:"#e2e8f0"}}>{d} {MONTHS[month]}</span>
                            <select value={p.tipo} onChange={e=>updPresenza(i,d,"tipo",e.target.value)}
                              style={{background:"#0f1923",color:TIPO_COLOR[p.tipo]||"#e2e8f0",border:"1px solid #1e293b",padding:"4px 8px",borderRadius:6,fontSize:11,fontFamily:"inherit",fontWeight:700}}>
                              {Object.entries(TIPO_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          {p.tipo==="lavoro"&&<>
                            <Row mb={6}>
                              <div style={{flex:1}}><Lbl c="Entrata"/><Inp val={p.entrata} set={v=>updPresenza(i,d,"entrata",v)} type="text" ph="08:00"/></div>
                              <div style={{flex:1}}><Lbl c="Uscita"/><Inp val={p.uscita} set={v=>updPresenza(i,d,"uscita",v)} type="text" ph="16:00"/></div>
                              <div style={{flex:1}}><Lbl c="Ore"/><div style={{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:7,padding:"9px 10px",fontSize:14,fontWeight:700,color:"#4ade80"}}>{ore.toFixed(1)}h</div></div>
                            </Row>
                            <Row mb={6}>
                              <Fld label="Straordinari (€)" val={p.straordinari} set={v=>updPresenza(i,d,"straordinari",v)}/>
                              <Fld label="Anticipo (€)" val={p.anticipo} set={v=>updPresenza(i,d,"anticipo",v)}/>
                            </Row>
                          </>}
                          {p.tipo!=="lavoro"&&<>
                            <Row mb={6}>
                              <Fld label="Straordinari (€)" val={p.straordinari} set={v=>updPresenza(i,d,"straordinari",v)}/>
                              <Fld label="Anticipo (€)" val={p.anticipo} set={v=>updPresenza(i,d,"anticipo",v)}/>
                            </Row>
                          </>}
                          <div><Lbl c="Note"/><Inp val={p.nota} set={v=>updPresenza(i,d,"nota",v)} type="text" ph="Note..."/></div>
                        </div>
                      );
                    })}
                  </Block>
                );
              })}
            </>}

            {/* ── RIEPILOGO ── */}
            {tab==="riepilogo"&&<>
              <div style={{fontSize:11,color:"#475569",marginBottom:14,letterSpacing:1}}>GIORNO {day} — {MONTHS[month].toUpperCase()} {year}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
                <Stat label="Movimento oggi" val={eur(calc.movimento)} accent="#4ade80" big/>
                <Stat label="Guadagno oggi" val={eur(calc.guadagno)} accent={calc.guadagno>=0?"#60a5fa":"#f87171"} big/>
                <Stat label="Cassa accumulata" val={eur(cassaOggi)} accent={cassaOggi>=0?"#a78bfa":"#f87171"} big/>
              </div>

              <Block title="Dettaglio Movimento Contante" accent="#4ade80">
                {[
                  ["Bar", n(today.bar), "#4ade80"],
                  ["Ristorante", n(today.risto), "#4ade80"],
                  ["Tabacchi rimasti", calc.tab_rim, "#fbbf24"],
                  ["Articoli Tabacchi", n(today.art_tabacchi), "#a3e635"],
                  ["Gratta rimasti", calc.gratta_rim, "#facc15"],
                  ["Lotto rimasti", calc.lotto_rim, "#f97316"],
                  ["Scommesse", n(today.toto), "#34d399"],
                  ["Virtual", n(today.virtual), "#60a5fa"],
                  ["LIS", n(today.lis), "#c084fc"],
                  ["SISAL", n(today.sisal), "#c084fc"],
                  ["Valori Bollati", n(today.valori), "#c084fc"],
                  ["Distributore", n(today.dist_prelievo), "#f97316"],
                  ["Slot raccolto", n(today.slot_raccolto), "#e879f9"],
                  ["Slot monete", n(today.slot_monete), "#e879f9"],
                  ["− Slot refill", -n(today.slot_refill), "#f87171"],
                  ["PF (oggi−domani)", calc.pf_diff, calc.pf_diff>=0?"#4ade80":"#f87171"],
                  ["Monete (oggi−domani)", calc.monete_diff, calc.monete_diff>=0?"#4ade80":"#f87171"],
                  ["Debiti (oggi−domani)", calc.debiti_diff, calc.debiti_diff>=0?"#4ade80":"#f87171"],
                  ["− Spese contanti", -calc.spese_cont, "#f87171"],
                  ["± Arrotondamento", n(today.arrotondamento), "#94a3b8"],
                ].filter(([,v])=>v!==0).map(([l,v,c])=><RRow key={l} label={l} val={eur(v,true)} color={c}/>)}
                <RRow label="TOTALE MOVIMENTO" val={eur(calc.movimento)} color="#4ade80" bold/>
              </Block>

              <Block title="Dettaglio Guadagno" accent="#60a5fa">
                {[
                  ["Bar", n(today.bar), "#4ade80"],
                  ["Ristorante", n(today.risto), "#4ade80"],
                  ["POS Bar", n(today.pos_bar), "#a78bfa"],
                  ["Articoli Tabacchi", n(today.art_tabacchi), "#a3e635"],
                  ["− Spese contanti", -calc.spese_cont, "#f87171"],
                  ["− Spese elettronico", -calc.spese_ele, "#fb923c"],
                ].filter(([,v])=>v!==0).map(([l,v,c])=><RRow key={l} label={l} val={eur(v,true)} color={c}/>)}
                <RRow label="GUADAGNO GIORNO" val={eur(calc.guadagno)} color={calc.guadagno>=0?"#60a5fa":"#f87171"} bold/>
              </Block>

              <Block title={"Aggi — "+MONTHS[month]+" "+year} accent="#fbbf24">
                <RRow label="Aggi Bar" val={eur(totAggiBar)} color="#4ade80"/>
                <RRow label="Aggi Tabacchi" val={eur(totAggiTab)} color="#fb923c"/>
                <RRow label="Totale Aggi" val={eur(totAggi)} color="#fbbf24"/>
                <div style={{height:8}}/>
                <RRow label="Guadagno mese (senza aggi)" val={eur(mGuadagno)} color="#60a5fa"/>
                <RRow label="GUADAGNO MESE + AGGI" val={eur(mGuadagno+totAggi)} color={mGuadagno+totAggi>=0?"#4ade80":"#f87171"} bold/>
              </Block>

              <Block title="Cassa Accumulata" accent="#a78bfa">
                <RRow label="Residuo mese precedente" val={eur(residuoPrecedente)} color="#64748b"/>
                <RRow label="Movimenti mese corrente" val={eur(movMensile)} color="#4ade80"/>
                <RRow label="− Totale versato" val={eur(-totVersati)} color="#f87171"/>
                <RRow label="CASSA ATTUALE" val={eur(cassaAccumulata)} color={cassaAccumulata>=0?"#a78bfa":"#f87171"} bold/>
              </Block>

              <button onClick={()=>window.print()} style={{width:"100%",background:"#0f1923",color:"#64748b",border:"1px solid #1e293b",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>🖨️ Stampa / Salva PDF</button>

              <button onClick={()=>{
                const blob = new Blob([JSON.stringify(all, null, 2)], {type:"application/json"});
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `cassa-pro-backup-${year}.json`;
                a.click();
              }} style={{width:"100%",background:"#0f1923",color:"#4ade80",border:"1px solid #166534",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8}}>
                💾 Backup completo (JSON)
              </button>

              <button onClick={()=>{
                const headers = ["Giorno","Bar","Risto","POS Bar","Tab Venduto","Tab POS","Tab Rimasti","Gratta Venduto","Gratta Pagati","Gratta Rimasti","Lotto Venduto","Lotto Pagati","Lotto Rimasti","Scommesse","Virtual","LIS","SISAL","Valori","Dist. Prelievo","Slot Raccolto","Slot Monete","Slot Refill","PF Oggi","PF Domani","Monete Oggi","Monete Domani","Debiti Oggi","Debiti Domani","Arrotondamento","Spese Contanti","Spese Elettronico","Movimento","Guadagno"];
                const rows = Array.from({length:dim(year,month)},(_,i)=>{
                  const d = all[dk(year,month,i+1)] || emptyDay();
                  const c = calcDay(d);
                  return [i+1,n(d.bar),n(d.risto),n(d.pos_bar),n(d.tab_venduto),n(d.tab_pos),c.tab_rim,n(d.gratta_venduto),n(d.gratta_pagati),c.gratta_rim,n(d.lotto_venduto),n(d.lotto_pagati),c.lotto_rim,n(d.toto),n(d.virtual),n(d.lis),n(d.sisal),n(d.valori),n(d.dist_prelievo),n(d.slot_raccolto),n(d.slot_monete),n(d.slot_refill),n(d.pf_oggi),n(d.pf_domani),n(d.monete_oggi),n(d.monete_domani),n(d.debiti_oggi),n(d.debiti_domani),n(d.arrotondamento),c.spese_cont,c.spese_ele,c.movimento,c.guadagno].join(";");
                });
                const aggiBar = AGGI_BAR_VOCI.map(v=>aggiLabel(v)+": "+totAggio(v).toFixed(2)).join(" | ");
                const aggiTab = AGGI_TAB_VOCI.map(v=>aggiLabel(v)+": "+totAggio(v).toFixed(2)).join(" | ");
                const summary = ["","RIEPILOGO "+MONTHS[month].toUpperCase()+" "+year,"Movimento mese;"+movMensile.toFixed(2),"Guadagno mese;"+mGuadagno.toFixed(2),"Aggi Bar;"+totAggiBar.toFixed(2),"Aggi Tabacchi;"+totAggiTab.toFixed(2),"Guadagno + Aggi;"+(mGuadagno+totAggi).toFixed(2),"Cassa accumulata;"+cassaAccumulata.toFixed(2),"Versato;"+totVersati.toFixed(2),"","Aggi Bar dettaglio;"+aggiBar,"Aggi Tab dettaglio;"+aggiTab].join("\n");
                const csv = [headers.join(";"), ...rows, summary].join("\n");
                const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8"});
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "cassa-pro-"+MONTHS[month]+"-"+year+".csv";
                a.click();
              }} style={{width:"100%",background:"#0f1923",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8}}>
                📊 Esporta Excel/CSV ({MONTHS[month]} {year})
              </button>

              <label style={{display:"block",width:"100%",background:"#0f1923",color:"#a78bfa",border:"1px solid #3b0764",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8,textAlign:"center",boxSizing:"border-box"}}>
                📂 Ripristina da backup (JSON)
                <input type="file" accept=".json" style={{display:"none"}} onChange={e=>{
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const imported = JSON.parse(ev.target.result);
                      setAll(imported);
                      persist(imported);
                      alert("Backup ripristinato con successo!");
                    } catch { alert("File non valido"); }
                  };
                  reader.readAsText(file);
                }}/>
              </label>
            </>}

          </div>
        </>
      )}
    </div>
  );
}
