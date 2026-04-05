import { useState, useRef, useCallback } from "react";

const DRIVE_FOLDER_ROOT = "Shot Lists — SceneDissect";
const SHEET_NAME = "Shot List Repository";
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";

export default function SceneDissect() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [videoAspect, setVideoAspect] = useState(16/9);
  const [shotCount, setShotCount] = useState(5);
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [scenes, setScenes] = useState([]);
  const [shots, setShots] = useState([]);
  const [error, setError] = useState(null);
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [creator, setCreator] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const inputRef = useRef();
  const canvasRef = useRef();
  const shotsRef = useRef([]);

  // Slider: 1=fewer shots, 10=more shots
  const getCutThreshold = (sc) => Math.round(35 - (sc - 1) * (27/9));
  // Dup threshold: how different a frame must be vs ALL kept frames to qualify
  // Much stricter than before — kills slow push/zoom duplicates
  const getDupThreshold = (sc) => Math.round(30 - (sc - 1) * (10/9));

  const signIn = () => {
    if (!clientId.trim()) { alert("Paste your Google Client ID first."); return; }
    localStorage.setItem("sd_cid", clientId.trim());
    const params = new URLSearchParams({
      client_id: clientId.trim(), redirect_uri: window.location.origin,
      response_type: "token", scope: SCOPES, include_granted_scopes: "true",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash.includes("access_token") && !token) {
      const p = new URLSearchParams(hash.slice(1));
      const t = p.get("access_token");
      if (t) {
        setTimeout(() => {
          setToken(t);
          window.history.replaceState(null, "", window.location.pathname);
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + t } })
            .then(r => r.json()).then(d => setUserEmail(d.email || "Connected"));
        }, 0);
      }
    }
    const saved = localStorage.getItem("sd_cid");
    if (saved && !clientId) setTimeout(() => setClientId(saved), 0);
  }

  const loadVideo = useCallback((file) => {
    if (!file?.type.startsWith("video/")) return;
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoURL(url);
    setScenes([]); setShots([]); shotsRef.current = [];
    setError(null); setPhase("idle"); setProgress(0); setUploadStatus(null);
    setCreator(file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
    const tmp = document.createElement("video"); tmp.src = url;
    tmp.onloadedmetadata = () => {
      if (tmp.videoWidth && tmp.videoHeight) setVideoAspect(tmp.videoWidth / tmp.videoHeight);
    };
  }, []);

  function frameDiff(ctx, w, h, prev) {
    const curr = ctx.getImageData(0, 0, w, h).data;
    if (!prev) return { diff: 0, data: curr };
    let t = 0, cnt = 0;
    for (let i = 0; i < curr.length; i += 16) {
      t += (Math.abs(curr[i]-prev[i]) + Math.abs(curr[i+1]-prev[i+1]) + Math.abs(curr[i+2]-prev[i+2])) / 3;
      cnt++;
    }
    return { diff: t / cnt, data: curr };
  }

  function arrDiff(a, b) {
    let d = 0, c = 0;
    for (let i = 0; i < a.length && i < b.length; i += 16) {
      d += (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3;
      c++;
    }
    return d / c;
  }

  function extractScenes(file, cutThreshold, dupThreshold, onProg) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
      v.onerror = () => reject(new Error("Cannot load video"));
      v.onloadedmetadata = () => {
        const dur = v.duration, fps = 10, total = Math.floor(dur * fps);
        const cv = canvasRef.current; const ctx = cv.getContext("2d");
        const isPort = v.videoHeight > v.videoWidth;
        const sc = isPort ? Math.min(1, 640/v.videoHeight) : Math.min(1, 640/v.videoWidth);
        cv.width = Math.floor(v.videoWidth * sc); cv.height = Math.floor(v.videoHeight * sc);

        const kept = [];
        let prev = null, idx = 0, first = true;

        const next = () => {
          if (idx >= total) { URL.revokeObjectURL(v.src); resolve(kept); return; }
          v.currentTime = idx / fps; idx++;
        };

        v.onseeked = () => {
          ctx.drawImage(v, 0, 0, cv.width, cv.height);
          const { diff, data } = frameDiff(ctx, cv.width, cv.height, prev);
          const isCut = first || diff > cutThreshold;

          if (isCut) {
            // Must differ from ALL kept frames by dupThreshold
            // This kills slow push/pan/zoom duplicates
            const tooSimilar = kept.some(k => arrDiff(data, k._a) < dupThreshold);
            if (!tooSimilar) {
              kept.push({ time: v.currentTime, dataUrl: cv.toDataURL("image/jpeg", 0.88), _a: data });
              first = false;
            }
          }

          prev = data;
          onProg(Math.round(idx / total * 100));
          next();
        };
        next();
      };
    });
  }

  const run = async () => {
    setError(null); setShots([]); setScenes([]); shotsRef.current = []; setUploadStatus(null);
    setPhase("detecting"); setProgress(0); setStatusMsg("Scanning for scene cuts…");
    let extracted;
    try {
      extracted = await extractScenes(videoFile, getCutThreshold(shotCount), getDupThreshold(shotCount),
        p => { setProgress(p); setStatusMsg(`Scanning… ${p}%`); });
    } catch (e) { setError("Detection failed: " + e.message); setPhase("idle"); return; }
    if (!extracted.length) { setError("No scenes detected. Move slider toward More Shots and try again."); setPhase("idle"); return; }
    setScenes(extracted);
    setStatusMsg(`${extracted.length} scenes found. Analysing with Claude…`);
    setPhase("analysing"); setProgress(0);
    const results = [];
    for (let i = 0; i < extracted.length; i++) {
      setStatusMsg(`Analysing shot ${i+1} of ${extracted.length}…`);
      setProgress(Math.round((i / extracted.length) * 100));
      try {
        const b64 = extracted[i].dataUrl.split(",")[1];
        const res = await fetch("/api/analyse", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: b64, shotNumber: i+1 })
        });
        const analysis = await res.json();
        results.push({ ...analysis, shotNumber: i+1, time: extracted[i].time, dataUrl: extracted[i].dataUrl });
      } catch {
        results.push({ shotNumber: i+1, time: extracted[i].time, dataUrl: extracted[i].dataUrl,
          shotType:"Error", angle:"—", cameraMovement:"—", lighting:"Analysis failed.", composition:"—", mood:"—", lensEstimate:"—", shootFor:"Re-run." });
      }
      setShots([...results]); shotsRef.current = [...results];
    }
    setProgress(100); setPhase("done"); setStatusMsg(`${results.length} shots analysed`);
  };

  const loadJsPDF = () => new Promise((res, rej) => {
    if (window.jspdf) { res(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  const makePDF = async (shotData) => {
    await loadJsPDF(); const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210, H = 297, M = 18;
    doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
    doc.setFillColor(232,255,71); doc.rect(M,H*0.42,0.8,H*0.36,"F");
    doc.setTextColor(240,237,232); doc.setFontSize(52); doc.setFont("helvetica","bold");
    doc.text("SHOT",M+5,H*0.62);
    doc.setTextColor(232,255,71); doc.text("LIST",M+5,H*0.62+22);
    doc.setTextColor(240,237,232); doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text((creator||videoFile?.name||"Video")+"  /  "+shotData.length+" shots",M+5,H*0.62+34);
    doc.setTextColor(170,170,170); doc.setFontSize(7);
    doc.text("SCENEDISSECT",M,H-8);
    doc.text(new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),W-M,H-8,{align:"right"});

    for (let i = 0; i < shotData.length; i++) {
      doc.addPage(); const s = shotData[i];
      doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
      const imgZoneH = H*0.44;
      try {
        const img = new Image(); await new Promise(r=>{img.onload=r;img.src=s.dataUrl;});
        const sa = img.naturalWidth/img.naturalHeight, za = W/imgZoneH;
        let dw,dh,dx,dy;
        if(sa<za){dh=imgZoneH;dw=imgZoneH*sa;dx=(W-dw)/2;dy=0;}
        else{dw=W;dh=W/sa;dx=0;dy=(imgZoneH-dh)/2;}
        doc.addImage(s.dataUrl,"JPEG",dx,dy,dw,dh);
      } catch(e){}
      doc.setFillColor(232,255,71); doc.rect(0,imgZoneH,W,0.5,"F");
      const y0 = imgZoneH+8;
      doc.setFillColor(232,255,71); doc.roundedRect(M,y0,36,7,1,1,"F");
      doc.setTextColor(7,7,7); doc.setFontSize(7); doc.setFont("helvetica","bold");
      doc.text(`SHOT ${String(i+1).padStart(2,"0")}  ·  ${s.time?.toFixed(1)}s`,M+18,y0+4.5,{align:"center"});
      doc.setFillColor(28,20,0); doc.roundedRect(M+39,y0,W-M-39-M,7,1,1,"F");
      doc.setTextColor(232,200,71); doc.setFontSize(7); doc.setFont("helvetica","normal");
      doc.text(s.mood||"",M+42,y0+4.5);
      let cy = y0+14; const c2 = M+(W-2*M)/2+3;
      [[M,"SHOT TYPE",s.shotType],[c2,"ANGLE",s.angle]].forEach(([x,lbl,val])=>{
        doc.setTextColor(170,170,170); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,x,cy);
        doc.setTextColor(240,237,232); doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text(val||"—",x,cy+6);
      });
      cy+=16;
      [[M,"CAMERA MOVEMENT",s.cameraMovement],[c2,"LENS ESTIMATE",s.lensEstimate]].forEach(([x,lbl,val])=>{
        doc.setTextColor(170,170,170); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,x,cy);
        doc.setTextColor(240,237,232); doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text(val||"—",x,cy+6);
      });
      cy+=18; doc.setDrawColor(42,42,42); doc.line(M,cy,W-M,cy); cy+=6;
      [["LIGHTING",s.lighting],["COMPOSITION",s.composition],["SHOOT FOR",s.shootFor]].forEach(([lbl,txt])=>{
        doc.setTextColor(170,170,170); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,M,cy); cy+=5;
        doc.setTextColor(...(lbl==="SHOOT FOR"?[212,160,96]:[220,220,220])); doc.setFontSize(8);
        const lines = doc.splitTextToSize(txt||"",W-2*M);
        doc.text(lines,M,cy); cy+=lines.length*4+5;
      });
      doc.setFillColor(22,22,22); doc.rect(0,H-8,W,8,"F");
      doc.setTextColor(170,170,170); doc.setFontSize(6);
      doc.text("SCENEDISSECT  /  SHOT LIST",M,H-3.5);
      doc.text(`PAGE ${i+2}`,W-M,H-3.5,{align:"right"});
    }
    return doc.output("blob");
  };

  const downloadPDF = async () => {
    const blob = await makePDF(shotsRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `shotlist_${(creator||"video").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const gFetch = (url, opts={}) => fetch(url, {
    ...opts, headers: { Authorization:"Bearer "+token, "Content-Type":"application/json", ...(opts.headers||{}) }
  });

  const getOrCreateRootFolder = async () => {
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_ROOT}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}`); const d = await r.json();
    if (d.files?.length > 0) return d.files[0].id;
    const c = await gFetch("https://www.googleapis.com/drive/v3/files", { method:"POST", body:JSON.stringify({name:DRIVE_FOLDER_ROOT,mimeType:"application/vnd.google-apps.folder"}) });
    return (await c.json()).id;
  };

  const createSubFolder = async (parentId, name) => {
    const c = await gFetch("https://www.googleapis.com/drive/v3/files", { method:"POST", body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",parents:[parentId]}) });
    return (await c.json()).id;
  };

  const uploadFileToDrive = async (folderId, filename, blob) => {
    const meta = JSON.stringify({name:filename,parents:[folderId]});
    const body = new FormData();
    body.append("metadata", new Blob([meta],{type:"application/json"}));
    body.append("file", blob, filename);
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method:"POST", headers:{Authorization:"Bearer "+token}, body });
    return r.json();
  };

  const getOrCreateSheet = async () => {
    const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}`); const d = await r.json();
    if (d.files?.length > 0) return d.files[0].id;
    const c = await gFetch("https://www.googleapis.com/drive/v3/files", { method:"POST", body:JSON.stringify({name:SHEET_NAME,mimeType:"application/vnd.google-apps.spreadsheet"}) });
    const sid = (await c.json()).id;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/A1:I1?valueInputOption=RAW`, {
      method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({values:[["Date","Creator","File Size","Shots","Mood","PDF Link","Video Link","Drive Folder","Notes"]]})
    });
    return sid;
  };

  const uploadToDrive = async () => {
    if (!token) return;
    setUploadStatus({type:"loading",msg:"Generating PDF…"});
    try {
      const pdfBlob = await makePDF(shotsRef.current);
      const date = new Date().toISOString().slice(0,10);
      const safeName = (creator||videoFile?.name||"video").replace(/[^a-z0-9]/gi,"_").slice(0,40);
      const folderName = `${creator||"Video"} — ${date}`;
      setUploadStatus({type:"loading",msg:"Creating Drive folder…"});
      const rootId = await getOrCreateRootFolder();
      const subId = await createSubFolder(rootId, folderName);
      setUploadStatus({type:"loading",msg:"Uploading PDF…"});
      const pdfFile = await uploadFileToDrive(subId, `shotlist_${safeName}_${date}.pdf`, pdfBlob);
      if (pdfFile.error) throw new Error(pdfFile.error.message);
      setUploadStatus({type:"loading",msg:"Uploading video…"});
      const vidFile = await uploadFileToDrive(subId, videoFile.name, videoFile);
      const fr = await gFetch(`https://www.googleapis.com/drive/v3/files/${subId}?fields=webViewLink`);
      const fd = await fr.json(); const fl = fd.webViewLink||"";
      setUploadStatus({type:"loading",msg:"Logging to sheet…"});
      const sid = await getOrCreateSheet();
      const moods = [...new Set(shotsRef.current.map(s=>s.mood).filter(Boolean))].slice(0,3).join(" / ");
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/A:I:append?valueInputOption=USER_ENTERED`, {
        method:"POST", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({values:[[
          new Date().toLocaleDateString("en-GB"), creator||"—",
          `${(videoFile.size/1024/1024).toFixed(1)} MB`, shotsRef.current.length, moods||"—",
          `=HYPERLINK("${pdfFile.webViewLink}","Open PDF")`,
          vidFile.webViewLink?`=HYPERLINK("${vidFile.webViewLink}","Open Video")`:"—",
          `=HYPERLINK("${fl}","Open Folder")`, notes||"—"
        ]]})
      });
      setUploadStatus({type:"success",msg:`Saved to "${folderName}" ✓`,link:fl});
    } catch(e) { setUploadStatus({type:"error",msg:"Upload failed: "+e.message}); }
  };

  const isRunning = phase==="detecting"||phase==="analysing";
  const isDone = phase==="done";
  const isPortrait = videoAspect < 1;
  const sliderLabel = shotCount<=3?"Fewer Shots":shotCount<=7?"Balanced":"More Shots";
  const sliderHint = shotCount<=3?"Major scene changes only":shotCount<=5?"Hard cuts and clear transitions":shotCount<=7?"Most visible cuts":shotCount<=8?"Subtle cuts included":"Every distinct frame change";

  const C = {
    bg:"#070707", surface:"#0d0d0d", surface2:"#111", border:"#1a1a1a", border2:"#222",
    text:"#f0ede8", textSub:"#c8c4bc", textDim:"#888",
    accent:"#e8ff47", accentDim:"rgba(232,255,71,0.07)", accentBorder:"rgba(232,255,71,0.18)",
    green:"#22c55e", greenDim:"rgba(34,197,94,0.07)", greenBorder:"rgba(34,197,94,0.2)",
    red:"#dc2626",
  };

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;background:${C.bg}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px}
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;background:#2a2a2a;outline:none;cursor:pointer;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:${C.accent};cursor:pointer}
        input[type=range]:disabled{opacity:0.35}
        .hbtn{transition:opacity 0.15s;cursor:pointer}
        .hbtn:hover:not(:disabled){opacity:0.78}
        .drop-hover:hover{border-color:${C.accent}!important;background:${C.accentDim}!important}
        .shot-card{animation:slideIn 0.28s ease forwards;opacity:0}
        @keyframes slideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:0.2;transform:scale(0.7)}50%{opacity:1;transform:scale(1)}}
      `}</style>
      <canvas ref={canvasRef} style={{display:"none"}} />

      <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",fontFamily:"'Courier New',monospace",background:C.bg,color:C.text}}>

        {/* Top bar */}
        <div style={{height:46,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",flexShrink:0,background:C.surface}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:C.accent,boxShadow:"0 0 8px rgba(232,255,71,0.4)"}} />
              <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C.text}}>SceneDissect</span>
            </div>
            <div style={{width:1,height:14,background:C.border2}} />
            <span style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim}}>Shot Analysis Tool</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {shots.length > 0 && <>
              <button className="hbtn" style={{padding:"5px 14px",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:3,border:`1px solid ${C.accentBorder}`,background:C.accentDim,color:C.accent}} onClick={downloadPDF}>↓ Export PDF</button>
              <button className="hbtn" style={{padding:"5px 14px",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:3,border:`1px solid ${C.greenBorder}`,background:C.greenDim,color:C.green,opacity:!token?0.35:1,cursor:!token?"not-allowed":"pointer"}} onClick={uploadToDrive} disabled={!token}>↑ Save to Drive</button>
              <div style={{width:1,height:14,background:C.border2}} />
            </>}
            <button className="hbtn" onClick={()=>setShowAuth(a=>!a)} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:token?C.green:C.border2,boxShadow:token?"0 0 6px rgba(34,197,94,0.5)":"none"}} />
              <span style={{fontSize:9,color:token?C.green:C.textDim,letterSpacing:"0.06em"}}>{token?userEmail||"Drive Connected":"Connect Drive"}</span>
            </button>
          </div>
        </div>

        {/* Auth dropdown */}
        {showAuth && (
          <div style={{position:"absolute",top:46,right:16,zIndex:200,background:"#111",border:`1px solid ${C.border2}`,borderRadius:6,padding:16,width:272,boxShadow:"0 12px 32px rgba(0,0,0,0.8)"}}>
            <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.textDim,marginBottom:10}}>Google Drive Connection</div>
            {!token ? <>
              <input style={{width:"100%",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,padding:"6px 8px",fontFamily:"'Courier New',monospace",fontSize:9,color:C.textSub,outline:"none",marginBottom:8}} placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)} />
              <button className="hbtn" style={{width:"100%",padding:"8px",fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:3,border:"none",background:C.accent,color:"#080808",marginBottom:8}} onClick={signIn}>Connect</button>
              <button style={{fontSize:9,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,letterSpacing:"0.08em",textTransform:"uppercase"}} onClick={()=>setShowGuide(g=>!g)}>{showGuide?"▲":"▼"} Setup guide</button>
              {showGuide && <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                {["Go to console.cloud.google.com → new project","Enable Google Drive API + Sheets API","Credentials → OAuth 2.0 Client ID → Web App","Add your Vercel URL to origins + redirect URIs","Paste Client ID above → Connect","OAuth Consent → Audience → add your Gmail"].map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:7,marginBottom:5}}>
                    <span style={{fontSize:9,color:C.accent,flexShrink:0}}>{i+1}.</span>
                    <span style={{fontSize:9,color:C.textSub,lineHeight:1.5}}>{t}</span>
                  </div>
                ))}
              </div>}
            </> : <button className="hbtn" style={{width:"100%",padding:"8px",fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:3,border:`1px solid ${C.border2}`,background:"transparent",color:C.textSub}} onClick={()=>{setToken(null);setUserEmail("");setShowAuth(false);}}>Disconnect</button>}
          </div>
        )}

        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* LEFT panel */}
          <div style={{width:290,flexShrink:0,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface}}>

            {!videoFile ? (
              <div className="drop-hover" style={{margin:12,border:`1px dashed ${C.border2}`,borderRadius:5,height:190,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.2s"}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();loadVideo(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current?.click()}>
                <input ref={inputRef} type="file" accept="video/*" style={{display:"none"}} onChange={e=>loadVideo(e.target.files[0])} />
                <div style={{fontSize:28,marginBottom:8}}>🎞</div>
                <div style={{fontSize:11,color:C.text,fontWeight:700,marginBottom:3}}>Drop video here</div>
                <div style={{fontSize:9,color:C.textDim,letterSpacing:"0.06em"}}>MP4 · MOV · WEBM</div>
              </div>
            ) : (
              <>
                <div style={{background:"#000",display:"flex",alignItems:"center",justifyContent:"center",height:isPortrait?300:180,flexShrink:0,overflow:"hidden"}}>
                  <video src={videoURL} controls playsInline style={{maxWidth:"100%",maxHeight:isPortrait?300:180,width:"auto",height:"auto",display:"block"}} />
                </div>
                <div style={{padding:"6px 12px",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                  <span style={{fontSize:9,color:C.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{videoFile.name}</span>
                  <button style={{fontSize:9,color:C.accent,background:"none",border:"none",cursor:"pointer",flexShrink:0,padding:"2px 6px",marginLeft:4}} onClick={()=>{setVideoFile(null);setVideoURL(null);setShots([]);setScenes([]);setPhase("idle");setVideoAspect(16/9);}}>✕</button>
                </div>
              </>
            )}

            <div style={{flex:1,overflow:"auto",padding:14,display:"flex",flexDirection:"column",gap:18}}>

              <div>
                <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.textDim,marginBottom:10}}>Shot Detection</div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,alignItems:"center"}}>
                  <span style={{fontSize:9,color:C.textSub}}>Fewer</span>
                  <span style={{fontSize:10,color:C.accent,fontWeight:700,letterSpacing:"0.06em"}}>{sliderLabel}</span>
                  <span style={{fontSize:9,color:C.textSub}}>More</span>
                </div>
                <input type="range" min={1} max={10} value={shotCount} step={1} onChange={e=>setShotCount(+e.target.value)} disabled={isRunning} />
                <div style={{fontSize:9,color:C.textDim,textAlign:"center",marginTop:5,letterSpacing:"0.04em"}}>{sliderHint}</div>
              </div>

              <div>
                <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.textDim,marginBottom:10}}>Project</div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {[["Creator / Project",creator,setCreator,"e.g. bgxfilms"],["Notes",notes,setNotes,"Optional…"]].map(([lbl,val,fn,ph])=>(
                    <div key={lbl}>
                      <label style={{fontSize:8,color:C.textDim,display:"block",marginBottom:3,letterSpacing:"0.08em",textTransform:"uppercase"}}>{lbl}</label>
                      <input style={{width:"100%",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,padding:"6px 8px",fontFamily:"'Courier New',monospace",fontSize:10,color:C.text,outline:"none"}} value={val} onChange={e=>fn(e.target.value)} placeholder={ph} />
                    </div>
                  ))}
                </div>
              </div>

              <button className="hbtn" style={{width:"100%",padding:"11px",fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",borderRadius:4,border:"none",background:(!videoFile||isRunning)?"#161616":C.accent,color:(!videoFile||isRunning)?"#333":"#080808",cursor:(!videoFile||isRunning)?"not-allowed":"pointer"}} disabled={!videoFile||isRunning} onClick={run}>
                {isRunning?(phase==="detecting"?"Scanning Video…":"Analysing Shots…"):videoFile?"Detect + Analyse":"Upload Video First"}
              </button>

              {(isRunning||isDone) && (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.1em"}}>{phase==="detecting"?"Scanning":phase==="analysing"?"Analysing":"Complete"}</span>
                    <span style={{fontSize:8,color:isDone?C.green:C.accent}}>{progress}%</span>
                  </div>
                  <div style={{height:2,background:C.border,borderRadius:1,overflow:"hidden",marginBottom:5}}>
                    <div style={{height:"100%",background:isDone?C.green:C.accent,transition:"width 0.3s",width:`${progress}%`}} />
                  </div>
                  <div style={{fontSize:9,color:C.textDim}}>{statusMsg}</div>
                </div>
              )}

              {error && <div style={{fontSize:9,color:C.red,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.15)",borderRadius:3,padding:"8px 10px",lineHeight:1.5}}>{error}</div>}

              {uploadStatus && (
                <div style={{fontSize:9,padding:"8px 10px",borderRadius:3,lineHeight:1.5,
                  background:uploadStatus.type==="success"?C.greenDim:uploadStatus.type==="error"?"rgba(220,38,38,0.06)":C.accentDim,
                  color:uploadStatus.type==="success"?C.green:uploadStatus.type==="error"?C.red:C.accent,
                  border:`1px solid ${uploadStatus.type==="success"?C.greenBorder:uploadStatus.type==="error"?"rgba(220,38,38,0.2)":C.accentBorder}`}}>
                  {uploadStatus.msg}
                  {uploadStatus.link && <><br/><a href={uploadStatus.link} target="_blank" rel="noreferrer" style={{color:C.green,textDecoration:"none"}}>Open Folder →</a></>}
                </div>
              )}

              {isDone && !token && <div style={{fontSize:9,color:C.textDim,textAlign:"center"}}>Connect Drive (top right) to save to your repository</div>}
            </div>

            {scenes.length > 0 && (
              <div style={{borderTop:`1px solid ${C.border}`,padding:"8px 12px",flexShrink:0}}>
                <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:5}}>{scenes.length} Scenes Detected</div>
                <div style={{display:"flex",gap:2,overflowX:"auto",paddingBottom:2}}>
                  {scenes.map((sc,i)=>(
                    <div key={i} style={{flexShrink:0,width:isPortrait?18:32,height:22,borderRadius:2,overflow:"hidden",border:shots[i]?`1px solid ${C.accent}`:`1px solid ${C.border}`,background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <img src={sc.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — shot list */}
          <div style={{flex:1,overflow:"auto",background:C.bg}}>
            <div style={{padding:"12px 22px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"rgba(7,7,7,0.96)",backdropFilter:"blur(8px)",zIndex:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:shots.length?C.text:C.border2}}>{shots.length?"Shot List":"No Analysis Yet"}</span>
                {shots.length > 0 && <span style={{fontSize:9,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,padding:"2px 8px",borderRadius:2,letterSpacing:"0.08em"}}>{shots.length} SHOTS</span>}
              </div>
              {isRunning && <div style={{display:"flex",alignItems:"center",gap:5}}>
                {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:C.accent,animation:`pulse 1s ease-in-out ${i*0.15}s infinite`}} />)}
                <span style={{fontSize:9,color:C.textDim,marginLeft:3}}>{statusMsg}</span>
              </div>}
            </div>

            {!shots.length && !isRunning && (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"65%",gap:10}}>
                <div style={{fontSize:40,opacity:0.1}}>🎬</div>
                <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.border2}}>Drop a video · Hit Detect + Analyse</div>
                <div style={{fontSize:9,color:C.border2,letterSpacing:"0.06em"}}>Shot cards appear here as Claude analyses each scene</div>
              </div>
            )}

            <div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:10}}>
              {shots.map((shot,i)=>(
                <div key={i} className="shot-card" style={{display:"grid",gridTemplateColumns:isPortrait?"110px 1fr":"200px 1fr",border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden",background:C.surface,animationDelay:`${i*0.025}s`}}>
                  <div style={{position:"relative",background:"#000",minHeight:isPortrait?170:130,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <img src={shot.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}} />
                    <div style={{position:"absolute",top:5,left:5,fontSize:8,letterSpacing:"0.1em",background:"rgba(0,0,0,0.88)",color:C.accent,padding:"2px 6px",borderRadius:2}}>
                      {String(shot.shotNumber).padStart(2,"0")} · {shot.time?.toFixed(1)}s
                    </div>
                    {shot.mood && <div style={{position:"absolute",bottom:5,left:5,right:5,fontSize:8,letterSpacing:"0.06em",textTransform:"uppercase",background:"rgba(0,0,0,0.75)",color:C.text,padding:"2px 5px",borderRadius:2,textAlign:"center"}}>{shot.mood}</div>}
                  </div>
                  <div style={{padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {[["Shot Type",shot.shotType],["Angle",shot.angle],["Movement",shot.cameraMovement],["Lens",shot.lensEstimate]].map(([k,v])=>(
                        <div key={k}>
                          <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:2}}>{k}</div>
                          <div style={{fontSize:10,fontWeight:600,color:C.text,lineHeight:1.3}}>{v||"—"}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:8,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {[["Lighting",shot.lighting],["Composition",shot.composition]].map(([k,v])=>(
                        <div key={k}>
                          <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:2}}>{k}</div>
                          <div style={{fontSize:9,color:C.textSub,lineHeight:1.5}}>{v||"—"}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:8}}>
                      <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.accent,marginBottom:3}}>↳ Shoot For</div>
                      <div style={{fontSize:9,color:C.textSub,lineHeight:1.6}}>{shot.shootFor||"—"}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
