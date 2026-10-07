import {Hono} from "hono";
import {serve} from "@hono/node-server";
import {realtimeAvatarHono} from "realtime-avatar/hono";

const app=new Hono();
const key=()=>process.env.REALTIME_AVATAR_API_KEY??"";
const base="https://realtimeavatar.ai/api/v1";
const headers=()=>({Authorization:"Bearer "+key()});

app.all("/api/realtime-avatar/*",realtimeAvatarHono({
 apiKey:key,
 authorize:({operation})=>operation==="connect"||operation==="end"?undefined:new Response("Not found",{status:404}),
 session:({avatarId})=>avatarId==="seed-rin-ashfall"||avatarId.startsWith("ava_")
  ? {instructions:"You are RED LIVE: warm, curious, natural and concise. Speak like a real conversational companion, listen while speaking, allow interruption, ask one question at a time, and never claim to be human.",maxSeconds:120}
  : new Response("Avatar not allowed",{status:403})
}));

app.post("/api/avatar/create",async c=>{
 if(!key())return c.json({error:"Realtime Avatar server key is not configured."},503);
 const form=await c.req.formData();
 const file=form.get("file");
 const name=String(form.get("name")||"RED Avatar").slice(0,160);
 const motionPrompt=String(form.get("motionPrompt")||"Natural subtle idle movement, relaxed expression, occasional gentle head movement.").slice(0,1200);
 if(!(file instanceof File))return c.json({error:"Portrait image is required."},400);
 if(file.size>8*1024*1024)return c.json({error:"Portrait must be 8 MB or smaller."},413);
 const body=new FormData();body.append("file",file,file.name||"portrait.png");body.append("kind","image");
 const upload=await fetch(base+"/assets",{method:"POST",headers:headers(),body});
 if(!upload.ok)return c.json({error:"Avatar image upload failed.",details:await upload.text()},upload.status as any);
 const asset=await upload.json();
 const create=await fetch(base+"/avatars",{method:"POST",headers:{...headers(),"content-type":"application/json"},body:JSON.stringify({displayName:name,sourceAssetId:asset.id,motionPrompt,voice:{auto_description:"Warm, natural, conversational voice; clear and friendly."}})});
 if(!create.ok)return c.json({error:"Avatar creation failed.",details:await create.text()},create.status as any);
 return c.json(await create.json());
});

app.get("/api/avatar/status",async c=>{
 const id=c.req.query("id")||"";
 if(!/^ava_[A-Za-z0-9_-]+$/.test(id))return c.json({error:"Invalid avatar id."},400);
 const r=await fetch(base+"/avatars/"+encodeURIComponent(id),{headers:headers()});
 return new Response(await r.text(),{status:r.status,headers:{"content-type":"application/json"}});
});

app.post("/api/chat",async c=>c.json({reply:"RED LIVE text chat is ready for an LLM adapter; the realtime avatar path is the primary conversation mode."},503));
app.get("/api/health",c=>c.json({ok:true,avatarProvider:key()?"configured":"missing"}));
serve({fetch:app.fetch,port:Number(process.env.PORT||8787)});
