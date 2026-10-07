import {Hono} from "hono";
import {serve} from "@hono/node-server";
import {realtimeAvatarHono} from "realtime-avatar/hono";

const app=new Hono();
const apiKey=()=>process.env.REALTIME_AVATAR_API_KEY??"";
app.all("/api/realtime-avatar/*",realtimeAvatarHono({
 apiKey,
 authorize:({operation})=>operation==="connect"||operation==="end"?undefined:new Response("Not found",{status:404}),
 session:({avatarId})=>avatarId==="seed-rin-ashfall"
  ? {instructions:"You are Rin, a warm, curious conversational AI avatar. Speak naturally and concisely. Listen while speaking, allow interruption, ask one question at a time, and never claim to be human.",maxSeconds:120}
  : new Response("Avatar not allowed",{status:403})
}));
app.post("/api/chat",async c=>c.json({reply:"RED LIVE text chat is available once an LLM provider is connected to this server."},503));
app.get("/api/health",c=>c.json({ok:true,avatarProvider:apiKey()?"configured":"missing"}));
const port=Number(process.env.PORT||8787);
serve({fetch:app.fetch,port});
