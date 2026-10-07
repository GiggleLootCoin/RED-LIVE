import React,{useEffect,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {AvatarCall,createProxyClient} from "realtime-avatar/react";
import "./style.css";

type Msg={role:"user"|"assistant";content:string;ts:number};
const STORE="red-live-v2";
const AVATAR="seed-rin-ashfall";
const IDLE="https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4";
const POSTER="https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png";

function load(){try{return JSON.parse(localStorage.getItem(STORE)||"{}")}catch{return {}}}
function App(){
 const saved=load();
 const [messages,setMessages]=useState<Msg[]>(saved.messages||[]);
 const [memory,setMemory]=useState(saved.memory||"");
 const [text,setText]=useState("");
 const [inCall,setInCall]=useState(false);
 const [showSettings,setShowSettings]=useState(false);
 const [showMemory,setShowMemory]=useState(false);
 const [customAvatar,setCustomAvatar]=useState(saved.customAvatar||"");
 const client=useMemo(()=>createProxyClient({proxyUrl:"/api/realtime-avatar"}),[]);
 useEffect(()=>localStorage.setItem(STORE,JSON.stringify({messages,memory,customAvatar})),[messages,memory,customAvatar]);
 const add=(role:Msg["role"],content:string)=>setMessages(m=>[...m,{role,content,ts:Date.now()}]);
 const send=async()=>{const v=text.trim();if(!v)return;setText("");add("user",v);try{const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:v,messages,memory})});if(!r.ok)throw 0;const d=await r.json();add("assistant",d.reply||"")}catch{add("assistant","Text chat is not connected yet. Start a live avatar call for the realtime conversation.")}};
 const upload=(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>setCustomAvatar(String(r.result));r.readAsDataURL(f)};
 return <div className="app">
  <header><div><div className="logo">RED <b>LIVE</b></div><div className="tag">Live AI Chats Unleashed</div></div><button className="ghost" onClick={()=>setShowSettings(true)}>⚙</button></header>
  <section className="hero">
   <div className="avatarWrap">
    {inCall?<AvatarCall client={client} avatarId={AVATAR} poster={POSTER} idleVideoUrl={IDLE} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"28px"}} onEnded={()=>setInCall(false)}>
      {(call)=><div className="callOverlay"><span>{call.status==="waiting"?`In line: ${call.queuePosition}`:call.status==="live"?"LIVE":call.status}</span><button onClick={call.end}>End call</button></div>}
    </AvatarCall>:customAvatar?<img src={customAvatar} className="avatarImage"/>:<video className="idle" src={IDLE} poster={POSTER} autoPlay muted loop playsInline/>}
   </div>
   <div className="heroActions">{!inCall?<button className="primary" onClick={()=>setInCall(true)}>Start live conversation</button>:null}<span className="secure">Full-duplex voice • interruptible • memory-ready</span></div>
  </section>
  <section className="chat"><div className="chatHead"><b>Conversation</b><button onClick={()=>setShowMemory(true)}>Memory</button></div>{messages.length===0?<div className="empty">Your conversation stays on this device until you choose a connected provider.</div>:messages.map((m,i)=><div key={i} className={"msg "+m.role}><small>{m.role==="user"?"YOU":"RED"}</small><div>{m.content}</div></div>)}</section>
  <section className="composer"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Type while RED is listening…"/><button onClick={send}>Send</button></section>
  <nav><button onClick={()=>setShowMemory(true)}>Memory</button><label>Avatar<input hidden type="file" accept="image/*" onChange={upload}/></label><button onClick={()=>setShowSettings(true)}>Tools</button></nav>
  {showMemory&&<div className="modal"><div className="sheet"><button className="close" onClick={()=>setShowMemory(false)}>×</button><h2>RED memory</h2><p>Only memories you explicitly save here are stored locally.</p><textarea value={memory} onChange={e=>setMemory(e.target.value)} placeholder="Things RED should remember…"/><button className="primary" onClick={()=>setShowMemory(false)}>Save memory</button></div></div>}
  {showSettings&&<div className="modal"><div className="sheet"><button className="close" onClick={()=>setShowSettings(false)}>×</button><h2>RED LIVE</h2><p>Realtime avatar: {AVATAR}</p><p>Custom avatar: {customAvatar?"loaded":"not loaded"}</p><p>Provider connection is server-side. No private API key is shipped in this app.</p><label className="upload">Choose avatar image<input hidden type="file" accept="image/*" onChange={upload}/></label></div></div>}
 </div>
}
createRoot(document.getElementById("root")!).render(<App/>);
