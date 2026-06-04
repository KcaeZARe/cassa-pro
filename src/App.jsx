import { useState, useEffect, useRef } from "react";

// ── PIN SYSTEM v2 — ADMIN + DIPENDENTE ─────────────────────
const ADMIN_PIN_KEY    = "cassapro_pin_admin_hash";
const DIP_PIN_KEY      = "cassapro_pin_dip_hash"; // legacy, non più usato
const DIP_PIN_PREFIX   = "cassapro_dip_pin_"; // cassapro_dip_pin_0, _1, ecc.
const RECOVERY_KEY     = "cassapro_recovery_hash";
const SESSION_KEY      = "cassapro_session_v2";
const ATTEMPTS_KEY     = "cassapro_attempts_v2";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 60 * 1000;

// hash SHA-256
const sha256 = async (str) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
};
const hashPIN      = (pin)  => sha256(pin  + "cassapro_pin_salt_v2");
const hashRecovery = (code) => sha256(code + "cassapro_rec_salt_v2");

// genera codice recovery 24 caratteri leggibile
const genRecoveryCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 24; i++) {
    if (i > 0 && i % 6 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // es. ABCD23-EFGH45-IJKL67-MNPQ89
};

// storage helpers
const getAdminHash    = () => localStorage.getItem(ADMIN_PIN_KEY);
const getRecoveryHash = () => localStorage.getItem(RECOVERY_KEY);
const hasAdminPIN     = () => !!getAdminHash();

// PIN per singolo dipendente (per indice)
const getDipIdxPINKey  = (idx) => `${DIP_PIN_PREFIX}${idx}`;
const setDipIdxPIN     = async (idx, pin) => localStorage.setItem(getDipIdxPINKey(idx), await hashPIN(pin));
const removeDipIdxPIN  = (idx) => localStorage.removeItem(getDipIdxPINKey(idx));
const getDipIdxHash    = (idx) => localStorage.getItem(getDipIdxPINKey(idx));
const hasDipIdxPIN     = (idx) => !!getDipIdxHash(idx);
const anyDipPIN        = (count) => Array.from({length:count},(_,i)=>i).some(i=>hasDipIdxPIN(i));
// Trova quale dipendente corrisponde al PIN — ritorna indice o -1
const matchDipPIN = async (pin, count) => {
  const hash = await hashPIN(pin);
  for (let i = 0; i < count; i++) {
    if (getDipIdxHash(i) === hash) return i;
  }
  return -1;
};

const setAdminPIN = async (pin, recoveryCode) => {
  localStorage.setItem(ADMIN_PIN_KEY, await hashPIN(pin));
  localStorage.setItem(RECOVERY_KEY,  await hashRecovery(recoveryCode));
};
const removeAdminPIN = () => {
  localStorage.removeItem(ADMIN_PIN_KEY);
  localStorage.removeItem(RECOVERY_KEY);
};

// sessione: role = "admin" | "dipendente" | null, dipIdx per dipendente
const getSession = () => {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!s) return null;
    const maxAge = s.role === "admin" ? 8*60*60*1000 : 12*60*60*1000;
    if (Date.now() - s.ts > maxAge) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
};
const setSession = (role, dipIdx=null) => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role, dipIdx, ts: Date.now() }));
const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

// tentativi per ruolo
const getAttempts = (role) => {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY+"_"+role) || '{"count":0,"ts":0}'); }
  catch { return { count:0, ts:0 }; }
};
const setAttempts = (role, obj) => localStorage.setItem(ATTEMPTS_KEY+"_"+role, JSON.stringify(obj));
const resetAttempts = (role) => localStorage.removeItem(ATTEMPTS_KEY+"_"+role);

// ── Componente schermata PIN ────────────────────────────────
function PINScreen({ mode, role, onSuccess, onCancel, onSwitchRole, onMatchDip, onSuccessDip, dipIdx, noDipPin }) {
  /*
    mode:  "choose_role" | "unlock" | "setup_admin" | "change_admin"
           "setup_dip" | "change_dip" | "recovery"
    role:  "admin" | "dipendente"
  */
  const LEN = 6; // sempre 6 cifre per tutti — admin e dipendenti
  const emptyDigits = () => Array(LEN).fill("");

  const [digits,  setDigits]  = useState(emptyDigits);
  const [confirm, setConfirm] = useState(emptyDigits);
  const [step,    setStep]    = useState("enter"); // "enter" | "confirm" | "show_recovery"
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [error,   setError]   = useState("");
  const [lockout, setLockout] = useState(0);
  const [showReset, setShowReset] = useState(false);
  const refs        = useRef([]);
  const confirmRefs = useRef([]);

  useEffect(() => {
    if (mode === "unlock") {
      const r = role || "admin";
      const a = getAttempts(r);
      if (a.count >= MAX_ATTEMPTS) {
        const rem = Math.ceil((a.ts + LOCKOUT_MS - Date.now()) / 1000);
        if (rem > 0) setLockout(rem); else resetAttempts(r);
      }
    }
  }, [mode, role]);

  useEffect(() => {
    if (lockout <= 0) return;
    const t = setInterval(() => setLockout(s => {
      if (s <= 1) { resetAttempts(role||"admin"); clearInterval(t); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [lockout]);

  useEffect(() => { setTimeout(() => refs.current[0]?.focus(), 80); }, [mode, step]);

  const handleDigit = (arr, setArr, arrRefs, len, idx, val) => {
    const clean = val.replace(/\D/g,"").slice(-1);
    const next = [...arr]; next[idx] = clean; setArr(next);
    if (clean && idx < len-1) setTimeout(() => arrRefs.current[idx+1]?.focus(), 10);
    if (!clean && idx > 0)    setTimeout(() => arrRefs.current[idx-1]?.focus(), 10);
  };
  const handleKey = (arr, setArr, arrRefs, idx, e) => {
    if (e.key === "Backspace" && !arr[idx] && idx > 0) {
      const next=[...arr]; next[idx-1]=""; setArr(next);
      setTimeout(() => arrRefs.current[idx-1]?.focus(), 10);
    }
  };

  const pin        = digits.join("");
  const confirmPin = confirm.join("");
  const isSetup    = mode.startsWith("setup") || mode.startsWith("change");

  const handleSubmit = async () => {
    setError("");
    const r = role || "admin";

    // ── UNLOCK ──
    if (mode === "unlock") {
      if (r === "dipendente" && onMatchDip) {
        const idx = await onMatchDip(pin);
        if (idx >= 0) {
          resetAttempts(r);
          if (onSuccessDip) onSuccessDip(idx);
          else onSuccess(r, pin);
        } else {
          const a = getAttempts(r);
          const newCount = (a.count||0) + 1;
          setAttempts(r, { count: newCount, ts: Date.now() });
          if (newCount >= MAX_ATTEMPTS) {
            setLockout(Math.ceil(LOCKOUT_MS/1000));
            setError("Troppi tentativi — bloccato 60s");
          } else {
            setError(`PIN errato. Tentativi rimasti: ${MAX_ATTEMPTS - newCount}`);
          }
          setDigits(emptyDigits());
          setTimeout(() => refs.current[0]?.focus(), 50);
        }
        return;
      }
      const expected = getAdminHash();
      const hash = await hashPIN(pin);
      if (hash === expected) {
        resetAttempts(r); setSession(r); onSuccess(r);
      } else {
        const a = getAttempts(r);
        const newCount = (a.count||0) + 1;
        setAttempts(r, { count: newCount, ts: Date.now() });
        if (newCount >= MAX_ATTEMPTS) {
          setLockout(Math.ceil(LOCKOUT_MS/1000));
          setError("Troppi tentativi — bloccato 60s");
        } else {
          setError(`PIN errato. Tentativi rimasti: ${MAX_ATTEMPTS - newCount}`);
        }
        setDigits(emptyDigits());
        setTimeout(() => refs.current[0]?.focus(), 50);
      }
      return;
    }

    // ── RECOVERY ──
    if (mode === "recovery") {
      const clean = recoveryInput.replace(/-/g,"").toUpperCase();
      const hash = await hashRecovery(clean.length === 24 ? clean.match(/.{6}/g).join("-") : recoveryInput.toUpperCase());
      // prova entrambi i formati
      const h1 = await hashRecovery(recoveryInput.toUpperCase().trim());
      const h2 = await hashRecovery(recoveryInput.toUpperCase().trim().replace(/[^A-Z0-9]/g,"").match(/.{1,6}/g)?.join("-")||"");
      if (h1 === getRecoveryHash() || h2 === getRecoveryHash()) {
        removeAdminPIN(); onSuccess("recovery");
      } else {
        setError("Codice non valido. Controlla e riprova.");
      }
      return;
    }

    // ── SETUP / CHANGE ──
    if (step === "enter") {
      if (mode === "setup_admin" || mode === "change_admin") {
        const code = genRecoveryCode();
        setRecoveryCode(code);
        setStep("confirm");
        setConfirm(emptyDigits());
        setTimeout(() => confirmRefs.current[0]?.focus(), 50);
      } else {
        setStep("confirm");
        setConfirm(emptyDigits());
        setTimeout(() => confirmRefs.current[0]?.focus(), 50);
      }
    } else if (step === "confirm") {
      if (pin !== confirmPin) {
        setError("I PIN non coincidono. Riprova.");
        setStep("enter"); setDigits(emptyDigits()); setConfirm(emptyDigits());
        setTimeout(() => refs.current[0]?.focus(), 50);
        return;
      }
      if (mode === "setup_admin" || mode === "change_admin") {
        await setAdminPIN(pin, recoveryCode.replace(/-/g,""));
        setStep("show_recovery");
      } else {
        // Per tutti gli altri modi (setup_dip_idx, change_dip_idx ecc.)
        // passa il pin grezzo a onSuccess così App può salvarlo
        onSuccess("saved", pin);
      }
    }
  };

  // ── RENDER ──
  const DOT_ON  = role === "dipendente" ? "#60a5fa" : "#4ade80";
  const DOT_OFF = "#1e293b";

  const renderDots = (arr) => (
    <div style={{display:"flex",gap:12,justifyContent:"center",margin:"18px 0"}}>
      {arr.map((d,i) => <div key={i} style={{width:14,height:14,borderRadius:"50%",
        background:d?DOT_ON:DOT_OFF, border:`2px solid ${d?DOT_ON:"#334155"}`,transition:"background 0.1s"}}/>)}
    </div>
  );

  const renderInputs = (arr, setArr, arrRefs, active) => (
    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:8}}>
      {arr.map((d,i) => (
        <input key={i} ref={el=>arrRefs.current[i]=el}
          type="password" inputMode="numeric" maxLength={1} value={d}
          disabled={!active||lockout>0}
          onChange={e=>handleDigit(arr,setArr,arrRefs,arr.length,i,e.target.value)}
          onKeyDown={e=>handleKey(arr,setArr,arrRefs,i,e)}
          onFocus={e=>e.target.select()}
          style={{width:44,height:54,textAlign:"center",fontSize:22,fontWeight:700,
            background:"#080e1c",color:"#e2e8f0",
            border:`2px solid ${d?DOT_ON:"#1e293b"}`,
            borderRadius:10,outline:"none",caretColor:"transparent",
            fontFamily:"inherit",transition:"border 0.15s",opacity:active?1:0.4}}/>
      ))}
    </div>
  );

  // ── SCHERMATA SCELTA RUOLO ──
  if (mode === "choose_role") {
    return (
      <div style={{minHeight:"100vh",background:"#05090f",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono','Courier New',monospace",padding:24}}>
        <div style={{background:"#0d1526",borderRadius:20,padding:"36px 28px",maxWidth:380,width:"100%",
          border:"1px solid #1e293b",boxShadow:"0 0 60px #4ade8011"}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:3,color:"#f8fafc",
              fontFamily:"Georgia,'Times New Roman',serif",marginBottom:2}}>La Lanterna</div>
            <div style={{fontSize:9,color:"#334155",letterSpacing:4}}>CASSA PRO</div>
            <div style={{fontSize:11,color:"#475569",letterSpacing:1,marginTop:8}}>CHI SEI?</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <button onClick={()=>onSuccess("admin")} style={{
              background:"#0a1a0a",color:"#4ade80",border:"2px solid #166534",
              borderRadius:12,padding:"18px 16px",fontSize:14,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
              <div style={{fontSize:20,marginBottom:4}}>👔</div>
              <div>Titolare / Admin</div>
              <div style={{fontSize:11,color:"#4ade8088",fontWeight:400,marginTop:2}}>Accesso completo all'app</div>
            </button>
            <button onClick={()=>onSuccess("dipendente")} style={{
              background:"#0a1020",color:"#60a5fa",border:"2px solid #1e3a5f",
              borderRadius:12,padding:"18px 16px",fontSize:14,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
              <div style={{fontSize:20,marginBottom:4}}>👤</div>
              <div>Dipendente</div>
              <div style={{fontSize:11,color:"#60a5fa88",fontWeight:400,marginTop:2}}>Solo inserimento presenze</div>
            </button>
            {noDipPin&&(
              <div style={{background:"#1a0a00",border:"1px solid #713f12",borderRadius:10,
                padding:"10px 14px",fontSize:12,color:"#f97316",fontWeight:700,textAlign:"center"}}>
                ⚠️ Nessun PIN dipendente impostato.<br/>
                <span style={{fontWeight:400,color:"#94a3b8"}}>Chiedi al titolare di configurarlo.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── SCHERMATA RECOVERY ──
  if (mode === "recovery") {
    return (
      <div style={{minHeight:"100vh",background:"#05090f",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono','Courier New',monospace",padding:24}}>
        <div style={{background:"#0d1526",borderRadius:20,padding:"36px 28px",maxWidth:380,width:"100%",
          border:"1px solid #7c2d12",boxShadow:"0 0 60px #f9731611"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:18,fontWeight:800,letterSpacing:2,color:"#f8fafc",marginBottom:4}}>◈ CASSA PRO</div>
            <div style={{fontSize:14,fontWeight:700,color:"#f97316",marginBottom:8}}>🔑 RECUPERO ACCESSO</div>
            <div style={{fontSize:11,color:"#64748b"}}>Inserisci il codice di emergenza che hai salvato al momento del setup</div>
          </div>
          <input type="text" value={recoveryInput} onChange={e=>setRecoveryInput(e.target.value.toUpperCase())}
            placeholder="es. ABCD23-EFGH45-IJKL67-MNPQ89"
            style={{width:"100%",background:"#080e1c",color:"#f97316",border:"1px solid #7c2d12",
              borderRadius:8,padding:"12px 14px",fontSize:13,fontFamily:"inherit",
              boxSizing:"border-box",letterSpacing:1,marginBottom:8}}/>
          {error&&<div style={{color:"#f87171",fontSize:12,textAlign:"center",marginBottom:8}}>{error}</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={handleSubmit} disabled={recoveryInput.length<10}
              style={{width:"100%",background:"#7c2d12",color:"#fed7aa",border:"1px solid #c2410c",
                borderRadius:10,padding:13,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
                opacity:recoveryInput.length<10?0.5:1}}>
              Reimposta accesso
            </button>
            {onCancel&&<button onClick={onCancel} style={{width:"100%",background:"transparent",color:"#475569",
              border:"1px solid #1e293b",borderRadius:10,padding:11,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              Annulla
            </button>}
          </div>
        </div>
      </div>
    );
  }

  // ── SHOW RECOVERY CODE dopo setup ──
  if (step === "show_recovery") {
    return (
      <div style={{minHeight:"100vh",background:"#05090f",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono','Courier New',monospace",padding:24}}>
        <div style={{background:"#0d1526",borderRadius:20,padding:"36px 28px",maxWidth:380,width:"100%",
          border:"2px solid #f97316",boxShadow:"0 0 60px #f9731622"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:18,fontWeight:800,letterSpacing:2,color:"#f8fafc",marginBottom:4}}>◈ CASSA PRO</div>
            <div style={{fontSize:14,fontWeight:700,color:"#f97316",marginBottom:8}}>🔑 CODICE DI EMERGENZA</div>
            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
              <b style={{color:"#fbbf24"}}>SALVALO ORA</b> — screenshot, notes, carta.<br/>
              Senza questo codice, se dimentichi il PIN admin non puoi più accedere.
            </div>
          </div>
          <div style={{background:"#080e1c",border:"2px dashed #f97316",borderRadius:12,padding:"18px 14px",
            textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:18,fontWeight:800,letterSpacing:3,color:"#fb923c",fontFamily:"monospace"}}>
              {recoveryCode}
            </div>
          </div>
          <button onClick={()=>{ setSession("admin"); onSuccess("admin"); }}
            style={{width:"100%",background:"#14532d",color:"#4ade80",border:"1px solid #166534",
              borderRadius:10,padding:14,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            ✅ L'ho salvato — Entra
          </button>
        </div>
      </div>
    );
  }

  // ── SCHERMATA PIN (unlock / setup / change) ──
  const titleMap = {
    unlock:       role==="dipendente" ? "👤 ACCESSO DIPENDENTE" : "🔐 ACCESSO ADMIN",
    setup_admin:  "⚙️ IMPOSTA PIN ADMIN",
    change_admin: "🔄 CAMBIA PIN ADMIN",
    setup_dip:    "⚙️ IMPOSTA PIN DIPENDENTE",
    change_dip:   "🔄 CAMBIA PIN DIPENDENTE",
  };
  const subMap = {
    unlock:       role==="dipendente" ? "PIN a 6 cifre" : "PIN a 6 cifre",
    setup_admin:  step==="enter" ? "Scegli un PIN a 6 cifre" : "Conferma PIN",
    change_admin: step==="enter" ? "Nuovo PIN a 6 cifre" : "Conferma nuovo PIN",
    setup_dip:    step==="enter" ? "Scegli un PIN a 6 cifre" : "Conferma PIN",
    change_dip:   step==="enter" ? "Nuovo PIN a 6 cifre" : "Conferma nuovo PIN",
  };

  const accentColor = role==="dipendente" ? "#60a5fa" : "#4ade80";
  const borderColor = role==="dipendente" ? "#1e3a5f" : "#166534";
  const bgColor     = role==="dipendente" ? "#0a1020" : "#14532d";

  return (
    <div style={{minHeight:"100vh",background:"#05090f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono','Courier New',monospace",padding:24}}>
      <div style={{background:"#0d1526",borderRadius:20,padding:"36px 32px 28px",maxWidth:380,width:"100%",
        border:`1px solid ${borderColor}`,boxShadow:`0 0 60px ${accentColor}11`}}>

        {/* MODAL RESET EMERGENZA */}
        {showReset&&(
          <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:100,display:"flex",
            alignItems:"center",justifyContent:"center",padding:24}}>
            <div style={{background:"#1a0505",border:"2px solid #f87171",borderRadius:16,padding:24,maxWidth:320,width:"100%"}}>
              <div style={{fontSize:15,fontWeight:800,color:"#f87171",marginBottom:8}}>⚠️ Reset Emergenza</div>
              <div style={{fontSize:12,color:"#94a3b8",marginBottom:20,lineHeight:1.6}}>
                Tutti i PIN verranno rimossi.<br/>
                <b style={{color:"#fbbf24"}}>I dati NON verranno cancellati.</b>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{
                  Object.keys(localStorage)
                    .filter(k=>k.startsWith("cassapro_pin")||k.startsWith("cassapro_dip_pin")||k.startsWith("cassapro_recovery"))
                    .forEach(k=>localStorage.removeItem(k));
                  sessionStorage.clear();
                  window.location.reload();
                }} style={{flex:1,background:"#7f1d1d",color:"#fca5a5",border:"none",borderRadius:8,
                  padding:12,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  Sì, resetta PIN
                </button>
                <button onClick={()=>setShowReset(false)}
                  style={{flex:1,background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:8,
                    padding:12,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annulla
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{textAlign:"center",marginBottom:24}}>
          {/* Logo — tocca 7 volte per reset emergenza */}
          <div onClick={()=>{
              const now = Date.now();
              if (!window._pinTaps) window._pinTaps = [];
              window._pinTaps = window._pinTaps.filter(t=>now-t<3000);
              window._pinTaps.push(now);
              if (window._pinTaps.length >= 7) { window._pinTaps = []; setShowReset(true); }
            }}
            style={{marginBottom:8,cursor:"default",userSelect:"none"}}>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:3,color:"#f8fafc",
              fontFamily:"Georgia,'Times New Roman',serif",textShadow:"0 0 20px #ffffff22"}}>
              La Lanterna
            </div>
            <div style={{fontSize:9,color:"#334155",letterSpacing:4,marginTop:2}}>CASSA PRO</div>
          </div>
          <div style={{fontSize:13,fontWeight:700,color:accentColor,letterSpacing:1.5,marginBottom:6}}>{titleMap[mode]}</div>
          <div style={{fontSize:11,color:"#64748b"}}>{subMap[mode]}</div>
        </div>

        {lockout>0&&<div style={{textAlign:"center",color:"#f87171",fontSize:13,fontWeight:700,marginBottom:12}}>
          🔒 Bloccato — riprova tra {lockout}s
        </div>}

        {step==="enter"
          ? <>{renderDots(digits)}{renderInputs(digits,setDigits,refs,lockout===0)}</>
          : <>{renderDots(confirm)}{renderInputs(confirm,setConfirm,confirmRefs,true)}</>
        }

        {error&&<div style={{color:"#f87171",fontSize:12,textAlign:"center",marginTop:8,marginBottom:4}}>{error}</div>}

        <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:20}}>
          <button onClick={handleSubmit}
            disabled={lockout>0||(step==="enter"?pin.length<LEN:confirmPin.length<LEN)}
            style={{width:"100%",background:bgColor,color:accentColor,border:`1px solid ${borderColor}`,
              borderRadius:10,padding:14,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
              opacity:((step==="enter"?pin.length:confirmPin.length)<LEN||lockout>0)?0.5:1}}>
            {isSetup?(step==="enter"?"Continua →":"✅ Salva PIN"):"Accedi"}
          </button>

          {/* Recovery solo per admin unlock */}
          {mode==="unlock"&&role!=="dipendente"&&getRecoveryHash()&&(
            <button onClick={()=>onCancel("recovery")} style={{width:"100%",background:"transparent",
              color:"#f97316",border:"1px solid #7c2d12",borderRadius:10,padding:11,
              fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              🔑 Ho dimenticato il PIN
            </button>
          )}
          {/* Dipendente: tasto indietro per tornare alla scelta ruolo */}
          {mode==="unlock"&&role==="dipendente"&&(
            <button onClick={()=>onCancel&&onCancel()} style={{width:"100%",background:"transparent",
              color:"#475569",border:"1px solid #1e293b",borderRadius:10,padding:11,
              fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              ← Torna alla scelta ruolo
            </button>
          )}
          {onCancel&&typeof onCancel==="function"&&mode!=="unlock"&&(
            <button onClick={()=>onCancel()} style={{width:"100%",background:"transparent",color:"#475569",
              border:"1px solid #1e293b",borderRadius:10,padding:11,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              Annulla
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── GOOGLE DRIVE SYNC ──────────────────────────────────────
const GDRIVE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GDRIVE_FILE_NAME = "cassa-pro-backup.json";

const gdriveAuth = () => new Promise((resolve, reject) => {
  const client = window.google?.accounts?.oauth2?.initTokenClient({
    client_id: GDRIVE_CLIENT_ID,
    scope: GDRIVE_SCOPE,
    callback: (resp) => resp.error ? reject(resp) : resolve(resp.access_token),
  });
  if (!client) { reject("Google API non caricata"); return; }
  client.requestAccessToken();
});

const gdriveFindFile = async (token) => {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${GDRIVE_FILE_NAME}'&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.files?.[0]?.id || null;
};

const gdriveSave = async (token, dataStr, fileId) => {
  const meta = JSON.stringify({ name: GDRIVE_FILE_NAME, mimeType: "application/json" });
  const body = new FormData();
  body.append("metadata", new Blob([meta], { type: "application/json" }));
  body.append("file", new Blob([dataStr], { type: "application/json" }));
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const method = fileId ? "PATCH" : "POST";
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body });
  return res.json();
};

const gdriveLoad = async (token, fileId) => {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};

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
const pgk = () => "pagamenti_globali";
const emptyPagamento = () => ({ motivo:"", importo:"", data_scadenza:"", pagato:false, data_pagato:"" });

const emptyDipendente = () => ({
 nome:"", stipendio:"", ore_mensili:"", maggiorazione:"25", data_pagamento:"" });
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

// ── EXCEL EXPORT (SheetJS) ─────────────────────────────────
const exportExcel = ({ all, year, month, MONTHS, dim, dk, emptyDay, calcDay, n,
  AGGI_BAR_VOCI, AGGI_TAB_VOCI, aggiLabel, mk, vk, pk, pgk }) => {
  const XLSX = window.XLSX;
  if (!XLSX) { console.error("SheetJS non caricato"); return; }
  const wb = XLSX.utils.book_new();

  // ── Foglio 1: GIORNALIERO ──
  const days = dim(year, month);
  const headers = [
    "Giorno","Data","Bar","Risto","POS Bar",
    "Tab Venduto","Tab POS","Tab Rimasti",
    "Art.Tabacchi",
    "Gratta Venduto","Gratta Pagati","Gratta Rimasti",
    "Lotto Venduto","Lotto Pagati","Lotto Rimasti",
    "Scommesse","Virtual","LIS","SISAL","Valori",
    "Dist. Prelievo",
    "Slot Raccolto","Slot Monete","Slot Refill","Slot Netto",
    "PF Oggi","PF Domani",
    "Monete Oggi","Monete Domani",
    "Debiti Oggi","Debiti Domani",
    "Arrotondamento",
    "Spese Contanti","Spese Elettronico",
    "Movimento","Guadagno"
  ];
  const dayRows = Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    const data = all[dk(year, month, d)] || emptyDay();
    const c = calcDay(data);
    const dateStr = `${String(d).padStart(2,"0")}/${String(month+1).padStart(2,"0")}/${year}`;
    return [
      d, dateStr,
      n(data.bar), n(data.risto), n(data.pos_bar),
      n(data.tab_venduto), n(data.tab_pos), c.tab_rim,
      n(data.art_tabacchi),
      n(data.gratta_venduto), n(data.gratta_pagati), c.gratta_rim,
      n(data.lotto_venduto), n(data.lotto_pagati), c.lotto_rim,
      n(data.toto), n(data.virtual), n(data.lis), n(data.sisal), n(data.valori),
      n(data.dist_prelievo),
      n(data.slot_raccolto), n(data.slot_monete), n(data.slot_refill),
      n(data.slot_raccolto) + n(data.slot_monete) - n(data.slot_refill),
      n(data.pf_oggi), n(data.pf_domani),
      n(data.monete_oggi), n(data.monete_domani),
      n(data.debiti_oggi), n(data.debiti_domani),
      n(data.arrotondamento),
      c.spese_cont, c.spese_ele,
      c.movimento, c.guadagno
    ];
  });
  // riga totali
  const totRow = ["TOTALE", ""];
  for (let col = 2; col < headers.length; col++) {
    totRow.push(dayRows.reduce((s, r) => s + (typeof r[col] === "number" ? r[col] : 0), 0));
  }
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...dayRows, [], totRow]);
  // larghezze colonne
  ws1["!cols"] = headers.map((h, i) => ({ wch: i === 1 ? 12 : i === 0 ? 6 : 11 }));
  XLSX.utils.book_append_sheet(wb, ws1, `${MONTHS[month]} ${year}`);

  // ── Foglio 2: SPESE ──
  const speseHeaders = ["Giorno","Data","Fornitore","Tipo","Contante €","Elettronico €","Nota"];
  const speseRows = [];
  for (let d = 1; d <= days; d++) {
    const data = all[dk(year, month, d)];
    if (!data?.spese?.length) continue;
    const dateStr = `${String(d).padStart(2,"0")}/${String(month+1).padStart(2,"0")}/${year}`;
    data.spese.forEach(sp => {
      speseRows.push([d, dateStr, sp.dove||"", sp.tipo||"", n(sp.contante), n(sp.elettronico), sp.nota||""]);
    });
  }
  const ws2 = XLSX.utils.aoa_to_sheet([speseHeaders, ...speseRows]);
  ws2["!cols"] = [6,12,20,10,12,12,30].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, "Spese");

  // ── Foglio 3: AGGI ──
  const aggi = all[mk(year, month)] || {};
  const aggiHeaders = ["Voce","Tipo","Periodo","Importo €"];
  const aggiRows = [];
  AGGI_BAR_VOCI.forEach(v => {
    (aggi[v] || []).forEach(a => { if (n(a.importo)) aggiRows.push([aggiLabel(v), "Bar", a.periodo||"", n(a.importo)]); });
  });
  AGGI_TAB_VOCI.forEach(v => {
    (aggi[v] || []).forEach(a => { if (n(a.importo)) aggiRows.push([aggiLabel(v), "Tabacchi", a.periodo||"", n(a.importo)]); });
  });
  const totAggiBar = AGGI_BAR_VOCI.reduce((s,v)=>(aggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),s),0);
  const totAggiTab = AGGI_TAB_VOCI.reduce((s,v)=>(aggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),s),0);
  aggiRows.push([], ["TOTALE BAR","","",totAggiBar], ["TOTALE TABACCHI","","",totAggiTab], ["TOTALE AGGI","","",totAggiBar+totAggiTab]);
  const ws3 = XLSX.utils.aoa_to_sheet([aggiHeaders, ...aggiRows]);
  ws3["!cols"] = [22,12,18,12].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws3, "Aggi");

  // ── Foglio 4: VERSAMENTI ──
  const versamenti = all[vk(year, month)] || [];
  const vHeaders = ["#","Importo €","Data","Note"];
  const vRows = versamenti.map((v, i) => [i+1, n(v.importo), v.data||"", v.nota||""]);
  vRows.push([], ["TOTALE","",versamenti.reduce((s,v)=>s+n(v.importo),0),""]);
  const ws4 = XLSX.utils.aoa_to_sheet([vHeaders, ...vRows]);
  ws4["!cols"] = [4,12,14,30].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws4, "Versamenti");

  // ── Foglio 5: PERSONALE ──
  const personale = all[pk(year, month)] || { dipendenti: [], presenze: {} };
  const persHeaders = ["Dipendente","Stipendio Base","Ore Contrattuali","Ore Lavorate","Paga Ordinaria","Straordinari","Anticipi","TOTALE DA PAGARE","Data Pagamento"];
  const persRows = (personale.dipendenti || []).map((dip, idx) => {
    const tariffa = n(dip.stipendio) / (n(dip.ore_mensili) || 1);
    let oreTot = 0, straoTot = 0, anticipiTot = 0;
    for (let d = 1; d <= days; d++) {
      const presKey = `${idx}_${year}_${String(month+1).padStart(2,"0")}_${String(d).padStart(2,"0")}`;
      const p = (personale.presenze || {})[presKey] || {};
      if (p.tipo === "lavoro" || !p.tipo) {
        if (p.entrata && p.uscita) {
          const [eh,em] = p.entrata.split(":").map(Number);
          const [uh,um] = p.uscita.split(":").map(Number);
          if (!isNaN(eh) && !isNaN(uh)) oreTot += Math.max(0, ((uh*60+um)-(eh*60+em))/60);
        }
      }
      straoTot += n(p.straordinari);
      anticipiTot += n(p.anticipo);
    }
    return [dip.nome||`Dip.#${idx+1}`, n(dip.stipendio), n(dip.ore_mensili), +oreTot.toFixed(2),
      +(oreTot*tariffa).toFixed(2), +straoTot.toFixed(2), +anticipiTot.toFixed(2),
      +(oreTot*tariffa+straoTot-anticipiTot).toFixed(2), dip.data_pagamento||""];
  });
  const ws5 = XLSX.utils.aoa_to_sheet([persHeaders, ...persRows]);
  ws5["!cols"] = [18,14,16,14,14,14,10,18,16].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws5, "Personale");

  // ── Foglio 6: RIEPILOGO MESE ──
  const hasRealData = (d) => d && (n(d.bar)||n(d.risto)||n(d.tab_venduto)||n(d.art_tabacchi)||n(d.gratta_venduto)||n(d.lotto_venduto)||n(d.slot_raccolto)||n(d.dist_prelievo));
  const movMensile = dayRows.reduce((s, r, i) => {
    const d = all[dk(year, month, i+1)];
    return s + (hasRealData(d) ? r[34] : 0); // col movimento
  }, 0);
  const mGuadagno = dayRows.reduce((s, r, i) => {
    const d = all[dk(year, month, i+1)];
    return s + (hasRealData(d) ? r[35] : 0); // col guadagno
  }, 0);
  const totVersati = versamenti.reduce((s,v)=>s+n(v.importo),0);
  const totStipendi = persRows.reduce((s,r)=>s+r[7],0);
  const totSpeseEl = dayRows.reduce((s,r)=>s+r[33],0);
  const riepilogoData = [
    ["RIEPILOGO", `${MONTHS[month].toUpperCase()} ${year}`],
    [],
    ["Movimento mese (contante)", movMensile],
    ["Guadagno mese (bar+tab−spese)", mGuadagno],
    [],
    ["Aggi Bar", totAggiBar],
    ["Aggi Tabacchi", totAggiTab],
    ["Totale Aggi", totAggiBar + totAggiTab],
    [],
    ["Guadagno + Aggi", mGuadagno + totAggiBar + totAggiTab],
    [],
    ["Versato in banca/cassa", totVersati],
    ["Spese elettronico", totSpeseEl],
    [],
    ["Stipendi dipendenti", totStipendi],
    [],
    ["CASSA NETTA STIMATA", mGuadagno + totAggiBar + totAggiTab - totStipendi - totSpeseEl],
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(riepilogoData);
  ws6["!cols"] = [{ wch: 30 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws6, "Riepilogo Mese");

  // download
  XLSX.writeFile(wb, `CassaPro_${MONTHS[month]}_${year}.xlsx`);
};

const TIPO_IT    = { lavoro:"Lavoro", malattia:"Malattia", permesso:"Permesso", assenza:"Assenza", ferie:"Ferie" };
const TIPO_COLOR = { lavoro:"#4ade80", malattia:"#f87171", permesso:"#fbbf24", assenza:"#f87171", ferie:"#60a5fa" };

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
  {id:"pagamenti",label:"💳 Pagamenti"},
  {id:"annuale",label:"📅 Annuale"},
  {id:"riepilogo",label:"📊 Totali"},
];

// ── VISTA DIPENDENTE ───────────────────────────────────────
// dipIdx = indice del dipendente già autenticato (non può cambiare)
function DipendentView({ all, year, month, day, setYear, setMonth, setDay,
  personale, onSave, onLock, MONTHS, dim, dk, dipIdx }) {

  const [flash, setFlash] = useState(false);
  const days = dim(year, month);

  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();
  const isToday = year===todayY && month===todayM && day===todayD;
  const isPast  = new Date(year,month,day) < new Date(todayY,todayM,todayD);

  const save = (updated) => { onSave(updated); setFlash(true); setTimeout(()=>setFlash(false),1200); };
  const presKey = (idx, d) => `${idx}_${year}_${String(month+1).padStart(2,"0")}_${String(d).padStart(2,"0")}`;
  const getP = (idx, d) => (personale.presenze||{})[presKey(idx,d)] || { entrata:"", uscita:"", tipo:"lavoro", nota:"" };
  const updP = (idx, d, f, v) => {
    const k = presKey(idx,d);
    const presenze = {...(personale.presenze||{}), [k]: {...getP(idx,d), [f]: v}};
    save({...personale, presenze});
  };
  const calcOre = (e,u) => {
    if (!e||!u) return 0;
    const [eh,em]=e.split(":").map(Number), [uh,um]=u.split(":").map(Number);
    if(isNaN(eh)||isNaN(uh)) return 0;
    return Math.max(0,((uh*60+um)-(eh*60+em))/60);
  };

  const dip = (personale.dipendenti||[])[dipIdx];
  if (!dip) return (
    <div style={{minHeight:"100vh",background:"#05090f",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#f87171",fontFamily:"'DM Mono','Courier New',monospace",fontSize:13}}>
      Dipendente non trovato. <button onClick={onLock} style={{marginLeft:12,background:"none",color:"#60a5fa",border:"none",cursor:"pointer",fontFamily:"inherit"}}>Esci</button>
    </div>
  );

  const p   = getP(dipIdx, day);
  const ore = calcOre(p.entrata, p.uscita);
  const locked = isPast; // giorni passati: sola lettura

  return (
    <div style={{minHeight:"100vh",background:"#05090f",color:"#e2e8f0",
      fontFamily:"'DM Mono','Courier New',monospace",maxWidth:700,margin:"0 auto",paddingBottom:60}}>

      {/* HEADER */}
      <div style={{background:"linear-gradient(180deg,#0a1520 0%,#05090f 100%)",padding:"18px 16px 12px",
        position:"sticky",top:0,zIndex:20,borderBottom:"1px solid #1e3a5f"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,letterSpacing:2,color:"#60a5fa"}}>◈ CASSA PRO</div>
            <div style={{fontSize:11,color:"#60a5fa88"}}>{dip.nome}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {flash&&<span style={{background:"#0a1a2a",color:"#60a5fa",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700}}>✓ SALVATO</span>}
            <button onClick={onLock} style={{background:"#0a1020",color:"#60a5fa",
              border:"1px solid #1e3a5f",padding:"6px 12px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              🔒 Esci
            </button>
          </div>
        </div>
        {/* Selettori — solo giorno corrente e mese (per vedere storico) */}
        <div style={{display:"flex",gap:8,marginTop:10}}>
          {[
            {val:year,set:setYear,opts:Array.from({length:new Date().getFullYear()-2023+3},(_,i)=>({v:2023+i,l:2023+i}))},
            {val:month,set:setMonth,opts:MONTHS.map((m,i)=>({v:i,l:m}))},
            {val:day,set:setDay,opts:Array.from({length:days},(_,i)=>({v:i+1,l:i+1}))},
          ].map((s,i)=>(
            <select key={i} value={s.val} onChange={e=>s.set(+e.target.value)}
              style={{flex:1,background:"#0d1526",color:"#e2e8f0",border:"1px solid #1e3a5f",
                padding:"7px 8px",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
              {s.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          ))}
        </div>
      </div>

      <div style={{padding:16}}>

        {/* Banner giorno bloccato */}
        {locked&&(
          <div style={{background:"#1a0a00",border:"1px solid #713f12",borderRadius:10,
            padding:"10px 14px",marginBottom:14,fontSize:12,color:"#f97316",fontWeight:700}}>
            🔒 Giorno passato — sola lettura. Solo il giorno corrente è modificabile.
          </div>
        )}

        {/* Card inserimento presenze */}
        <div style={{background:"#0f1923",borderRadius:14,borderLeft:`4px solid ${locked?"#334155":"#60a5fa"}`,
          padding:16,marginBottom:14,opacity:locked?0.8:1}}>
          <div style={{fontSize:11,color:locked?"#475569":"#60a5fa",fontWeight:800,letterSpacing:1,marginBottom:12}}>
            {String(day).padStart(2,"0")}/{String(month+1).padStart(2,"0")}/{year}
            {isToday&&<span style={{marginLeft:8,background:"#0a1a2a",color:"#4ade80",padding:"2px 8px",borderRadius:10,fontSize:10}}>OGGI</span>}
          </div>

          {/* Tipo giornata */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,color:"#64748b",fontWeight:700,marginBottom:4}}>TIPO GIORNATA</div>
            <select value={p.tipo||"lavoro"} disabled={locked}
              onChange={e=>updP(dipIdx,day,"tipo",e.target.value)}
              style={{width:"100%",background:"#080e1c",color:locked?"#475569":TIPO_COLOR[p.tipo||"lavoro"],
                border:"1px solid #1e293b",padding:"10px 12px",borderRadius:8,
                fontSize:13,fontFamily:"inherit",fontWeight:700,
                cursor:locked?"not-allowed":"pointer"}}>
              {Object.entries(TIPO_IT).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Entrata / Uscita / Ore */}
          {(p.tipo==="lavoro"||!p.tipo)&&(
            <div style={{display:"flex",gap:10,marginBottom:12}}>
              {[
                {label:"ENTRATA",field:"entrata",ph:"08:00"},
                {label:"USCITA", field:"uscita", ph:"16:00"},
              ].map(({label,field,ph})=>(
                <div key={field} style={{flex:1}}>
                  <div style={{fontSize:10,color:"#64748b",fontWeight:700,marginBottom:4}}>{label}</div>
                  <input type="text" value={p[field]||""} disabled={locked}
                    onChange={e=>updP(dipIdx,day,field,e.target.value)}
                    placeholder={ph}
                    style={{width:"100%",background:"#080e1c",color:locked?"#475569":"#e2e8f0",
                      border:`1px solid ${locked?"#0f1923":"#1e293b"}`,borderRadius:7,
                      padding:"10px",fontSize:16,fontFamily:"inherit",boxSizing:"border-box",
                      cursor:locked?"not-allowed":"text"}}/>
                </div>
              ))}
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:700,marginBottom:4}}>ORE</div>
                <div style={{background:"#080e1c",border:"1px solid #1e293b",borderRadius:7,
                  padding:"10px",fontSize:16,fontWeight:800,color:"#4ade80",textAlign:"center"}}>
                  {ore.toFixed(1)}h
                </div>
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <div style={{fontSize:10,color:"#64748b",fontWeight:700,marginBottom:4}}>NOTE</div>
            <input type="text" value={p.nota||""} disabled={locked}
              onChange={e=>updP(dipIdx,day,"nota",e.target.value)}
              placeholder="Note..."
              style={{width:"100%",background:"#080e1c",color:locked?"#475569":"#e2e8f0",
                border:`1px solid ${locked?"#0f1923":"#1e293b"}`,borderRadius:7,
                padding:"10px",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",
                cursor:locked?"not-allowed":"text"}}/>
          </div>
        </div>

        {/* Storico mese */}
        <div style={{background:"#0f1923",borderRadius:12,borderLeft:"4px solid #334155",padding:14}}>
          <div style={{fontSize:11,color:"#475569",fontWeight:800,letterSpacing:1,marginBottom:10}}>
            STORICO — {MONTHS[month]} {year}
          </div>
          {Array.from({length:days},(_,gi)=>{
            const d=gi+1;
            const pp=getP(dipIdx,d);
            const oo=calcOre(pp.entrata,pp.uscita);
            const has=pp.entrata||pp.uscita||pp.tipo==="malattia"||pp.tipo==="ferie"||pp.tipo==="permesso"||pp.tipo==="assenza";
            if(!has) return null;
            const wd=new Date(year,month,d).toLocaleDateString("it-IT",{weekday:"short"});
            const isTod=year===todayY&&month===todayM&&d===todayD;
            return (
              <div key={d} onClick={()=>setDay(d)}
                style={{display:"flex",justifyContent:"space-between",padding:"6px 4px",
                  borderBottom:"1px solid #080e1c",fontSize:12,cursor:"pointer",
                  background:isTod?"#0a1a2a":"transparent",borderRadius:isTod?4:0}}>
                <span style={{color:isTod?"#60a5fa":"#64748b"}}>{wd} {d}{isTod?" 📍":""}</span>
                <span style={{color:TIPO_COLOR[pp.tipo||"lavoro"],fontWeight:700}}>
                  {pp.tipo&&pp.tipo!=="lavoro" ? TIPO_IT[pp.tipo] : `${oo.toFixed(1)}h`}
                  {pp.entrata&&` (${pp.entrata}–${pp.uscita||"?"})`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const now = new Date();
  const [all, setAll] = useState(load);

  // ── PIN STATE v3 ──
  // Migrazione: se esistono PIN dipendenti (impostati con 4 cifre), li rimuove
  // e mostra avviso al prossimo accesso admin
  useEffect(() => {
    const dipPINs = Object.keys(localStorage).filter(k=>k.startsWith(DIP_PIN_PREFIX));
    if (dipPINs.length > 0 && !localStorage.getItem("cassapro_pin_migrated_v3")) {
      dipPINs.forEach(k => localStorage.removeItem(k));
      localStorage.setItem("cassapro_pin_migrated_v3", "1");
    }
  }, []);
  const [pinScreen, setPinScreen] = useState(() => {
    const s = getSession();
    if (s) return null;
    if (!hasAdminPIN()) return null;
    return "choose_role";
  });
  const [currentRole, setCurrentRole] = useState(() => {
    const s = getSession();
    return s ? s.role : (hasAdminPIN() ? null : "admin");
  });
  const [currentDipIdx, setCurrentDipIdx] = useState(() => {
    const s = getSession();
    return s ? (s.dipIdx ?? null) : null;
  });
  const [pinMode, setPinMode] = useState(null);
  const [pinModeTarget, setPinModeTarget] = useState(null); // idx dipendente per setup PIN

  // ── INATTIVITÀ ──
  // Timeout in minuti per ruolo — salvato in localStorage così persiste
  const INACTIVITY_KEY = "cassapro_inactivity_cfg";
  const getInactivityCfg = () => {
    try { return JSON.parse(localStorage.getItem(INACTIVITY_KEY) || '{"admin":30,"dipendente":10}'); }
    catch { return { admin:30, dipendente:10 }; }
  };
  const [inactivityCfg, setInactivityCfg] = useState(getInactivityCfg);
  const inactivityTimer = useRef(null);
  const lastActivity = useRef(Date.now());

  const saveInactivityCfg = (cfg) => {
    setInactivityCfg(cfg);
    localStorage.setItem(INACTIVITY_KEY, JSON.stringify(cfg));
  };

  const lockDueToInactivity = () => {
    if (!hasAdminPIN()) return; // nessun PIN impostato, niente blocco
    clearSession();
    setPinScreen(hasAdminPIN() ? "choose_role" : null);
    setCurrentRole(null);
    setCurrentDipIdx(null);
  };

  const resetInactivityTimer = () => {
    lastActivity.current = Date.now();
  };

  useEffect(() => {
    if (!hasAdminPIN() || !currentRole) return; // no PIN o non loggato → no timer
    const minutes = inactivityCfg[currentRole] || 30;
    const ms = minutes * 60 * 1000;

    const check = () => {
      if (Date.now() - lastActivity.current >= ms) {
        lockDueToInactivity();
      }
    };

    inactivityTimer.current = setInterval(check, 10000); // controlla ogni 10s
    return () => clearInterval(inactivityTimer.current);
  }, [currentRole, inactivityCfg]);

  useEffect(() => {
    const events = ["click","touchstart","keydown","mousemove","scroll"];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive:true }));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }
  }, []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(now.getDate());
  const [tab, setTab] = useState("incassi");
  const [view, setView] = useState("day"); // "day" | "month" | "annual"
  const [flash, setFlash] = useState(false);
  const [selDip, setSelDip] = useState(null);
  const [confirmDelDip, setConfirmDelDip] = useState(null);
  const [confirmRemPinDip, setConfirmRemPinDip] = useState(null);
  const [confirmRemAdminPIN, setConfirmRemAdminPIN] = useState(false);
  const [driveStatus, setDriveStatus] = useState("");
  const [restoreStatus, setRestoreStatus] = useState("");
  const [notaOpen, setNotaOpen] = useState(false);

  const handleDriveSave = async () => {
    setDriveStatus("syncing");
    try {
      const token = await gdriveAuth();
      const dataStr = JSON.stringify(all, null, 2);
      const fileId = await gdriveFindFile(token);
      await gdriveSave(token, dataStr, fileId);
      localStorage.setItem("cassapro_last_backup", new Date().toISOString());
      localStorage.setItem("cassapro_drive_fileid", fileId||"new");
      setDriveStatus("ok");
      setTimeout(() => setDriveStatus(""), 3000);
    } catch(e) {
      console.error(e);
      setDriveStatus("error");
      setTimeout(() => setDriveStatus(""), 4000);
    }
  };

  const handleDriveLoad = async () => {
    setDriveStatus("confirm_load");
  };

  const handleDriveLoadConfirmed = async () => {
    setDriveStatus("syncing");
    try {
      const token = await gdriveAuth();
      const fileId = await gdriveFindFile(token);
      if (!fileId) { setDriveStatus("nobackup"); setTimeout(()=>setDriveStatus(""),3000); return; }
      const imported = await gdriveLoad(token, fileId);
      setAll(imported);
      persist(imported);
      localStorage.setItem("cassapro_last_backup", new Date().toISOString());
      setDriveStatus("ok");
      setTimeout(() => setDriveStatus(""), 3000);
    } catch(e) {
      console.error(e);
      setDriveStatus("error");
      setTimeout(() => setDriveStatus(""), 4000);
    }
  };

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

  // ── PAGAMENTI ──
  const PGKEY = pgk();
  const pagamenti = all[PGKEY] || [];
  const savePag = (updated) => save({...all, [PGKEY]: updated});
  const addPagamento = () => savePag([...pagamenti, emptyPagamento()]);
  const updPagamento = (i, f, v) => {
    const pg = [...pagamenti];
    pg[i] = {...pg[i], [f]: v};
    savePag(pg);
  };
  const delPagamento = (i) => savePag(pagamenti.filter((_,j)=>j!==i));

  // ── PROMEMORIA ──
  const oggi = new Date();
  oggi.setHours(0,0,0,0);
  const diffGiorni = (dataStr) => {
    if (!dataStr) return null;
    const [d,m,y] = dataStr.split("/").map(Number);
    if (!d||!m||!y) return null;
    const data = new Date(y,m-1,d);
    data.setHours(0,0,0,0);
    return Math.ceil((data-oggi)/(1000*60*60*24));
  };
  const promemoria = [];
  // Stipendi dipendenti
  (personale.dipendenti||[]).forEach(dip => {
    if (!dip.data_pagamento || !dip.nome) return;
    const diff = diffGiorni(dip.data_pagamento);
    if (diff !== null && diff <= 7) {
      promemoria.push({ tipo: diff < 0 ? "scaduto" : diff === 0 ? "oggi" : "presto", testo: `Stipendio ${dip.nome}`, data: dip.data_pagamento, diff });
    }
  });
  // Promemoria backup
  const lastBackup = localStorage.getItem("cassapro_last_backup");
  if (!lastBackup) {
    promemoria.push({ tipo:"backup", testo:"Nessun backup ancora — fai il primo backup!", diff:999 });
  } else {
    const daysSince = Math.floor((oggi - new Date(lastBackup)) / (1000*60*60*24));
    if (daysSince >= 7) {
      promemoria.push({ tipo:"backup", testo:`Backup dati — ultimo ${daysSince} giorni fa`, diff:0 });
    }
  }

  // Pagamenti
  pagamenti.filter(p=>!p.pagato).forEach(pag => {
    if (!pag.data_scadenza || !pag.motivo) return;
    const diff = diffGiorni(pag.data_scadenza);
    if (diff !== null && diff <= 7) {
      promemoria.push({ tipo: diff < 0 ? "scaduto" : diff === 0 ? "oggi" : "presto", testo: pag.motivo, importo: pag.importo, data: pag.data_scadenza, diff });
    }
  });

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

  // ── PIN: early returns ──
  // dipCount: cerca i dipendenti in tutti i mesi disponibili (non solo quello corrente)
  const dipCount = (() => {
    // Prima prova il mese corrente
    const curr = all[pk(year,month)]?.dipendenti?.length || 0;
    if (curr > 0) return curr;
    // Poi cerca in tutti i dati salvati
    let max = 0;
    Object.keys(all).forEach(k => {
      if (k.startsWith("personale_")) {
        const len = all[k]?.dipendenti?.length || 0;
        if (len > max) max = len;
      }
    });
    // Fallback: conta quanti PIN dipendente esistono nel localStorage
    if (max === 0) max = Object.keys(localStorage).filter(k=>k.startsWith(DIP_PIN_PREFIX)).length;
    return max;
  })();

  if (pinScreen === "choose_role") {
    return <PINScreen mode="choose_role" onSuccess={(role) => {
      if (role === "admin") {
        if (hasAdminPIN()) setPinScreen("unlock_admin");
        else { setCurrentRole("admin"); setPinScreen(null); }
      } else {
        const tot = Object.keys(localStorage).filter(k=>k.startsWith(DIP_PIN_PREFIX)).length;
        if (tot > 0) setPinScreen("unlock_dip");
        else setPinScreen("no_dip_pin");
      }
    }}/>;
  }
  if (pinScreen === "no_dip_pin") {
    return <PINScreen mode="choose_role" noDipPin={true} onSuccess={(role) => {
      if (role === "admin") {
        if (hasAdminPIN()) setPinScreen("unlock_admin");
        else { setCurrentRole("admin"); setPinScreen(null); }
      } else setPinScreen("no_dip_pin");
    }}/>;
  }
  if (pinScreen === "unlock_admin") {
    return <PINScreen mode="unlock" role="admin"
      onSuccess={() => { setCurrentRole("admin"); setSession("admin"); setPinScreen(null); }}
      onCancel={(type) => { if(type==="recovery") setPinScreen("recovery"); }}/>;
  }
  if (pinScreen === "unlock_dip") {
    const handleMatchDip = async (pin) => {
      const hash = await hashPIN(pin);
      const keys = Object.keys(localStorage).filter(k=>k.startsWith(DIP_PIN_PREFIX));
      for (const k of keys) {
        if (localStorage.getItem(k) === hash) {
          return parseInt(k.replace(DIP_PIN_PREFIX,""), 10);
        }
      }
      return -1;
    };
    const handleSuccessDip = (idx) => {
      setCurrentRole("dipendente");
      setCurrentDipIdx(idx);
      setSession("dipendente", idx);
      setPinScreen(null);
    };
    return <PINScreen mode="unlock" role="dipendente"
      onMatchDip={handleMatchDip}
      onSuccess={()=>{}}
      onSuccessDip={handleSuccessDip}
      onCancel={() => setPinScreen("choose_role")}/>;
  }
  if (pinScreen === "recovery") {
    return <PINScreen mode="recovery"
      onSuccess={() => { setCurrentRole("admin"); setPinScreen(null); }}
      onCancel={() => setPinScreen("unlock_admin")}/>;
  }
  if (pinMode) {
    const handlePinModeSuccess = async (_, pin) => {
      if ((pinMode === "setup_dip_idx" || pinMode === "change_dip_idx") && pin) {
        await setDipIdxPIN(pinModeTarget, pin);
        console.log(`PIN dipendente ${pinModeTarget} salvato con hash:`, localStorage.getItem(getDipIdxPINKey(pinModeTarget))?.slice(0,8)+"...");
      }
      setPinMode(null); setPinModeTarget(null);
    };
    return <PINScreen mode={pinMode} role={pinMode.includes("dip")?"dipendente":"admin"}
      dipIdx={pinModeTarget}
      onSuccess={handlePinModeSuccess}
      onCancel={() => { setPinMode(null); setPinModeTarget(null); }}/>;
  }

  // Vista dipendente — solo presenze del dipendente autenticato
  if (currentRole === "dipendente" && currentDipIdx !== null) {
    return <DipendentView all={all} year={year} month={month} day={day}
      setYear={setYear} setMonth={setMonth} setDay={setDay}
      personale={all[pk(year,month)]||{dipendenti:[],presenze:{}}}
      onSave={(updated) => { const u={...all,[pk(year,month)]:updated}; setAll(u); persist(u); }}
      onLock={() => { clearSession(); setCurrentRole(null); setCurrentDipIdx(null); setPinScreen("choose_role"); }}
      MONTHS={MONTHS} dim={dim} dk={dk} dipIdx={currentDipIdx}/>;
  }

  return (
    <div style={{minHeight:"100vh",background:"#05090f",color:"#e2e8f0",fontFamily:"'DM Mono','Courier New',monospace",maxWidth:700,margin:"0 auto",paddingBottom:60}}>

      {/* HEADER */}
      <div style={{background:"linear-gradient(180deg,#0d1526 0%,#05090f 100%)",padding:"18px 16px 10px",position:"sticky",top:0,zIndex:20,borderBottom:"1px solid #1e293b"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:16,fontWeight:900,letterSpacing:2,color:"#f8fafc",
              fontFamily:"Georgia,'Times New Roman',serif"}}>La Lanterna</div>
            <div style={{fontSize:9,color:"#334155",letterSpacing:2}}>CASSA PRO</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {flash&&<span style={{background:"#14532d",color:"#4ade80",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700}}>✓ SALVATO</span>}
            {/* Pulsante lock */}
            <button
              onClick={() => {
                if (hasAdminPIN()) {
                  clearSession(); setCurrentRole(null); setCurrentDipIdx(null); setPinScreen("choose_role");
                } else {
                  setPinMode("setup_admin");
                }
              }}
              title={hasAdminPIN() ? "Blocca app" : "Imposta PIN"}
              style={{background:"#1e293b",color: hasAdminPIN() ? "#fbbf24" : "#475569",border:"1px solid #334155",padding:"6px 10px",borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              {hasAdminPIN() ? "🔒" : "🔓"}
            </button>
            <button onClick={()=>setView(v=>v==="day"?"month":v==="month"?"annual":"day")}
              style={{background:"#1e293b",color:"#94a3b8",border:"1px solid #334155",padding:"6px 12px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              {view==="day"?"MESE ▸":view==="month"?"ANNO ▸":"◂ GIORNO"}
            </button>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[
            {val:year,set:setYear,opts:Array.from({length:new Date().getFullYear()-2023+3},(_,i)=>({v:2023+i,l:2023+i}))},
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

      {/* ── PROMEMORIA BANNER ── */}
      {promemoria.length > 0 && (
        <div style={{background:"#1a0a00",borderBottom:"1px solid #7c2d12",padding:"10px 16px"}}>
          <div style={{fontSize:10,color:"#f97316",fontWeight:800,letterSpacing:1,marginBottom:6}}>⚠️ PROMEMORIA SCADENZE</div>
          {promemoria.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #431407",fontSize:12}}>
              <span style={{color: p.tipo==="scaduto"?"#f87171": p.tipo==="oggi"?"#fbbf24":"#fb923c"}}>
                {p.tipo==="scaduto"?"🔴":p.tipo==="oggi"?"🟡":"🟠"} {p.testo}
                {p.importo ? ` — ${p.importo}€` : ""}
              </span>
              <span style={{color:"#64748b",fontSize:11}}>
                {p.tipo==="scaduto" ? `Scaduto ${Math.abs(p.diff)}gg fa` : p.tipo==="oggi" ? "Oggi!" : `Tra ${p.diff}gg`}
              </span>
            </div>
          ))}
        </div>
      )}

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

      {/* ── VISTA ANNUALE ── */}
      {view==="annual"&&(()=>{
        const annualData = MONTHS.map((mName, mi) => {
          const mDays = dim(year, mi);
          let mov=0, guad=0, versato=0, aggiBar=0, aggiTab=0;
          for (let d=1; d<=mDays; d++) {
            const dd = all[dk(year,mi,d)];
            if (hasRealData(dd)) { const c=calcDay(dd); mov+=c.movimento; guad+=c.guadagno; }
          }
          const vers = all[vk(year,mi)]||[];
          versato = vers.reduce((s,v)=>s+n(v.importo),0);
          const aggi = all[mk(year,mi)]||{};
          aggiBar = AGGI_BAR_VOCI.reduce((s,v)=>(aggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),s),0);
          aggiTab = AGGI_TAB_VOCI.reduce((s,v)=>(aggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),s),0);
          const hasData = mov!==0||guad!==0;
          return { mName, mi, mov, guad, versato, aggi:aggiBar+aggiTab, hasData };
        });
        const totMov   = annualData.reduce((s,m)=>s+m.mov,0);
        const totGuad  = annualData.reduce((s,m)=>s+m.guad,0);
        const totVers  = annualData.reduce((s,m)=>s+m.versato,0);
        const totAggiA = annualData.reduce((s,m)=>s+m.aggi,0);
        // scala per grafico
        const maxMov  = Math.max(...annualData.map(m=>Math.abs(m.mov)),1);
        const maxGuad = Math.max(...annualData.map(m=>Math.abs(m.guad)),1);
        return (
          <div style={{padding:16}}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>📅 Anno {year}</div>
            <div style={{fontSize:11,color:"#475569",marginBottom:16}}>Riepilogo tutti i mesi</div>

            {/* KPI annuali */}
            <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:20}}>
              <Stat label="Movimento anno" val={eur(totMov)} accent="#4ade80" big/>
              <Stat label="Guadagno anno" val={eur(totGuad)} accent={totGuad>=0?"#60a5fa":"#f87171"} big/>
              <Stat label="Aggi anno" val={eur(totAggiA)} accent="#fbbf24"/>
              <Stat label="Guad.+Aggi" val={eur(totGuad+totAggiA)} accent={totGuad+totAggiA>=0?"#4ade80":"#f87171"} big/>
              <Stat label="Versato anno" val={eur(totVers)} accent="#f87171"/>
            </div>

            {/* Grafico a barre — Movimento */}
            <div style={{background:"#0f1923",borderRadius:12,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:800,color:"#4ade80",letterSpacing:1,marginBottom:12}}>📊 MOVIMENTO MENSILE</div>
              {annualData.map(({mName,mi,mov,hasData})=>(
                <div key={mi} onClick={()=>{setMonth(mi);setView("month");}}
                  style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer"}}>
                  <div style={{width:30,fontSize:10,color:"#475569",fontWeight:700,flexShrink:0}}>{mName.slice(0,3)}</div>
                  <div style={{flex:1,background:"#080e1c",borderRadius:4,height:20,overflow:"hidden"}}>
                    {hasData&&<div style={{width:`${Math.min(100,Math.abs(mov)/maxMov*100)}%`,height:"100%",
                      background:mov>=0?"#4ade80":"#f87171",borderRadius:4,
                      transition:"width 0.3s",minWidth:2}}/>}
                  </div>
                  <div style={{width:80,textAlign:"right",fontSize:11,fontWeight:700,
                    color:hasData?(mov>=0?"#4ade80":"#f87171"):"#334155",flexShrink:0}}>
                    {hasData?eur(mov):"—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Grafico a barre — Guadagno */}
            <div style={{background:"#0f1923",borderRadius:12,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:800,color:"#60a5fa",letterSpacing:1,marginBottom:12}}>📊 GUADAGNO MENSILE</div>
              {annualData.map(({mName,mi,guad,aggi,hasData})=>(
                <div key={mi} onClick={()=>{setMonth(mi);setView("month");}}
                  style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer"}}>
                  <div style={{width:30,fontSize:10,color:"#475569",fontWeight:700,flexShrink:0}}>{mName.slice(0,3)}</div>
                  <div style={{flex:1,background:"#080e1c",borderRadius:4,height:20,overflow:"hidden",position:"relative"}}>
                    {hasData&&<>
                      <div style={{width:`${Math.min(100,Math.abs(guad)/maxGuad*100)}%`,height:"100%",
                        background:"#60a5fa44",borderRadius:4,position:"absolute"}}/>
                      <div style={{width:`${Math.min(100,Math.abs(guad+aggi)/maxGuad*100)}%`,height:"60%",
                        background:"#4ade8077",borderRadius:4,position:"absolute",top:"20%"}}/>
                    </>}
                  </div>
                  <div style={{width:80,textAlign:"right",fontSize:11,fontWeight:700,
                    color:hasData?(guad>=0?"#60a5fa":"#f87171"):"#334155",flexShrink:0}}>
                    {hasData?eur(guad+aggi):"—"}
                  </div>
                </div>
              ))}
              <div style={{fontSize:10,color:"#334155",marginTop:6}}>🟦 guadagno · 🟩 guadagno+aggi</div>
            </div>

            {/* Tabella riepilogo mensile */}
            <div style={{background:"#0f1923",borderRadius:12,overflow:"hidden",marginBottom:14}}>
              <div style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 1fr 1fr",
                padding:"10px 12px",background:"#080e1c",fontSize:9,color:"#475569",fontWeight:800,letterSpacing:1,gap:4}}>
                <span>MESE</span><span>MOV.</span><span>GUAD.</span><span>AGGI</span><span>VERSATO</span>
              </div>
              {annualData.map(({mName,mi,mov,guad,versato,aggi,hasData})=>(
                <div key={mi} onClick={()=>{setMonth(mi);setView("month");}}
                  style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 1fr 1fr",
                    padding:"10px 12px",fontSize:11,borderBottom:"1px solid #080e1c",
                    gap:4,cursor:"pointer",opacity:hasData?1:0.3}}>
                  <span style={{color:"#64748b",fontWeight:800}}>{mName.slice(0,3)}</span>
                  <span style={{color:"#4ade80"}}>{hasData?eur(mov):"—"}</span>
                  <span style={{color:hasData?(guad>=0?"#60a5fa":"#f87171"):"#475569",fontWeight:700}}>{hasData?eur(guad):"—"}</span>
                  <span style={{color:"#fbbf24"}}>{hasData&&aggi?eur(aggi):"—"}</span>
                  <span style={{color:"#f87171"}}>{versato?eur(versato):"—"}</span>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 1fr 1fr",
                padding:"10px 12px",fontSize:11,gap:4,background:"#080e1c",fontWeight:800}}>
                <span style={{color:"#e2e8f0"}}>TOT</span>
                <span style={{color:"#4ade80"}}>{eur(totMov)}</span>
                <span style={{color:totGuad>=0?"#60a5fa":"#f87171"}}>{eur(totGuad)}</span>
                <span style={{color:"#fbbf24"}}>{eur(totAggiA)}</span>
                <span style={{color:"#f87171"}}>{eur(totVers)}</span>
              </div>
            </div>
            <div style={{fontSize:11,color:"#334155",textAlign:"center"}}>Clicca su un mese per aprirlo</div>
          </div>
        );
      })()}

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

              {/* LISTA DIPENDENTI */}
              {selDip===null&&<>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:12,color:"#475569"}}>{MONTHS[month]} {year}</div>
                  <button onClick={addDipendente} style={{background:"#0a1a2a",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Dipendente</button>
                </div>

                {(personale.dipendenti||[]).length===0&&(
                  <div style={{textAlign:"center",color:"#475569",padding:60,fontSize:13}}>Nessun dipendente.<br/>Clicca "+ Dipendente" per iniziare.</div>
                )}

                {(personale.dipendenti||[]).map((dip,i)=>{
                  const mens = calcMensile(i);
                  const hasProm = promemoria.some(p=>p.testo===`Stipendio ${dip.nome}`);
                  return (
                    <div key={i} onClick={()=>setSelDip(i)}
                      style={{background:"#0f1923",borderRadius:12,borderLeft:"4px solid #60a5fa",padding:14,marginBottom:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:800,color:"#e2e8f0",marginBottom:4}}>
                          {hasProm&&<span style={{color:"#f97316",marginRight:6}}>⚠️</span>}
                          {dip.nome||`Dipendente #${i+1}`}
                        </div>
                        <div style={{fontSize:11,color:"#64748b"}}>
                          Stipendio: {dip.stipendio?`€${dip.stipendio}`:"—"} · Ore: {dip.ore_mensili||"—"}h/mese
                        </div>
                        <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
                          Ore lavorate: <b style={{color:"#4ade80"}}>{mens.ore.toFixed(1)}h</b> · Da pagare: <b style={{color:"#60a5fa"}}>{eur(mens.totale)}</b>
                        </div>
                        {dip.data_pagamento&&<div style={{fontSize:11,color:"#f97316",marginTop:2}}>Pagamento: {dip.data_pagamento}</div>}
                      </div>
                      <div style={{fontSize:20,color:"#334155"}}>›</div>
                    </div>
                  );
                })}
              </>}

              {/* DETTAGLIO DIPENDENTE */}
              {selDip!==null&&(()=>{
                const dip = (personale.dipendenti||[])[selDip];
                if (!dip) { setSelDip(null); return null; }
                const mens = calcMensile(selDip);
                const tariffa = n(dip.stipendio)/(n(dip.ore_mensili)||1);
                return (<>
                  {/* Header con freccia back */}
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                    <button onClick={()=>setSelDip(null)} style={{background:"#1e293b",color:"#e2e8f0",border:"none",borderRadius:8,padding:"8px 14px",fontSize:14,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>← Torna</button>
                    <div>
                      <div style={{fontSize:15,fontWeight:800,color:"#e2e8f0"}}>{dip.nome||`Dipendente #${selDip+1}`}</div>
                      <div style={{fontSize:10,color:"#64748b"}}>Tariffa: {eur(tariffa)}/ora</div>
                    </div>
                    <button onClick={()=>setConfirmDelDip(selDip)}
                      style={{marginLeft:"auto",background:"#1a0a0a",color:"#f87171",border:"none",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕ Rimuovi</button>
                  </div>

                  {/* Modal conferma cancellazione */}
                  {confirmDelDip===selDip&&(
                    <div style={{background:"#1a0505",border:"2px solid #7f1d1d",borderRadius:12,padding:16,marginBottom:16}}>
                      <div style={{fontSize:13,color:"#f87171",fontWeight:700,marginBottom:8}}>
                        ⚠️ Rimuovere {dip.nome||`Dipendente #${selDip+1}`}?
                      </div>
                      <div style={{fontSize:11,color:"#94a3b8",marginBottom:14}}>
                        Verranno rimossi anche i dati contrattuali e il PIN. Le presenze salvate rimarranno nei dati storici.
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>{
                          removeDipIdxPIN(selDip);
                          delDipendente(selDip);
                          setSelDip(null);
                          setConfirmDelDip(null);
                        }} style={{flex:1,background:"#7f1d1d",color:"#fca5a5",border:"none",borderRadius:8,padding:11,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          ✕ Sì, rimuovi
                        </button>
                        <button onClick={()=>setConfirmDelDip(null)}
                          style={{flex:1,background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:8,padding:11,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PIN DIPENDENTE */}
                  <Block title="Accesso Dipendente" accent="#60a5fa">
                    <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>
                      {hasDipIdxPIN(selDip)
                        ? `PIN attivo — ${dip.nome||"questo dipendente"} può accedere all'area presenze.`
                        : `Nessun PIN — ${dip.nome||"questo dipendente"} non può ancora accedere.`}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{ setPinModeTarget(selDip); setPinMode("setup_dip_idx"); }}
                        style={{flex:1,background:"#0a1020",color:"#60a5fa",border:"1px solid #1e3a5f",
                          borderRadius:8,padding:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        {hasDipIdxPIN(selDip) ? "🔄 Cambia PIN" : "🔒 Imposta PIN"}
                      </button>
                      {hasDipIdxPIN(selDip)&&(
                        <button onClick={()=>setConfirmRemPinDip(selDip)}
                          style={{flex:1,background:"#1a0a0a",color:"#f87171",border:"1px solid #7f1d1d",
                            borderRadius:8,padding:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          ✕ Rimuovi PIN
                        </button>
                      )}
                    </div>
                    {confirmRemPinDip===selDip&&(
                      <div style={{background:"#1a0505",border:"1px solid #7f1d1d",borderRadius:10,padding:12,marginTop:10}}>
                        <div style={{fontSize:12,color:"#f87171",marginBottom:10}}>Rimuovere il PIN di {dip.nome}? Non potrà più accedere.</div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{ removeDipIdxPIN(selDip); setConfirmRemPinDip(null); }}
                            style={{flex:1,background:"#7f1d1d",color:"#fca5a5",border:"none",borderRadius:7,padding:9,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sì, rimuovi</button>
                          <button onClick={()=>setConfirmRemPinDip(null)}
                            style={{flex:1,background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:7,padding:9,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                        </div>
                      </div>
                    )}
                    <div style={{fontSize:10,color:"#334155",marginTop:8}}>
                      Il PIN è a 6 cifre. Se lo dimentica, reimpostalo da qui.
                    </div>
                  </Block>

                  {/* DATI CONTRATTUALI */}
                  <Block title="Dati Contrattuali" accent="#60a5fa">
                    <Row>
                      <Fld label="Nome" val={dip.nome} set={v=>updDipendente(selDip,"nome",v)} type="text" flex="2 1 140px"/>
                      <Fld label="Stipendio base (€)" val={dip.stipendio} set={v=>updDipendente(selDip,"stipendio",v)}/>
                      <Fld label="Ore mensili" val={dip.ore_mensili} set={v=>updDipendente(selDip,"ore_mensili",v)}/>
                    </Row>
                    <Row>
                      <Fld label="Data pagamento (gg/mm/aaaa)" val={dip.data_pagamento||""} set={v=>updDipendente(selDip,"data_pagamento",v)} type="text" flex="2 1 180px"/>
                      <div style={{flex:"1 1 120px",display:"flex",alignItems:"flex-end",paddingBottom:10}}>
                        <span style={{fontSize:11,color:"#475569"}}>Banner 7 giorni prima</span>
                      </div>
                    </Row>
                  </Block>

                  {/* RIEPILOGO MESE */}
                  <Block title={"Riepilogo "+MONTHS[month]+" "+year} accent="#4ade80">
                    <RRow label="Ore lavorate" val={mens.ore.toFixed(1)+"h"} color="#4ade80"/>
                    <RRow label="Paga ordinaria" val={eur(mens.paga)} color="#4ade80"/>
                    <RRow label="Straordinari" val={eur(mens.straordinari)} color="#fbbf24"/>
                    <RRow label="− Anticipi" val={eur(-mens.anticipi)} color="#f87171"/>
                    <div style={{height:4}}/>
                    <RRow label="TOTALE DA PAGARE" val={eur(mens.totale)} color="#60a5fa" bold/>
                  </Block>

                  {/* PRESENZE */}
                  <Block title="Presenze Giornaliere" accent="#a78bfa">
                    {Array.from({length:dim(year,month)},(_,gi)=>{
                      const d = gi+1;
                      const p = getPresenza(selDip,d);
                      const ore = calcOre(p.entrata, p.uscita);
                      const wd = new Date(year,month,d).toLocaleDateString("it-IT",{weekday:"short"});
                      return (
                        <div key={d} style={{background:"#080e1c",borderRadius:8,padding:10,marginBottom:8,borderLeft:`3px solid ${TIPO_COLOR[p.tipo]||"#1e293b"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <span style={{fontSize:12,fontWeight:800,color:"#e2e8f0"}}>{wd} {d}</span>
                            <select value={p.tipo} onChange={e=>updPresenza(selDip,d,"tipo",e.target.value)}
                              style={{background:"#0f1923",color:TIPO_COLOR[p.tipo],border:"1px solid #1e293b",padding:"5px 8px",borderRadius:6,fontSize:11,fontFamily:"inherit",fontWeight:700}}>
                              {["lavoro","malattia","permesso","assenza","ferie"].map(t=><option key={t} value={t}>{TIPO_IT[t]}</option>)}
                            </select>
                          </div>
                          {p.tipo==="lavoro"&&(
                            <Row>
                              <div style={{flex:1}}><Lbl c="Entrata"/><Inp val={p.entrata} set={v=>updPresenza(selDip,d,"entrata",v)} type="text" ph="08:00"/></div>
                              <div style={{flex:1}}><Lbl c="Uscita"/><Inp val={p.uscita} set={v=>updPresenza(selDip,d,"uscita",v)} type="text" ph="16:00"/></div>
                              <div style={{flex:1}}>
                                <Lbl c="Ore"/>
                                <div style={{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:7,padding:"9px 10px",fontSize:14,fontWeight:700,color:"#4ade80"}}>{ore.toFixed(1)}h</div>
                              </div>
                            </Row>
                          )}
                          <Row>
                            <Fld label="Straordinari (€)" val={p.straordinari} set={v=>updPresenza(selDip,d,"straordinari",v)}/>
                            <Fld label="Anticipo (€)" val={p.anticipo} set={v=>updPresenza(selDip,d,"anticipo",v)}/>
                          </Row>
                          <div><Lbl c="Note"/><Inp val={p.nota} set={v=>updPresenza(selDip,d,"nota",v)} type="text" ph="Note..."/></div>
                        </div>
                      );
                    })}
                  </Block>
                </>);
              })()}
            </>}

            {tab==="pagamenti"&&<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:12,color:"#94a3b8"}}>Scadenze e pagamenti pianificati</div>
                <button onClick={addPagamento} style={{background:"#0a1a2a",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Aggiungi</button>
              </div>

              {pagamenti.length===0&&(
                <div style={{textAlign:"center",color:"#475569",padding:40,fontSize:13}}>Nessun pagamento. Clicca "+ Aggiungi" per iniziare.</div>
              )}

              {pagamenti.map((pag,i)=>{
                const diff = diffGiorni(pag.data_scadenza);
                const scaduto = diff !== null && diff < 0 && !pag.pagato;
                const inScadenza = diff !== null && diff >= 0 && diff <= 7 && !pag.pagato;
                const borderColor = pag.pagato ? "#166534" : scaduto ? "#f87171" : inScadenza ? "#f97316" : "#334155";
                return (
                  <div key={i} style={{background:"#0f1923",borderRadius:12,borderLeft:`4px solid ${borderColor}`,padding:14,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                      <span style={{fontSize:10,fontWeight:800,letterSpacing:1,color:borderColor}}>
                        {pag.pagato ? "✅ PAGATO" : scaduto ? "🔴 SCADUTO" : inScadenza ? "🟠 IN SCADENZA" : "⏳ PIANIFICATO"}
                      </span>
                      <button onClick={()=>delPagamento(i)} style={{background:"#1a0a0a",color:"#f87171",border:"none",borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                    </div>
                    <Row>
                      <div style={{flex:"2 1 160px"}}><Lbl c="Motivo / Descrizione"/><Inp val={pag.motivo} set={v=>updPagamento(i,"motivo",v)} type="text" ph="es. Affitto, Fornitore X..."/></div>
                      <Fld label="Importo (€)" val={pag.importo} set={v=>updPagamento(i,"importo",v)}/>
                    </Row>
                    <Row>
                      <Fld label="Data scadenza (gg/mm/aaaa)" val={pag.data_scadenza} set={v=>updPagamento(i,"data_scadenza",v)} type="text" flex="2 1 160px"/>
                      {diff !== null && !pag.pagato && (
                        <div style={{flex:"1 1 100px",display:"flex",alignItems:"flex-end",paddingBottom:10}}>
                          <span style={{fontSize:12,fontWeight:700,color:scaduto?"#f87171":inScadenza?"#f97316":"#64748b"}}>
                            {scaduto ? `Scaduto ${Math.abs(diff)}gg fa` : diff===0 ? "Oggi!" : `Tra ${diff} giorni`}
                          </span>
                        </div>
                      )}
                    </Row>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginTop:4}}>
                      <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#94a3b8"}}>
                        <input type="checkbox" checked={pag.pagato||false} onChange={e=>updPagamento(i,"pagato",e.target.checked)}
                          style={{width:16,height:16,cursor:"pointer"}}/>
                        Segna come pagato
                      </label>
                      {pag.pagato && (
                        <Fld label="Data pagato" val={pag.data_pagato||""} set={v=>updPagamento(i,"data_pagato",v)} type="text" flex="1 1 140px"/>
                      )}
                    </div>
                  </div>
                );
              })}
            </>}

            {/* ── RIEPILOGO ANNUALE ── */}
            {tab==="annuale"&&(()=>{
              // Calcola dati per ogni mese dell'anno selezionato
              const annualData = MONTHS.map((mName, m) => {
                const mDays = dim(year, m);
                const mVers = all[vk(year,m)] || [];
                const mAggi = all[mk(year,m)] || {};
                const totVers = mVers.reduce((s,v)=>s+n(v.importo),0);
                const totAggiBarM = AGGI_BAR_VOCI.reduce((s,v)=>s+(mAggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),0),0);
                const totAggiTabM = AGGI_TAB_VOCI.reduce((s,v)=>s+(mAggi[v]||[]).reduce((ss,a)=>ss+n(a.importo),0),0);
                const totAggiM = totAggiBarM + totAggiTabM;
                let movM=0, guadM=0, speseContM=0, speseEleM=0, hasAny=false;
                for(let d=1;d<=mDays;d++){
                  const dd=all[dk(year,m,d)];
                  if(!dd) continue;
                  const hasReal = n(dd.bar)||n(dd.risto)||n(dd.tab_venduto)||n(dd.art_tabacchi)||n(dd.gratta_venduto)||n(dd.lotto_venduto)||n(dd.slot_raccolto)||n(dd.dist_prelievo);
                  if(!hasReal) continue;
                  hasAny=true;
                  const c=calcDay(dd);
                  movM+=c.movimento; guadM+=c.guadagno;
                  speseContM+=c.spese_cont; speseEleM+=c.spese_ele;
                }
                return { mName, m, movM, guadM, totAggiM, totAggiBarM, totAggiTabM,
                  guadConAggi: guadM+totAggiM, totVers, speseContM, speseEleM, hasAny };
              });

              const totAnno = annualData.reduce((acc,r)=>({
                movM: acc.movM+r.movM, guadM: acc.guadM+r.guadM,
                totAggiM: acc.totAggiM+r.totAggiM, guadConAggi: acc.guadConAggi+r.guadConAggi,
                totVers: acc.totVers+r.totVers, speseContM: acc.speseContM+r.speseContM,
                speseEleM: acc.speseEleM+r.speseEleM,
              }), {movM:0,guadM:0,totAggiM:0,guadConAggi:0,totVers:0,speseContM:0,speseEleM:0});

              // Scala per barre
              const maxGuad = Math.max(...annualData.map(r=>Math.abs(r.guadConAggi)), 1);
              const maxMov  = Math.max(...annualData.map(r=>Math.abs(r.movM)), 1);

              return (<>
                <div style={{fontSize:11,color:"#475569",marginBottom:14,letterSpacing:1}}>ANNO {year}</div>

                {/* KPI annuali */}
                <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:20}}>
                  <Stat label="Movimento anno" val={eur(totAnno.movM)} accent="#4ade80" big/>
                  <Stat label="Guadagno anno" val={eur(totAnno.guadM)} accent="#60a5fa" big/>
                  <Stat label="Aggi anno" val={eur(totAnno.totAggiM)} accent="#fbbf24"/>
                  <Stat label="Guadagno + Aggi" val={eur(totAnno.guadConAggi)} accent={totAnno.guadConAggi>=0?"#a78bfa":"#f87171"} big/>
                  <Stat label="Versato anno" val={eur(totAnno.totVers)} accent="#f87171"/>
                  <Stat label="Spese contanti" val={eur(totAnno.speseContM)} accent="#fb923c"/>
                  <Stat label="Spese elettronico" val={eur(totAnno.speseEleM)} accent="#fb923c"/>
                </div>

                {/* Grafico a barre — Guadagno + Aggi per mese */}
                <Block title="Guadagno + Aggi per Mese" accent="#a78bfa">
                  {annualData.map(r=>{
                    if(!r.hasAny) return (
                      <div key={r.m} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <div style={{width:32,fontSize:10,color:"#334155",fontWeight:700,flexShrink:0}}>{r.mName.slice(0,3)}</div>
                        <div style={{fontSize:10,color:"#1e293b"}}>—</div>
                      </div>
                    );
                    const pct = Math.abs(r.guadConAggi)/maxGuad*100;
                    const pos = r.guadConAggi >= 0;
                    return (
                      <div key={r.m} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{fontSize:10,color:"#94a3b8",fontWeight:700}}>{r.mName.slice(0,3).toUpperCase()}</span>
                          <span style={{fontSize:11,fontWeight:800,color:pos?"#a78bfa":"#f87171"}}>{eur(r.guadConAggi)}</span>
                        </div>
                        <div style={{background:"#080e1c",borderRadius:4,height:10,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:pos?"linear-gradient(90deg,#7c3aed,#a78bfa)":"#f87171",borderRadius:4,transition:"width 0.3s"}}/>
                        </div>
                      </div>
                    );
                  })}
                </Block>

                {/* Grafico a barre — Movimento */}
                <Block title="Movimento Contante per Mese" accent="#4ade80">
                  {annualData.map(r=>{
                    if(!r.hasAny) return (
                      <div key={r.m} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <div style={{width:32,fontSize:10,color:"#334155",fontWeight:700,flexShrink:0}}>{r.mName.slice(0,3)}</div>
                        <div style={{fontSize:10,color:"#1e293b"}}>—</div>
                      </div>
                    );
                    const pct = Math.abs(r.movM)/maxMov*100;
                    return (
                      <div key={r.m} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{fontSize:10,color:"#94a3b8",fontWeight:700}}>{r.mName.slice(0,3).toUpperCase()}</span>
                          <span style={{fontSize:11,fontWeight:800,color:"#4ade80"}}>{eur(r.movM)}</span>
                        </div>
                        <div style={{background:"#080e1c",borderRadius:4,height:10,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#166534,#4ade80)",borderRadius:4,transition:"width 0.3s"}}/>
                        </div>
                      </div>
                    );
                  })}
                </Block>

                {/* Tabella mensile dettagliata */}
                <Block title="Dettaglio Mese per Mese" accent="#60a5fa">
                  {/* header */}
                  <div style={{display:"grid",gridTemplateColumns:"60px 1fr 1fr 1fr",gap:4,marginBottom:8,
                    fontSize:9,color:"#475569",fontWeight:800,letterSpacing:1}}>
                    <span>MESE</span><span style={{textAlign:"right"}}>MOVIMENTO</span>
                    <span style={{textAlign:"right"}}>GUAD.+AGGI</span><span style={{textAlign:"right"}}>VERSATO</span>
                  </div>
                  {annualData.map(r=>(
                    <div key={r.m}
                      onClick={()=>{ setMonth(r.m); setTab("riepilogo"); }}
                      style={{display:"grid",gridTemplateColumns:"60px 1fr 1fr 1fr",gap:4,
                        padding:"8px 0",borderBottom:"1px solid #080e1c",cursor:"pointer",
                        opacity:r.hasAny?1:0.3}}>
                      <span style={{fontSize:11,fontWeight:800,color: month===r.m?"#60a5fa":"#94a3b8"}}>{r.mName.slice(0,3)}</span>
                      <span style={{fontSize:11,color:"#4ade80",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.hasAny?eur(r.movM):"—"}</span>
                      <span style={{fontSize:11,fontWeight:700,color:r.guadConAggi>=0?"#a78bfa":"#f87171",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.hasAny?eur(r.guadConAggi):"—"}</span>
                      <span style={{fontSize:11,color:"#f87171",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.totVers>0?eur(r.totVers):"—"}</span>
                    </div>
                  ))}
                  {/* riga totale */}
                  <div style={{display:"grid",gridTemplateColumns:"60px 1fr 1fr 1fr",gap:4,
                    padding:"10px 0",fontSize:12,fontWeight:800,marginTop:4}}>
                    <span style={{color:"#e2e8f0"}}>TOTALE</span>
                    <span style={{color:"#4ade80",textAlign:"right"}}>{eur(totAnno.movM)}</span>
                    <span style={{color:totAnno.guadConAggi>=0?"#a78bfa":"#f87171",textAlign:"right"}}>{eur(totAnno.guadConAggi)}</span>
                    <span style={{color:"#f87171",textAlign:"right"}}>{eur(totAnno.totVers)}</span>
                  </div>
                </Block>

                {/* Confronto mese corrente vs stesso mese anno precedente */}
                {(()=>{
                  const prevYear2 = year - 1;
                  const mDays2 = dim(prevYear2, month);
                  let movPrev=0, guadPrev=0, hasAnyPrev=false;
                  const mAggiPrev = all[mk(prevYear2,month)] || {};
                  const totAggiPrev = [...AGGI_BAR_VOCI,...AGGI_TAB_VOCI].reduce((s,v)=>s+(mAggiPrev[v]||[]).reduce((ss,a)=>ss+n(a.importo),0),0);
                  for(let d=1;d<=mDays2;d++){
                    const dd=all[dk(prevYear2,month,d)];
                    if(!dd) continue;
                    const hasReal=n(dd.bar)||n(dd.risto)||n(dd.tab_venduto)||n(dd.art_tabacchi)||n(dd.gratta_venduto)||n(dd.lotto_venduto)||n(dd.slot_raccolto)||n(dd.dist_prelievo);
                    if(!hasReal) continue;
                    hasAnyPrev=true;
                    const c=calcDay(dd);
                    movPrev+=c.movimento; guadPrev+=c.guadagno;
                  }
                  if(!hasAnyPrev) return null;
                  const curMonth = annualData[month];
                  const diffGuad = curMonth.guadConAggi - (guadPrev+totAggiPrev);
                  const diffMov  = curMonth.movM - movPrev;
                  return (
                    <Block title={`${MONTHS[month]} ${year} vs ${MONTHS[month]} ${prevYear2}`} accent="#fbbf24">
                      <RRow label={`Movimento ${year}`} val={eur(curMonth.movM)} color="#4ade80"/>
                      <RRow label={`Movimento ${prevYear2}`} val={eur(movPrev)} color="#64748b"/>
                      <RRow label="Differenza movimento" val={eur(diffMov,true)} color={diffMov>=0?"#4ade80":"#f87171"} bold/>
                      <div style={{height:8}}/>
                      <RRow label={`Guad.+Aggi ${year}`} val={eur(curMonth.guadConAggi)} color="#a78bfa"/>
                      <RRow label={`Guad.+Aggi ${prevYear2}`} val={eur(guadPrev+totAggiPrev)} color="#64748b"/>
                      <RRow label="Differenza guadagno" val={eur(diffGuad,true)} color={diffGuad>=0?"#4ade80":"#f87171"} bold/>
                    </Block>
                  );
                })()}

              </>);
            })()}

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

              {/* PIN MANAGEMENT */}
              <div style={{background:"#0f1923",borderRadius:10,padding:12,marginTop:8,border:"1px solid #1e293b"}}>
                <div style={{fontSize:10,color:"#fbbf24",fontWeight:800,letterSpacing:1,marginBottom:10}}>🔐 SICUREZZA PIN</div>

                {/* PIN ADMIN */}
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>
                    👔 PIN Admin (6 cifre) — {hasAdminPIN() ? "✅ attivo" : "❌ non impostato"}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {!hasAdminPIN() ? (
                      <button onClick={()=>setPinMode("setup_admin")} style={{flex:1,background:"#1a1400",color:"#fbbf24",border:"1px solid #713f12",borderRadius:8,padding:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        🔒 Imposta PIN Admin
                      </button>
                    ) : (
                      <>
                        <button onClick={()=>setPinMode("change_admin")} style={{flex:1,background:"#0a1a2a",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          🔄 Cambia
                        </button>
                        <button onClick={()=>setConfirmRemAdminPIN(true)}
                          style={{flex:1,background:"#1a0a0a",color:"#f87171",border:"1px solid #7f1d1d",borderRadius:8,padding:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          ✕ Rimuovi
                        </button>
                      </>
                    )}
                  </div>
                  {confirmRemAdminPIN&&(
                    <div style={{background:"#1a0505",border:"1px solid #7f1d1d",borderRadius:10,padding:12,marginTop:10}}>
                      <div style={{fontSize:12,color:"#f87171",marginBottom:10}}>Rimuovere il PIN admin? L'app non sarà più protetta.</div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>{ removeAdminPIN(); setCurrentRole("admin"); setConfirmRemAdminPIN(false); }}
                          style={{flex:1,background:"#7f1d1d",color:"#fca5a5",border:"none",borderRadius:7,padding:9,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sì, rimuovi</button>
                        <button onClick={()=>setConfirmRemAdminPIN(false)}
                          style={{flex:1,background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:7,padding:9,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{fontSize:10,color:"#334155",marginTop:6}}>
                  I PIN dipendenti si impostano nella scheda di ogni dipendente (tab Personale).
                </div>

                {/* TIMEOUT INATTIVITÀ */}
                {hasAdminPIN()&&<div style={{borderTop:"1px solid #1e293b",paddingTop:12,marginTop:12}}>
                  <div style={{fontSize:10,color:"#a78bfa",fontWeight:800,letterSpacing:1,marginBottom:10}}>⏱ BLOCCO AUTOMATICO</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[
                      {role:"admin", label:"👔 Admin", opts:[5,10,15,30,60]},
                      {role:"dipendente", label:"👤 Dipendente", opts:[5,10,15,30]},
                    ].map(({role,label,opts})=>(
                      <div key={role} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:12,color:"#94a3b8"}}>{label}</span>
                        <select value={inactivityCfg[role]||30}
                          onChange={e=>saveInactivityCfg({...inactivityCfg,[role]:+e.target.value})}
                          style={{background:"#080e1c",color:"#a78bfa",border:"1px solid #4c1d95",
                            borderRadius:7,padding:"6px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>
                          {opts.map(m=><option key={m} value={m}>{m} min</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:10,color:"#334155",marginTop:8}}>
                    L'app si blocca automaticamente dopo il tempo di inattività selezionato. I dati non vengono mai cancellati.
                  </div>
                </div>}
              </div>

              <button onClick={()=>{
                const blob = new Blob([JSON.stringify(all, null, 2)], {type:"application/json"});
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `cassa-pro-backup-${year}.json`;
                a.click();
                localStorage.setItem("cassapro_last_backup", new Date().toISOString());
              }} style={{width:"100%",background:"#0f1923",color:"#4ade80",border:"1px solid #166534",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8}}>
                💾 Backup completo (JSON)
              </button>

              <button onClick={()=> exportExcel({
                all, year, month, MONTHS, dim, dk, emptyDay, calcDay, n,
                AGGI_BAR_VOCI, AGGI_TAB_VOCI, aggiLabel, mk, vk, pk, pgk
              })} style={{width:"100%",background:"#0f1923",color:"#4ade80",border:"1px solid #166534",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8}}>
                📊 Esporta Excel (.xlsx) — {MONTHS[month]} {year}
              </button>

              {/* GOOGLE DRIVE SYNC */}
              <div style={{background:"#0f1923",borderRadius:10,padding:12,marginTop:8,border:"1px solid #1e3a5f"}}>
                <div style={{fontSize:10,color:"#60a5fa",fontWeight:800,letterSpacing:1,marginBottom:10}}>☁️ SYNC GOOGLE DRIVE</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={handleDriveSave} disabled={driveStatus==="syncing"}
                    style={{flex:1,background:"#0a1a2a",color:"#4ade80",border:"1px solid #166534",borderRadius:8,padding:11,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    {driveStatus==="syncing"?"⏳ Salvataggio...":driveStatus==="ok"?"✅ Salvato!":driveStatus==="error"?"❌ Errore":"☁️ Salva su Drive"}
                  </button>
                  <button onClick={handleDriveLoad} disabled={driveStatus==="syncing"||driveStatus==="confirm_load"}
                    style={{flex:1,background:"#0a1a2a",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:11,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    {driveStatus==="syncing"?"⏳ Caricamento...":driveStatus==="nobackup"?"❌ Nessun backup":"📥 Carica da Drive"}
                  </button>
                </div>
                {/* Conferma caricamento Drive — inline, funziona su mobile */}
                {driveStatus==="confirm_load"&&(
                  <div style={{background:"#0a1a2a",border:"1px solid #f97316",borderRadius:10,padding:12,marginTop:10}}>
                    <div style={{fontSize:12,color:"#f97316",marginBottom:10,fontWeight:700}}>
                      ⚠️ I dati locali verranno sostituiti con quelli del Drive. Continuare?
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={handleDriveLoadConfirmed}
                        style={{flex:1,background:"#1e3a5f",color:"#60a5fa",border:"none",borderRadius:7,padding:9,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        Sì, carica
                      </button>
                      <button onClick={()=>setDriveStatus("")}
                        style={{flex:1,background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:7,padding:9,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
                <div style={{fontSize:10,color:"#475569",marginTop:8}}>La prima volta ti chiederà di autorizzare con Google</div>
              </div>

              <label style={{display:"block",width:"100%",background:"#0f1923",color:"#a78bfa",border:"1px solid #3b0764",borderRadius:10,padding:13,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginTop:8,textAlign:"center",boxSizing:"border-box"}}>
                {restoreStatus==="ok"?"✅ Ripristinato!":restoreStatus==="error"?"❌ File non valido":"📂 Ripristina da backup (JSON)"}
                <input type="file" accept=".json" style={{display:"none"}} onChange={e=>{
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const imported = JSON.parse(ev.target.result);
                      setAll(imported);
                      persist(imported);
                      setRestoreStatus("ok");
                      setTimeout(()=>setRestoreStatus(""),3000);
                    } catch {
                      setRestoreStatus("error");
                      setTimeout(()=>setRestoreStatus(""),3000);
                    }
                  };
                  reader.readAsText(file);
                }}/>
              </label>
            </>}

          </div>
        </>
      )}

      {/* ── NOTA RAPIDA FLOATING ── */}
      {view!=="annual"&&<>
        {/* Bottone floating */}
        <button onClick={()=>setNotaOpen(true)}
          style={{position:"fixed",bottom:24,right:20,width:52,height:52,borderRadius:"50%",
            background: today.nota_rapida ? "#1a1400" : "#0f1923",
            color: today.nota_rapida ? "#fbbf24" : "#475569",
            border:`2px solid ${today.nota_rapida?"#fbbf24":"#334155"}`,
            fontSize:22,cursor:"pointer",zIndex:30,boxShadow:"0 4px 20px #00000088",
            display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>
          📝
        </button>

        {/* Modal nota rapida */}
        {notaOpen&&(
          <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:50,
            display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
            <div style={{background:"#0d1526",borderRadius:"20px 20px 0 0",padding:"20px 20px 32px",
              width:"100%",maxWidth:700,border:"1px solid #1e293b",borderBottom:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"#fbbf24",letterSpacing:1}}>📝 NOTA RAPIDA</div>
                  <div style={{fontSize:10,color:"#475569",marginTop:2}}>
                    {String(day).padStart(2,"0")}/{String(month+1).padStart(2,"0")}/{year}
                  </div>
                </div>
                <button onClick={()=>setNotaOpen(false)}
                  style={{background:"#1e293b",color:"#94a3b8",border:"none",borderRadius:8,
                    padding:"6px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
              </div>
              <textarea
                autoFocus
                value={today.nota_rapida||""}
                onChange={e=>upd("nota_rapida",e.target.value)}
                placeholder="Scrivi qui una nota per oggi... (es. chiusura anticipata, problema slot 2, fornitore chiamato...)"
                style={{width:"100%",background:"#080e1c",color:"#e2e8f0",
                  border:`1px solid ${today.nota_rapida?"#fbbf24":"#1e293b"}`,
                  borderRadius:10,padding:14,fontSize:14,minHeight:130,
                  boxSizing:"border-box",resize:"none",fontFamily:"inherit",lineHeight:1.6,outline:"none"}}/>
              {today.nota_rapida&&(
                <button onClick={()=>{upd("nota_rapida","");}}
                  style={{marginTop:8,background:"transparent",color:"#475569",border:"none",
                    fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                  🗑 Cancella nota
                </button>
              )}
            </div>
          </div>
        )}
      </>}

    </div>
  );
}
