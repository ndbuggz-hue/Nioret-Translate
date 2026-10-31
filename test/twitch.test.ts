import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { buildTwitchAuthorizationUrl, TwitchAuthClient } from "../src/twitch/oauth.js";

const config: AppConfig = {
  port: 3000,
  publicBaseUrl: "http://localhost:3000",
  sessionSecret: "test-secret",
  twitchClientId: "client-id",
  twitchClientSecret: "client-secret",
  twitchRedirectUri: "http://localhost:3000/auth/twitch/callback",
  openaiApiKey: "",
  openaiModel: "gpt-6-astra",
  demoMode: false,
  isProduction: false,
};

test("Twitch authorization URL uses code flow, state, redirect, and read-chat scope", () => {
  const url = new URL(buildTwitchAuthorizationUrl(config, "state-value"));
  assert.equal(url.origin, "https://id.twitch.tv");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("scope"), "user:read:chat");
  assert.equal(url.searchParams.get("redirect_uri"), config.twitchRedirectUri);
});

test("EventSub subscription request targets channel.chat.message over WebSocket", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchStub: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ data: [{ id: "subscription-id" }] }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new TwitchAuthClient(config, fetchStub);
  await client.createChatSubscription("user-token", "socket-session", "channel-1", "user-2");

  assert.equal(capturedUrl, "https://api.twitch.tv/helix/eventsub/subscriptions");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer user-token");
  assert.equal(headers["Client-Id"], "client-id");
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body, {
    type: "channel.chat.message",
    version: "1",
    condition: { broadcaster_user_id: "channel-1", user_id: "user-2" },
    transport: { method: "websocket", session_id: "socket-session" },
  });
});
