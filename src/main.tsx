import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AvatarCall, createProxyClient, useAvatarCamera, useCharacterTools, type AvatarConnectionDetails } from "realtime-avatar/react";
import "./style.css";

type Msg = { role: "user" | "assistant"; content: string; ts: number };
type Avatar = { id: string; name: string; status: string; poster?: string | null; idle?: string | null };

const STORE = "red-live-v5";
const DEFAULT_ID = "seed-rin-ashfall";
const RIN: Avatar = {
  id: DEFAULT_ID,
  name: "Rin Ashfall",
  status: "ready",
  poster: "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png",
  idle: "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4",
};

const read = () => {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
};

function LiveWebTools() {
  const tools = useCharacterTools({
    web_search: {
      description: "Search the live web for current, factual information whenever the user asks about recent events, news, prices, people, products, places, websites, or anything that may have changed. Always use this tool rather than guessing. Return concise source-backed results.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The exact web search query to run." } },
        required: ["query"],
      },
      execute: async ({ query }, { signal }: { signal: AbortSignal }) => {
        const response = await fetch("/api/web-search?q=" + encodeURIComponent(query), { signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Web search failed");
        return JSON.stringify((data.results || []).slice(0, 5).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })));
      },
    },
  });
  return tools.status === "error" ? <span className="toolStatus">WEB OFFLINE</span> : <span className="toolStatus">{tools.status === "ready" ? "WEB READY" : "WEB CONNECTING"}</span>;
}

function CameraButton({ active }: { active: boolean }) {
  const camera = useAvatarCamera({ allowed: true, active });
  return <button className="smallButton" disabled={!camera.available} onClick={() => void camera.toggle()}>
    {camera.pending ? "Cancel" : camera.enabled ? "Camera on" : camera.error ? "Camera unavailable" : "Share camera"}
  </button>;
}

function App() {
  const saved = read();
  const [avatarId, setAvatarId] = useState(saved.avatarId || DEFAULT_ID);
  const [avatarStatus, setAvatarStatus] = useState(saved.avatarStatus || "ready");
  const [selected, setSelected] = useState<Avatar>(saved.avatar || RIN);
  const [avatars, setAvatars] = useState<Avatar[]>([RIN]);
  const [inCall, setInCall] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [callError, setCallError] = useState("");
  const [connection, setConnection] = useState<AvatarConnectionDetails | null>(null);
  const [messages, setMessages] = useState<Msg[]>(saved.messages || []);
  const [memory, setMemory] = useState(saved.memory || "");
  const [text, setText] = useState("");
  const [modal, setModal] = useState<"memory" | "create" | "web" | "settings" | null>(null);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("RED");
  const [motion, setMotion] = useState("Natural breathing, attentive eye contact, subtle head movement, expressive listening and restrained conversational gestures.");
  const [portrait, setPortrait] = useState("");
  const [busy, setBusy] = useState(false);
  const [webQuery, setWebQuery] = useState("");
  const [webResults, setWebResults] = useState<Array<{title:string;url:string;snippet:string}>>([]);
  const client = useMemo(() => createProxyClient({ proxyUrl: "/api/realtime-avatar" }), []);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify({ avatarId, avatarStatus, avatar: selected, messages, memory }));
  }, [avatarId, avatarStatus, selected, messages, memory]);

  useEffect(() => {
    fetch("/api/avatars").then(r => r.json()).then(d => {
      if (Array.isArray(d.avatars)) {
        const clean = d.avatars.filter((a: Avatar) => !/mark zuckerberg/i.test(a.name));
        if (clean.length) setAvatars(clean);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!avatarId.startsWith("ava_")) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/avatar/status?id=" + encodeURIComponent(avatarId));
        const d = await r.json();
        if (stopped) return;
        setAvatarStatus(d.status || "unknown");
        setSelected((a: Avatar) => ({ ...a, status: d.status || a.status, poster: d.posterUrl || a.poster, idle: d.idleVideoUrl || a.idle }));
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 8000);
    return () => { stopped = true; clearInterval(timer); };
  }, [avatarId]);

  const selectAvatar = (a: Avatar) => {
    if (inCall) return;
    setAvatarId(a.id);
    setAvatarStatus(a.status);
    setSelected(a);
    setCallError("");
  };

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    const next = [...messages, { role: "user" as const, content: value, ts: Date.now() }];
    setMessages(next);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ message:value, messages:next, memory }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Chat failed");
      setMessages(m => [...m, { role:"assistant", content:d.reply || "", ts:Date.now() }]);
    } catch {
      setMessages(m => [...m, { role:"assistant", content:"Start the live conversation and talk to me hands-free.", ts:Date.now() }]);
    }
  };

  const createAvatar = async () => {
    const input = document.getElementById("portrait") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) { setNotice("Choose a portrait first."); return; }
    setBusy(true); setNotice("Building the avatar…");
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("name", name); fd.append("motionPrompt", motion);
      const r = await fetch("/api/avatar/create", { method:"POST", body:fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Avatar creation failed");
      const a: Avatar = { id:d.id, name:d.displayName || name, status:d.status || "preprocessing", poster:d.posterUrl || portrait, idle:d.idleVideoUrl };
      setSelected(a); setAvatarId(a.id); setAvatarStatus(a.status); setAvatars(v => [a, ...v.filter(x => x.id !== a.id)]);
      setNotice("Avatar creation started. RED LIVE will enable it when the provider reports it ready.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Avatar creation failed"); }
    finally { setBusy(false); }
  };

  const choosePortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 8*1024*1024) { setNotice("Use a PNG, JPEG or WebP image up to 8 MB."); return; }
    const reader = new FileReader(); reader.onload = () => setPortrait(String(reader.result)); reader.readAsDataURL(f);
  };

  const saveMemory = async () => {
    try {
      const r = await fetch("/api/memory", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({memory,messages}) });
      if (!r.ok) throw new Error("Memory could not be saved");
      setNotice("Memory saved.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Memory could not be saved"); }
  };

  const webSearch = async () => {
    if (!webQuery.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/web-search?q=" + encodeURIComponent(webQuery));
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Search failed");
      setWebResults(d.results || []);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Search failed"); }
    finally { setBusy(false); }
  };

  const poster = selected.poster || portrait || RIN.poster;
  const idle = selected.idle || (selected.id === DEFAULT_ID ? RIN.idle : undefined);

  return <div className="app">
    <header>
      <div className="brand"><div className="brandOrb">R</div><div><div className="brandName">RED <span>LIVE</span></div><div className="brandSub">FACE-TO-FACE AI</div></div></div>
      <button className="iconButton" onClick={() => setModal("settings")}>⚙</button>
    </header>

    <main>
      <section className="stage">
        <div className="stageTop"><div><span className="statusDot"/> {inCall ? "LIVE" : "READY"} <span className="muted">/ {selected.name}</span></div><div className="stageActions"><span>{inCall ? callStatus : "Full-duplex voice • animated video"}</span></div></div>
        <div className="stageGrid">
          <div className="videoPanel">
            {inCall ? <AvatarCall client={client} avatarId={avatarId} poster={poster || undefined} idleVideoUrl={idle || undefined}
              style={{width:"100%",height:"100%"}} onStatusChange={s => {setCallStatus(s); if(s==="live") setCallError("");}}
              onConnectionDetailsChange={setConnection}
              onEnded={({reason}) => {setInCall(false);setCallStatus("ended");setCallError(reason ? String(reason) : "The session ended.");setConnection(null);}}>
              {call => <><LiveWebTools/><div className="liveBar"><CameraButton active={inCall}/><div className="liveState"><b>{call.status === "waiting" ? "WAITING " + call.queuePosition : call.status.toUpperCase()}</b>{connection?.localQuality && <small> · {connection.localQuality}</small>}</div><button className="endButton" onClick={call.end}>End</button></div></>}
            </AvatarCall> : idle ? <video className="avatarMedia" src={idle} poster={poster || undefined} autoPlay muted loop playsInline/> : poster ? <img className="avatarMedia" src={poster} alt={selected.name}/> : <div className="noAvatar"><b>{selected.name}</b><span>Live avatar</span></div>}
            <div className="namePlate"><b>{selected.name}</b><span>{avatarStatus === "ready" ? "LIVE-READY" : avatarStatus}</span></div>
          </div>

          <aside className="controlPanel">
            <div className="eyebrow">LIVE CONVERSATION</div>
            <h1>Talk to an AI<br/><em>that looks alive.</em></h1>
            <p className="lead">Natural two-way voice, interruption, animated facial performance, memory, web access and optional camera vision.</p>
            {callError && <div className="errorBox"><b>Connection stopped</b><span>{callError}</span><button onClick={() => {setCallError("");setInCall(false);}}>Dismiss</button></div>}
            {!inCall ? <button className="startButton" disabled={avatarStatus !== "ready"} onClick={() => {setCallError("");setCallStatus("connecting");setInCall(true);}}>{avatarStatus === "ready" ? "START LIVE" : "AVATAR " + avatarStatus.toUpperCase()}</button> : <button className="secondaryButton" onClick={() => setInCall(false)}>Leave conversation</button>}
            <div className="featureList"><div><b>01</b><span>Full-duplex voice</span></div><div><b>02</b><span>Real-time animated avatar</span></div><div><b>03</b><span>Persistent memory</span></div><div><b>04</b><span>Web + camera tools</span></div></div>
            <div className="controlHint">Microphone is owned by the live-call component so there is one audio lifecycle, not two competing mic requests.</div>
          </aside>
        </div>
      </section>

      <section className="vault">
        <div className="sectionHead"><div><div className="eyebrow">CHARACTER VAULT</div><h2>Choose a character.</h2><p>These are provider-backed live characters or avatars you create yourself. No fake thumbnail faces.</p></div><button className="createButton" onClick={() => setModal("create")}>＋ CREATE YOUR OWN</button></div>
        <div className="avatarGrid">
          {avatars.map(a => <button key={a.id} className={"avatarCard " + (a.id === avatarId ? "selected" : "")} onClick={() => selectAvatar(a)}>
            <div className="cardMedia">{a.id === DEFAULT_ID && a.idle ? <video src={a.idle} poster={a.poster || undefined} muted autoPlay loop playsInline/> : a.poster ? <img src={a.poster} alt={a.name}/> : <div className="generatedCard"><span>{a.status === "ready" ? "LIVE" : a.status.toUpperCase()}</span></div>}</div>
            <div className="cardInfo"><b>{a.name}</b><small>{a.id.startsWith("ava_") ? "YOUR AVATAR" : "PROVIDER CHARACTER"}</small><span className={a.status === "ready" ? "ready" : ""}>{a.status === "ready" ? "READY" : a.status}</span></div>
          </button>)}
          <button className="avatarCard createTile" onClick={() => setModal("create")}><div className="createGlyph">＋</div><b>Create your own</b><small>Upload a portrait → animated live character</small></button>
        </div>
      </section>

      <section className="conversation">
        <div className="sectionMini"><b>TEXT CONVERSATION</b><button onClick={() => setModal("memory")}>MEMORY</button></div>
        <div className="messages">{messages.length ? messages.map((m,i)=><div key={i} className={"message "+m.role}><small>{m.role === "user" ? "YOU" : "RED"}</small><div>{m.content}</div></div>) : <div className="emptyState">Text chat stays available when you don't want to start a live call.</div>}</div>
        <div className="composer"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Say something…"/><button onClick={send}>SEND</button></div>
      </section>

      <nav className="bottomNav"><button onClick={()=>setModal("memory")}>Memory</button><button onClick={()=>setModal("create")}>Create avatar</button><button onClick={()=>setModal("web")}>Web search</button><button onClick={()=>setModal("settings")}>Settings</button></nav>
    </main>

    {modal === "create" && <div className="modal"><div className="sheet"><button className="close" onClick={()=>setModal(null)}>×</button><div className="eyebrow">AVATAR CREATOR</div><h2>Make a real live character.</h2><p>Use a clear portrait. The provider generates the animated idle state and motion library from that image, then RED LIVE can use the resulting avatar in a live call.</p><input id="portrait" type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePortrait}/>{portrait && <img className="preview" src={portrait} alt="Portrait preview"/>}<input value={name} onChange={e=>setName(e.target.value)} placeholder="Character name"/><textarea value={motion} onChange={e=>setMotion(e.target.value)}/><button className="startButton" disabled={busy} onClick={createAvatar}>{busy ? "BUILDING…" : "CREATE LIVE AVATAR"}</button>{notice&&<div className="notice">{notice}</div>}</div></div>}

    {modal === "memory" && <div className="modal"><div className="sheet"><button className="close" onClick={()=>setModal(null)}>×</button><div className="eyebrow">MEMORY</div><h2>What should RED remember?</h2><p>Memory is kept locally and supplied as live-session context. Recent conversation is retained too.</p><textarea value={memory} onChange={e=>setMemory(e.target.value)} placeholder="Preferences, ongoing projects, things RED should remember…"/><button className="startButton" onClick={saveMemory}>SAVE MEMORY</button>{notice&&<div className="notice">{notice}</div>}</div></div>}

    {modal === "web" && <div className="modal"><div className="sheet"><button className="close" onClick={()=>setModal(null)}>×</button><div className="eyebrow">WEB</div><h2>Search the live web.</h2><div className="webRow"><input value={webQuery} onChange={e=>setWebQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&webSearch()} placeholder="Search…"/><button onClick={webSearch} disabled={busy}>SEARCH</button></div><div className="results">{webResults.map(r=><article key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a><p>{r.snippet}</p></article>)}</div>{notice&&<div className="notice">{notice}</div>}</div></div>}

    {modal === "settings" && <div className="modal"><div className="sheet"><button className="close" onClick={()=>setModal(null)}>×</button><div className="eyebrow">SYSTEM</div><h2>RED LIVE</h2><p><b>Avatar:</b> {selected.name}</p><p><b>Avatar status:</b> {avatarStatus}</p><p><b>Live provider:</b> server-side session proxy</p><p><b>Camera:</b> available inside the live session when enabled</p><button onClick={()=>{setModal("create");}}>Create/change avatar</button><button onClick={()=>{fetch("/api/live-diagnostic").then(r=>r.json()).then(d=>setNotice(JSON.stringify(d))).catch(()=>setNotice("Provider diagnostic failed"));}}>Check provider</button>{notice&&<div className="notice">{notice}</div>}</div></div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
