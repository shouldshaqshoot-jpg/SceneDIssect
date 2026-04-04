import { useState, useRef, useCallback } from "react";

const DRIVE_FOLDER = "Shot Lists — SceneDissect";
const SHEET_NAME = "Shot List Repository";
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";

export default function SceneDissect() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [sensitivity, setSensitivity] = useState(18);
  const [dragOver, setDragOver] = useState(false);
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
  const [creator, setCreator] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const [driveLink, setDriveLink] = useState(null);
  const [pdfReady, setPdfReady] = useState(false);
  const inputRef = useRef();
  const canvasRef = useRef();
  const shotsRef = useRef([]);

  // ── Google OAuth ──────────────────────────────────────────────────────────
  const signIn = () => {
    if (!clientId.trim()) { alert("Paste your Google Client ID first."); return; }
    localStorage.setItem("sd_cid", clientId.trim());
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: window.location.origin,
      response_type: "token",
      scope: SCOPES,
      include_granted_scopes: "true",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  // Check for OAuth token in URL hash on load
  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash.includes("access_token") && !token) {
      const p = new URLSearchParams(hash.slice(1));
      const t = p.get("access_token");
      if (t) {
        setTimeout(() => {
          setToken(t);
          window.history.replaceState(null, "", window.location.pathname);
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: "Bearer " + t }
          }).then(r => r.json()).then(d => setUserEmail(d.email || "Connected"));
        }, 0);
      }
    }
  }

  // ── Video load ────────────────────────────────────────────────────────────
  const loadVideo = useCallback((file) => {
    if (!file?.type.startsWith("video/")) return;
    setVideoFile(file);
    setVideoURL(URL.createObjectURL(file));
    setScenes([]); setShots([]); shotsRef.current = [];
    setError(null); setPhase("idle"); setProgress(0);
    setUploadStatus(null); setDriveLink(null); setPdfReady(false);
    setCreator(file.name.replace(/\.[^.]+$/, "").replace(/_/g, " "));
  }, []);

  // ── Scene detection ───────────────────────────────────────────────────────
  function frameDiff(ctx, w, h, prev) {
    const curr = ctx.getImageData(0, 0, w, h).data;
    if (!prev) return { diff: 0, data: curr };
    let t = 0, c = 0;
    for (let i = 0; i < curr.length; i += 16) {
      t += (Math.abs(curr[i]-prev[i]) + Math.abs(curr[i+1]-prev[i+1]) + Math.abs(curr[i+2]-prev[i+2])) / 3;
      c++;
    }
    return { diff: t / c, data: curr };
  }

  function extractScenes(file, sens, onProg) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.src = URL.createObjectURL(file);
      v.onerror = () => reject(new Error("Cannot load video"));
      v.onloadedmetadata = () => {
        const dur = v.duration, fps = 10, total = Math.floor(dur * fps);
        const cv = canvasRef.current;
        const ctx = cv.getContext("2d");
        const sc = Math.min(1, 640 / v.videoWidth);
        cv.width = Math.floor(v.videoWidth * sc);
        cv.height = Math.floor(v.videoHeight * sc);
        const out = []; let prev = null, idx = 0, first = true;
        const next = () => {
          if (idx >= total) { URL.revokeObjectURL(v.src); resolve(out); return; }
          v.currentTime = idx / fps; idx++;
        };
        v.onseeked = () => {
          ctx.drawImage(v, 0, 0, cv.width, cv.height);
          const { diff, data } = frameDiff(ctx, cv.width, cv.height, prev);
          let minD = 999;
          if (out.length > 0) {
            minD = out.reduce((m, s) => {
              if (!s._a) return m;
              let d = 0, c = 0;
              for (let i = 0; i < data.length && i < s._a.length; i += 16) {
                d += (Math.abs(data[i]-s._a[i]) + Math.abs(data[i+1]-s._a[i+1]) + Math.abs(data[i+2]-s._a[i+2])) / 3;
                c++;
              }
              return Math.min(m, d / c);
            }, 999);
          }
          if ((first || diff > sens) && minD >= 10) {
            out.push({ time: v.currentTime, dataUrl: cv.toDataURL("image/jpeg", 0.85), _a: data });
            first = false;
          }
          prev = data;
          onProg(Math.round(idx / total * 100));
          next();
        };
        next();
      };
    });
  }

  // ── Run analysis ──────────────────────────────────────────────────────────
  const run = async () => {
    setError(null); setShots([]); setScenes([]); shotsRef.current = [];
    setUploadStatus(null); setDriveLink(null); setPdfReady(false);
    setPhase("detecting"); setProgress(0);
    setStatusMsg("Scanning for scene cuts…");

    let extracted;
    try {
      extracted = await extractScenes(videoFile, sensitivity, p => { setProgress(p); setStatusMsg(`Scanning… ${p}%`); });
    } catch (e) { setError("Detection failed: " + e.message); setPhase("idle"); return; }

    if (!extracted.length) { setError("No scenes found. Lower sensitivity and try again."); setPhase("idle"); return; }
    setScenes(extracted);
    setStatusMsg(`${extracted.length} scenes found. Analysing with Claude…`);
    setPhase("analysing"); setProgress(0);

    const results = [];
    for (let i = 0; i < extracted.length; i++) {
      setStatusMsg(`Analysing shot ${i + 1} of ${extracted.length}…`);
      setProgress(Math.round((i / extracted.length) * 100));
      try {
        const b64 = extracted[i].dataUrl.split(",")[1];
        const res = await fetch("/api/analyse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: b64, shotNumber: i + 1 })
        });
        const analysis = await res.json();
        const shot = { ...analysis, shotNumber: i + 1, time: extracted[i].time, dataUrl: extracted[i].dataUrl };
        results.push(shot);
      } catch {
        results.push({ shotNumber: i+1, time: extracted[i].time, dataUrl: extracted[i].dataUrl,
          shotType:"Error", angle:"—", cameraMovement:"—", lighting:"Analysis failed.", composition:"—", mood:"—", lensEstimate:"—", shootFor:"Re-run." });
      }
      setShots([...results]);
      shotsRef.current = [...results];
    }

    setProgress(100); setPhase("done"); setPdfReady(true);
    setStatusMsg(`Done — ${results.length} shots analysed.`);
  };

  // ── PDF generation ────────────────────────────────────────────────────────
  const loadJsPDF = () => new Promise((res, rej) => {
    if (window.jspdf) { res(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  const makePDF = async (shotData) => {
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210, H = 297, M = 18;

    // Cover
    doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
    doc.setFillColor(232,255,71); doc.rect(M, H*0.42, 0.8, H*0.36, "F");
    doc.setTextColor(240,237,232); doc.setFontSize(52); doc.setFont("helvetica","bold");
    doc.text("SHOT", M+5, H*0.62);
    doc.setTextColor(232,255,71);
    doc.text("LIST", M+5, H*0.62+22);
    doc.setTextColor(100,100,100); doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text((creator || videoFile?.name || "Video") + "  /  " + shotData.length + " shots", M+5, H*0.62+34);
    doc.setTextColor(85,85,85); doc.setFontSize(7);
    doc.text("SCENEDISSECT", M, H-8);
    doc.text(new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}), W-M, H-8, {align:"right"});

    // Shot pages
    for (let i = 0; i < shotData.length; i++) {
      doc.addPage();
      const s = shotData[i];
      doc.setFillColor(7,7,7); doc.rect(0,0,W,H,"F");
      const ih = H * 0.44;
      try { doc.addImage(s.dataUrl,"JPEG",0,0,W,ih); } catch(e) {}
      doc.setFillColor(232,255,71); doc.rect(0,ih,W,0.5,"F");

      const y0 = ih + 8;
      doc.setFillColor(232,255,71); doc.roundedRect(M,y0,36,7,1,1,"F");
      doc.setTextColor(7,7,7); doc.setFontSize(7); doc.setFont("helvetica","bold");
      doc.text(`SHOT ${String(i+1).padStart(2,"0")}  ·  ${s.time?.toFixed(1)}s`, M+18, y0+4.5, {align:"center"});
      doc.setFillColor(28,20,0); doc.roundedRect(M+39,y0,W-M-39-M,7,1,1,"F");
      doc.setTextColor(232,200,71); doc.setFontSize(7); doc.setFont("helvetica","normal");
      doc.text(s.mood||"", M+42, y0+4.5);

      let cy = y0 + 14;
      const c2 = M + (W-2*M)/2 + 3;

      [[M,"SHOT TYPE",s.shotType],[c2,"ANGLE",s.angle]].forEach(([x,lbl,val]) => {
        doc.setTextColor(85,85,85); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,x,cy);
        doc.setTextColor(240,237,232); doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text(val||"—",x,cy+6);
      });
      cy += 16;
      [[M,"CAMERA MOVEMENT",s.cameraMovement],[c2,"LENS ESTIMATE",s.lensEstimate]].forEach(([x,lbl,val]) => {
        doc.setTextColor(85,85,85); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,x,cy);
        doc.setTextColor(240,237,232); doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text(val||"—",x,cy+6);
      });
      cy += 18;
      doc.setDrawColor(42,42,42); doc.line(M,cy,W-M,cy); cy += 6;

      [["LIGHTING",s.lighting],["COMPOSITION",s.composition],["SHOOT FOR",s.shootFor]].forEach(([lbl,txt]) => {
        doc.setTextColor(85,85,85); doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.text(lbl,M,cy); cy+=5;
        const color = lbl==="SHOOT FOR" ? [212,160,96] : [170,170,170];
        doc.setTextColor(...color); doc.setFontSize(8);
        const lines = doc.splitTextToSize(txt||"", W-2*M);
        doc.text(lines,M,cy); cy += lines.length*4+5;
      });

      doc.setFillColor(22,22,22); doc.rect(0,H-8,W,8,"F");
      doc.setTextColor(85,85,85); doc.setFontSize(6);
      doc.text("SCENEDISSECT  /  SHOT LIST",M,H-3.5);
      doc.text(`PAGE ${i+2}`,W-M,H-3.5,{align:"right"});
    }
    return doc.output("blob");
  };

  const downloadPDF = async () => {
    const blob = await makePDF(shotsRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shotlist_${(creator||"video").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Drive / Sheets ────────────────────────────────────────────────────────
  const gFetch = (url, opts = {}) => fetch(url, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers||{}) }
  });

  const getOrCreateFolder = async () => {
    const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}`);
    const d = await r.json();
    if (d.files?.length > 0) return d.files[0].id;
    const c = await gFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST", body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" })
    });
    return (await c.json()).id;
  };

  const getOrCreateSheet = async () => {
    const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}`);
    const d = await r.json();
    if (d.files?.length > 0) return d.files[0].id;
    const c = await gFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST", body: JSON.stringify({ name: SHEET_NAME, mimeType: "application/vnd.google-apps.spreadsheet" })
    });
    const sid = (await c.json()).id;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/A1:H1?valueInputOption=RAW`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [["Date","Creator","File Size","Shots","Mood","PDF Link","Drive File ID","Notes"]] })
    });
    return sid;
  };

  const uploadToDrive = async () => {
    if (!token) return;
    setUploadStatus({ type: "loading", msg: "Generating PDF…" });
    try {
      const blob = await makePDF(shotsRef.current);
      setUploadStatus({ type: "loading", msg: "Uploading to Google Drive…" });
      const folderId = await getOrCreateFolder();
      const date = new Date().toISOString().slice(0,10);
      const safe = (creator||videoFile?.name||"video").replace(/[^a-z0-9]/gi,"_").slice(0,40);
      const filename = `shotlist_${safe}_${date}.pdf`;
      const meta = JSON.stringify({ name: filename, parents: [folderId] });
      const body = new FormData();
      body.append("metadata", new Blob([meta], { type: "application/json" }));
      body.append("file", blob, filename);
      const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
        method: "POST", headers: { Authorization: "Bearer " + token }, body
      });
      const file = await uploadRes.json();
      if (file.error) throw new Error(file.error.message);
      setDriveLink(file.webViewLink);
      setUploadStatus({ type: "loading", msg: "Logging to Sheet…" });
      const sheetId = await getOrCreateSheet();
      const moods = [...new Set(shotsRef.current.map(s=>s.mood).filter(Boolean))].slice(0,3).join(" / ");
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:H:append?valueInputOption=USER_ENTERED`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [[
          new Date().toLocaleDateString("en-GB"),
          creator||videoFile?.name||"—",
          `${(videoFile.size/1024/1024).toFixed(1)} MB`,
          shotsRef.current.length,
          moods||"—",
          `=HYPERLINK("${file.webViewLink}","Open PDF")`,
          file.id,
          notes||"—"
        ]]})
      });
      setUploadStatus({ type: "success", msg: "Saved to Drive & logged in Sheet ✓", link: file.webViewLink });
    } catch(e) {
      setUploadStatus({ type: "error", msg: "Upload failed: " + e.message });
    }
  };

  const isRunning = phase === "detecting" || phase === "analysing";

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    app: { maxWidth:920, margin:"0 auto", padding:"0 20px 80px", fontFamily:"'Courier New',monospace", background:"#070707", minHeight:"100vh", color:"#f0ede8" },
    hdr: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"40px 0 32px", borderBottom:"1px solid #1f1f1f", marginBottom:"32px", gap:20, flexWrap:"wrap" },
    h1: { fontSize:"clamp(32px,6vw,56px)", fontWeight:800, lineHeight:1, letterSpacing:"-0.03em", fontFamily:"sans-serif" },
    accent: { color:"#e8ff47" },
    eyebrow: { fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#e8ff47", marginBottom:10 },
    authBox: { background:"#0f0f0f", border:"1px solid #1f1f1f", borderRadius:8, padding:"14px 16px", minWidth:210 },
    authLbl: { fontSize:10, letterSpacing:"0.15em", textTransform:"uppercase", color:"#555", marginBottom:10 },
    statusRow: { display:"flex", alignItems:"center", gap:8, marginBottom:10 },
    dot: (on) => ({ width:7, height:7, borderRadius:"50%", background: on?"#22c55e":"#444", boxShadow: on?"0 0 8px rgba(34,197,94,0.5)":"none", flexShrink:0 }),
    statusTxt: (on) => ({ fontSize:11, color: on?"#22c55e":"#666" }),
    cidInp: { width:"100%", background:"#161616", border:"1px solid #2a2a2a", borderRadius:4, padding:"6px 8px", fontFamily:"'Courier New',monospace", fontSize:9, color:"#aaa", outline:"none", marginBottom:8, boxSizing:"border-box" },
    gBtn: (primary) => ({ width:"100%", padding:"8px 12px", fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", borderRadius:4, border: primary?"1px solid #e8ff47":"1px solid #2a2a2a", background: primary?"#e8ff47":"transparent", color: primary?"#080808":"#aaa" }),
    guideToggle: { fontSize:10, color:"#e8ff47", background:"none", border:"none", cursor:"pointer", padding:"6px 0 0", letterSpacing:"0.1em", textTransform:"uppercase" },
    guide: { background:"#0f0f0f", border:"1px solid #1f1f1f", borderLeft:"3px solid #e8ff47", borderRadius:8, padding:"16px 18px", marginBottom:20 },
    guideTitle: { fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#e8ff47", marginBottom:12 },
    step: { display:"flex", gap:10, marginBottom:8, alignItems:"flex-start" },
    stepN: { width:18, height:18, borderRadius:"50%", background:"rgba(232,255,71,0.08)", border:"1px solid rgba(232,255,71,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#e8ff47", flexShrink:0, fontWeight:700 },
    stepT: { fontSize:11, color:"#888", lineHeight:1.6 },
    drop: { border:"1px dashed #2a2a2a", borderRadius:8, padding:"40px 24px", textAlign:"center", cursor:"pointer", background:"#0f0f0f", marginBottom:16 },
    vidWrap: { border:"1px solid #1f1f1f", borderRadius:8, overflow:"hidden", marginBottom:16 },
    vidBar: { padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"1px solid #1f1f1f", background:"#0f0f0f" },
    ctrlRow: { display:"flex", alignItems:"center", gap:14, padding:"12px 16px", background:"#0f0f0f", border:"1px solid #1f1f1f", borderRadius:6, marginBottom:14, flexWrap:"wrap" },
    runBtn: { width:"100%", padding:16, fontSize:12, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", cursor:"pointer", borderRadius:8, border:"none", background:"#e8ff47", color:"#080808", marginBottom:28 },
    progWrap: { marginBottom:28 },
    progHdr: { display:"flex", justifyContent:"space-between", marginBottom:6 },
    progLbl: { fontSize:10, color:"#666", textTransform:"uppercase", letterSpacing:"0.1em" },
    progPct: { fontSize:10, color:"#e8ff47" },
    progBar: { height:2, background:"#1f1f1f", borderRadius:2, overflow:"hidden", marginBottom:6 },
    progFill: { height:"100%", background:"#e8ff47", transition:"width 0.3s" },
    progMsg: { fontSize:10, color:"#555" },
    strip: { display:"flex", gap:4, overflowX:"auto", paddingBottom:4, marginBottom:22 },
    thumb: (done) => ({ width:60, height:40, flexShrink:0, borderRadius:3, overflow:"hidden", border: done?"1px solid #e8ff47":"1px solid #1f1f1f", position:"relative" }),
    savePanel: { border:"1px solid #1f1f1f", borderRadius:8, padding:"18px 20px", marginBottom:24, background:"#0f0f0f" },
    saveTitle: { fontSize:10, letterSpacing:"0.15em", textTransform:"uppercase", color:"#22c55e", marginBottom:14, display:"flex", alignItems:"center", gap:7 },
    saveGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 },
    saveField: { display:"flex", flexDirection:"column", gap:4 },
    saveLabel: { fontSize:9, color:"#555", letterSpacing:"0.1em", textTransform:"uppercase" },
    saveInp: { background:"#161616", border:"1px solid #2a2a2a", borderRadius:4, padding:"7px 10px", fontFamily:"'Courier New',monospace", fontSize:11, color:"#f0ede8", outline:"none" },
    btnRow: { display:"flex", gap:10 },
    dlBtn: { flex:1, padding:10, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer", borderRadius:4, border:"1px solid rgba(232,255,71,0.3)", background:"rgba(232,255,71,0.06)", color:"#e8ff47" },
    upBtn: (disabled) => ({ flex:1, padding:10, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", cursor: disabled?"not-allowed":"pointer", borderRadius:4, border:"1px solid rgba(34,197,94,0.3)", background:"rgba(34,197,94,0.06)", color:"#22c55e", opacity: disabled?0.4:1 }),
    upMsg: (type) => ({ marginTop:10, fontSize:11, padding:"8px 12px", borderRadius:4, background: type==="success"?"rgba(34,197,94,0.08)":type==="error"?"rgba(220,38,38,0.06)":"rgba(232,255,71,0.06)", color: type==="success"?"#22c55e":type==="error"?"#dc2626":"#e8ff47", border:`1px solid ${type==="success"?"rgba(34,197,94,0.2)":type==="error"?"rgba(220,38,38,0.2)":"rgba(232,255,71,0.15)"}` }),
    resultsHdr: { display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:18, paddingBottom:12, borderBottom:"1px solid #1f1f1f" },
    resultsTitle: { fontSize:16, fontWeight:700, fontFamily:"sans-serif" },
    ct: { fontSize:10, color:"#e8ff47" },
    card: { display:"grid", gridTemplateColumns:"240px 1fr", border:"1px solid #1f1f1f", borderRadius:8, overflow:"hidden", marginBottom:14, background:"#0f0f0f" },
    cardImg: { position:"relative", overflow:"hidden", background:"#000", minHeight:160 },
    badge: { position:"absolute", top:8, left:8, fontSize:9, letterSpacing:"0.12em", background:"rgba(0,0,0,0.8)", color:"#e8ff47", padding:"3px 7px", borderRadius:3 },
    moodTag: { position:"absolute", bottom:8, left:8, right:8, fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", background:"rgba(0,0,0,0.65)", color:"#f0ede8", padding:"3px 7px", borderRadius:3, textAlign:"center" },
    cardBody: { padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 },
    metaGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 },
    mk: { fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#444", marginBottom:2 },
    mv: { fontSize:11, fontWeight:600, color:"#f0ede8", lineHeight:1.3 },
    mvSm: { fontSize:11, fontWeight:400, color:"#888", lineHeight:1.5, gridColumn:"1/-1" },
    sfBlock: { borderTop:"1px solid #1f1f1f", paddingTop:10 },
    sfKey: { fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#e8ff47", marginBottom:4 },
    sfVal: { fontSize:11, color:"#888", lineHeight:1.6 },
  };

  return (
    <div style={s.app}>
      <canvas ref={canvasRef} style={{ display:"none" }} />

      {/* Header */}
      <div style={s.hdr}>
        <div>
          <div style={s.eyebrow}>Shot Analysis Tool</div>
          <div style={s.h1}>Scene<span style={s.accent}>Dissect.</span></div>
        </div>

        {/* Auth panel */}
        <div style={s.authBox}>
          <div style={s.authLbl}>Google Drive</div>
          <div style={s.statusRow}>
            <div style={s.dot(!!token)} />
            <span style={s.statusTxt(!!token)}>{token ? userEmail || "Connected" : "Not connected"}</span>
          </div>
          {!token ? (
            <>
              <input style={s.cidInp} placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)} />
              <button style={s.gBtn(true)} onClick={signIn}>Connect Google Drive</button>
              <button style={s.guideToggle} onClick={()=>setShowGuide(g=>!g)}>{showGuide?"▲":"▼"} Setup guide</button>
            </>
          ) : (
            <button style={s.gBtn(false)} onClick={()=>{ setToken(null); setUserEmail(""); }}>Disconnect</button>
          )}
        </div>
      </div>

      {/* Setup guide */}
      {showGuide && !token && (
        <div style={s.guide}>
          <div style={s.guideTitle}>Google Cloud Setup — 10 minutes</div>
          {[
            <>Go to <a href="https://console.cloud.google.com" target="_blank" style={{color:"#e8ff47"}}>console.cloud.google.com</a> → create a new project</>,
            <>APIs & Services → Library → enable Google Drive API and Google Sheets API</>,
            <>Credentials → Create Credentials → OAuth 2.0 Client ID → Web Application</>,
            <>Authorised JavaScript origins → add your Vercel URL (e.g. https://scenedissect.vercel.app)</>,
            <>Authorised redirect URIs → add the same Vercel URL</>,
            <>Copy the Client ID, paste above, click Connect</>,
            <>OAuth Consent Screen → Test Users → add your Gmail address</>,
          ].map((text, i) => (
            <div key={i} style={s.step}>
              <div style={s.stepN}>{i+1}</div>
              <div style={s.stepT}>{text}</div>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {!videoFile ? (
        <div style={s.drop}
          onDragOver={e=>{e.preventDefault();}}
          onDrop={e=>{e.preventDefault(); loadVideo(e.dataTransfer.files[0]);}}
          onClick={()=>inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept="video/*" style={{display:"none"}} onChange={e=>loadVideo(e.target.files[0])} />
          <div style={{fontSize:32,marginBottom:10}}>🎞</div>
          <div style={{fontSize:14,fontWeight:700,fontFamily:"sans-serif",marginBottom:4}}>Drop your video here</div>
          <div style={{fontSize:12,color:"#555"}}>MP4 · MOV · WEBM</div>
        </div>
      ) : (
        <div style={s.vidWrap}>
          <video src={videoURL} controls playsInline style={{width:"100%",maxHeight:280,display:"block",background:"#000"}} />
          <div style={s.vidBar}>
            <span style={{fontSize:11,color:"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📽 {videoFile.name}</span>
            <button style={{fontSize:10,color:"#e8ff47",background:"none",border:"1px solid rgba(232,255,71,0.2)",borderRadius:3,padding:"4px 10px",cursor:"pointer"}} onClick={()=>{setVideoFile(null);setVideoURL(null);setShots([]);setScenes([]);setPhase("idle");}}>Remove</button>
          </div>
        </div>
      )}

      {/* Sensitivity */}
      {videoFile && (
        <div style={s.ctrlRow}>
          <span style={{fontSize:11,color:"#666",whiteSpace:"nowrap"}}>Cut Sensitivity</span>
          <input type="range" min={5} max={40} value={sensitivity} step={1} onChange={e=>setSensitivity(+e.target.value)} disabled={isRunning} style={{flex:1,accentColor:"#e8ff47"}} />
          <span style={{fontSize:11,color:"#e8ff47",minWidth:22}}>{sensitivity}</span>
          <span style={{fontSize:11,color:"#444",paddingLeft:12,borderLeft:"1px solid #1f1f1f"}}>Lower = subtle cuts</span>
        </div>
      )}

      {/* Run button */}
      <button style={{...s.runBtn, background: (!videoFile||isRunning)?"#161616":"#e8ff47", color:(!videoFile||isRunning)?"#444":"#080808", cursor:(!videoFile||isRunning)?"not-allowed":"pointer"}}
        disabled={!videoFile || isRunning} onClick={run}>
        {isRunning ? (phase==="detecting"?"Detecting Scenes…":"Analysing with Claude…") : videoFile ? "Detect Scenes + Analyse" : "Upload a Video to Begin"}
      </button>

      {error && <div style={{fontFamily:"'Courier New',monospace",fontSize:11,color:"#dc2626",background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:4,padding:"10px 14px",marginBottom:20}}>{error}</div>}

      {/* Progress */}
      {(isRunning || phase==="done") && (
        <div style={s.progWrap}>
          <div style={s.progHdr}>
            <span style={s.progLbl}>{phase==="detecting"?"Scanning":phase==="analysing"?"Analysing":"Complete"}</span>
            <span style={s.progPct}>{progress}%</span>
          </div>
          <div style={s.progBar}><div style={{...s.progFill,width:`${progress}%`}} /></div>
          <div style={s.progMsg}>{statusMsg}</div>
        </div>
      )}

      {/* Frames strip */}
      {scenes.length > 0 && (
        <div style={s.strip}>
          {scenes.map((sc,i) => (
            <div key={i} style={s.thumb(!!shots[i])}>
              <img src={sc.dataUrl} alt={`Scene ${i+1}`} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} />
              <span style={{position:"absolute",bottom:2,right:3,fontSize:8,color:"rgba(255,255,255,0.6)"}}>{i+1}</span>
            </div>
          ))}
        </div>
      )}

      {/* Save panel */}
      {phase==="done" && shots.length>0 && (
        <div style={s.savePanel}>
          <div style={s.saveTitle}><div style={{width:6,height:6,borderRadius:"50%",background:"#22c55e"}} />Save to Repository</div>
          <div style={s.saveGrid}>
            <div style={s.saveField}><label style={s.saveLabel}>Creator / Project</label><input style={s.saveInp} value={creator} onChange={e=>setCreator(e.target.value)} placeholder="e.g. bgxfilms" /></div>
            <div style={s.saveField}><label style={s.saveLabel}>Notes (optional)</label><input style={s.saveInp} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. warm tungsten reel" /></div>
          </div>
          <div style={s.btnRow}>
            <button style={s.dlBtn} onClick={downloadPDF}>↓ Download PDF</button>
            <button style={s.upBtn(!token)} onClick={uploadToDrive} disabled={!token}>
              {token ? "↑ Save to Drive + Sheet" : "Connect Drive to Upload"}
            </button>
          </div>
          {!token && <div style={{fontSize:10,color:"#444",marginTop:6}}>Connect your Google account above to enable Drive upload</div>}
          {uploadStatus && (
            <div style={s.upMsg(uploadStatus.type)}>
              {uploadStatus.msg}
              {uploadStatus.link && <> · <a href={uploadStatus.link} target="_blank" rel="noreferrer" style={{color:"#22c55e"}}>Open in Drive →</a></>}
            </div>
          )}
        </div>
      )}

      {/* Shot cards */}
      {shots.length > 0 && (
        <>
          <div style={s.resultsHdr}>
            <span style={s.resultsTitle}>Shot List</span>
            <span style={s.ct}>{shots.length} SHOTS</span>
          </div>
          {shots.map((shot,i) => (
            <div key={i} style={s.card}>
              <div style={s.cardImg}>
                <img src={shot.dataUrl} alt={`Shot ${shot.shotNumber}`} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} />
                <div style={s.badge}>SHOT {String(shot.shotNumber).padStart(2,"0")} · {shot.time?.toFixed(1)}s</div>
                {shot.mood && <div style={s.moodTag}>{shot.mood}</div>}
              </div>
              <div style={s.cardBody}>
                <div style={s.metaGrid}>
                  <div><div style={s.mk}>Shot Type</div><div style={s.mv}>{shot.shotType}</div></div>
                  <div><div style={s.mk}>Angle</div><div style={s.mv}>{shot.angle}</div></div>
                  <div><div style={s.mk}>Movement</div><div style={s.mv}>{shot.cameraMovement}</div></div>
                  <div><div style={s.mk}>Lens</div><div style={s.mv}>{shot.lensEstimate}</div></div>
                  <div style={{gridColumn:"1/-1"}}><div style={s.mk}>Composition</div><div style={s.mvSm}>{shot.composition}</div></div>
                  <div style={{gridColumn:"1/-1"}}><div style={s.mk}>Lighting</div><div style={s.mvSm}>{shot.lighting}</div></div>
                </div>
                <div style={s.sfBlock}>
                  <div style={s.sfKey}>↳ Shoot For</div>
                  <div style={s.sfVal}>{shot.shootFor}</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
