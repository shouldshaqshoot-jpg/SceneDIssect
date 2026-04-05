import { useState, useEffect } from "react";

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
  const [selectedCard, setSelectedCard] = useState(null);
  const [filterVideo, setFilterVideo] = useState("all");
  const [filterMood, setFilterMood] = useState("all");
  const [filterShot, setFilterShot] = useState("all");

  const C = {
    bg:"#070707",surface:"#0d0d0d",surface2:"#111",border:"#1a1a1a",border2:"#222",
    text:"#f0ede8",textSub:"#c8c4bc",textDim:"#666",
    accent:"#e8ff47",accentDim:"rgba(232,255,71,0.07)",accentBorder:"rgba(232,255,71,0.18)",
    green:"#22c55e",greenDim:"rgba(34,197,94,0.07)",greenBorder:"rgba(34,197,94,0.2)",
    red:"#dc2626",
  };

  const signIn = () => {
    if (!clientId.trim()) { alert("Paste your Google Client ID first."); return; }
    localStorage.setItem("sd_cid", clientId.trim());
    const p = new URLSearchParams({ client_id:clientId.trim(), redirect_uri:window.location.origin+"/library", response_type:"token", scope:SCOPES, include_granted_scopes:"true" });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };

  // Handle OAuth redirect
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const p = new URLSearchParams(hash.slice(1));
      const t = p.get("access_token");
      if (t) {
        setToken(t);
        window.history.replaceState(null,"",window.location.pathname);
        fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:"Bearer "+t}})
          .then(r=>r.json()).then(d=>setUserEmail(d.email||"Connected"));
      }
    }
    const saved = localStorage.getItem("sd_cid");
    if (saved) setClientId(saved);
  }, []);

  // Auto-load when token available
  useEffect(() => { if (token) loadLibrary(); }, [token]);

  const gFetch = (url, opts={}) => fetch(url, {
    ...opts, headers: { Authorization:"Bearer "+token, "Content-Type":"application/json", ...(opts.headers||{}) }
  });

  const loadLibrary = async () => {
    setLoading(true); setLoadStatus("Finding Shot Library folder…"); setCards([]);
    try {
      // Find root → library folder
      const rootQ = encodeURIComponent(`name='${DRIVE_ROOT}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const rootR = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${rootQ}`);
      const rootD = await rootR.json();
      if (!rootD.files?.length) { setLoadStatus("No Shot Library found. Analyse a video and save cards first."); setLoading(false); return; }

      const libQ = encodeURIComponent(`name='${LIBRARY_FOLDER}' and mimeType='application/vnd.google-apps.folder' and '${rootD.files[0].id}' in parents and trashed=false`);
      const libR = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${libQ}`);
      const libD = await libR.json();
      if (!libD.files?.length) { setLoadStatus("No Shot Library found. Save some cards from SceneDissect first."); setLoading(false); return; }
      const libId = libD.files[0].id;

      // Get all video subfolders
      setLoadStatus("Loading video folders…");
      const foldersQ = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and '${libId}' in parents and trashed=false`);
      const foldersR = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${foldersQ}&fields=files(id,name)`);
      const foldersD = await foldersR.json();
      const folders = foldersD.files || [];

      if (!folders.length) { setLoadStatus("No shotcards saved yet."); setLoading(false); return; }

      // Get all JSON files from each folder
      const allCards = [];
      for (const folder of folders) {
        setLoadStatus(`Loading cards from "${folder.name}"…`);
        const jsonQ = encodeURIComponent(`mimeType='application/json' and '${folder.id}' in parents and trashed=false`);
        const jsonR = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${jsonQ}&fields=files(id,name,webViewLink)`);
        const jsonD = await jsonR.json();
        for (const file of (jsonD.files||[])) {
          try {
            const content = await gFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
            const card = await content.json();
            allCards.push({ ...card, _fileId: file.id, _folderName: folder.name });
          } catch(e) { console.warn("Failed to load card:", file.name, e); }
        }
      }

      allCards.sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt));
      setCards(allCards);
      setLoadStatus(`${allCards.length} shotcard${allCards.length!==1?"s":""} loaded`);
    } catch(e) {
      setLoadStatus("Error loading library: " + e.message);
    }
    setLoading(false);
  };

  // Derived filter options
  const videos = ["all", ...new Set(cards.map(c=>c.sourceVideo).filter(Boolean))];
  const moods = ["all", ...new Set(cards.flatMap(c=>(c.mood||"").split(/[,/]/).map(m=>m.trim())).filter(Boolean))];
  const shotTypes = ["all", ...new Set(cards.map(c=>c.shotType).filter(v=>v&&v!=="—"))];

  const filtered = cards.filter(c => {
    if (filterVideo !== "all" && c.sourceVideo !== filterVideo) return false;
    if (filterMood !== "all" && !(c.mood||"").includes(filterMood)) return false;
    if (filterShot !== "all" && c.shotType !== filterShot) return false;
    return true;
  });

  const sel = (label, value, onChange, options) => (
    <select value={value} onChange={e=>onChange(e.target.value)} style={{background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,padding:"4px 8px",fontFamily:"'Courier New',monospace",fontSize:9,color:C.textSub,outline:"none",letterSpacing:"0.04em"}}>
      {options.map(o=><option key={o} value={o}>{o==="all"?label:o}</option>)}
    </select>
  );

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{background:${C.bg};min-height:100vh}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px}
        .hbtn{transition:opacity 0.15s;cursor:pointer}.hbtn:hover{opacity:0.78}
        .card-item{transition:border-color 0.15s,transform 0.15s}.card-item:hover{border-color:${C.accent}!important;transform:translateY(-2px)}
        .overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      `}</style>

      <div style={{fontFamily:"'Courier New',monospace",background:C.bg,color:C.text,minHeight:"100vh"}}>

        {/* Top bar */}
        <div style={{height:46,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",background:C.surface,position:"sticky",top:0,zIndex:50}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:C.accent,boxShadow:"0 0 8px rgba(232,255,71,0.4)"}} />
              <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C.text}}>Shot Library</span>
            </div>
            <div style={{width:1,height:14,background:C.border2}} />
            <a href="/" style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,textDecoration:"none",padding:"3px 8px",border:`1px solid ${C.border2}`,borderRadius:3}}
              onMouseEnter={e=>e.target.style.color=C.accent} onMouseLeave={e=>e.target.style.color=C.textDim}>
              ← SceneDissect
            </a>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {token && <button className="hbtn" style={{fontSize:9,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:3,padding:"5px 12px",letterSpacing:"0.08em",textTransform:"uppercase"}} onClick={loadLibrary} disabled={loading}>↺ Refresh</button>}
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:token?C.green:C.border2,boxShadow:token?"0 0 6px rgba(34,197,94,0.5)":"none"}} />
              <span style={{fontSize:9,color:token?C.green:C.textDim}}>{token?userEmail||"Connected":"Not connected"}</span>
            </div>
          </div>
        </div>

        {/* Not connected */}
        {!token && (
          <div style={{maxWidth:400,margin:"80px auto",padding:32,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:16}}>📚</div>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>Connect Google Drive</div>
            <div style={{fontSize:10,color:C.textDim,marginBottom:20,lineHeight:1.6}}>Sign in to load your Shot Library</div>
            <input style={{width:"100%",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,padding:"8px 10px",fontFamily:"'Courier New',monospace",fontSize:9,color:C.textSub,outline:"none",marginBottom:10,textAlign:"center"}} placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)} />
            <button className="hbtn" style={{width:"100%",padding:"10px",fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:4,border:"none",background:C.accent,color:"#080808"}} onClick={signIn}>Connect Drive</button>
          </div>
        )}

        {/* Library content */}
        {token && (
          <div style={{padding:"20px 24px"}}>

            {/* Status bar + filters */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:C.text}}>
                  {loading?"Loading…":`${filtered.length} card${filtered.length!==1?"s":""}${filtered.length!==cards.length?` of ${cards.length}`:""}`}
                </span>
                {!loading&&cards.length>0&&<span style={{fontSize:9,color:C.textDim}}>{loadStatus}</span>}
              </div>
              {cards.length>0&&(
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {sel("All Videos",filterVideo,setFilterVideo,videos)}
                  {sel("All Shot Types",filterShot,setFilterShot,shotTypes)}
                  {sel("All Moods",filterMood,setFilterMood,moods)}
                  {(filterVideo!=="all"||filterShot!=="all"||filterMood!=="all")&&(
                    <button className="hbtn" style={{fontSize:9,color:C.textDim,background:"none",border:`1px solid ${C.border2}`,borderRadius:3,padding:"4px 8px"}} onClick={()=>{setFilterVideo("all");setFilterShot("all");setFilterMood("all");}}>Clear</button>
                  )}
                </div>
              )}
            </div>

            {/* Loading state */}
            {loading && (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:10,color:C.textDim,letterSpacing:"0.1em",marginBottom:8}}>{loadStatus}</div>
                <div style={{height:2,background:C.border,borderRadius:1,overflow:"hidden",maxWidth:200,margin:"0 auto"}}>
                  <div style={{height:"100%",background:C.accent,width:"60%",animation:"pulse 1.2s ease-in-out infinite"}} />
                </div>
              </div>
            )}

            {/* Empty state */}
            {!loading && cards.length===0 && token && (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:40,opacity:0.1,marginBottom:16}}>📷</div>
                <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.border2,marginBottom:8}}>{loadStatus}</div>
                <a href="/" style={{fontSize:9,color:C.accent,textDecoration:"none",letterSpacing:"0.08em"}}>Go to SceneDissect →</a>
              </div>
            )}

            {/* Card grid */}
            {!loading && filtered.length>0 && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
                {filtered.map((card, i) => (
                  <div key={card.id||i} className="card-item" style={{border:`1px solid ${C.border}`,borderRadius:6,overflow:"hidden",background:C.surface,cursor:"pointer"}} onClick={()=>setSelectedCard(card)}>
                    {/* Frame */}
                    <div style={{background:"#000",aspectRatio:card.dataUrl?.includes("data:image")?"auto":"9/16",position:"relative",overflow:"hidden",minHeight:140,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {card.dataUrl ? (
                        <img src={card.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:180,objectFit:"contain",display:"block"}} />
                      ) : (
                        <div style={{fontSize:24,opacity:0.2}}>🎞</div>
                      )}
                      <div style={{position:"absolute",top:5,left:5,fontSize:8,background:"rgba(0,0,0,0.85)",color:C.accent,padding:"2px 6px",borderRadius:2,letterSpacing:"0.08em"}}>
                        {card.shotType||"—"}
                      </div>
                      {card.mood&&<div style={{position:"absolute",bottom:5,left:5,right:5,fontSize:8,background:"rgba(0,0,0,0.75)",color:C.text,padding:"2px 5px",borderRadius:2,textAlign:"center",letterSpacing:"0.04em",textTransform:"uppercase"}}>{card.mood}</div>}
                    </div>
                    {/* Card footer */}
                    <div style={{padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:C.textSub,fontWeight:600,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.sourceVideo||"Unknown"}</div>
                      <div style={{fontSize:8,color:C.textDim,letterSpacing:"0.04em"}}>{card.angle||"—"} · {card.cameraMovement||"—"}</div>
                      <div style={{fontSize:8,color:C.textDim,marginTop:3}}>{card.savedAt?new Date(card.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Card detail overlay */}
        {selectedCard && (
          <div className="overlay-bg" onClick={()=>setSelectedCard(null)} style={{animation:"fadeIn 0.2s ease"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:8,maxWidth:780,width:"100%",maxHeight:"90vh",overflow:"auto",display:"grid",gridTemplateColumns:"280px 1fr"}}>
              {/* Image panel */}
              <div style={{background:"#000",display:"flex",alignItems:"center",justifyContent:"center",minHeight:300,position:"relative"}}>
                {selectedCard.dataUrl&&<img src={selectedCard.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:400,objectFit:"contain",display:"block"}} />}
                <div style={{position:"absolute",top:10,left:10,fontSize:8,background:"rgba(0,0,0,0.88)",color:C.accent,padding:"3px 8px",borderRadius:2,letterSpacing:"0.1em"}}>
                  SHOT {String(selectedCard.shotNumber||"").padStart(2,"0")} · {selectedCard.time?.toFixed(1)}s
                </div>
              </div>

              {/* Details panel */}
              <div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
                {/* Header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:2}}>{selectedCard.sourceVideo||"Unknown"}</div>
                    <div style={{fontSize:9,color:C.textDim}}>{selectedCard.savedAt?new Date(selectedCard.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}</div>
                  </div>
                  <button className="hbtn" onClick={()=>setSelectedCard(null)} style={{fontSize:12,color:C.textDim,background:"none",border:"none",padding:4}}>✕</button>
                </div>

                {/* Mood */}
                {selectedCard.mood&&<div style={{fontSize:9,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:3,padding:"4px 10px",display:"inline-block",letterSpacing:"0.08em",textTransform:"uppercase"}}>{selectedCard.mood}</div>}

                {/* Meta grid */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[["Shot Type",selectedCard.shotType],["Angle",selectedCard.angle],["Movement",selectedCard.cameraMovement],["Lens",selectedCard.lensEstimate]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:2}}>{k}</div>
                      <div style={{fontSize:10,fontWeight:600,color:C.text}}>{v||"—"}</div>
                    </div>
                  ))}
                </div>

                {/* Long fields */}
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,display:"flex",flexDirection:"column",gap:10}}>
                  {[["Lighting",selectedCard.lighting],["Composition",selectedCard.composition]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:3}}>{k}</div>
                      <div style={{fontSize:9,color:C.textSub,lineHeight:1.55}}>{v||"—"}</div>
                    </div>
                  ))}
                </div>

                {/* Shoot for */}
                <div style={{background:"rgba(232,255,71,0.04)",border:`1px solid ${C.accentBorder}`,borderRadius:4,padding:"10px 12px"}}>
                  <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.accent,marginBottom:4}}>↳ Shoot For</div>
                  <div style={{fontSize:9,color:C.textSub,lineHeight:1.6}}>{selectedCard.shootFor||"—"}</div>
                </div>

                {/* User notes */}
                {selectedCard.userNotes&&(
                  <div style={{background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,padding:"10px 12px"}}>
                    <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:4}}>Your Notes</div>
                    <div style={{fontSize:9,color:C.textSub,lineHeight:1.6}}>{selectedCard.userNotes}</div>
                  </div>
                )}

                {/* Source video link */}
                {selectedCard.sourceVideoLink&&(
                  <a href={selectedCard.sourceVideoLink} target="_blank" rel="noreferrer"
                    style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:C.greenDim,border:`1px solid ${C.greenBorder}`,borderRadius:4,textDecoration:"none"}}>
                    <span style={{fontSize:16}}>▶</span>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:C.green,letterSpacing:"0.06em"}}>View Source Video in Drive</div>
                      <div style={{fontSize:8,color:C.textDim,marginTop:1}}>{selectedCard.sourceVideo}</div>
                    </div>
                  </a>
                )}

                {selectedCard.videoFolderLink&&(
                  <a href={selectedCard.videoFolderLink} target="_blank" rel="noreferrer"
                    style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,textDecoration:"none"}}>
                    <span style={{fontSize:14}}>📁</span>
                    <div style={{fontSize:9,color:C.textSub,letterSpacing:"0.04em"}}>Open Drive Folder →</div>
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
