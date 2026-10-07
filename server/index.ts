import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { realtimeAvatarHono } from "realtime-avatar/hono";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const app = new Hono();
const key = () => process.env.REALTIME_AVATAR_API_KEY ?? "";
const base = "https://realtimeavatar.ai/api/v1";
const headers = () => ({ Authorization: "Bearer " + key() });
const persona = "You are RED LIVE: a warm, curious, natural AI companion. Be conversational, concise, honest about being AI, remember the provided context, and allow the user to interrupt you. Do not claim to be human.";

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
  authorize: ({ operation }) =>
    operation === "connect" || operation === "end" || operation === "avatars" || operation === "credits"
      ? undefined
      : new Response("Not found", { status: 404 }),
  session: async ({ request, avatarId }) =>
    avatarId === "seed-rin-ashfall" || avatarId.startsWith("ava_")
      ? {
          instructions: persona,
          context: cookieContext(request),
          maxSeconds: 120,
          camera: true,
        }
      : new Response("Avatar not allowed", { status: 403 }),
}));

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

app.post("/api/avatar/create", async c => {
  if (!key()) {
    return c.json({ error: "Realtime Avatar server key is not configured." }, 503);
  }

  try {
    const form = await c.req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "RED Avatar").slice(0, 160);
    const motionPrompt = String(
      form.get("motionPrompt") ||
        "Natural subtle idle movement, relaxed expression, occasional gentle head movement."
    ).slice(0, 1200);

    if (!(file instanceof File)) {
      return c.json({ error: "Portrait image is required." }, 400);
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
            "Warm, natural, conversational voice; clear and friendly.",
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
    const data = await readFile(join(process.cwd(), "dist", "index.html"));
    return new Response(data, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT || 8787),
  hostname: "0.0.0.0",
});
