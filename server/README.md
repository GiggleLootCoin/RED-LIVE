# RED LIVE server adapter

Keep provider API keys out of the browser.

Implement:
- POST /api/chat
- POST /api/token (optional ephemeral avatar/WebRTC token)
- POST /api/search
- POST /api/vision (optional)
- GET /api/health

The client handles an unavailable /api/chat endpoint honestly; it never invents an AI response.
