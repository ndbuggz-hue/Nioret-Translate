import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, twitchIsConfigured } from "../src/config.js";
import { getLanguage, isSupportedLanguage } from "../src/languages.js";

test("configuration derives a local OAuth callback without inventing credentials", () => {
  const config = loadConfig({ PORT: "4310", PUBLIC_BASE_URL: "http://localhost:4310/" });
  assert.equal(config.publicBaseUrl, "http://localhost:4310");
  assert.equal(config.twitchRedirectUri, "http://localhost:4310/auth/twitch/callback");
  assert.equal(twitchIsConfigured(config), false);
});

test("language selection falls back safely and accepts known codes case-insensitively", () => {
  assert.equal(getLanguage("JA").code, "ja");
  assert.equal(getLanguage("not-a-language").code, "en");
  assert.equal(isSupportedLanguage("es"), true);
  assert.equal(isSupportedLanguage("xx"), false);
});
