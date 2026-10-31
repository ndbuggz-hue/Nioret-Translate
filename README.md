# Nioret Translate

Nioret Translate is a standalone real-time translation studio for Twitch chat, built for the Codex × TwitchCon Hackathon 2026. A streamer signs in with Twitch, connects a channel, and viewers or OBS browser sources receive translated messages in independently selected languages.

> Current verification status: the complete local message pipeline is covered by automated tests with mocked Twitch/OpenAI boundaries. Live Twitch OAuth, a real EventSub message, and a real OpenAI response still require project credentials and have not been verified in this development environment. The UI reports missing configuration instead of simulating a live connection.

## Implemented

- Twitch OAuth Authorization Code flow with state validation and server-side token storage.
- Twitch user/channel lookup through Helix.
- Real-time `channel.chat.message` ingestion through Twitch EventSub WebSockets.
- EventSub reconnect handling and duplicate-message suppression.
- Language detection and translation through the OpenAI Responses API with Structured Outputs.
- One translation request per active target language, with per-language ordering and a short in-memory feed.
- A responsive web dashboard with individual language selection.
- A transparent `/overlay` page suitable for an OBS browser source.
- A gated local sample-message endpoint for rehearsing the translation path. It is explicitly labeled as local and does not impersonate Twitch.
- TypeScript checks and automated unit/integration tests.

Speech transcription and spoken-caption ingestion are not implemented yet.

## Architecture

```text
Twitch OAuth → server session → Helix channel lookup
                               ↓
                     EventSub WebSocket
                               ↓
                         chat message
                               ↓
           OpenAI detection + translation (per language)
                               ↓
                  local WebSocket broadcast hub
                         ↙             ↘
                    dashboard       OBS overlay
```

The Node.js service keeps Twitch and OpenAI credentials off the browser. EventSub WebSockets were chosen for the local hackathon app because they support user access tokens without requiring a public webhook endpoint.

## Requirements

- Node.js 22 or newer
- A [Twitch developer application](https://dev.twitch.tv/console/apps)
- An OpenAI API key

## Setup

1. Clone and install dependencies:

   ```powershell
   git clone https://github.com/ndbuggz-hue/Nioret-Translate.git
   cd Nioret-Translate
   npm install
   ```

   On Windows systems that block PowerShell script shims, use `npm.cmd install` and `npm.cmd run dev`.

2. In the [Twitch Developer Console](https://dev.twitch.tv/console/apps), create an application and register this exact OAuth redirect URL:

   ```text
   http://localhost:3000/auth/twitch/callback
   ```

   Set the application category to an appropriate chat or application-integration category. Copy the generated Client ID and Client Secret.

3. Copy `.env.example` to `.env` and fill in the secrets locally:

   ```dotenv
   PORT=3000
   PUBLIC_BASE_URL=http://localhost:3000
   SESSION_SECRET=generate-a-long-random-value
   TWITCH_CLIENT_ID=your-client-id
   TWITCH_CLIENT_SECRET=your-client-secret
   TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_MODEL=gpt-6-astra
   DEMO_MODE=false
   ```

   `.env` is ignored by Git. Never place real secrets in `.env.example` or frontend files.

4. Start the application:

   ```powershell
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), choose **Connect Twitch**, approve the `user:read:chat` permission, enter a channel login, and choose **Listen**.

Twitch's current chat/EventSub documentation requires `user:read:chat` for the chatting user and a user access token for WebSocket subscriptions. See [Authenticating and setting up EventSub](https://dev.twitch.tv/docs/chat/authenticating/) and [`channel.chat.message`](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage).

## OBS overlay

After selecting a viewer language, copy the generated overlay URL from the dashboard. In OBS:

1. Add a **Browser** source.
2. Paste the URL, for example `http://localhost:3000/overlay?language=es`.
3. Use a canvas-sized browser source such as 1920×1080.
4. Keep the page background transparent.

Multiple browser sources can use different `language` query values at the same time.

## Local rehearsal mode

Set `DEMO_MODE=true` to expose a sample-message form and `POST /api/demo/message`. This exercises HTTP ingestion, the configured OpenAI translation adapter, local WebSocket delivery, dashboard rendering, and overlay rendering. It does not test OAuth or Twitch EventSub and is never presented as a Twitch event.

## Verification

Run all publication checks:

```powershell
npm run check
```

The test suite covers OAuth URL construction, EventSub subscription payloads, configuration behavior, structured translation parsing, and a full local HTTP → translation → WebSocket flow. External-service tests are deliberately not run without credentials.

For a live smoke test:

1. Sign in with Twitch and listen to a channel you can message in.
2. Open the dashboard and an overlay in different target languages.
3. Send a Twitch chat message in a third language.
4. Confirm the dashboard and overlay receive their respective translations.
5. Capture the timestamp and result in [DEVELOPMENT.md](DEVELOPMENT.md) before marking live verification complete.

## Security and deployment notes

- Twitch access and refresh tokens remain in the server session and are never sent to browser JavaScript.
- OAuth state is checked before exchanging the authorization code.
- The default session store is in-memory and intended for the local standalone demo. A hosted multi-instance deployment must use a durable server-side session store.
- Production deployment must use HTTPS, set `PUBLIC_BASE_URL`/`TWITCH_REDIRECT_URI` to the public origin, register that exact callback with Twitch, and configure a strong `SESSION_SECRET`.
- The app currently has one active Twitch channel connection per process, which matches the standalone demonstration scope.

## Project status and development record

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture decisions, environment observations, and the distinction between implemented, test-verified, and live-verified functionality.

## References

- [Twitch OAuth Authorization Code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow)
- [Twitch EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
