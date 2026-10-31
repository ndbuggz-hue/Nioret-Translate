# Development record

## 2026-10-31 — Initial architecture

The workspace began empty. The first vertical slice uses one Node.js/TypeScript process:

1. Twitch OAuth Authorization Code flow keeps user tokens on the server.
2. Twitch EventSub WebSocket subscribes to `channel.chat.message` with `user:read:chat`.
3. OpenAI Responses API performs language detection and translation with a structured result.
4. A local WebSocket hub translates once per active target language and serves the dashboard and OBS overlay.
5. A gated demo-message endpoint supports rehearsals without pretending to be a Twitch connection.

The local environment has Node.js 24, Git, and Python. Docker and pnpm were not available. The project was not initially a Git repository.

### Status vocabulary

- **Implemented:** code exists and automated tests cover the local behavior.
- **Live verified:** a real external credential and service produced an observed result.
- **Planned:** no complete implementation yet.

External-service features must not be marked live verified from mocked tests alone.

## 2026-10-31 — First complete local flow

### Implemented

- Twitch Authorization Code OAuth with CSRF state checking, token validation, token refresh, and server-only sessions.
- Helix channel resolution and EventSub `channel.chat.message` subscription over WebSocket.
- EventSub reconnect migration, retry backoff, and duplicate notification suppression.
- OpenAI Responses API structured language detection and translation.
- Per-language translation queues and WebSocket delivery to the dashboard and `/overlay`.
- Transparent OBS browser overlay and a gated, explicitly local demo-message route.

### Verification evidence

- `npm.cmd run check` passed: strict typecheck, 6 automated tests, and production TypeScript build.
- Tests cover the OAuth URL, EventSub subscription payload, structured translation adapter, language/config fallbacks, and a local HTTP → translation → WebSocket integration flow.
- A built-server smoke test returned HTTP 200 for `/`, `/overlay?language=es`, and a successful `/health` response.
- Dependency audit reported 0 vulnerabilities at installation time.
- Publication secret scan found no credential values. Only documented placeholders exist in `.env.example` and `README.md`.

### Not live verified

No Twitch or OpenAI credentials were available in this workspace. Real OAuth consent, EventSub delivery from Twitch, and a real OpenAI translation response remain unverified. Speech transcription is not implemented.
