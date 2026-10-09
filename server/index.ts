import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { realtimeAvatarHono } from "realtime-avatar/hono";
import { RealtimeAvatar } from "realtime-avatar";

const app = new Hono();
const key = () => process.env.REALTIME_AVATAR_API_KEY ?? "";
const base = "https://realtimeavatar.ai/api/v1";
const headers = () => ({ Authorization: "Bearer " + key() });
const persona = "You are RED LIVE, a highly natural adult conversational AI companion. Speak like a real adult person: grounded, warm, calm, slightly imperfect and spontaneous. Use natural contractions, varied sentence length, realistic pauses, subtle emotional inflection and understated reactions. Avoid any cartoon, anime, childlike, mascot, announcer, presenter, radio, call-centre, sing-song, overly cheerful or theatrical delivery. Do not use exaggerated character voices, squeaky tones, fake excitement or constant smiling energy. Keep your vocal phrasing easy to speak aloud and conversational. Do not repeat greetings or filler. Listen while the user speaks and respond directly to what they actually said. Let the user interrupt. Keep ordinary replies concise and expand when useful. Use supplied conversation context as memory. Never claim to be human.";
function isAvatarIdAllowed(id:string){return id==="seed-rin-ashfall"||/^ava_[A-Za-z0-9_-]+$/.test(id)}
function isPublicFigureLabel(v:string){return /(^|\s)(celebrity|politician|president|prime minister|king|queen|world leader|public figure)($|\s)/i.test(v)}
function isAvatarSafeForREDLive(a:any){const label=String(a?.displayName||a?.name||"");return !isPublicFigureLabel(label)&&(a?.status==="ready"||a?.id==="seed-rin-ashfall")}
function cookieContext(request:Request){const raw=request.headers.get("cookie")?.match(/red_memory=([^;]+)/)?.[1];if(!raw)return[];try{const p=JSON.parse(decodeURIComponent(raw));return Array.isArray(p)?p.slice(-18):[]}catch{return[]}}
function creditMicros(d:any,name:"balance"|"reserved"){const keys=name==="balance"?["balanceCreditMicros","balanceMicros","balance_credits_micros","balance","credits"]:["reservedCreditMicros","reservedMicros","reserved_credits_micros","reserved"];for(const k of keys){const n=Number(d?.[k]);if(Number.isFinite(n))return n}return 0}
async function getCreditWindow(){if(!key())return null;try{const r=await fetch(base+"/credits/balance",{headers:headers()});const d=await r.json().catch(()=>null);if(!r.ok)return{ok:false,status:r.status,balanceCreditMicros:null,reservedCreditMicros:null,availableSeconds:0,raw:d};const balance=creditMicros(d,"balance");const reserved=creditMicros(d,"reserved");const availableSeconds=Math.max(0,Math.floor(Math.max(0,balance-reserved)/1000000));return{ok:true,status:r.status,balanceCreditMicros:balance,reservedCreditMicros:reserved,availableSeconds,raw:d}}catch{return null}}
async function getProviderAvatar(id:string){if(id==="seed-rin-ashfall")return{id,status:"ready",displayName:"Rin Ashfall",posterUrl:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png",idleVideoUrl:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4"};if(!key()||!isAvatarIdAllowed(id))return null;const r=await fetch(base+"/avatars/"+encodeURIComponent(id),{headers:headers()});if(!r.ok)return null;return await r.json().catch(()=>null)}

app.all("/api/realtime-avatar/*",realtimeAvatarHono({
 apiKey:key,
 authorize:({operation})=>operation==="connect"||operation==="end"||operation==="avatars"||operation==="credits"?undefined:new Response("Not found",{status:404}),
 session:async({request,avatarId,mode})=>{if(process.env.ALLOW_PAID_LIVE_SESSIONS!=="true")return new Response("Paid live-avatar sessions are disabled in free mode.",{status:403});if(!isAvatarIdAllowed(avatarId))return new Response("Avatar not allowed",{status:403});const avatar=await getProviderAvatar(avatarId);if(!avatar||!isAvatarSafeForREDLive(avatar))return new Response("Avatar is not ready or is not permitted in RED LIVE.",{status:403});const creditWindow=await getCreditWindow();if(creditWindow?.ok&&creditWindow.availableSeconds<1)return new Response(JSON.stringify({code:"insufficient_credits",error:"RED LIVE has no live seconds available in the Realtime Avatar credit balance."}),{status:402,headers:{"content-type":"application/json"}});const maxSeconds=Math.min(60,Math.max(1,creditWindow?.availableSeconds??60));const common={instructions:persona,context:cookieContext(request),maxSeconds:Math.min(180,maxSeconds),listen:true,camera:true,clientTools:true,video:{mode:"generative" as const}};return common}
}));

app.get("/api/live-diagnostic",async c=>{if(!key())return c.json({ok:false,error:"REALTIME_AVATAR_API_KEY is not configured on the server."},503);try{const[cr,ar,capr]=await Promise.all([fetch(base+"/credits/balance",{headers:headers()}),fetch(base+"/avatars",{headers:headers()}),fetch(base+"/realtime/livekit/capacity",{headers:headers()})]);const credits=await cr.json().catch(()=>null);const capacity=await capr.json().catch(()=>null);const balanceCreditMicros=creditMicros(credits,"balance");const reservedCreditMicros=creditMicros(credits,"reserved");const availableSeconds=Math.max(0,Math.floor(Math.max(0,balanceCreditMicros-reservedCreditMicros)/1000000));const payload=await ar.json().catch(()=>null);const rows=Array.isArray(payload?.data)?payload.data:[];const allowed=rows.filter((a:any)=>/^ava_[A-Za-z0-9_-]+$/.test(String(a?.id))&&!isPublicFigureLabel(String(a?.displayName||a?.name||"")));const ready=allowed.filter((a:any)=>a.status==="ready");return c.json({ok:cr.ok&&ar.ok,creditsStatus:cr.status,avatarStatus:ar.status,realtimeStatus:capr.status,realtimeScope:capr.ok?"realtime:write confirmed":"Realtime capacity check unavailable; this does not block calls.",capacity,avatarReady:true,credits:{balanceCreditMicros,reservedCreditMicros,availableSeconds,providerKeys:credits&&typeof credits==="object"?Object.keys(credits):[],raw:credits},avatars:[{id:"seed-rin-ashfall",name:"Rin Ashfall",status:"ready",idleVideoStatus:"ready",error:null},...allowed.map((a:any)=>({id:a.id,name:a.displayName||a.name||"Live Avatar",status:a.status,idleVideoStatus:a.idleVideoStatus,error:a.error??null}))],errors:[!cr.ok?`Credits endpoint HTTP ${cr.status}`:"",!ar.ok?`Avatar list endpoint HTTP ${ar.status}`:"",ar.ok&&ready.length===0?"No custom READY platform avatars are available; the public Rin example is available.":""].filter(Boolean)})}catch(e){return c.json({ok:false,error:e instanceof Error?e.message:"Provider check failed"},502)}});



async function llmChat(message:string,messages:any[],memory:string){
 const providers=[
  {name:"primary",url:(process.env.LLM_BASE_URL||"").replace(/\/$/,""),apiKey:process.env.LLM_API_KEY||"",model:process.env.LLM_MODEL||""},
  {name:"fallback",url:(process.env.LLM_FALLBACK_BASE_URL||"").replace(/\/$/,""),apiKey:process.env.LLM_FALLBACK_API_KEY||"",model:process.env.LLM_FALLBACK_MODEL||""}
 ].filter(p=>p.url&&p.apiKey&&p.model);
 if(!providers.length) throw new Error("Text AI is not configured. Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL; optionally configure the LLM_FALLBACK_* variables for a second provider.");
 const history=messages.slice(-16).filter((m:any,i:number,arr:any[])=>!(i===arr.length-1&&m.role==="user"&&String(m.content||"").trim()===message));
 const context=[
  {role:"system",content:persona+(memory?("\nUser memory:\n"+memory):"")},
  ...history.map((m:any)=>({role:m.role==="user"?"user":"assistant",content:String(m.content||"").slice(0,4000)})),
  {role:"user",content:message}
 ];
 const failures:string[]=[];
 for(const provider of providers){
  try{
   const response=await fetch(provider.url+"/chat/completions",{method:"POST",headers:{"content-type":"application/json",Authorization:"Bearer "+provider.apiKey},body:JSON.stringify({model:provider.model,messages:context,temperature:0.7,max_tokens:700}),signal:AbortSignal.timeout(18000)});
   const data=await response.json().catch(()=>null);
   if(!response.ok) throw new Error(data?.error?.message||data?.error||("HTTP "+response.status));
   const reply=data?.choices?.[0]?.message?.content;
   if(typeof reply!=="string"||!reply.trim()) throw new Error("provider returned an empty response");
   return reply.trim();
  }catch(e){failures.push(provider.name+": "+(e instanceof Error?(e.name==="TimeoutError"||e.name==="AbortError"?"request timed out":e.message):"request failed"))}
 }
 throw new Error("All configured text AI routes failed ("+failures.join("; ")+"). Check provider configuration or try again.");
}

app.post("/api/chat",async c=>{
 try{
  const body=await c.req.json();
  const message=typeof body.message==="string"?body.message.trim().slice(0,4000):"";
  if(!message)return c.json({error:"Message is required."},400);
  const messages=Array.isArray(body.messages)?body.messages.slice(-16):[];
  const memory=typeof body.memory==="string"?body.memory.slice(0,3200):"";
  const reply=await llmChat(message,messages,memory);
  return c.json({ok:true,reply});
 }catch(e){return c.json({ok:false,error:e instanceof Error?e.message:"Text AI failed."},502)}
});

app.get("/api/web-search",async c=>{
 const query=(c.req.query("q")||"").trim().slice(0,500);
 const tavily=process.env.TAVILY_API_KEY||"";
 if(!query)return c.json({error:"Search query is required."},400);
 if(!tavily)return c.json({error:"Web search is not configured. Set TAVILY_API_KEY."},503);
 try{
  const r=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({api_key:tavily,query,max_results:6,search_depth:"advanced",include_answer:true})});
  const d=await r.json().catch(()=>null);
  if(!r.ok)return c.json({error:d?.detail||d?.error||("Search provider HTTP "+r.status)},r.status as any);
  return c.json({ok:true,answer:d?.answer||"",results:Array.isArray(d?.results)?d.results.map((x:any)=>({title:x.title,url:x.url,content:x.content,score:x.score})):[]});
 }catch(e){return c.json({error:e instanceof Error?e.message:"Web search failed."},502)}
});

app.post("/api/memory",async c=>{try{const body=await c.req.json();const messages=Array.isArray(body.messages)?body.messages:[];const memory=typeof body.memory==="string"?body.memory.slice(0,3200):"";const context=[...(memory?[{role:"system",content:"User-saved memory:\n"+memory}]:[]),...messages.slice(-12).map((m:any)=>({role:m.role==="user"?"user":"assistant",content:String(m.content??"").slice(0,900)}))];const encoded=encodeURIComponent(JSON.stringify(context));if(encoded.length>6500)return c.json({error:"Memory is too large."},413);return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","set-cookie":`red_memory=${encoded}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`}})}catch{return c.json({error:"Invalid memory payload."},400)}});

app.get("/api/avatars",async c=>{if(!key())return c.json({avatars:[],error:"Realtime Avatar server key is not configured."},503);try{const r=await fetch(base+"/avatars",{headers:headers()});if(!r.ok)return c.json({avatars:[],error:`Avatar provider returned HTTP ${r.status}.`},r.status as any);const payload=await r.json();const rows=Array.isArray(payload?.data)?payload.data:[];const custom=rows.filter((a:any)=>/^ava_[A-Za-z0-9_-]+$/.test(String(a?.id))&&!isPublicFigureLabel(String(a?.displayName||a?.name||""))).map((a:any)=>({id:String(a.id),name:String(a.displayName||a.name||"Live Avatar"),status:String(a.status||"unknown"),poster:a.posterUrl||a.poster_url||a.anchor?.url||null,idle:a.idleVideoUrl||a.idle_video_url||a.video?.url||null}));return c.json({avatars:[{id:"seed-rin-ashfall",name:"Rin Ashfall",status:"ready",poster:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png",idle:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4"},...new Map(custom.map((x:any)=>[x.id,x])).values()]})}catch{return c.json({avatars:[],error:"Avatar provider could not be reached."},502)}});

app.get("/api/avatar/status",async c=>{const id=c.req.query("id")||"";if(!/^ava_[A-Za-z0-9_-]+$/.test(id))return c.json({error:"Invalid avatar id."},400);if(!key())return c.json({error:"Realtime Avatar server key is not configured."},503);try{const r=await fetch(base+"/avatars/"+encodeURIComponent(id),{headers:headers()});const d=await r.json().catch(()=>({}));if(!r.ok)return c.json({error:d?.error||`Avatar provider returned HTTP ${r.status}.`},r.status as any);return c.json({id:d.id,status:d.status,displayName:d.displayName||d.name||"Live Avatar",error:d.error||null,posterUrl:d.posterUrl||d.poster_url||null,idleVideoUrl:d.idleVideoUrl||d.idle_video_url||null})}catch{return c.json({error:"Avatar provider could not be reached."},502)}});

async function createAvatar(c:any,file:File,name:string,motion:string,policy:boolean){if(process.env.ALLOW_PAID_AVATAR_CREATION!=="true")return c.json({error:"Provider avatar generation is disabled in free mode. Use a local portrait avatar instead."},403);if(!key())return c.json({error:"Realtime Avatar server key is not configured."},503);if(!policy)return c.json({error:"Confirm that the portrait is original, licensed, or used with permission, and is not a public figure."},400);if(isPublicFigureLabel(name)||isPublicFigureLabel(motion))return c.json({error:"Public-figure avatars are not allowed in RED LIVE."},400);if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>8*1024*1024)return c.json({error:"Use a PNG, JPEG or WebP portrait up to 8 MB."},400);try{const rta=new RealtimeAvatar({apiKey:key()});const asset=await rta.uploadAsset(file,{kind:"image",filename:file.name||"portrait.png"});const avatar:any=await rta.createAvatar({displayName:name,sourceKind:"image",sourceAssetId:asset.id,motionPrompt:motion,voice:{auto_description:"Natural adult human voice. Warm, grounded, realistic British or neutral English conversation. Mature adult delivery, subtle emotion, natural pauses and varied intonation. Never cartoon, mascot, character, childlike, announcer, presenter, radio, call-centre, squeaky, sing-song or theatrical."}});return c.json({id:avatar.id,displayName:avatar.displayName||name,status:avatar.status,posterUrl:avatar.posterUrl||avatar.anchor?.url||null,idleVideoUrl:avatar.idleVideoUrl||avatar.idle_video_url||null});}catch(e){const err:any=e;const status=Number(err?.status||err?.statusCode||0);return c.json({error:err?.message||"Avatar creation failed.",code:err?.code||"avatar_creation_failed"},status>=400&&status<600?status:502)}}
app.post("/api/avatar/create",async c=>{try{const form=await c.req.formData();const file=form.get("file");if(!(file instanceof File))return c.json({error:"Portrait image is required."},400);const name=String(form.get("name")||"RED Avatar").slice(0,160);const motion=String(form.get("motionPrompt")||"Natural breathing, blinking, attentive eye contact, subtle head and shoulder movement, expressive listening and restrained conversational gestures.").slice(0,1200);const policy=String(form.get("policyAccepted")||"")==="true";return await createAvatar(c,file,name,motion,policy)}catch(e){return c.json({error:e instanceof Error?e.message:"Avatar creation failed."},500)}});
app.post("/api/avatar/create-from-url",async c=>{try{const body=await c.req.json();const imageUrl=typeof body.imageUrl==="string"?body.imageUrl:"";const name=typeof body.displayName==="string"?body.displayName.slice(0,80):"RED LIVE Avatar";const motion=typeof body.motionPrompt==="string"?body.motionPrompt.slice(0,1000):"Natural breathing, blinking, attentive eye contact, subtle head and shoulder movement and restrained conversational gestures.";if(!/^https:\/\//i.test(imageUrl))return c.json({error:"Secure image URL required."},400);const source=await fetch(imageUrl);if(!source.ok)return c.json({error:"Avatar portrait could not be loaded."},502);const type=(source.headers.get("content-type")||"").split(";")[0].toLowerCase();const blob=await source.blob();const file=new File([blob],name.replace(/[^a-z0-9]+/gi,"-")+"."+(type==="image/png"?"png":type==="image/webp"?"webp":"jpg"),{type});return await createAvatar(c,file,name,motion,body.policyAccepted===true)}catch(e){return c.json({error:e instanceof Error?e.message:"Avatar creation failed."},500)}});

app.get("/api/heygen/status",async c=>{if(process.env.ALLOW_PAID_LIVE_SESSIONS!=="true")return c.json({enabled:false,configured:false,error:"Paid live-avatar sessions are disabled in free mode."});const apiKey=process.env.HEYGEN_API_KEY||"";const avatarId=process.env.HEYGEN_AVATAR_ID||"";const apiUrl=(process.env.HEYGEN_API_URL||"https://api.liveavatar.com").replace(/\/$/,"");if(!apiKey)return c.json({enabled:false,configured:false,error:"HEYGEN_API_KEY is not configured on the server."});if(!avatarId)return c.json({enabled:true,configured:false,error:"HEYGEN_AVATAR_ID is missing. A HeyGen Video Agent render is not automatically a LiveAvatar ID."});return c.json({enabled:true,configured:true,avatarId,provider:"HeyGen LiveAvatar",apiUrl});});

app.post("/api/heygen/session",async c=>{if(process.env.ALLOW_PAID_LIVE_SESSIONS!=="true")return c.json({error:"Paid live-avatar sessions are disabled in free mode."},403);const apiKey=process.env.HEYGEN_API_KEY||"";const avatarId=process.env.HEYGEN_AVATAR_ID||"";const apiUrl=(process.env.HEYGEN_API_URL||"https://api.liveavatar.com").replace(/\/$/,"");if(!apiKey)return c.json({error:"HeyGen LiveAvatar is not configured. Add HEYGEN_API_KEY to the RED-LIVE server environment."},503);if(!avatarId)return c.json({error:"HEYGEN_AVATAR_ID is missing. Configure a LiveAvatar ID before starting a provider session."},503);try{const body=await c.req.json().catch(()=>({}));const requestedAvatar=typeof body?.avatarId==="string"&&body.avatarId.trim()?body.avatarId.trim():avatarId;const sessionBody:any={mode:"LITE",is_sandbox:String(process.env.HEYGEN_IS_SANDBOX||"false")==="true"};if(requestedAvatar)sessionBody.avatar_id=requestedAvatar;const r=await fetch(apiUrl+"/v1/sessions/token",{method:"POST",headers:{"X-API-KEY":apiKey,"content-type":"application/json"},body:JSON.stringify(sessionBody)});const d=await r.json().catch(()=>null);if(!r.ok)return c.json({error:d?.data?.[0]?.message||d?.error||("HeyGen HTTP "+r.status)},r.status as any);const token=d?.data?.session_token;const sessionId=d?.data?.session_id;if(!token)return c.json({error:"HeyGen returned no session token."},502);return c.json({session_token:token,session_id:sessionId,avatar_id:requestedAvatar||null});}catch(e){return c.json({error:e instanceof Error?e.message:"HeyGen session creation failed."},502)}});


async function checkAvatarWorker(){
 const url=(process.env.AVATAR_WORKER_URL||"").replace(/\/$/,"");
 if(!url)return {configured:false,available:false,engine:null,error:"AVATAR_WORKER_URL is not configured."};
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),3500);
 try{
  const r=await fetch(url+"/health",{signal:controller.signal,headers:{"accept":"application/json"}});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return {configured:true,available:false,engine:data?.engine||null,error:"Avatar worker health endpoint returned HTTP "+r.status+"."};
  if(data?.ok!==true)return {configured:true,available:false,engine:data?.engine||null,error:"Avatar worker did not confirm healthy status."};
  return {configured:true,available:true,engine:typeof data.engine==="string"?data.engine:"unknown",gpu:typeof data.gpu==="boolean"?data.gpu:null,error:null};
 }catch(e){
  return {configured:true,available:false,engine:null,error:e instanceof Error&&e.name==="AbortError"?"Avatar worker health check timed out.":"Avatar worker could not be reached."};
 }finally{clearTimeout(timeout)}
}
app.get("/api/avatar-worker/status",async c=>c.json(await checkAvatarWorker()));

app.get("/api/runtime-status",async c=>{const avatarWorker=await checkAvatarWorker();return c.json({realtimeAvatarConfigured:Boolean(key()),paidLiveSessionsEnabled:process.env.ALLOW_PAID_LIVE_SESSIONS==="true",heygenConfigured:Boolean(process.env.HEYGEN_API_KEY&&process.env.HEYGEN_AVATAR_ID),textAiConfigured:Boolean(process.env.LLM_BASE_URL&&process.env.LLM_API_KEY&&process.env.LLM_MODEL),textAiFallbackConfigured:Boolean(process.env.LLM_FALLBACK_BASE_URL&&process.env.LLM_FALLBACK_API_KEY&&process.env.LLM_FALLBACK_MODEL),webSearchConfigured:Boolean(process.env.TAVILY_API_KEY),avatarWorker});});
app.get("/api/health",c=>c.json({ok:true,service:"RED LIVE",build:"live-generative-avatar-v2",liveMode:"realtime-generative-avatar",sdk:"realtime-avatar@0.27.0"}));
app.get("/health",c=>c.json({ok:true,service:"RED LIVE",build:"live-generative-avatar-v2",liveMode:"realtime-generative-avatar",sdk:"realtime-avatar@0.27.0"}));
app.use("/*",serveStatic({root:"./dist"}));
const port=Number(process.env.PORT||3000);serve({fetch:app.fetch,port});
