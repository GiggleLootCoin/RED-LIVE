# RED LIVE provider contract

## Realtime avatar
Expose an ephemeral session/token to the client and a synchronized video/audio stream. Prefer WebRTC. Required: custom avatar, realtime audio, interruption/barge-in, synchronized talking-head video.

## Brain
Input: message, messages, memory, attachments, tool results. Output: reply and optional tool calls.

## Speech
STT should provide interim/final transcripts. TTS should stream audio when possible.

## Memory
Keep durable user-approved memories separate from raw transcript. The client is local-first.

## Web
Search/fetch belongs server-side so credentials never ship to the browser.

The initial UI intentionally has no fake talking face. A real avatar stream is attached to #avatarVideo by the provider adapter.
