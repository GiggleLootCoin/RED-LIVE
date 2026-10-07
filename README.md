# RED LIVE

A mobile-first live AI avatar application.

## Live avatar

RED LIVE is wired to the Realtime Avatar SDK. The provider supplies the actual synchronized talking-head video, full-duplex voice, interruption and WebRTC transport; RED LIVE owns the product UI, memory and provider boundary. The SDK documentation confirms the browser/client + secure server split and full-duplex behavior. 

### Server
Set `REALTIME_AVATAR_API_KEY` only on the server. Never put it in a `VITE_` variable or public client code.

```bash
npm install
REALTIME_AVATAR_API_KEY=... npm run server
```

The server exposes `/api/realtime-avatar/*` and keeps the provider key private.

### Client
The client is Vite + React and stores explicit local memory/conversation state on-device. It can install as a PWA on Android.

## Custom avatars

The UI accepts an uploaded portrait now. The production provider path for turning that portrait into a live avatar is intentionally server-side; the provider's avatar-creation API accepts a portrait image and generates the motion assets needed for live calls.

## Important

The GitHub Pages build is the free static client. A realtime WebRTC call requires the secure server route above; GitHub Pages cannot hold private server secrets or run a persistent API server.

For a zero-cost development path, use the provider's Sandbox allowance. Current provider documentation lists 17 free realtime minutes/month and no card requirement. Production usage is paid.
