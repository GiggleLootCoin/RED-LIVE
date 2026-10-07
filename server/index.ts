import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { realtimeAvatarHono } from "realtime-avatar/hono";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const app = new Hono();
const key = () => process.env.REALTIME_AVATAR_API_KEY ?? "";
const base = "https://realtimeavatar.ai/api/v1";
const headers = () => ({ Authorization: "Bearer " + key() });
const persona = "You are RED LIVE, a highly natural conversational AI companion. Speak in a relaxed, human conversational rhythm with contractions, varied sentence length, brief natural reactions and occasional pauses. Sound like a real person, not a cartoon, announcer, presenter, chatbot or call-centre agent. Use natural conversational phrasing, realistic pacing and understated emotion. Do not repeat greetings or filler. Listen while the user speaks and respond directly to what they actually said. Let the user interrupt. Keep ordinary replies concise and expand when useful. Use the supplied conversation context as memory. Never claim to be human.";

const FALLBACK_AVATAR_IDS = new Set([
  "seed-rin-ashfall",
  "seed-vesper-nyx",
  "seed-professor-thistle",
  "seed-valko",
  "seed-remy",
  "seed-koko",
  "seed-luciano-draven",
]);

function isAvatarIdAllowed(id: string) {
  return FALLBACK_AVATAR_IDS.has(id) || /^ava_[A-Za-z0-9_-]+$/.test(id);
}

async function getProviderAvatar(id: string) {
  if (!key() || !isAvatarIdAllowed(id)) return null;
  const r = await fetch(base + "/avatars/" + encodeURIComponent(id), { headers: headers() });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

function isAvatarSafeForREDLive(avatar: any) {
  if (!avatar?.id) return false;
  const label = [avatar.displayName, avatar.name, avatar.description, avatar.persona]
    .filter(Boolean).join(" ");
  return !isPublicFigureLabel(label);
}


function isPublicFigureLabel(value: string) {
  return /(^|\s)(celebrity|politician|president|prime minister|king|queen|world leader|public figure)($|\s)/i.test(value);
}

function cookieContext(request: Request) {
  const raw = request.headers.get("cookie")?.match(/red_memory=([^;]+)/)?.[1];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed.slice(-18) : [];
  } catch { return []; }
}

app.all("/api/realtime-avatar/*", realtimeAvatarHono({
  apiKey: key,
  // The SDK may use the read operations for balance/avatar state.
  // Only the actual connect/end operations are sensitive here; the provider
  // still keeps the API key server-side.
  // Session policy below is the authoritative avatar allowlist/readiness gate.
  // The adapter's authorize hook does not receive avatarId in its documented shape.
  authorize: () => undefined,
  session: async ({ request, avatarId }) =>
    isAvatarIdAllowed(avatarId)
      ? await (async () => {
          const avatar = await getProviderAvatar(avatarId);
          if (!avatar || avatar.status !== "ready" || !isAvatarSafeForREDLive(avatar)) {
            return new Response("Avatar is not ready or is not permitted in RED LIVE.", { status: 403 });
          }
          return {
          instructions: persona,
          context: cookieContext(request),
          maxSeconds: 180,
          camera: true,
          listen: true,
          clientTools: true,
          // Keep the provider's generated portrait loop and motion library.
          // This gives the character breathing, blinking, listening reactions
          // and gestures without forcing the less predictable generative mode.
          };
        })()
      : new Response("Avatar not allowed", { status: 403 }),
}));

app.get("/api/live-diagnostic", async c => {
  if (!key()) return c.json({ ok: false, error: "REALTIME_AVATAR_API_KEY is not configured on the server." }, 503);
  try {
    const [creditsRes, avatarRes] = await Promise.all([
      fetch(base + "/credits/balance", { headers: headers() }),
      fetch(base + "/avatars/seed-rin-ashfall", { headers: headers() }),
    ]);
    const creditsText = await creditsRes.text();
    const avatarText = await avatarRes.text();
    let credits:any = null, avatar:any = null;
    try { credits = JSON.parse(creditsText); } catch {}
    try { avatar = JSON.parse(avatarText); } catch {}
    return c.json({
      ok: creditsRes.ok && avatarRes.ok && avatar?.status === "ready",
      creditsStatus: creditsRes.status,
      avatarStatus: avatarRes.status,
      avatarReady: avatar?.status === "ready",
      credits: credits?.balance ?? credits?.available ?? credits?.credits ?? null,
      avatar: avatar ? {
        id: avatar.id,
        status: avatar.status,
        idleVideoStatus: avatar.idleVideoStatus,
        error: avatar.error ?? null
      } : null,
      errors: [
        !creditsRes.ok ? `Credits endpoint HTTP ${creditsRes.status}` : "",
        !avatarRes.ok ? `Rin endpoint HTTP ${avatarRes.status}` : "",
        avatar && avatar.status !== "ready" ? `Rin avatar status: ${avatar.status}` : ""
      ].filter(Boolean)
    });
  } catch (e) {
    return c.json({ ok:false, error:e instanceof Error ? e.message : "Provider check failed" }, 502);
  }
});

app.post("/api/memory", async c => {
  try {
    const body = await c.req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const memory = typeof body.memory === "string" ? body.memory.slice(0, 3200) : "";

    // Keep this cookie deliberately small: it is sent with every live-session
    // request, and browsers impose tight cookie/header limits.
    const context = [
      ...(memory
        ? [{ role: "system", content: "User-saved memory:\n" + memory }]
        : []),
      ...messages.slice(-12).map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content ?? "").slice(0, 900),
      })),
    ];

    const encoded = encodeURIComponent(JSON.stringify(context));
    if (encoded.length > 6500) {
      return c.json({ error: "Memory is too large." }, 413);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
        "set-cookie":
          `red_memory=${encoded}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`,
      },
    });
  } catch {
    return c.json({ error: "Invalid memory payload." }, 400);
  }
});

app.get("/api/avatars", async c => {
  const fallback = [
    { id: "seed-rin-ashfall", name: "Rin Ashfall", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png", idle: "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4" },
    { id: "seed-vesper-nyx", name: "Vesper Nyx", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/vesper-nyx/portrait.png" },
    { id: "seed-professor-thistle", name: "Professor Thistle", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/professor-thistle/portrait.png" },
    { id: "seed-valko", name: "Valko", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/valko/portrait.png" },
    { id: "seed-remy", name: "Remy", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/remy/portrait.png" },
    { id: "seed-koko", name: "Koko", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/koko/portrait.png" },
    { id: "seed-luciano-draven", name: "Luciano Draven", status: "ready", poster: "https://realtimeavatar.ai/api/assets/public/characters/luciano-draven/portrait.png" },
  ];

  if (!key()) return c.json({ avatars: fallback });

  try {
    const r = await fetch(base + "/avatars", { headers: headers() });
    if (!r.ok) return c.json({ avatars: fallback });
    const payload = await r.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const actual = rows
      .filter((a: any) => a?.id && isAvatarIdAllowed(String(a.id)) && !isPublicFigureLabel(String(a.displayName || a.name || "")))
      .map((a: any) => ({
        id: String(a.id),
        name: String(a.displayName || a.name || "Live Avatar"),
        status: String(a.status || "unknown"),
        poster: a.posterUrl || a.poster_url || a.anchor?.url || null,
        idle: a.idleVideoUrl || a.idle_video_url || a.video?.url || null,
      }));
    const map = new Map<string, any>();
    for (const a of [...fallback, ...actual]) map.set(a.id, a);
    return c.json({ avatars: [...map.values()] });
  } catch {
    return c.json({ avatars: fallback });
  }
});

app.post("/api/avatar/create-from-url", async c => {
  try {
    if (!key()) return c.json({ error: "Live avatar API key is not configured." }, 503);
    const body = await c.req.json();
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.slice(0, 80) : "RED LIVE Avatar";
    const policyAccepted = body.policyAccepted === true;
    if (!policyAccepted) return c.json({ error: "Confirm that the portrait is original, licensed, or used with permission, and is not a celebrity, politician, world leader, or other public figure." }, 400);
    if (isPublicFigureLabel(displayName)) return c.json({ error: "Public-figure avatars are not allowed in RED LIVE." }, 400);
    const motionPrompt = typeof body.motionPrompt === "string" ? body.motionPrompt.slice(0, 1000) : "Natural conversational presence with visible breathing, blinking, eye movement, attentive listening reactions, subtle head and shoulder movement, expressive facial micro-movements, and restrained conversational gestures.";
    if (!/^https:\/\//i.test(imageUrl)) return c.json({ error: "Secure image URL required." }, 400);
    if (isPublicFigureLabel(motionPrompt)) return c.json({ error: "Public-figure avatar prompts are not allowed in RED LIVE." }, 400);

    const source = await fetch(imageUrl);
    if (!source.ok) return c.json({ error: "Avatar portrait could not be loaded." }, 502);
    const type = (source.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/jpeg","image/png","image/webp"].includes(type)) return c.json({ error: "Avatar portrait must be JPEG, PNG, or WebP." }, 415);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) return c.json({ error: "Avatar portrait is too large." }, 413);

    const form = new FormData();
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    form.append("file", new Blob([bytes], { type }), displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "." + ext);
    form.append("kind", "image");

    const upload = await fetch(base + "/assets", { method: "POST", headers: headers(), body: form });
    const asset = await upload.json().catch(() => ({}));
    if (!upload.ok) return c.json({ error: asset?.error || "Avatar portrait upload failed.", details: asset }, upload.status as any);

    const created = await fetch(base + "/avatars", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        displayName,
        sourceAssetId: asset.id,
        motionPrompt,
        voice: { auto_description: "Natural, character-appropriate conversational voice, warm and emotionally expressive, realistic pacing, subtle breaths, natural pauses, varied intonation, responsive listening, no announcer or call-centre delivery, and no exaggerated cartoon affect." }
      })
    });
    const avatar = await created.json().catch(() => ({}));
    if (!created.ok) return c.json({ error: avatar?.error || "Avatar creation failed.", details: avatar }, created.status as any);
    return c.json({
      id: avatar.id,
      name: avatar.displayName || displayName,
      status: avatar.status,
      posterUrl: avatar.posterUrl || avatar.poster_url || imageUrl,
      idleVideoUrl: avatar.idleVideoUrl || avatar.idle_video_url || null
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Avatar creation failed." }, 500);
  }
});

app.post("/api/avatar/create", async c => {
  if (!key()) {
    return c.json({ error: "Realtime Avatar server key is not configured." }, 503);
  }

  try {
    const form = await c.req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "RED Avatar").slice(0, 160);
    const policyAccepted = String(form.get("policyAccepted") || "") === "true";
    const motionPrompt = String(
      form.get("motionPrompt") ||
        "Natural breathing and blinking, expressive eye movement, attentive listening, subtle head and shoulder movement, small facial micro-expressions, and restrained conversational gestures."
    ).slice(0, 1200);

    if (!(file instanceof File)) {
      return c.json({ error: "Portrait image is required." }, 400);
    }
    if (!policyAccepted) {
      return c.json({ error: "Confirm that the portrait is original, licensed, or used with permission, and is not a celebrity, politician, world leader, or other public figure." }, 400);
    }
    if (isPublicFigureLabel(name) || isPublicFigureLabel(motionPrompt)) {
      return c.json({ error: "Public-figure avatars are not allowed in RED LIVE." }, 400);
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      return c.json({ error: "Use a PNG, JPEG, or WebP portrait." }, 400);
    }
    if (file.size > 8 * 1024 * 1024) {
      return c.json({ error: "Portrait must be 8 MB or smaller." }, 413);
    }

    const body = new FormData();
    body.append("file", file, file.name || "portrait.png");
    body.append("kind", "image");

    const upload = await fetch(base + "/assets", {
      method: "POST",
      headers: headers(),
      body,
    });
    if (!upload.ok) {
      return c.json(
        { error: "Avatar image upload failed.", details: await upload.text() },
        upload.status as any
      );
    }

    const asset = await upload.json();
    const create = await fetch(base + "/avatars", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        sourceAssetId: asset.id,
        motionPrompt,
        voice: {
          auto_description:
            "Natural adult human voice, warm and emotionally expressive, conversational rather than announcer-like, realistic pacing, subtle breaths, natural pauses, varied intonation, no cartoon affect, no exaggerated character voice.",
        },
      }),
    });

    if (!create.ok) {
      return c.json(
        { error: "Avatar creation failed.", details: await create.text() },
        create.status as any
      );
    }

    return c.json(await create.json());
  } catch {
    return c.json({ error: "Avatar creation request failed." }, 502);
  }
});

app.get("/api/avatar/status", async c => {
  if (!key()) {
    return c.json({ error: "Realtime Avatar server key is not configured." }, 503);
  }

  const id = c.req.query("id") || "";
  if (!/^ava_[A-Za-z0-9_-]+$/.test(id)) {
    return c.json({ error: "Invalid avatar id." }, 400);
  }

  const r = await fetch(base + "/avatars/" + encodeURIComponent(id), {
    headers: headers(),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
});

app.post("/api/chat", async c => {
  const provider = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!provider || !model) {
    return c.json({
      reply:
        "Start the live conversation for hands-free voice and the talking avatar.",
    });
  }

  try {
    const body = await c.req.json();
    const messages = Array.isArray(body.messages)
      ? body.messages.slice(-24)
      : [];
    const memory =
      typeof body.memory === "string" ? body.memory.slice(0, 6000) : "";

    const r = await fetch(
      provider.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: persona + (memory ? "\nUser memory:\n" + memory : ""),
            },
            ...messages.map((m: any) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: String(m.content ?? ""),
            })),
          ],
          temperature: 0.7,
        }),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      return c.json(
        { error: data?.error?.message || "LLM request failed." },
        r.status as any
      );
    }

    return c.json({
      reply:
        data?.choices?.[0]?.message?.content || "I didn't receive a response.",
    });
  } catch {
    return c.json({ error: "LLM connection failed." }, 502);
  }
});

app.get("/api/web-search", async c => {
  const q = (c.req.query("q") || "").trim().slice(0, 240);
  if (!q) return c.json({ error: "Search query is required." }, 400);
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return c.json({ error: "Web search is not configured. Add TAVILY_API_KEY in Render." }, 503);
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query: q, search_depth: "basic", max_results: 6, include_answer: false }),
    });
    const d = await r.json();
    if (!r.ok) return c.json({ error: d?.detail || "Web search failed." }, r.status as any);
    return c.json({ results: Array.isArray(d.results) ? d.results.map((x:any) => ({ title:String(x.title||""), url:String(x.url||""), snippet:String(x.content||"").slice(0,500) })) : [] });
  } catch { return c.json({ error: "Web search connection failed." }, 502); }
});

app.get("/api/provider-check", async c => {
  if (!key()) return c.json({ ok: false, avatar: "missing_key" }, 503);
  try {
    const [credits, avatars] = await Promise.all([
      fetch(base + "/credits/balance", { headers: headers() }),
      fetch(base + "/avatars?limit=1", { headers: headers() }),
    ]);
    return c.json({
      ok: credits.ok && avatars.ok,
      avatar: avatars.ok ? "reachable" : "scope_or_provider_error",
      credits: credits.ok ? "reachable" : "scope_or_provider_error",
    });
  } catch {
    return c.json({ ok: false, avatar: "provider_unreachable" }, 502);
  }
});

const health = (c: any) =>
  c.json({
    ok: true,
    avatarProvider: key() ? "configured" : "missing",
    webSearch: process.env.TAVILY_API_KEY ? "configured" : "missing",
    publicUrl: process.env.RENDER_EXTERNAL_URL || null,
    textModel: process.env.LLM_MODEL || "live-avatar",
  });

app.get("/api/health", health);
app.get("/healthz", health);

app.get("*", async c => {
  const requested =
    c.req.path === "/" ? "index.html" : c.req.path.replace(/^\//, "");
  const safe = requested.replace(/\.\./g, "");

  try {
    const filePath = join(process.cwd(), "dist", safe);
    const data = await readFile(filePath);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    return new Response(data, {
      headers: { "content-type": types[extname(filePath)] || "application/octet-stream" },
    });
  } catch {
    if (c.req.path !== "/" && !c.req.path.endsWith(".html")) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const data = await readFile(join(process.cwd(), "dist", "index.html"));
      return new Response(data, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("RED LIVE build is unavailable.", { status: 503 });
    }
  }
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT || 8787),
  hostname: "0.0.0.0",
});
