# RED LIVE — Little Red’s Big Live AI Chats Unleashed

RED LIVE is an Android-first, browser-capable live AI avatar client designed around hands-free full-duplex voice, interruptible turn-taking, customizable photorealistic avatars, persistent memory, camera/file/image context and pluggable AI providers.

## Architecture
- `src/` — installable mobile-first client
- `server/` — secure provider adapter boundary
- `docs/` — provider and deployment contracts

The client does not fake a talking avatar with a CSS face. A real streamed avatar/video provider is inserted into the avatar surface when configured.

See `docs/PROVIDERS.md` for the integration contract.
