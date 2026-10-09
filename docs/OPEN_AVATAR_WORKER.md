# Open avatar worker path for RED LIVE

## Goal

Make RED LIVE independent of paid avatar-session providers while preserving the existing conversation UI, Qwen/OpenAI-compatible LLM adapter, microphone flow, and voice fallback. A user must never lose the text/voice conversation because an animation provider is offline or exhausted.

## Important distinction

- **Free software** is achievable.
- **Unlimited hosted GPU inference at no cost** is not something we can promise. Real-time portrait animation needs GPU inference; free notebook/Space tiers can sleep, queue, throttle, or change availability.
- The app must label a session as *live lip-synced* only when the worker is connected and returning synchronized frames/audio. An idle video, CSS motion, or mouth-open animation is not true lip-sync.

## Proposed provider-neutral architecture

1. Keep RED LIVE's existing `/api/chat` and browser voice fallback as the conversation path.
2. Add an optional self-hosted animation worker behind a server-side `AVATAR_WORKER_URL` setting. Never expose worker credentials to the browser.
3. The worker API should expose:
   - `GET /health` → `{ "ok": true, "engine": "...", "gpu": true }`
   - `POST /v1/sessions` → session id and WebRTC signaling details
   - `POST /v1/sessions/:id/audio` → accept generated audio chunks with monotonically increasing sequence numbers
   - `DELETE /v1/sessions/:id` → stop and release resources
   - a WebRTC output stream containing video and the matching audio track.
4. RED LIVE should treat worker health as optional capability discovery. If it is absent, asleep, overloaded, or errors, keep text and speech working and show a clear “Avatar animation unavailable; voice conversation remains active” status.
5. Support engine selection at the worker boundary. **LiveTalking** is the first candidate because it documents custom avatars, WebRTC, interruption, and Wav2Lip/MuseTalk engines: https://github.com/lipku/LiveTalking. Its documented real-time modes need a GPU, and deployment networking must support WebRTC. Do not deploy it on a free host until these requirements are verified.
6. Use the user's own exported portrait/video and voice sample only where the source service permits export and reuse. Do not attempt to extract provider-internal model weights or bypass service restrictions.

## Candidate engines

- **LiveTalking + Wav2Lip:** easier baseline, but Wav2Lip's license/weights and redistribution rights must be reviewed before a public member feature.
- **LiveTalking + MuseTalk:** promising quality/performance, but documented benchmarks use high-end NVIDIA GPUs; not a credible always-free hosted assumption.
- **Local/self-hosted worker:** no provider credits, but requires a machine with compatible GPU and ongoing power/network.
- **Hosted community demo/Space:** only for evaluation. Never make it a production dependency because sleep, quotas, and owner changes can interrupt members.

## Reliability rules

- Never block the LLM or speech output while waiting for animation.
- Bound worker connection and inference waits; retry with backoff, not in a tight loop.
- Keep one active session per browser unless the deployment has been load-tested.
- Add health and session diagnostics without logging API keys, raw audio, or portrait data.
- For channel-member access, enforce authentication and server-side entitlements. Do not treat a hidden button or client-side flag as authorization.

## Acceptance checklist

- [ ] A complete voice conversation works when the animation worker URL is unset.
- [ ] A live worker produces synchronized audio and facial frames for a 60-second conversation.
- [ ] User interruption stops current speech and animation promptly.
- [ ] Worker failure does not terminate the LLM/voice conversation.
- [ ] Reconnection and stale-session cleanup work.
- [ ] No paid provider is required for the fallback path.
- [ ] Mobile Chrome/Brave on Android is tested over HTTPS.
- [ ] License and model-weight terms are reviewed before member launch.

## Why this is a plan, not a claim of completion

The current RED LIVE repository has a Node/Hono service deployed on Render's free web-service plan. That is not an NVIDIA GPU runtime. A provider-neutral contract is the safe seam; a worker must then be deployed to actual GPU capacity and tested end-to-end. This change does not claim that true real-time lip-sync is already deployed.