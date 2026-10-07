import "./style.css";

type Message={role:"user"|"assistant";content:string;time:number};
const KEY="red-live-state-v1";
const state={messages:[] as Message[],memory:"",listening:false};
try{Object.assign(state,JSON.parse(localStorage.getItem(KEY)||"{}"));}catch{}
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const app=document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML=`<main class="shell">
<header class="top"><div><div class="brand">RED <span>LIVE</span></div><div class="sub">Little Red’s Big Live AI Chats Unleashed</div></div><button id="settings" class="icon">⚙</button></header>
<section class="stage"><div class="avatar" id="avatar"><video id="avatarVideo" playsinline autoplay></video><div class="avatarFallback"><div class="ring"></div><div class="status">REAL AVATAR SLOT</div></div></div><div class="livebar"><span class="dot"></span><span id="liveState">Ready</span><span class="sep">•</span><span>Provider-neutral</span></div></section>
<section class="chat" id="chat"></section>
<section class="composer"><button id="mic" class="round">🎙</button><input id="input" autocomplete="off" placeholder="Talk to RED LIVE…"><button id="send" class="send">Send</button></section>
<section class="tools"><button data-tool="memory">Memory</button><button data-tool="camera">Camera</button><button data-tool="file">File</button><button data-tool="web">Web</button></section>
</main><div id="panel" class="panel hidden"></div>`;
const chat=document.querySelector("#chat")!;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function render(){chat.innerHTML=state.messages.map(m=>`<div class="msg ${m.role}"><div class="who">${m.role==="user"?"YOU":"RED"}</div><div>${esc(m.content)}</div></div>`).join("");chat.scrollTop=chat.scrollHeight}
function add(role:Message["role"],content:string){state.messages.push({role,content,time:Date.now()});save();render()}
function live(s:string){document.querySelector("#liveState")!.textContent=s}
async function ask(text:string){if(!text.trim())return;add("user",text);live("Thinking…");try{const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:text,messages:state.messages,memory:state.memory})});if(!r.ok)throw 0;const d=await r.json();add("assistant",d.reply||"No reply returned.");}catch{add("assistant","RED LIVE is ready, but its AI provider is not connected yet. Connect an LLM provider through the secure server adapter.");}live("Ready")}
render();
(document.querySelector("#send") as HTMLButtonElement).onclick=()=>{const i=document.querySelector<HTMLInputElement>("#input")!;const v=i.value;i.value="";ask(v)};
(document.querySelector("#input") as HTMLInputElement).onkeydown=e=>{if(e.key==="Enter")(document.querySelector("#send") as HTMLButtonElement).click()};
const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;let rec:any;
if(SR){rec=new SR();rec.continuous=false;rec.interimResults=true;rec.lang="en-GB";rec.onstart=()=>{state.listening=true;live("Listening…")};rec.onend=()=>{state.listening=false;if((document.querySelector("#liveState")!).textContent==="Listening…")live("Ready")};rec.onresult=(e:any)=>{let f="";for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)f+=e.results[i][0].transcript;else(document.querySelector<HTMLInputElement>("#input")!).value=e.results[i][0].transcript}if(f)ask(f)}}else(document.querySelector("#mic") as HTMLButtonElement).disabled=true;
(document.querySelector("#mic") as HTMLButtonElement).onclick=()=>{if(rec){if(state.listening)rec.stop();else rec.start()}};
for(const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))b.onclick=()=>openTool(b.dataset.tool!);
function openTool(tool:string){const p=document.querySelector("#panel")!;p.classList.remove("hidden");const title=tool[0].toUpperCase()+tool.slice(1);p.innerHTML=`<div class="panelbox"><button id="close" class="close">×</button><h2>${title}</h2><p>${tool==="memory"?"Your memory is stored on this device until you connect a memory provider.":tool==="camera"?"Camera access is requested only when you start a camera-capable provider.":tool==="file"?"Files and images are passed to a connected multimodal provider.":"Web search runs through the secure server adapter so API keys stay off-device."}</p>${tool==="memory"?'<textarea id="memory"></textarea><button id="saveMemory">Save memory</button>':""}</div>`;document.querySelector("#close")!.onclick=()=>p.classList.add("hidden");if(tool==="memory"){const t=document.querySelector<HTMLTextAreaElement>("#memory")!;t.value=state.memory;document.querySelector("#saveMemory")!.onclick=()=>{state.memory=t.value;save();p.classList.add("hidden")}}}
