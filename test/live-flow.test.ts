import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { createApplication } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { Translator } from "../src/translation/translator.js";

const config: AppConfig = {
  port: 0,
  publicBaseUrl: "http://localhost",
  sessionSecret: "integration-test-secret",
  twitchClientId: "",
  twitchClientSecret: "",
  twitchRedirectUri: "http://localhost/auth/twitch/callback",
  openaiApiKey: "",
  openaiModel: "gpt-6-astra",
  demoMode: true,
  isProduction: false,
};

const translator: Translator = {
  async translate(text, targetLanguageCode) {
    return {
      sourceLanguageCode: "es",
      sourceLanguageName: "Spanish",
      targetLanguageCode,
      translatedText: `translated:${text}`,
    };
  },
};

test("local demo message traverses HTTP, translation, and per-language WebSocket delivery", async (context) => {
  const application = createApplication(config, { translator });
  await new Promise<void>((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  context.after(async () => application.close());
  const address = application.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/live?language=fr`);
  context.after(() => socket.close());

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for ready message")), 2_000);
    const onMessage = (data: WebSocket.RawData) => {
      const payload = JSON.parse(data.toString()) as { type: string };
      if (payload.type === "ready") {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve();
      }
    };
    socket.on("message", onMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  await ready;

  const translation = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for translation")), 2_000);
    socket.on("message", (data) => {
      const payload = JSON.parse(data.toString()) as { type: string; message?: Record<string, unknown> };
      if (payload.type === "translation" && payload.message) {
        clearTimeout(timeout);
        resolve(payload.message);
      }
    });
  });
  const response = await fetch(`${baseUrl}/api/demo/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Bonjour Twitch" }),
  });
  assert.equal(response.status, 202);
  const message = await translation;
  assert.equal(message.targetLanguageCode, "fr");
  assert.equal(message.translatedText, "translated:Bonjour Twitch");
  assert.equal(message.broadcasterLogin, "nioret_demo");
});
