import { useState, useEffect, useRef } from "react";

const DRIVE_ROOT = "Shot Lists — SceneDissect";
const LIBRARY_FOLDER = "Shot Library";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

export default function Library() {
  const [token, setToken] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState("");
  const [selectedCard, setSelectedCard] = useState(null); // detail view
  const [selected, setSelected] = useState(new Set()); // selected for actions
  const [filterVideo, setFilterVideo] = useState("all");
  const [filterMood, setFilterMood] = useState("all");
  const [filterShot, setFilterShot] = useState("all");
  const [mode, setMode] = useState("browse"); // browse | arrange
  const [arranged, setArranged] = useState([]); // cards in storyboard order
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [deleteStatus, setDeleteStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);

  const C = {
    bg:"#070707", surface:"#0d0d0d", surface2:"#141414", border:"#1e1e1e", border2:"#2a2a2a",
    text:"#f0ede8", textSub:"#c8c4bc", textDim:"#777",
    accent:"#e8ff47", accentDim:"rgba(232,255,71,0.07)", accentBorder:"rgba(232,255,71,0.2)",
    green:"#22c55e", greenDim:"rgba(34,197,94,0.08)", greenBorder:"rgba(34,197,94,0.25)",
    red:"#dc2626", redDim:"rgba(220,38,38,0.08)", redBorder:"rgba(220,38,38,0.25)",
  };

  useEffect(() => {
    const saved = localStorage.getItem("sd_cid");
    if (saved) setClientId(saved);
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const p = new URLSearchParams(hash.slice(1));
      const t = p.get("access_token");
      if (t) {
        setToken(t);
        window.history.replaceState(null, "", window.location.pathname);
        fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + t } })
          .then(r => r.json()).then(d => setUserEmail(d.email || "Connected"));
      }
    }
  }, []);

  useEffect(() => { if (token) loadLibrary(); }, [token]);

  const signIn = () => {
    const id = localStorage.getItem("sd_cid") || clientId.trim();
    if (!id) { alert("No Client ID found. Go to SceneDissect and connect Drive first."); return; }
    const p = new URLSearchParams({
      client_id: id,
      redirect_uri: window.location.origin + "/library",
      response_type: "token", scope: SCOPES, include_granted_scopes: "true",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };

  const gFetch = (url, opts={}) => fetch(url, {
    ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers||{}) }
  });

  const loadLibrary = async () => {
    setLoading(true); setLoadStatus("Finding Shot Library…"); setCards([]);
    setSelected(new Set()); setArranged([]);
    try {
      const rootQ = encodeURIComponent(`name='${DRIVE_ROOT}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const rootD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${rootQ}`)).json();
      if (!rootD.files?.length) { setLoadStatus("No Shot Library found. Save some cards from SceneDissect first."); setLoading(false); return; }

      const libQ = encodeURIComponent(`name='${LIBRARY_FOLDER}' and mimeType='application/vnd.google-apps.folder' and '${rootD.files[0].id}' in parents and trashed=false`);
      const libD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${libQ}`)).json();
      if (!libD.files?.length) { setLoadStatus("No cards saved yet."); setLoading(false); return; }
      const libId = libD.files[0].id;

      const foldersQ = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and '${libId}' in parents and trashed=false`);
      const foldersD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${foldersQ}&fields=files(id,name)`)).json();
      const folders = foldersD.files || [];
      if (!folders.length) { setLoadStatus("No shotcards saved yet."); setLoading(false); return; }

      const allCards = [];
      for (const folder of folders) {
        setLoadStatus(`Loading "${folder.name}"…`);
        const jsonQ = encodeURIComponent(`mimeType='application/json' and '${folder.id}' in parents and trashed=false`);
        const jsonD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${jsonQ}&fields=files(id,name)`)).json();
        for (const file of (jsonD.files || [])) {
          try {
            const card = await (await gFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)).json();
            allCards.push({ ...card, _fileId: file.id, _folderName: folder.name });
          } catch(e) { console.warn("Failed:", file.name); }
        }
      }
      allCards.sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt));
      setCards(allCards);
      setLoadStatus(`${allCards.length} card${allCards.length !== 1 ? "s" : ""} loaded`);
    } catch(e) { setLoadStatus("Error: " + e.message); }
    setLoading(false);
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAll = () => setSelected(new Set(filtered.map(c => c._fileId)));
  const clearSelection = () => setSelected(new Set());

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} card${selected.size > 1 ? "s" : ""} permanently from Drive?`)) return;
    setDeleteStatus(`Deleting ${selected.size} card${selected.size > 1 ? "s" : ""}…`);
    let deleted = 0;
    for (const fileId of selected) {
      try {
        await gFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" });
        deleted++;
      } catch(e) { console.warn("Delete failed:", fileId); }
    }
    setDeleteStatus(`Deleted ${deleted} card${deleted !== 1 ? "s" : ""} ✓`);
    setTimeout(() => setDeleteStatus(null), 3000);
    setSelected(new Set());
    await loadLibrary();
  };

  // ── Arrange mode ──────────────────────────────────────────────────────────
  const enterArrange = () => {
    const toArrange = selected.size > 0
      ? cards.filter(c => selected.has(c._fileId))
      : filtered;
    setArranged([...toArrange]);
    setMode("arrange");
    setSelected(new Set());
  };

  // Drag and drop
  const onDragStart = (i) => setDragIdx(i);
  const onDragOver = (e, i) => { e.preventDefault(); setDragOverIdx(i); };
  const onDrop = (i) => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...arranged];
    const [item] = next.splice(dragIdx, 1);
    next.splice(i, 0, item);
    setArranged(next);
    setDragIdx(null); setDragOverIdx(null);
  };

  // ── PDF export ────────────────────────────────────────────────────────────
  const loadJsPDF = () => new Promise((res,rej)=>{
    if(window.jspdf){res();return;}
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });

  const exportPDF = async (cardList, title="Storyboard") => {
    setExportStatus("Generating PDF…");
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
    const W=210, H=297, M=18;

    // Cover
    doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
    doc.setFillColor(232,255,71); doc.rect(M,H*0.42,0.8,H*0.36,"F");
    doc.setTextColor(240,237,232); doc.setFontSize(48); doc.setFont("helvetica","bold");
    doc.text("STORY",M+5,H*0.58);
    doc.setTextColor(232,255,71); doc.text("BOARD",M+5,H*0.58+22);
    doc.setTextColor(240,237,232); doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text(`${cardList.length} shots`, M+5, H*0.58+36);
    doc.setTextColor(170,170,170); doc.setFontSize(7);
    doc.text("SCENEDISSECT — SHOT LIBRARY", M, H-8);
    doc.text(new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}), W-M, H-8, {align:"right"});

    // Shot pages
    for (let i=0; i<cardList.length; i++) {
      doc.addPage();
      const s = cardList[i];
      doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
      const ih = H*0.44;
      try {
        const img = new Image();
        await new Promise(r => { img.onload=r; img.src=s.dataUrl; });
        const sa = img.naturalWidth/img.naturalHeight, za = W/ih;
        let dw,dh,dx,dy;
        if(sa<za){dh=ih;dw=ih*sa;dx=(W-dw)/2;dy=0;}
        else{dw=W;dh=W/sa;dx=0;dy=(ih-dh)/2;}
        doc.addImage(s.dataUrl,"JPEG",dx,dy,dw,dh);
      } catch(e){}

      doc.setFillColor(232,255,71); doc.rect(0,ih,W,0.5,"F");
      const y0=ih+8;
      // Shot badge
      doc.setFillColor(232,255,71); doc.roundedRect(M,y0,36,7,1,1,"F");
      doc.setTextColor(7,7,7); doc.setFontSize(7); doc.setFont("helvetica","bold");
      doc.text(`SHOT ${String(i+1).padStart(2,"0")}`,M+18,y0+4.5,{align:"center"});
      // Source
      doc.setFillColor(28,20,0); doc.roundedRect(M+39,y0,W-M-39-M,7,1,1,"F");
      doc.setTextColor(232,200,71); doc.setFontSize(7); doc.setFont("helvetica","normal");
      const srcLabel = `${s.sourceVideo||""}${s.mood?" · "+s.mood:""}`;
      doc.text(srcLabel.slice(0,60), M+42, y0+4.5);

      let cy=y0+14; const c2=M+(W-2*M)/2+3;
      [[M,"SHOT TYPE",s.shotType],[c2,"ANGLE",s.angle]].forEach(([x,l,v])=>{
        doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,x,cy);
        doc.setTextColor(240,237,232);doc.setFontSize(9);doc.setFont("helvetica","bold");doc.text(v||"—",x,cy+6);
      });
      cy+=16;
      [[M,"CAMERA MOVEMENT",s.cameraMovement],[c2,"LENS ESTIMATE",s.lensEstimate]].forEach(([x,l,v])=>{
        doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,x,cy);
        doc.setTextColor(240,237,232);doc.setFontSize(9);doc.setFont("helvetica","bold");doc.text(v||"—",x,cy+6);
      });
      cy+=18; doc.setDrawColor(42,42,42); doc.line(M,cy,W-M,cy); cy+=6;
      [["LIGHTING",s.lighting],["COMPOSITION",s.composition],["SHOOT FOR",s.shootFor]].forEach(([l,txt])=>{
        doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,M,cy);cy+=5;
        doc.setTextColor(...(l==="SHOOT FOR"?[212,160,96]:[220,220,220]));doc.setFontSize(8);
        const lines=doc.splitTextToSize(txt||"",W-2*M);doc.text(lines,M,cy);cy+=lines.length*4+5;
      });
      if(s.userNotes){
        doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text("YOUR NOTES",M,cy);cy+=5;
        doc.setTextColor(200,200,200);doc.setFontSize(8);
        const nLines=doc.splitTextToSize(s.userNotes,W-2*M);doc.text(nLines,M,cy);
      }
      doc.setFillColor(22,22,22);doc.rect(0,H-8,W,8,"F");
      doc.setTextColor(170,170,170);doc.setFontSize(6);
      doc.text("SCENEDISSECT  /  STORYBOARD",M,H-3.5);
      doc.text(`PAGE ${i+2}`,W-M,H-3.5,{align:"right"});
    }

    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`storyboard_${new Date().toISOString().slice(0,10)}.pdf`;
    a.click(); URL.revokeObjectURL(url);
    setExportStatus(null);
  };

  // ── Filters ───────────────────────────────────────────────────────────────
  const videos = ["all", ...new Set(cards.map(c=>c.sourceVideo).filter(Boolean))];
  const moods = ["all", ...new Set(cards.flatMap(c=>(c.mood||"").split(/[,/]/).map(m=>m.trim())).filter(Boolean))];
  const shotTypes = ["all", ...new Set(cards.map(c=>c.shotType).filter(v=>v&&v!=="—"))];

  const filtered = cards.filter(c => {
    if (filterVideo!=="all" && c.sourceVideo!==filterVideo) return false;
    if (filterMood!=="all" && !(c.mood||"").includes(filterMood)) return false;
    if (filterShot!=="all" && c.shotType!==filterShot) return false;
    return true;
  });

  const Sel = ({ label, value, onChange, options }) => (
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,padding:"6px 10px",fontFamily:"'Courier New',monospace",fontSize:11,color:C.textSub,outline:"none"}}>
      {options.map(o=><option key={o} value={o}>{o==="all"?label:o}</option>)}
    </select>
  );

  const numSelected = selected.size;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:${C.bg};min-height:100vh}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}
        .hbtn{transition:opacity 0.15s;cursor:pointer}.hbtn:hover:not(:disabled){opacity:0.75}
        .card-g{transition:border-color 0.15s,transform 0.12s;cursor:pointer}
        .card-g:hover{border-color:${C.accent}!important;transform:translateY(-2px)}
        .card-sel{border-color:${C.accent}!important;background:rgba(232,255,71,0.04)!important}
        .drag-over{border-color:${C.accent}!important;opacity:0.6}
        .dragging{opacity:0.35}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:100;display:flex;align-items:center;justify-content:center;padding:24px}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes pulse{0%,100%{opacity:0.2}50%{opacity:1}}
        select option{background:#141414;color:#f0ede8}
      `}</style>

      <div style={{fontFamily:"'Courier New',monospace",background:C.bg,color:C.text,minHeight:"100vh"}}>

        {/* Top bar */}
        <div style={{height:52,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",background:C.surface,position:"sticky",top:0,zIndex:50}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.accent,boxShadow:"0 0 10px rgba(232,255,71,0.5)"}}/>
              <span style={{fontSize:13,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:C.text}}>Shot Library</span>
            </div>
            <div style={{width:1,height:16,background:C.border2}}/>
            <a href="/" style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textDim,textDecoration:"none",padding:"4px 10px",border:`1px solid ${C.border2}`,borderRadius:4}}
              onMouseEnter={e=>e.target.style.color=C.accent} onMouseLeave={e=>e.target.style.color=C.textDim}>
              ← SceneDissect
            </a>
            {/* Mode toggle */}
            {mode==="arrange" && (
              <button className="hbtn" style={{fontSize:11,color:C.textDim,background:"none",border:`1px solid ${C.border2}`,borderRadius:4,padding:"4px 10px"}} onClick={()=>setMode("browse")}>
                ← Back to Library
              </button>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {mode==="arrange" && (
              <button className="hbtn" style={{fontSize:12,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#080808",background:C.accent,border:"none",borderRadius:4,padding:"7px 18px"}}
                onClick={()=>exportPDF(arranged)} disabled={!!exportStatus}>
                {exportStatus||"↓ Export Storyboard PDF"}
              </button>
            )}
            {token && mode==="browse" && (
              <button className="hbtn" style={{fontSize:11,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:4,padding:"6px 14px",letterSpacing:"0.08em",textTransform:"uppercase"}}
                onClick={loadLibrary} disabled={loading}>↺ Refresh</button>
            )}
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 14px",border:`1px solid ${C.border2}`,borderRadius:4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:token?C.green:C.border2,boxShadow:token?"0 0 6px rgba(34,197,94,0.5)":"none"}}/>
              <span style={{fontSize:11,color:token?C.green:C.textDim}}>{token?userEmail||"Connected":"Not connected"}</span>
            </div>
          </div>
        </div>

        {/* Not connected */}
        {!token && (
          <div style={{maxWidth:420,margin:"100px auto",padding:36,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:20}}>📚</div>
            <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Connect Google Drive</div>
            <div style={{fontSize:12,color:C.textDim,marginBottom:24,lineHeight:1.6}}>Sign in to load your Shot Library.</div>
            {clientId && <div style={{fontSize:10,color:C.textDim,background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,padding:"8px 12px",marginBottom:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{clientId.slice(0,50)}…</div>}
            {!clientId && <input style={{width:"100%",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,padding:"10px 12px",fontFamily:"'Courier New',monospace",fontSize:11,color:C.textSub,outline:"none",marginBottom:12,textAlign:"center"}} placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)}/>}
            <button className="hbtn" style={{width:"100%",padding:"12px",fontSize:13,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:6,border:"none",background:C.accent,color:"#080808"}} onClick={signIn}>Connect Drive</button>
          </div>
        )}

        {/* ── BROWSE MODE ── */}
        {token && mode==="browse" && (
          <div style={{padding:"24px 28px"}}>

            {/* Action bar */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:14,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:C.text}}>
                  {loading?"Loading…":`${filtered.length} Card${filtered.length!==1?"s":""}${filtered.length!==cards.length?` of ${cards.length}`:""}`}
                </span>
                {!loading && <span style={{fontSize:11,color:C.textDim}}>{loadStatus}</span>}
              </div>

              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {/* Filters */}
                <Sel label="All Videos" value={filterVideo} onChange={setFilterVideo} options={videos}/>
                <Sel label="All Shot Types" value={filterShot} onChange={setFilterShot} options={shotTypes}/>
                <Sel label="All Moods" value={filterMood} onChange={setFilterMood} options={moods}/>
                {(filterVideo!=="all"||filterShot!=="all"||filterMood!=="all") && (
                  <button className="hbtn" style={{fontSize:11,color:C.textDim,background:"none",border:`1px solid ${C.border2}`,borderRadius:4,padding:"5px 10px"}} onClick={()=>{setFilterVideo("all");setFilterShot("all");setFilterMood("all");}}>Clear</button>
                )}
              </div>
            </div>

            {/* Selection action bar */}
            {filtered.length>0 && (
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,padding:"12px 16px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,flexWrap:"wrap"}}>
                <button className="hbtn" style={{fontSize:11,color:C.textSub,background:"none",border:`1px solid ${C.border2}`,borderRadius:4,padding:"6px 14px"}} onClick={numSelected===filtered.length?clearSelection:selectAll}>
                  {numSelected===filtered.length?"Deselect All":"Select All"}
                </button>
                <span style={{fontSize:11,color:C.textDim}}>{numSelected>0?`${numSelected} selected`:""}</span>
                <div style={{flex:1}}/>
                {numSelected>0 && <>
                  <button className="hbtn" style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:C.green,background:C.greenDim,border:`1px solid ${C.greenBorder}`,borderRadius:4,padding:"7px 16px"}}
                    onClick={enterArrange}>
                    Arrange + Export ({numSelected} card{numSelected!==1?"s":""})
                  </button>
                  <button className="hbtn" style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:C.red,background:C.redDim,border:`1px solid ${C.redBorder}`,borderRadius:4,padding:"7px 16px"}}
                    onClick={deleteSelected}>
                    Delete ({numSelected})
                  </button>
                </>}
                {numSelected===0 && (
                  <button className="hbtn" style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:4,padding:"7px 16px"}}
                    onClick={enterArrange}>
                    Arrange All + Export
                  </button>
                )}
              </div>
            )}

            {deleteStatus && (
              <div style={{fontSize:12,padding:"10px 14px",borderRadius:6,marginBottom:16,background:C.redDim,color:C.red,border:`1px solid ${C.redBorder}`}}>{deleteStatus}</div>
            )}

            {/* Loading */}
            {loading && (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:12,color:C.textDim,letterSpacing:"0.1em",marginBottom:12}}>{loadStatus}</div>
                <div style={{height:2,background:C.border,borderRadius:1,overflow:"hidden",maxWidth:200,margin:"0 auto"}}>
                  <div style={{height:"100%",background:C.accent,width:"60%",animation:"pulse 1.2s ease-in-out infinite"}}/>
                </div>
              </div>
            )}

            {/* Empty */}
            {!loading && cards.length===0 && (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:48,opacity:0.08,marginBottom:20}}>📷</div>
                <div style={{fontSize:13,letterSpacing:"0.1em",textTransform:"uppercase",color:C.border2,marginBottom:12}}>{loadStatus}</div>
                <a href="/" style={{fontSize:12,color:C.accent,textDecoration:"none"}}>Go to SceneDissect →</a>
              </div>
            )}

            {/* Card grid */}
            {!loading && filtered.length>0 && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
                {filtered.map((card) => {
                  const isSel = selected.has(card._fileId);
                  return (
                    <div key={card._fileId||card.id}
                      className={`card-g${isSel?" card-sel":""}`}
                      style={{border:`1.5px solid ${isSel?C.accent:C.border}`,borderRadius:8,overflow:"hidden",background:isSel?"rgba(232,255,71,0.03)":C.surface,position:"relative"}}
                      onClick={()=>toggleSelect(card._fileId)}>
                      {/* Checkbox overlay */}
                      <div style={{position:"absolute",top:8,right:8,zIndex:2,width:22,height:22,borderRadius:4,border:`2px solid ${isSel?C.accent:"rgba(255,255,255,0.4)"}`,background:isSel?C.accent:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                        {isSel && <span style={{fontSize:12,color:"#000",fontWeight:700}}>✓</span>}
                      </div>
                      {/* View detail button */}
                      <div style={{position:"absolute",bottom:54,right:8,zIndex:2}} onClick={e=>{e.stopPropagation();setSelectedCard(card);}}>
                        <div style={{fontSize:9,background:"rgba(0,0,0,0.8)",color:C.textSub,border:`1px solid ${C.border2}`,borderRadius:3,padding:"3px 8px",letterSpacing:"0.06em",cursor:"pointer"}}>View</div>
                      </div>
                      {/* Frame */}
                      <div style={{background:"#000",position:"relative",minHeight:140,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {card.dataUrl
                          ? <img src={card.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:180,objectFit:"contain",display:"block"}}/>
                          : <div style={{fontSize:28,opacity:0.15}}>🎞</div>
                        }
                        <div style={{position:"absolute",top:6,left:6,fontSize:9,background:"rgba(0,0,0,0.88)",color:C.accent,padding:"3px 7px",borderRadius:3,letterSpacing:"0.08em"}}>{card.shotType||"—"}</div>
                        {card.mood && <div style={{position:"absolute",bottom:6,left:6,right:6,fontSize:9,background:"rgba(0,0,0,0.78)",color:C.text,padding:"3px 6px",borderRadius:3,textAlign:"center",textTransform:"uppercase"}}>{card.mood}</div>}
                      </div>
                      {/* Footer */}
                      <div style={{padding:"10px 12px"}}>
                        <div style={{fontSize:11,color:C.text,fontWeight:600,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.sourceVideo||"Unknown"}</div>
                        <div style={{fontSize:10,color:C.textDim,marginBottom:2}}>{card.angle||"—"} · {card.cameraMovement||"—"}</div>
                        <div style={{fontSize:10,color:C.textDim}}>{card.savedAt?new Date(card.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ARRANGE MODE ── */}
        {token && mode==="arrange" && (
          <div style={{padding:"24px 28px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <span style={{fontSize:14,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:C.text}}>{arranged.length} Shots</span>
              <span style={{fontSize:11,color:C.textDim}}>Drag to reorder · Click Export when ready</span>
            </div>

            {/* Drag-drop strip */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
              {arranged.map((card, i) => (
                <div key={card._fileId||card.id||i}
                  draggable
                  onDragStart={()=>onDragStart(i)}
                  onDragOver={e=>onDragOver(e,i)}
                  onDrop={()=>onDrop(i)}
                  onDragEnd={()=>{setDragIdx(null);setDragOverIdx(null);}}
                  className={dragIdx===i?"dragging":dragOverIdx===i?"drag-over":""}
                  style={{border:`1.5px solid ${dragOverIdx===i?C.accent:C.border}`,borderRadius:8,overflow:"hidden",background:C.surface,cursor:"grab",userSelect:"none",transition:"border-color 0.1s,opacity 0.1s"}}>
                  {/* Sequence number */}
                  <div style={{background:C.accent,padding:"4px 0",textAlign:"center"}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#080808",letterSpacing:"0.1em"}}>#{i+1}</span>
                  </div>
                  {/* Frame */}
                  <div style={{background:"#000",minHeight:120,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                    {card.dataUrl && <img src={card.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:150,objectFit:"contain",display:"block"}}/>}
                    {card.mood && <div style={{position:"absolute",bottom:4,left:4,right:4,fontSize:8,background:"rgba(0,0,0,0.78)",color:C.text,padding:"2px 5px",borderRadius:2,textAlign:"center",textTransform:"uppercase"}}>{card.mood}</div>}
                  </div>
                  {/* Info */}
                  <div style={{padding:"8px 10px"}}>
                    <div style={{fontSize:10,color:C.accent,fontWeight:600,marginBottom:1}}>{card.shotType||"—"}</div>
                    <div style={{fontSize:10,color:C.textSub,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.sourceVideo||"—"}</div>
                    <div style={{fontSize:9,color:C.textDim}}>{card.angle||"—"} · {card.cameraMovement||"—"}</div>
                  </div>
                  {/* Remove from storyboard */}
                  <div style={{padding:"0 10px 8px",display:"flex",justifyContent:"flex-end"}}>
                    <button style={{fontSize:9,color:C.textDim,background:"none",border:`1px solid ${C.border2}`,borderRadius:3,padding:"2px 8px",cursor:"pointer"}}
                      onClick={()=>setArranged(prev=>prev.filter((_,j)=>j!==i))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {arranged.length===0 && (
              <div style={{textAlign:"center",padding:"60px 0",color:C.textDim,fontSize:13}}>All cards removed. <button style={{color:C.accent,background:"none",border:"none",cursor:"pointer",fontSize:13}} onClick={()=>setMode("browse")}>Go back to library</button></div>
            )}
          </div>
        )}

        {/* Card detail overlay */}
        {selectedCard && (
          <div className="overlay" onClick={()=>setSelectedCard(null)} style={{animation:"fadeIn 0.2s ease"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:10,maxWidth:820,width:"100%",maxHeight:"90vh",overflow:"auto",display:"grid",gridTemplateColumns:"300px 1fr"}}>
              <div style={{background:"#000",display:"flex",alignItems:"center",justifyContent:"center",minHeight:320,position:"relative"}}>
                {selectedCard.dataUrl && <img src={selectedCard.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:440,objectFit:"contain",display:"block"}}/>}
                <div style={{position:"absolute",top:10,left:10,fontSize:10,background:"rgba(0,0,0,0.88)",color:C.accent,padding:"4px 10px",borderRadius:3,letterSpacing:"0.1em"}}>
                  SHOT {String(selectedCard.shotNumber||"").padStart(2,"0")} · {selectedCard.time?.toFixed(1)}s
                </div>
              </div>
              <div style={{padding:24,display:"flex",flexDirection:"column",gap:16,overflow:"auto"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:3}}>{selectedCard.sourceVideo||"Unknown"}</div>
                    <div style={{fontSize:11,color:C.textDim}}>{selectedCard.savedAt?new Date(selectedCard.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}</div>
                  </div>
                  <button className="hbtn" onClick={()=>setSelectedCard(null)} style={{fontSize:14,color:C.textDim,background:"none",border:"none",padding:4}}>✕</button>
                </div>
                {selectedCard.mood && <div style={{fontSize:11,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:4,padding:"5px 12px",display:"inline-block",letterSpacing:"0.08em",textTransform:"uppercase"}}>{selectedCard.mood}</div>}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {[["Shot Type",selectedCard.shotType],["Angle",selectedCard.angle],["Movement",selectedCard.cameraMovement],["Lens",selectedCard.lensEstimate]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:3}}>{k}</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.text}}>{v||"—"}</div>
                    </div>
                  ))}
                </div>
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,display:"flex",flexDirection:"column",gap:12}}>
                  {[["Lighting",selectedCard.lighting],["Composition",selectedCard.composition]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:4}}>{k}</div>
                      <div style={{fontSize:12,color:C.textSub,lineHeight:1.6}}>{v||"—"}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"12px 14px"}}>
                  <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.accent,marginBottom:5}}>↳ Shoot For</div>
                  <div style={{fontSize:12,color:C.textSub,lineHeight:1.6}}>{selectedCard.shootFor||"—"}</div>
                </div>
                {selectedCard.sourceVideoLink && (
                  <a href={selectedCard.sourceVideoLink} target="_blank" rel="noreferrer"
                    style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:C.greenDim,border:`1px solid ${C.greenBorder}`,borderRadius:6,textDecoration:"none"}}>
                    <span style={{fontSize:18}}>▶</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:C.green,letterSpacing:"0.05em"}}>View Source Video in Drive</div>
                      <div style={{fontSize:10,color:C.textDim,marginTop:2}}>{selectedCard.sourceVideo}</div>
                    </div>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
