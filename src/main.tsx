import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AvatarCall,
  createProxyClient,
  useAvatarCamera,
  type AvatarConnectionDetails,
} from "realtime-avatar/react";
import "./style.css";

type Msg = { role: "user" | "assistant"; content: string; ts: number };

const STORE = "red-live-v4";
const DEFAULT_ID = "seed-rin-ashfall";
const IDLE =
  "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/idle-10s.mp4";
const POSTER =
  "https://realtimeavatar.ai/api/assets/public/characters/rin-ashfall/portrait.png";

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
};

function CameraControl({ active }: { active: boolean }) {
  const camera = useAvatarCamera({ allowed: true, active });
  return (
    <button
      className="cameraButton"
      disabled={!camera.available}
      aria-pressed={camera.enabled}
      onClick={() => void camera.toggle()}
    >
      {camera.pending
        ? "Cancel camera request"
        : camera.enabled
          ? "Stop camera"
          : camera.error
            ? "Camera unavailable"
            : "Share camera"}
    </button>
  );
}

function App() {
  const saved = read();
  const [messages, setMessages] = useState<Msg[]>(saved.messages || []);
  const [memory, setMemory] = useState(saved.memory || "");
  const [avatarId, setAvatarId] = useState(saved.avatarId || DEFAULT_ID);
  const [portrait, setPortrait] = useState("");
  const [avatarMedia, setAvatarMedia] = useState<{ poster?: string; idle?: string }>({});
  const [micReady, setMicReady] = useState<boolean | null>(null);
  const [avatarStatus, setAvatarStatus] = useState(saved.avatarStatus || "ready");
  const [name, setName] = useState(saved.name || "RED");
  const [motion, setMotion] = useState(
    "Natural subtle idle movement, relaxed expression, occasional gentle head movement."
  );
  const [text, setText] = useState("");
  const [inCall, setInCall] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [connection, setConnection] =
    useState<AvatarConnectionDetails | null>(null);
  const [modal, setModal] = useState<
    "memory" | "avatar" | "web" | "settings" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [webQuery, setWebQuery] = useState("");
  const [webResults, setWebResults] = useState<Array<{ title: string; url: string; snippet: string }>>([]);
  const client = useMemo(
    () => createProxyClient({ proxyUrl: "/api/realtime-avatar" }),
    []
  );

  useEffect(() => {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        messages,
        memory,
        avatarId,
        avatarStatus,
        name,
      })
    );
  }, [messages, memory, avatarId, avatarStatus, name]);

  useEffect(() => {
    if (!avatarId.startsWith("ava_")) return;

    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(
          "/api/avatar/status?id=" + encodeURIComponent(avatarId)
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!stop) setAvatarStatus(d.status || "unknown");
        if (!stop && (d.posterUrl || d.idleVideoUrl)) setAvatarMedia({ poster: d.posterUrl, idle: d.idleVideoUrl });
      } catch {}
    };

    tick();
    const id = setInterval(tick, 10000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [avatarId]);

  const add = (role: Msg["role"], content: string) =>
    setMessages((m) => [...m, { role, content, ts: Date.now() }]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;

    setText("");
    const userMessage: Msg = { role: "user", content: v, ts: Date.now() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: v,
          messages: nextMessages,
          memory,
        }),
      });
      if (!r.ok) throw new Error("Text chat failed");
      const d = await r.json();
      add("assistant", d.reply || "");
    } catch {
      add(
        "assistant",
        "Start the live conversation for hands-free voice and the talking avatar."
      );
    }
  };

  const saveMemory = async () => {
    setNotice("Saving memory…");
    try {
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memory, messages }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Memory could not be saved.");
      }
      setNotice("Memory saved on this device and synced for live calls.");
      setTimeout(() => setModal(null), 500);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Memory could not be saved.");
    }
  };

  const choosePortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      setNotice("Use a PNG, JPEG, or WebP portrait.");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setNotice("Image must be 8 MB or smaller.");
      return;
    }

    const r = new FileReader();
    r.onload = () => setPortrait(String(r.result));
    r.readAsDataURL(f);
  };

  const createAvatar = async () => {
    const input = document.getElementById("avatarFile") as
      | HTMLInputElement
      | null;
    const file = input?.files?.[0];

    if (!file) {
      setNotice("Choose a portrait first.");
      return;
    }

    setBusy(true);
    setNotice("Creating your live avatar…");

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name);
      fd.append("motionPrompt", motion);

      const r = await fetch("/api/avatar/create", {
        method: "POST",
        body: fd,
      });
      const d = await r.json();

      if (!r.ok) throw new Error(d.error || "Creation failed");

      setAvatarId(d.id);
      setAvatarMedia({ poster: d.posterUrl, idle: d.idleVideoUrl });
      setAvatarStatus(d.status || "preprocessing");
      setNotice(
        d.status === "ready"
          ? "Avatar ready."
          : "Avatar is rendering. RED LIVE will keep checking until it is ready."
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Avatar creation failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const isDefault = avatarId === DEFAULT_ID;

  const checkMic = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicReady(true);
      setNotice("Microphone is available. Start the live conversation.");
    } catch {
      setMicReady(false);
      setNotice("Microphone access is blocked. In Brave, allow Microphone for this site, then try again.");
    }
  };

  const webSearch = async () => {
    const q = webQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      const r = await fetch("/api/web-search?q=" + encodeURIComponent(q));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Web search failed.");
      setWebResults(Array.isArray(d.results) ? d.results : []);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Web search failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="app">
      <header>
        <div>
          <div className="logo">
            RED <b>LIVE</b>
          </div>
          <div className="tag">Live AI Chats Unleashed</div>
        </div>
        <button className="ghost" onClick={() => setModal("settings")}>
          ⚙
        </button>
      </header>

      <main>
        <section className="hero">
          <div className="avatarWrap">
            {inCall ? (
              <AvatarCall
                client={client}
                avatarId={avatarId}
                poster={isDefault ? POSTER : avatarMedia.poster || portrait || undefined}
                idleVideoUrl={isDefault ? IDLE : avatarMedia.idle || undefined}
                style={{ width: "100%", height: "100%" }}
                onStatusChange={setCallStatus}
                onConnectionDetailsChange={setConnection}
                onEnded={() => {
                  setInCall(false);
                  setCallStatus("");
                  setConnection(null);
                }}
              >
                {(call) => (
                  <div className="callOverlay">
                    <div className="callTools"><CameraControl active={inCall} /></div>
                    <div>
                      <strong>
                        {call.status === "waiting"
                          ? "In line: " + call.queuePosition
                          : call.status === "live"
                            ? "LIVE"
                            : call.status}
                      </strong>
                      {connection?.localQuality && (
                        <small className="quality">
                          {" "}
                          • {connection.localQuality}
                        </small>
                      )}
                    </div>
                    <button onClick={call.end}>End call</button>
                  </div>
                )}
              </AvatarCall>
            ) : isDefault ? (
              <video
                className="idle"
                src={IDLE}
                poster={POSTER}
                autoPlay
                muted
                loop
                playsInline
              />
             ) : avatarMedia.poster ? (
              <img className="idle" src={avatarMedia.poster} alt={name} />
            ) : portrait ? (
              <img className="idle" src={portrait} alt={name} />
            ) : (
              <div className="portraitPlaceholder">
                <span>RED LIVE</span>
                <small>
                  {avatarStatus === "ready"
                    ? "Avatar ready"
                    : "Avatar " + avatarStatus}
                </small>
              </div>
            )}
          </div>

          <div className="heroActions">
            {!inCall && (
              <button
                className="primary"
                disabled={avatarStatus !== "ready"}
                onClick={() => setInCall(true)}
              >
                {avatarStatus === "ready"
                  ? "Start live conversation"
                  : "Avatar is " + avatarStatus}
              </button>
            )}
            {inCall && callStatus && (
              <span className="callStatus">
                {callStatus === "connecting"
                  ? "Connecting microphone and avatar…"
                  : callStatus === "recovering"
                    ? "Reconnecting…"
                    : callStatus}
              </span>
            )}
            <span className="secure">
              Full-duplex voice • interruption • camera • persistent
              memory
            </span>
          </div>
        </section>

        <section className="chat">
          <div className="chatHead">
            <b>Conversation</b>
            <button onClick={() => setModal("memory")}>Memory</button>
          </div>

          {messages.length === 0 ? (
            <div className="empty">
              Start a live call or type below. Saved memory stays on this
              device and is supplied to live calls.
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={"msg " + m.role}>
                <small>{m.role === "user" ? "YOU" : "RED"}</small>
                <div>{m.content}</div>
              </div>
            ))
          )}
        </section>

        <section className="composer">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type to RED…"
          />
          <button onClick={send}>Send</button>
        </section>

        <nav>
          <button onClick={() => setModal("memory")}>Memory</button>
          <button onClick={() => setModal("avatar")}>Create avatar</button>
          <button onClick={() => setModal("web")}>Web</button>
          <button onClick={() => setModal("settings")}>Settings</button>
        </nav>
      </main>

      {modal === "memory" && (
        <div className="modal">
          <div className="sheet">
            <button className="close" onClick={() => setModal(null)}>
              ×
            </button>
            <h2>RED memory</h2>
            <p>
              Saved memory is kept locally and synchronized into the secure
              live-session context.
            </p>
            <textarea
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              placeholder="Things RED should remember…"
            />
            <button className="primary" onClick={saveMemory}>
              Save memory
            </button>
            {notice && <div className="notice">{notice}</div>}
          </div>
        </div>
      )}

      {modal === "avatar" && (
        <div className="modal">
          <div className="sheet">
            <button className="close" onClick={() => setModal(null)}>
              ×
            </button>
            <h2>Create your avatar</h2>
            <p>
              Upload one clear portrait. RED LIVE creates the talking avatar
              server-side; creation can take a minute or two.
            </p>
            <input
              id="avatarFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={choosePortrait}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Avatar name"
            />
            <textarea
              value={motion}
              onChange={(e) => setMotion(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={createAvatar}
            >
              {busy ? "Creating…" : "Create live avatar"}
            </button>
            {notice && <div className="notice">{notice}</div>}
          </div>
        </div>
      )}

      {modal === "web" && (
        <div className="modal">
          <div className="sheet">
            <button className="close" onClick={() => setModal(null)}>×</button>
            <h2>Web search</h2>
            <p>Search the web from RED LIVE when a search provider is configured on the server.</p>
            <div className="webRow"><input value={webQuery} onChange={(e) => setWebQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && webSearch()} placeholder="Search the web…" /><button onClick={webSearch} disabled={busy}>Search</button></div>
            <div className="results">{webResults.map((r) => <article key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a><p>{r.snippet}</p></article>)}</div>
            {notice && <div className="notice">{notice}</div>}
          </div>
        </div>
      )}

      {modal === "settings" && (
        <div className="modal">
          <div className="sheet">
            <button className="close" onClick={() => setModal(null)}>
              ×
            </button>
            <h2>RED LIVE</h2>
            <p>
              Avatar: <b>{avatarId}</b>
            </p>
            <p>
              Status: <b>{avatarStatus}</b>
            </p>
            <p>
              Live voice uses the browser microphone over HTTPS. Use “Test microphone” before a call if Brave has not granted access. The provider
              key remains server-side.
            </p>
            <button onClick={() => setModal("avatar")}>
              Create/change avatar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
