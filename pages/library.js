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
    bg:"#070707", surface:"#0d0d0d", surface2:"#141414", border:"#1e1e1e", border2:"#2a2a2a",
    text:"#f0ede8", textSub:"#c8c4bc", textDim:"#777",
    accent:"#e8ff47", accentDim:"rgba(232,255,71,0.07)", accentBorder:"rgba(232,255,71,0.2)",
    green:"#22c55e", greenDim:"rgba(34,197,94,0.08)", greenBorder:"rgba(34,197,94,0.25)",
    red:"#dc2626",
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
      response_type: "token",
      scope: SCOPES,
      include_granted_scopes: "true",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };

  const gFetch = (url, opts={}) => fetch(url, {
    ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers||{}) }
  });

  const loadLibrary = async () => {
    setLoading(true); setLoadStatus("Finding Shot Library…"); setCards([]);
    try {
      const rootQ = encodeURIComponent(`name='${DRIVE_ROOT}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const rootD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${rootQ}`)).json();
      if (!rootD.files?.length) { setLoadStatus("No Shot Library found. Save some cards from SceneDissect first."); setLoading(false); return; }

      const libQ = encodeURIComponent(`name='${LIBRARY_FOLDER}' and mimeType='application/vnd.google-apps.folder' and '${rootD.files[0].id}' in parents and trashed=false`);
      const libD = await (await gFetch(`https://www.googleapis.com/drive/v3/files?q=${libQ}`)).json();
      if (!libD.files?.length) { setLoadStatus("No cards saved yet. Analyse a video and save cards first."); setLoading(false); return; }
      const libId = libD.files[0].id;

      setLoadStatus("Loading video folders…");
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
            const content = await gFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
            const card = await content.json();
            allCards.push({ ...card, _fileId: file.id, _folderName: folder.name });
          } catch(e) { console.warn("Failed to load card:", file.name); }
        }
      }

      allCards.sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt));
      setCards(allCards);
      setLoadStatus(`${allCards.length} card${allCards.length !== 1 ? "s" : ""} loaded`);
    } catch(e) {
      setLoadStatus("Error: " + e.message);
    }
    setLoading(false);
  };

  const videos = ["all", ...new Set(cards.map(c => c.sourceVideo).filter(Boolean))];
  const moods = ["all", ...new Set(cards.flatMap(c => (c.mood||"").split(/[,/]/).map(m => m.trim())).filter(Boolean))];
  const shotTypes = ["all", ...new Set(cards.map(c => c.shotType).filter(v => v && v !== "—"))];

  const filtered = cards.filter(c => {
    if (filterVideo !== "all" && c.sourceVideo !== filterVideo) return false;
    if (filterMood !== "all" && !(c.mood||"").includes(filterMood)) return false;
    if (filterShot !== "all" && c.shotType !== filterShot) return false;
    return true;
  });

  const Sel = ({ label, value, onChange, options }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:4, padding:"6px 10px", fontFamily:"'Courier New',monospace", fontSize:11, color:C.textSub, outline:"none" }}>
      {options.map(o => <option key={o} value={o}>{o === "all" ? label : o}</option>)}
    </select>
  );

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: ${C.bg}; min-height: 100vh; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        .hbtn { transition: opacity 0.15s; cursor: pointer; } .hbtn:hover { opacity: 0.78; }
        .card-item { transition: border-color 0.15s, transform 0.15s; cursor: pointer; }
        .card-item:hover { border-color: ${C.accent} !important; transform: translateY(-2px); }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 24px; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
      `}</style>

      <div style={{ fontFamily:"'Courier New',monospace", background:C.bg, color:C.text, minHeight:"100vh" }}>

        {/* Top bar */}
        <div style={{ height:52, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 28px", background:C.surface, position:"sticky", top:0, zIndex:50 }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:C.accent, boxShadow:"0 0 10px rgba(232,255,71,0.5)" }} />
              <span style={{ fontSize:13, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:C.text }}>Shot Library</span>
            </div>
            <div style={{ width:1, height:16, background:C.border2 }} />
            <a href="/" style={{ fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", color:C.textDim, textDecoration:"none", padding:"4px 10px", border:`1px solid ${C.border2}`, borderRadius:4 }}
              onMouseEnter={e=>e.target.style.color=C.accent} onMouseLeave={e=>e.target.style.color=C.textDim}>
              ← SceneDissect
            </a>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {token && (
              <button className="hbtn" style={{ fontSize:11, color:C.accent, background:C.accentDim, border:`1px solid ${C.accentBorder}`, borderRadius:4, padding:"6px 14px", letterSpacing:"0.08em", textTransform:"uppercase" }}
                onClick={loadLibrary} disabled={loading}>
                ↺ Refresh
              </button>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", border:`1px solid ${C.border2}`, borderRadius:4 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:token?C.green:C.border2, boxShadow:token?"0 0 6px rgba(34,197,94,0.5)":"none" }} />
              <span style={{ fontSize:11, color:token?C.green:C.textDim }}>{token ? userEmail||"Connected" : "Not connected"}</span>
            </div>
          </div>
        </div>

        {/* Not connected */}
        {!token && (
          <div style={{ maxWidth:420, margin:"100px auto", padding:36, background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:20 }}>📚</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>Connect Google Drive</div>
            <div style={{ fontSize:12, color:C.textDim, marginBottom:24, lineHeight:1.6 }}>
              Sign in to load your Shot Library.<br/>Your Client ID is saved — just click Connect.
            </div>
            {clientId && (
              <div style={{ fontSize:10, color:C.textDim, background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:4, padding:"8px 12px", marginBottom:16, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {clientId.slice(0,40)}…
              </div>
            )}
            {!clientId && (
              <input style={{ width:"100%", background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:4, padding:"10px 12px", fontFamily:"'Courier New',monospace", fontSize:11, color:C.textSub, outline:"none", marginBottom:12, textAlign:"center" }}
                placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)} />
            )}
            <button className="hbtn" style={{ width:"100%", padding:"12px", fontSize:13, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", borderRadius:6, border:"none", background:C.accent, color:"#080808" }}
              onClick={signIn}>
              Connect Drive
            </button>
            {clientId && (
              <button style={{ marginTop:10, fontSize:11, color:C.textDim, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}
                onClick={() => { localStorage.removeItem("sd_cid"); setClientId(""); }}>
                Use a different account
              </button>
            )}
          </div>
        )}

        {/* Library content */}
        {token && (
          <div style={{ padding:"24px 28px" }}>

            {/* Status + filters */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:C.text }}>
                  {loading ? "Loading…" : `${filtered.length} card${filtered.length !== 1 ? "s" : ""}${filtered.length !== cards.length ? ` of ${cards.length}` : ""}`}
                </span>
                {!loading && <span style={{ fontSize:11, color:C.textDim }}>{loadStatus}</span>}
              </div>
              {cards.length > 0 && (
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <Sel label="All Videos" value={filterVideo} onChange={setFilterVideo} options={videos} />
                  <Sel label="All Shot Types" value={filterShot} onChange={setFilterShot} options={shotTypes} />
                  <Sel label="All Moods" value={filterMood} onChange={setFilterMood} options={moods} />
                  {(filterVideo !== "all" || filterShot !== "all" || filterMood !== "all") && (
                    <button className="hbtn" style={{ fontSize:11, color:C.textDim, background:"none", border:`1px solid ${C.border2}`, borderRadius:4, padding:"5px 10px" }}
                      onClick={() => { setFilterVideo("all"); setFilterShot("all"); setFilterMood("all"); }}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Loading */}
            {loading && (
              <div style={{ textAlign:"center", padding:"100px 0" }}>
                <div style={{ fontSize:12, color:C.textDim, letterSpacing:"0.1em", marginBottom:12 }}>{loadStatus}</div>
                <div style={{ height:2, background:C.border, borderRadius:1, overflow:"hidden", maxWidth:200, margin:"0 auto" }}>
                  <div style={{ height:"100%", background:C.accent, width:"60%", animation:"pulse 1.2s ease-in-out infinite" }} />
                </div>
              </div>
            )}

            {/* Empty */}
            {!loading && cards.length === 0 && (
              <div style={{ textAlign:"center", padding:"100px 0" }}>
                <div style={{ fontSize:48, opacity:0.08, marginBottom:20 }}>📷</div>
                <div style={{ fontSize:13, letterSpacing:"0.1em", textTransform:"uppercase", color:C.border2, marginBottom:12 }}>{loadStatus}</div>
                <a href="/" style={{ fontSize:12, color:C.accent, textDecoration:"none", letterSpacing:"0.06em" }}>Go to SceneDissect →</a>
              </div>
            )}

            {/* Grid */}
            {!loading && filtered.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:14 }}>
                {filtered.map((card, i) => (
                  <div key={card.id||i} className="card-item"
                    style={{ border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden", background:C.surface }}
                    onClick={() => setSelectedCard(card)}>
                    {/* Frame */}
                    <div style={{ background:"#000", position:"relative", minHeight:150, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {card.dataUrl
                        ? <img src={card.dataUrl} alt="" style={{ maxWidth:"100%", maxHeight:190, objectFit:"contain", display:"block" }} />
                        : <div style={{ fontSize:28, opacity:0.15 }}>🎞</div>
                      }
                      <div style={{ position:"absolute", top:6, left:6, fontSize:9, background:"rgba(0,0,0,0.88)", color:C.accent, padding:"3px 8px", borderRadius:3, letterSpacing:"0.08em" }}>
                        {card.shotType||"—"}
                      </div>
                      {card.mood && (
                        <div style={{ position:"absolute", bottom:6, left:6, right:6, fontSize:9, background:"rgba(0,0,0,0.78)", color:C.text, padding:"3px 6px", borderRadius:3, textAlign:"center", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                          {card.mood}
                        </div>
                      )}
                    </div>
                    {/* Footer */}
                    <div style={{ padding:"10px 12px" }}>
                      <div style={{ fontSize:12, color:C.text, fontWeight:600, marginBottom:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {card.sourceVideo||"Unknown"}
                      </div>
                      <div style={{ fontSize:10, color:C.textDim, marginBottom:2 }}>{card.angle||"—"} · {card.cameraMovement||"—"}</div>
                      <div style={{ fontSize:10, color:C.textDim }}>
                        {card.savedAt ? new Date(card.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Card detail overlay */}
        {selectedCard && (
          <div className="overlay" onClick={() => setSelectedCard(null)} style={{ animation:"fadeIn 0.2s ease" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background:C.surface, border:`1px solid ${C.border2}`, borderRadius:10, maxWidth:820, width:"100%", maxHeight:"90vh", overflow:"auto", display:"grid", gridTemplateColumns:"300px 1fr" }}>

              {/* Image */}
              <div style={{ background:"#000", display:"flex", alignItems:"center", justifyContent:"center", minHeight:320, position:"relative" }}>
                {selectedCard.dataUrl && <img src={selectedCard.dataUrl} alt="" style={{ maxWidth:"100%", maxHeight:440, objectFit:"contain", display:"block" }} />}
                <div style={{ position:"absolute", top:10, left:10, fontSize:10, background:"rgba(0,0,0,0.88)", color:C.accent, padding:"4px 10px", borderRadius:3, letterSpacing:"0.1em" }}>
                  SHOT {String(selectedCard.shotNumber||"").padStart(2,"0")} · {selectedCard.time?.toFixed(1)}s
                </div>
              </div>

              {/* Details */}
              <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:3 }}>{selectedCard.sourceVideo||"Unknown"}</div>
                    <div style={{ fontSize:11, color:C.textDim }}>
                      {selectedCard.savedAt ? new Date(selectedCard.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : ""}
                    </div>
                  </div>
                  <button className="hbtn" onClick={() => setSelectedCard(null)} style={{ fontSize:14, color:C.textDim, background:"none", border:"none", padding:4 }}>✕</button>
                </div>

                {selectedCard.mood && (
                  <div style={{ fontSize:11, color:C.accent, background:C.accentDim, border:`1px solid ${C.accentBorder}`, borderRadius:4, padding:"5px 12px", display:"inline-block", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                    {selectedCard.mood}
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  {[["Shot Type",selectedCard.shotType],["Angle",selectedCard.angle],["Movement",selectedCard.cameraMovement],["Lens",selectedCard.lensEstimate]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{ fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.textDim, marginBottom:3 }}>{k}</div>
                      <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{v||"—"}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:14, display:"flex", flexDirection:"column", gap:12 }}>
                  {[["Lighting",selectedCard.lighting],["Composition",selectedCard.composition]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{ fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.textDim, marginBottom:4 }}>{k}</div>
                      <div style={{ fontSize:12, color:C.textSub, lineHeight:1.6 }}>{v||"—"}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background:C.accentDim, border:`1px solid ${C.accentBorder}`, borderRadius:6, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.accent, marginBottom:5 }}>↳ Shoot For</div>
                  <div style={{ fontSize:12, color:C.textSub, lineHeight:1.6 }}>{selectedCard.shootFor||"—"}</div>
                </div>

                {selectedCard.sourceVideoLink && (
                  <a href={selectedCard.sourceVideoLink} target="_blank" rel="noreferrer"
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:C.greenDim, border:`1px solid ${C.greenBorder}`, borderRadius:6, textDecoration:"none" }}>
                    <span style={{ fontSize:18 }}>▶</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:C.green, letterSpacing:"0.05em" }}>View Source Video in Drive</div>
                      <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>{selectedCard.sourceVideo}</div>
                    </div>
                  </a>
                )}

                {selectedCard.videoFolderLink && (
                  <a href={selectedCard.videoFolderLink} target="_blank" rel="noreferrer"
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:6, textDecoration:"none" }}>
                    <span style={{ fontSize:16 }}>📁</span>
                    <div style={{ fontSize:12, color:C.textSub }}>Open Drive Folder →</div>
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
