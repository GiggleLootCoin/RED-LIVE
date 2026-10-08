import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { realtimeAvatarHono } from "realtime-avatar/hono";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const app = new Hono();
const key = () => process.env.REALTIME_AVATAR_API_KEY ?? "";
const base = "https://realtimeavatar.ai/api/v1";
const headers = () => ({ Authorization: "Bearer " + key() });
const persona = "You are RED LIVE, a highly natural adult conversational AI companion. Speak like a real adult person: grounded, warm, calm, slightly imperfect and spontaneous. Use natural contractions, varied sentence length, realistic pauses, subtle emotional inflection and understated reactions. Avoid any cartoon, anime, childlike, mascot, announcer, presenter, radio, call-centre, sing-song, overly cheerful or theatrical delivery. Do not use exaggerated character voices, squeaky tones, fake excitement or constant smiling energy. Keep your vocal phrasing easy to speak aloud and conversational. Do not repeat greetings or filler. Listen while the user speaks and respond directly to what they actually said. Let the user interrupt. Keep ordinary replies concise and expand when useful. Use supplied conversation context as memory. Never claim to be human.";

function isAvatarIdAllowed(id: string) { return id === "seed-rin-ashfall" || /^ava_[A-Za-z0-9_-]+$/.test(id); }
function isPublicFigureLabel(value: string) { return /(^|\s)(celebrity|politician|president|prime minister|king|queen|world leader|public figure)($|\s)/i.test(value); }
function isAvatarSafeForREDLive(avatar: any) { const label = String(avatar?.displayName || avatar?.name || ""); return !isPublicFigureLabel(label) && (avatar?.status === "ready" || avatar?.id === "seed-rin-ashfall"); }
function cookieContext(request: Request) { const raw = request.headers.get("cookie")?.match(/red_memory=([^;]+)/)?.[1]; if (!raw) return []; try { const parsed = JSON.parse(decodeURIComponent(raw)); return Array.isArray(parsed) ? parsed.slice(-18) : []; } catch { return []; } }

async function getProviderAvatar(id: string) {
  if (id === "seed-rin-ashfall") return { id:"seed-rin-ashfall", status:"ready", displayName:"Rin Ashfall" };
  if (!key() || !isAvatarIdAllowed(id)) return null;
  const r = await fetch(base + "/avatars/" + encodeURIComponent(id), { headers: headers() });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

app.all("/api/realtime-avatar/*", realtimeAvatarHono({
  apiKey: key,
  authorize: ({ operation }) => operation === "connect" || operation === "end" ? undefined : new Response("Not found", { status: 404 }),
  session: async ({ request, avatarId }) => {
    if (!isAvatarIdAllowed(avatarId)) return new Response("Avatar not allowed", { status: 403 });
    // The documented public Rin avatar is already known by RTA. Do not perform
    // an avatars:read request during connect: a realtime-only key can mint the
    // session, while an unnecessary read permission check can reject the call.
    const avatar = await getProviderAvatar(avatarId);
    if (!avatar || !isAvatarSafeForREDLive(avatar)) return new Response("Avatar is not ready or is not permitted in RED LIVE.", { status: 403 });
    return {
      instructions: persona,
      context: cookieContext(request),
      maxSeconds: 180,
      camera: true,
      listen: true,
      clientTools: true,
    };
  },
}));

app.get("/api/live-diagnostic", async c => {
  if (!key()) return c.json({ ok:false, error:"REALTIME_AVATAR_API_KEY is not configured on the server." }, 503);
  try {
    const [creditsRes, avatarsRes, capacityRes] = await Promise.all([
      fetch(base + "/credits/balance", { headers: headers() }),
      fetch(base + "/avatars", { headers: headers() }),
      fetch(base + "/realtime/livekit/capacity", { headers: headers() }),
    ]);
    const credits = await creditsRes.json().catch(() => null);
    const capacity = await capacityRes.json().catch(() => null);
    const payload = await avatarsRes.json().catch(() => null);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const allowed = rows.filter((a:any) => /^ava_[A-Za-z0-9_-]+$/.test(String(a?.id)) && !isPublicFigureLabel(String(a?.displayName || a?.name || "")));
    const ready = allowed.filter((a:any) => a.status === "ready");
    return c.json({
      ok: creditsRes.ok && avatarsRes.ok,
      creditsStatus: creditsRes.status,
      avatarStatus: avatarsRes.status,
      realtimeStatus: capacityRes.status,
      realtimeScope: capacityRes.ok ? "realtime:write confirmed" : "Realtime capacity check unavailable; this does not block calls.",
      capacity,
      avatarReady: true,
      credits: credits?.balance ?? credits?.available ?? credits?.credits ?? null,
      avatars:[{id:"seed-rin-ashfall",name:"Rin Ashfall",status:"ready",idleVideoStatus:"ready",error:null}, ...allowed.map((a:any)=>({id:a.id,name:a.displayName||a.name||"Live Avatar",status:a.status,idleVideoStatus:a.idleVideoStatus,error:a.error??null}))],
      errors:[!creditsRes.ok?`Credits endpoint HTTP ${creditsRes.status}`:"",!avatarsRes.ok?`Avatar list endpoint HTTP ${avatarsRes.status}`:"",avatarsRes.ok&&ready.length===0?"No custom READY platform avatars are available; the public Rin example is available.":""].filter(Boolean)
    });
  } catch(e) { return c.json({ok:false,error:e instanceof Error?e.message:"Provider check failed"},502); }
});

app.post("/api/memory", async c => {
  try {
    const body = await c.req.json(); const messages = Array.isArray(body.messages)?body.messages:[]; const memory = typeof body.memory === "string" ? body.memory.slice(0,3200) : "";
    const context=[...(memory?[{role:"system",content:"User-saved memory:\n"+memory}]:[]),...messages.slice(-12).map((m:any)=>({role:m.role==="user"?"user":"assistant",content:String(m.content??"").slice(0,900)}))];
    const encoded=encodeURIComponent(JSON.stringify(context)); if(encoded.length>6500)return c.json({error:"Memory is too large."},413);
    return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","set-cookie":`red_memory=${encoded}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`}});
  } catch { return c.json({error:"Invalid memory payload."},400); }
});

app.get("/api/avatars", async c => {
  if(!key())return c.json({avatars:[],error:"Realtime Avatar server key is not configured."},503);
  try {
    const r=await fetch(base+"/avatars",{headers:headers()}); if(!r.ok)return c.json({avatars:[],error:`Avatar provider returned HTTP ${r.status}.`},r.status as any);
    const payload=await r.json(); const rows=Array.isArray(payload?.data)?payload.data:[];
    const example={id:"seed-rin-ashfall",name:"Rin Ashfall",status:"ready",poster:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png",idle:"https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4"};
    const custom=rows.filter((a:any)=>/^ava_[A-Za-z0-9_-]+$/.test(String(a?.id))&&!isPublicFigureLabel(String(a?.displayName||a?.name||""))).map((a:any)=>({id:String(a.id),name:String(a.displayName||a.name||"Live Avatar"),status:String(a.status||"unknown"),poster:a.posterUrl||a.poster_url||a.anchor?.url||null,idle:a.idleVideoUrl||a.idle_video_url||a.video?.url||null}));
    return c.json({avatars:[...new Map([example,...custom].map((x:any)=>[x.id,x])).values()]});
  } catch { return c.json({avatars:[],error:"Avatar provider could not be reached."},502); }
});

app.get("/health",c=>c.json({ok:true,service:"RED LIVE"}));

const port=Number(process.env.PORT||3000); serve({fetch:app.fetch,port});
