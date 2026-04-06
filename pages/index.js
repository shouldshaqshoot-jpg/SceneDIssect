import { useState, useRef, useCallback } from "react";

const DRIVE_ROOT = "Shot Lists — SceneDissect";
const LIBRARY_FOLDER = "Shot Library";
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
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [creator, setCreator] = useState("");
  const [notes, setNotes] = useState("");
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showDriveWarning, setShowDriveWarning] = useState(false);
  const inputRef = useRef();
  const canvasRef = useRef();
  const shotsRef = useRef([]);
  const videoFileRef = useRef(null);

  const getCutThreshold = (sc) => Math.round(35 - (sc-1)*(27/9));
  const getDupThreshold = (sc) => Math.round(30 - (sc-1)*(10/9));

  const signIn = () => {
    if (!clientId.trim()) { alert("Paste your Google Client ID first."); return; }
    localStorage.setItem("sd_cid", clientId.trim());
    const p = new URLSearchParams({ client_id:clientId.trim(), redirect_uri:window.location.origin, response_type:"token", scope:SCOPES, include_granted_scopes:"true" });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };

  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash.includes("access_token") && !token) {
      const p = new URLSearchParams(hash.slice(1));
      const t = p.get("access_token");
      if (t) {
        setTimeout(() => {
          setToken(t);
          window.history.replaceState(null,"",window.location.pathname);
          fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:"Bearer "+t}})
            .then(r=>r.json()).then(d=>setUserEmail(d.email||"Connected"));
        },0);
      }
    }
    const saved = localStorage.getItem("sd_cid");
    if (saved && !clientId) setTimeout(()=>setClientId(saved),0);
  }

  const loadVideo = useCallback((file) => {
    if (!file?.type.startsWith("video/")) return;
    setVideoFile(file); videoFileRef.current = file;
    const url = URL.createObjectURL(file);
    setVideoURL(url);
    setScenes([]); setShots([]); shotsRef.current = [];
    setSelected(new Set());
    setError(null); setPhase("idle"); setProgress(0);
    setLibraryStatus(null); setUploadProgress(null);
    setCreator(file.name.replace(/\.[^.]+$/,"").replace(/[_-]/g," "));
    const tmp = document.createElement("video"); tmp.src = url;
    tmp.onloadedmetadata = () => { if (tmp.videoWidth && tmp.videoHeight) setVideoAspect(tmp.videoWidth/tmp.videoHeight); };
  }, []);

  function frameDiff(ctx,w,h,prev) {
    const curr = ctx.getImageData(0,0,w,h).data;
    if (!prev) return {diff:0,data:curr};
    let t=0,cnt=0;
    for (let i=0;i<curr.length;i+=16){t+=(Math.abs(curr[i]-prev[i])+Math.abs(curr[i+1]-prev[i+1])+Math.abs(curr[i+2]-prev[i+2]))/3;cnt++;}
    return {diff:t/cnt,data:curr};
  }
  function arrDiff(a,b){let d=0,c=0;for(let i=0;i<a.length&&i<b.length;i+=16){d+=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;c++;}return d/c;}

  function extractScenes(file, cutT, dupT, onProg) {
    return new Promise((resolve,reject) => {
      const v = document.createElement("video");
      v.muted=true; v.playsInline=true; v.preload="auto"; v.src=URL.createObjectURL(file);
      v.onerror=()=>reject(new Error("Cannot load video"));
      v.onloadedmetadata=()=>{
        const dur=v.duration,fps=10,total=Math.floor(dur*fps);
        const cv=canvasRef.current,ctx=cv.getContext("2d");
        const isPort=v.videoHeight>v.videoWidth;
        const sc=isPort?Math.min(1,640/v.videoHeight):Math.min(1,640/v.videoWidth);
        cv.width=Math.floor(v.videoWidth*sc); cv.height=Math.floor(v.videoHeight*sc);
        const kept=[];let prev=null,idx=0,first=true;
        const next=()=>{if(idx>=total){URL.revokeObjectURL(v.src);resolve(kept);return;}v.currentTime=idx/fps;idx++;};
        v.onseeked=()=>{
          ctx.drawImage(v,0,0,cv.width,cv.height);
          const {diff,data}=frameDiff(ctx,cv.width,cv.height,prev);
          if((first||diff>cutT)&&!kept.some(k=>arrDiff(data,k._a)<dupT)){
            kept.push({time:v.currentTime,dataUrl:cv.toDataURL("image/jpeg",0.88),_a:data});
            first=false;
          }
          prev=data;onProg(Math.round(idx/total*100));next();
        };
        next();
      };
    });
  }

  const run = async () => {
    if (!token) { setShowDriveWarning(true); return; }
    await startAnalysis();
  };

  const startAnalysis = async () => {
    setShowDriveWarning(false);
    setError(null);setShots([]);setScenes([]);shotsRef.current=[];
    setSelected(new Set());setLibraryStatus(null);setUploadProgress(null);
    setPhase("detecting");setProgress(0);setStatusMsg("Scanning for scene cuts…");
    let extracted;
    try { extracted=await extractScenes(videoFile,getCutThreshold(shotCount),getDupThreshold(shotCount),p=>{setProgress(p);setStatusMsg(`Scanning… ${p}%`);}); }
    catch(e){setError("Detection failed: "+e.message);setPhase("idle");return;}
    if(!extracted.length){setError("No scenes detected. Try More Shots.");setPhase("idle");return;}
    setScenes(extracted);setStatusMsg(`${extracted.length} scenes found. Analysing…`);setPhase("analysing");setProgress(0);
    const results=[];
    for(let i=0;i<extracted.length;i++){
      setStatusMsg(`Analysing shot ${i+1} of ${extracted.length}…`);setProgress(Math.round(i/extracted.length*100));
      try{
        const b64=extracted[i].dataUrl.split(",")[1];
        const res=await fetch("/api/analyse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:b64,shotNumber:i+1})});
        const a=await res.json();
        results.push({...a,shotNumber:i+1,time:extracted[i].time,dataUrl:extracted[i].dataUrl});
      }catch{results.push({shotNumber:i+1,time:extracted[i].time,dataUrl:extracted[i].dataUrl,shotType:"Error",angle:"—",cameraMovement:"—",lighting:"Failed.",composition:"—",mood:"—",lensEstimate:"—",shootFor:"Re-run."});}
      setShots([...results]);shotsRef.current=[...results];
    }
    setProgress(100);setPhase("done");setStatusMsg(`${results.length} shots — click cards to select`);
  };

  const toggleCard = (i) => setSelected(prev=>{const n=new Set(prev);n.has(i)?n.delete(i):n.add(i);return n;});
  const selectAll = () => setSelected(new Set(shots.map((_,i)=>i)));
  const clearAll = () => setSelected(new Set());

  const gFetch = (url,opts={}) => fetch(url,{...opts,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(opts.headers||{})}});

  const getOrCreateFolder = async (name, parentId=null) => {
    const parentQ = parentId?` and '${parentId}' in parents`:"";
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentQ}`);
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}`);
    const d = await r.json();
    if(d.files?.length>0) return d.files[0].id;
    const body={name,mimeType:"application/vnd.google-apps.folder"};
    if(parentId) body.parents=[parentId];
    const c = await gFetch("https://www.googleapis.com/drive/v3/files",{method:"POST",body:JSON.stringify(body)});
    return (await c.json()).id;
  };

  const uploadBlob = async (folderId, filename, data, mimeType="application/json") => {
    const blob = new Blob([data],{type:mimeType});
    const meta = JSON.stringify({name:filename,parents:[folderId]});
    const body = new FormData();
    body.append("metadata",new Blob([meta],{type:"application/json"}));
    body.append("file",blob,filename);
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",{method:"POST",headers:{Authorization:"Bearer "+token},body});
    return r.json();
  };

  const uploadVideoResumable = async (folderId, file, onProgress) => {
    const initRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",{
      method:"POST",
      headers:{Authorization:"Bearer "+token,"Content-Type":"application/json","X-Upload-Content-Type":file.type,"X-Upload-Content-Length":file.size},
      body:JSON.stringify({name:file.name,parents:[folderId]})
    });
    const uploadUrl = initRes.headers.get("Location");
    const chunkSize = 5*1024*1024;
    let start=0,fileId=null,webViewLink=null;
    while(start<file.size){
      const end=Math.min(start+chunkSize,file.size);
      const chunk=file.slice(start,end);
      const res=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Range":`bytes ${start}-${end-1}/${file.size}`,"Content-Type":file.type},body:chunk});
      start=end;
      if(onProgress) onProgress(Math.round(start/file.size*100));
      if(res.status===200||res.status===201){const d=await res.json();fileId=d.id;webViewLink=d.webViewLink;}
    }
    return {id:fileId,webViewLink};
  };

  const saveToLibrary = async () => {
    if(!token){alert("Connect Google Drive first.");return;}
    if(selected.size===0){alert("Select at least one shotcard.");return;}
    setLibraryStatus({type:"loading",msg:"Setting up Drive folders…"});setUploadProgress(0);
    try{
      const rootId=await getOrCreateFolder(DRIVE_ROOT);
      const libId=await getOrCreateFolder(LIBRARY_FOLDER,rootId);
      const date=new Date().toISOString().slice(0,10);
      const vFolderName=`${creator||"video"} — ${date}`;
      const vFolderId=await getOrCreateFolder(vFolderName,libId);
      setLibraryStatus({type:"loading",msg:"Uploading source video…"});
      const vidResult=await uploadVideoResumable(vFolderId,videoFileRef.current,(pct)=>{
        setUploadProgress(pct);setLibraryStatus({type:"loading",msg:`Uploading video… ${pct}%`});
      });
      const videoLink=vidResult.webViewLink||"";
      setLibraryStatus({type:"loading",msg:`Saving ${selected.size} card${selected.size>1?"s":""}…`});
      const selectedShots=[...selected].map(i=>shotsRef.current[i]);
      for(const shot of selectedShots){
        const card={
          id:`${(creator||"video").replace(/\s+/g,"_")}_shot${String(shot.shotNumber).padStart(2,"0")}_${date}_${Date.now()}`,
          savedAt:new Date().toISOString(),
          sourceVideo:creator||videoFileRef.current?.name||"Unknown",
          sourceVideoLink:videoLink,
          videoFolderLink:`https://drive.google.com/drive/folders/${vFolderId}`,
          shotNumber:shot.shotNumber,time:shot.time,dataUrl:shot.dataUrl,
          shotType:shot.shotType||"—",angle:shot.angle||"—",cameraMovement:shot.cameraMovement||"—",
          lensEstimate:shot.lensEstimate||"—",lighting:shot.lighting||"—",
          composition:shot.composition||"—",mood:shot.mood||"—",shootFor:shot.shootFor||"—",userNotes:"",
        };
        await uploadBlob(vFolderId,`${card.id}.json`,JSON.stringify(card));
      }
      setLibraryStatus({type:"success",msg:`${selected.size} card${selected.size>1?"s":""} saved to library ✓`});
      setUploadProgress(null);
    }catch(e){setLibraryStatus({type:"error",msg:"Save failed: "+e.message});setUploadProgress(null);}
  };

  const loadJsPDF = () => new Promise((res,rej)=>{
    if(window.jspdf){res();return;}
    const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });

  const exportPDF = async () => {
    await loadJsPDF();const{jsPDF}=window.jspdf;
    const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
    const W=210,H=297,M=18;
    doc.setFillColor(7,7,7);doc.rect(0,0,W,H,"F");
    doc.setFillColor(232,255,71);doc.rect(M,H*0.42,0.8,H*0.36,"F");
    doc.setTextColor(240,237,232);doc.setFontSize(52);doc.setFont("helvetica","bold");doc.text("SHOT",M+5,H*0.62);
    doc.setTextColor(232,255,71);doc.text("LIST",M+5,H*0.62+22);
    doc.setTextColor(240,237,232);doc.setFontSize(10);doc.setFont("helvetica","normal");
    doc.text((creator||"Video")+"  /  "+shotsRef.current.length+" shots",M+5,H*0.62+34);
    doc.setTextColor(170,170,170);doc.setFontSize(7);doc.text("SCENEDISSECT",M,H-8);
    doc.text(new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),W-M,H-8,{align:"right"});
    for(let i=0;i<shotsRef.current.length;i++){
      doc.addPage();const s=shotsRef.current[i];
      doc.setFillColor(7,7,7);doc.rect(0,0,W,H,"F");
      const ih=H*0.44;
      try{const img=new Image();await new Promise(r=>{img.onload=r;img.src=s.dataUrl;});const sa=img.naturalWidth/img.naturalHeight,za=W/ih;let dw,dh,dx,dy;if(sa<za){dh=ih;dw=ih*sa;dx=(W-dw)/2;dy=0;}else{dw=W;dh=W/sa;dx=0;dy=(ih-dh)/2;}doc.addImage(s.dataUrl,"JPEG",dx,dy,dw,dh);}catch(e){}
      doc.setFillColor(232,255,71);doc.rect(0,ih,W,0.5,"F");
      const y0=ih+8;doc.setFillColor(232,255,71);doc.roundedRect(M,y0,36,7,1,1,"F");
      doc.setTextColor(7,7,7);doc.setFontSize(7);doc.setFont("helvetica","bold");doc.text(`SHOT ${String(i+1).padStart(2,"0")}  ·  ${s.time?.toFixed(1)}s`,M+18,y0+4.5,{align:"center"});
      doc.setFillColor(28,20,0);doc.roundedRect(M+39,y0,W-M-39-M,7,1,1,"F");
      doc.setTextColor(232,200,71);doc.setFontSize(7);doc.setFont("helvetica","normal");doc.text(s.mood||"",M+42,y0+4.5);
      let cy=y0+14;const c2=M+(W-2*M)/2+3;
      [[M,"SHOT TYPE",s.shotType],[c2,"ANGLE",s.angle]].forEach(([x,l,v])=>{doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,x,cy);doc.setTextColor(240,237,232);doc.setFontSize(9);doc.setFont("helvetica","bold");doc.text(v||"—",x,cy+6);});
      cy+=16;[[M,"CAMERA MOVEMENT",s.cameraMovement],[c2,"LENS ESTIMATE",s.lensEstimate]].forEach(([x,l,v])=>{doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,x,cy);doc.setTextColor(240,237,232);doc.setFontSize(9);doc.setFont("helvetica","bold");doc.text(v||"—",x,cy+6);});
      cy+=18;doc.setDrawColor(42,42,42);doc.line(M,cy,W-M,cy);cy+=6;
      [["LIGHTING",s.lighting],["COMPOSITION",s.composition],["SHOOT FOR",s.shootFor]].forEach(([l,txt])=>{doc.setTextColor(170,170,170);doc.setFontSize(6);doc.setFont("helvetica","normal");doc.text(l,M,cy);cy+=5;doc.setTextColor(...(l==="SHOOT FOR"?[212,160,96]:[220,220,220]));doc.setFontSize(8);const lines=doc.splitTextToSize(txt||"",W-2*M);doc.text(lines,M,cy);cy+=lines.length*4+5;});
      doc.setFillColor(22,22,22);doc.rect(0,H-8,W,8,"F");doc.setTextColor(170,170,170);doc.setFontSize(6);doc.text("SCENEDISSECT  /  SHOT LIST",M,H-3.5);doc.text(`PAGE ${i+2}`,W-M,H-3.5,{align:"right"});
    }
    const blob=doc.output("blob");const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`shotlist_${(creator||"video").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;a.click();URL.revokeObjectURL(url);
  };

  const isRunning = phase==="detecting"||phase==="analysing";
  const isDone = phase==="done";
  const isPortrait = videoAspect<1;
  const sliderLabel = shotCount<=3?"Fewer Shots":shotCount<=7?"Balanced":"More Shots";
  const sliderHint = shotCount<=3?"Major scene changes only":shotCount<=5?"Hard cuts and clear transitions":shotCount<=7?"Most visible cuts":shotCount<=8?"Subtle cuts included":"Every distinct frame change";

  const C = {
    bg:"#070707", surface:"#0d0d0d", surface2:"#141414", border:"#1e1e1e", border2:"#2a2a2a",
    text:"#f0ede8", textSub:"#c8c4bc", textDim:"#777",
    accent:"#e8ff47", accentDim:"rgba(232,255,71,0.07)", accentBorder:"rgba(232,255,71,0.2)",
    green:"#22c55e", greenDim:"rgba(34,197,94,0.08)", greenBorder:"rgba(34,197,94,0.25)",
    red:"#dc2626",
  };

  const label = (txt) => ({fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:8,display:"block",fontWeight:600});
  const fieldStyle = {width:"100%",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:4,padding:"10px 12px",fontFamily:"'Courier New',monospace",fontSize:12,color:C.text,outline:"none"};

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;background:${C.bg}}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}
        input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:#2a2a2a;outline:none;cursor:pointer;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${C.accent};cursor:pointer}
        input[type=range]:disabled{opacity:0.35}
        .hbtn{transition:opacity 0.15s;cursor:pointer}.hbtn:hover:not(:disabled){opacity:0.78}
        .drop-hover:hover{border-color:${C.accent}!important;background:rgba(232,255,71,0.04)!important}
        .card-hover:hover .chk-reveal{opacity:1!important}
        .shot-card{animation:slideIn 0.28s ease forwards;opacity:0}
        @keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:0.2;transform:scale(0.7)}50%{opacity:1;transform:scale(1)}}
        input:focus{border-color:${C.accent}!important}
      `}</style>
      <canvas ref={canvasRef} style={{display:"none"}} />

      <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",fontFamily:"'Courier New',monospace",background:C.bg,color:C.text}}>

        {/* ── Top bar ── */}
        <div style={{height:52,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",flexShrink:0,background:C.surface}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.accent,boxShadow:"0 0 10px rgba(232,255,71,0.5)"}} />
              <span style={{fontSize:13,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:C.text}}>SceneDissect</span>
            </div>
            <div style={{width:1,height:16,background:C.border2}} />
            <a href="/library" style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textDim,textDecoration:"none",padding:"4px 10px",border:`1px solid ${C.border2}`,borderRadius:4,transition:"color 0.15s"}}
              onMouseEnter={e=>e.target.style.color=C.accent} onMouseLeave={e=>e.target.style.color=C.textDim}>
              Shot Library →
            </a>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isDone && shots.length>0 && (
              <button className="hbtn" style={{padding:"7px 16px",fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:4,border:`1px solid ${C.accentBorder}`,background:C.accentDim,color:C.accent}} onClick={exportPDF}>↓ Export PDF</button>
            )}
            <button className="hbtn" onClick={()=>setShowAuth(a=>!a)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 14px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:token?C.green:C.border2,boxShadow:token?"0 0 6px rgba(34,197,94,0.5)":"none"}} />
              <span style={{fontSize:11,color:token?C.green:C.textDim}}>{token?userEmail||"Drive Connected":"Connect Drive"}</span>
            </button>
          </div>
        </div>

        {/* ── Drive warning modal ── */}
        {showDriveWarning && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
            <div style={{background:"#0f0f0f",border:"1px solid #2a2a2a",borderRadius:10,padding:32,maxWidth:420,width:"100%",textAlign:"center"}}>
              <div style={{fontSize:36,marginBottom:16}}>⚠️</div>
              <div style={{fontSize:16,fontWeight:700,color:"#f0ede8",marginBottom:10}}>Google Drive not connected</div>
              <div style={{fontSize:13,color:"#888",lineHeight:1.7,marginBottom:24}}>
                Your shots won't be saved to Drive after analysis.<br/>
                If you close or refresh, your progress will be lost.<br/>
                <strong style={{color:"#c8c4bc"}}>Connect Drive first to save your shotcards to the library.</strong>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <button style={{width:"100%",padding:"12px",fontSize:13,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:6,border:"none",background:"#e8ff47",color:"#080808",cursor:"pointer"}}
                  onClick={()=>{setShowDriveWarning(false);setShowAuth(true);}}>
                  Connect Drive First
                </button>
                <button style={{width:"100%",padding:"12px",fontSize:12,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:6,border:"1px solid #2a2a2a",background:"transparent",color:"#666",cursor:"pointer"}}
                  onClick={startAnalysis}>
                  Continue Without Drive
                </button>
                <button style={{fontSize:11,color:"#444",background:"none",border:"none",cursor:"pointer",padding:"4px"}}
                  onClick={()=>setShowDriveWarning(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Auth dropdown ── */}
        {showAuth && (
          <div style={{position:"absolute",top:52,right:16,zIndex:200,background:"#111",border:`1px solid ${C.border2}`,borderRadius:8,padding:20,width:300,boxShadow:"0 16px 48px rgba(0,0,0,0.8)"}}>
            <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textDim,marginBottom:12}}>Google Drive</div>
            {!token ? <>
              <input style={{...fieldStyle,marginBottom:10,fontSize:11}} placeholder="Paste Google Client ID…" value={clientId} onChange={e=>setClientId(e.target.value)} />
              <button className="hbtn" style={{width:"100%",padding:"10px",fontSize:12,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:4,border:"none",background:C.accent,color:"#080808",marginBottom:10}} onClick={signIn}>Connect</button>
              <button style={{fontSize:11,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,letterSpacing:"0.06em",textTransform:"uppercase"}} onClick={()=>setShowGuide(g=>!g)}>{showGuide?"▲":"▼"} Setup guide</button>
              {showGuide && <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                {["Go to console.cloud.google.com → new project","Enable Google Drive API + Sheets API","Credentials → OAuth 2.0 Client ID → Web App","Add your Vercel URL to origins + redirect URIs","Paste Client ID above → Connect","OAuth Consent → Audience → add your Gmail"].map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
                    <span style={{fontSize:11,color:C.accent,flexShrink:0}}>{i+1}.</span>
                    <span style={{fontSize:11,color:C.textSub,lineHeight:1.5}}>{t}</span>
                  </div>
                ))}
              </div>}
            </> : (
              <button className="hbtn" style={{width:"100%",padding:"10px",fontSize:12,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:4,border:`1px solid ${C.border2}`,background:"transparent",color:C.textSub}} onClick={()=>{setToken(null);setUserEmail("");setShowAuth(false);}}>Disconnect</button>
            )}
          </div>
        )}

        {/* ── Main layout ── */}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* ── LEFT PANEL — wider, more breathing room ── */}
          <div style={{width:360,flexShrink:0,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface}}>

            {/* Video area */}
            {!videoFile ? (
              <div className="drop-hover"
                style={{margin:16,border:`2px dashed ${C.border2}`,borderRadius:8,minHeight:220,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.2s",gap:8}}
                onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();loadVideo(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current?.click()}>
                <input ref={inputRef} type="file" accept="video/*" style={{display:"none"}} onChange={e=>loadVideo(e.target.files[0])} />
                <div style={{fontSize:36,opacity:0.5}}>🎞</div>
                <div style={{fontSize:14,color:C.text,fontWeight:700}}>Drop video here</div>
                <div style={{fontSize:12,color:C.textDim}}>or click to browse</div>
                <div style={{fontSize:11,color:C.textDim,marginTop:4}}>MP4 · MOV · WEBM</div>
              </div>
            ) : (
              <>
                <div style={{background:"#000",display:"flex",alignItems:"center",justifyContent:"center",minHeight:isPortrait?320:200,flexShrink:0,overflow:"hidden"}}>
                  <video src={videoURL} controls playsInline style={{maxWidth:"100%",maxHeight:isPortrait?320:200,width:"auto",height:"auto",display:"block"}} />
                </div>
                <div style={{padding:"8px 16px",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                  <span style={{fontSize:11,color:C.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{videoFile.name}</span>
                  <button style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",flexShrink:0,padding:"2px 8px",marginLeft:8}} onClick={()=>{setVideoFile(null);videoFileRef.current=null;setVideoURL(null);setShots([]);setScenes([]);setPhase("idle");setVideoAspect(16/9);}}>✕ Remove</button>
                </div>
              </>
            )}

            {/* Controls */}
            <div style={{flex:1,overflow:"auto",padding:20,display:"flex",flexDirection:"column",gap:20}}>

              {/* Shot detection */}
              <div>
                <span style={label("Shot Detection")}>Shot Detection</span>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:12,color:C.textSub}}>Fewer</span>
                  <span style={{fontSize:13,color:C.accent,fontWeight:700}}>{sliderLabel}</span>
                  <span style={{fontSize:12,color:C.textSub}}>More</span>
                </div>
                <input type="range" min={1} max={10} value={shotCount} step={1} onChange={e=>setShotCount(+e.target.value)} disabled={isRunning} />
                <div style={{fontSize:11,color:C.textDim,textAlign:"center",marginTop:8,lineHeight:1.4}}>{sliderHint}</div>
              </div>

              {/* Project info */}
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <span style={label("Project")}>Project</span>
                <div>
                  <label style={{fontSize:11,color:C.textDim,display:"block",marginBottom:6,letterSpacing:"0.06em",textTransform:"uppercase"}}>Creator / Project Name</label>
                  <input style={fieldStyle} value={creator} onChange={e=>setCreator(e.target.value)} placeholder="e.g. bgxfilms" />
                </div>
                <div>
                  <label style={{fontSize:11,color:C.textDim,display:"block",marginBottom:6,letterSpacing:"0.06em",textTransform:"uppercase"}}>Notes</label>
                  <input style={fieldStyle} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes…" />
                </div>
              </div>

              {/* Analyse button */}
              <button className="hbtn" style={{width:"100%",padding:"14px",fontSize:13,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",borderRadius:6,border:"none",background:(!videoFile||isRunning)?"#1a1a1a":C.accent,color:(!videoFile||isRunning)?"#444":"#080808",cursor:(!videoFile||isRunning)?"not-allowed":"pointer"}} disabled={!videoFile||isRunning} onClick={run}>
                {isRunning?(phase==="detecting"?"Scanning Video…":"Analysing Shots…"):videoFile?"Detect + Analyse":"Upload Video First"}
              </button>

              {/* Progress */}
              {(isRunning||isDone) && (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.08em"}}>{phase==="detecting"?"Scanning":phase==="analysing"?"Analysing":"Complete"}</span>
                    <span style={{fontSize:11,color:isDone?C.green:C.accent,fontWeight:700}}>{progress}%</span>
                  </div>
                  <div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden",marginBottom:8}}>
                    <div style={{height:"100%",background:isDone?C.green:C.accent,transition:"width 0.3s",width:`${progress}%`}} />
                  </div>
                  <div style={{fontSize:11,color:C.textDim,lineHeight:1.4}}>{statusMsg}</div>
                </div>
              )}

              {/* Video upload progress */}
              {uploadProgress !== null && (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.08em"}}>Uploading Video</span>
                    <span style={{fontSize:11,color:C.green,fontWeight:700}}>{uploadProgress}%</span>
                  </div>
                  <div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",background:C.green,transition:"width 0.3s",width:`${uploadProgress}%`}} />
                  </div>
                </div>
              )}

              {/* Library status */}
              {libraryStatus && (
                <div style={{fontSize:12,padding:"10px 14px",borderRadius:6,lineHeight:1.5,
                  background:libraryStatus.type==="success"?C.greenDim:libraryStatus.type==="error"?"rgba(220,38,38,0.06)":C.accentDim,
                  color:libraryStatus.type==="success"?C.green:libraryStatus.type==="error"?C.red:C.accent,
                  border:`1px solid ${libraryStatus.type==="success"?C.greenBorder:libraryStatus.type==="error"?"rgba(220,38,38,0.2)":C.accentBorder}`}}>
                  {libraryStatus.msg}
                </div>
              )}

              {error && (
                <div style={{fontSize:12,color:C.red,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.18)",borderRadius:6,padding:"10px 14px",lineHeight:1.5}}>{error}</div>
              )}
            </div>

            {/* Scene strip */}
            {scenes.length > 0 && (
              <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 16px",flexShrink:0}}>
                <div style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textDim,marginBottom:8}}>{scenes.length} Scenes Detected</div>
                <div style={{display:"flex",gap:3,overflowX:"auto",paddingBottom:3}}>
                  {scenes.map((sc,i)=>(
                    <div key={i} style={{flexShrink:0,width:isPortrait?22:38,height:26,borderRadius:3,overflow:"hidden",border:shots[i]?`1px solid ${C.accent}`:`1px solid ${C.border}`,background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <img src={sc.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT — shot list ── */}
          <div style={{flex:1,overflow:"auto",background:C.bg}}>

            {/* Sticky header */}
            <div style={{padding:"12px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"rgba(7,7,7,0.96)",backdropFilter:"blur(8px)",zIndex:10,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:13,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:shots.length?C.text:C.border2}}>{shots.length?"Shot List":"No Analysis Yet"}</span>
                {shots.length>0 && <span style={{fontSize:11,color:C.accent,background:C.accentDim,border:`1px solid ${C.accentBorder}`,padding:"3px 10px",borderRadius:3}}>{shots.length} SHOTS</span>}
              </div>

              {isDone && shots.length>0 && (
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:11,color:C.textDim}}>{selected.size} selected</span>
                  <button className="hbtn" style={{fontSize:11,color:C.textSub,background:"none",border:`1px solid ${C.border2}`,borderRadius:4,padding:"5px 12px"}} onClick={selectAll}>Select All</button>
                  {selected.size>0 && <button className="hbtn" style={{fontSize:11,color:C.textDim,background:"none",border:`1px solid ${C.border2}`,borderRadius:4,padding:"5px 12px"}} onClick={clearAll}>Clear</button>}
                  {selected.size>0 && (
                    <button className="hbtn" style={{fontSize:12,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:C.bg,background:C.green,border:"none",borderRadius:4,padding:"7px 18px",cursor:!token?"not-allowed":"pointer",opacity:!token?0.45:1}}
                      onClick={saveToLibrary} disabled={!token}>
                      + Save to Library
                    </button>
                  )}
                </div>
              )}

              {isRunning && (
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:C.accent,animation:`pulse 1s ease-in-out ${i*0.15}s infinite`}} />)}
                  <span style={{fontSize:11,color:C.textDim,marginLeft:4}}>{statusMsg}</span>
                </div>
              )}
            </div>

            {/* Empty state */}
            {!shots.length && !isRunning && (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"70%",gap:12}}>
                <div style={{fontSize:48,opacity:0.08}}>🎬</div>
                <div style={{fontSize:13,letterSpacing:"0.1em",textTransform:"uppercase",color:C.border2}}>Drop a video and hit Detect + Analyse</div>
                <div style={{fontSize:11,color:C.border2}}>Click cards to select them · Save selected to your Shot Library</div>
              </div>
            )}

            {/* Cards */}
            <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:12}}>
              {shots.map((shot,i)=>{
                const isSel = selected.has(i);
                return (
                  <div key={i} className={`shot-card card-hover`}
                    style={{display:"grid",gridTemplateColumns:isPortrait?"140px 1fr":"240px 1fr",border:`1.5px solid ${isSel?C.accent:C.border}`,borderRadius:8,overflow:"hidden",background:isSel?"rgba(232,255,71,0.03)":C.surface,animationDelay:`${i*0.025}s`,cursor:isDone?"pointer":"default",transition:"border-color 0.15s"}}
                    onClick={()=>isDone&&toggleCard(i)}>

                    {/* Frame */}
                    <div style={{position:"relative",background:"#000",minHeight:isPortrait?200:160,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <img src={shot.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}} />
                      <div style={{position:"absolute",top:7,left:7,fontSize:10,letterSpacing:"0.08em",background:"rgba(0,0,0,0.88)",color:C.accent,padding:"3px 8px",borderRadius:3}}>
                        {String(shot.shotNumber).padStart(2,"0")} · {shot.time?.toFixed(1)}s
                      </div>
                      {shot.mood && <div style={{position:"absolute",bottom:7,left:7,right:7,fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase",background:"rgba(0,0,0,0.78)",color:C.text,padding:"3px 7px",borderRadius:3,textAlign:"center"}}>{shot.mood}</div>}
                      {/* Checkbox */}
                      {isDone && (
                        <div className="chk-reveal" style={{position:"absolute",top:7,right:7,width:22,height:22,borderRadius:4,border:`2px solid ${isSel?C.accent:"rgba(255,255,255,0.5)"}`,background:isSel?C.accent:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",opacity:isSel?1:0,transition:"all 0.15s"}}>
                          {isSel && <span style={{fontSize:12,color:"#000",fontWeight:700,lineHeight:1}}>✓</span>}
                        </div>
                      )}
                    </div>

                    {/* Data */}
                    <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[["Shot Type",shot.shotType],["Angle",shot.angle],["Movement",shot.cameraMovement],["Lens",shot.lensEstimate]].map(([k,v])=>(
                          <div key={k}>
                            <div style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textDim,marginBottom:3}}>{k}</div>
                            <div style={{fontSize:13,fontWeight:600,color:C.text,lineHeight:1.3}}>{v||"—"}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[["Lighting",shot.lighting],["Composition",shot.composition]].map(([k,v])=>(
                          <div key={k}>
                            <div style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textDim,marginBottom:3}}>{k}</div>
                            <div style={{fontSize:12,color:C.textSub,lineHeight:1.55}}>{v||"—"}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                        <div style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.accent,marginBottom:4}}>↳ Shoot For</div>
                        <div style={{fontSize:12,color:C.textSub,lineHeight:1.6}}>{shot.shootFor||"—"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
