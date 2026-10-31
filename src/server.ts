import { createApplication } from "./app.js";
import { loadConfig, twitchIsConfigured } from "./config.js";

const config = loadConfig();

if (config.isProduction && config.sessionSecret === "nioret-development-only-secret") {
  throw new Error("SESSION_SECRET must be configured in production.");
}

const application = createApplication(config);

application.server.listen(config.port, () => {
  console.log(`Nioret Translate listening on ${config.publicBaseUrl}`);
  console.log(`Twitch configuration: ${twitchIsConfigured(config) ? "ready" : "missing"}`);
  console.log(`OpenAI configuration: ${config.openaiApiKey ? "ready" : "missing"}`);
  if (config.demoMode) console.log("Local demo-message endpoint: enabled");
});

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down.`);
  await application.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
