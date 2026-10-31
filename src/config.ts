import "dotenv/config";

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  sessionSecret: string;
  twitchClientId: string;
  twitchClientSecret: string;
  twitchRedirectUri: string;
  openaiApiKey: string;
  openaiModel: string;
  demoMode: boolean;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");

  return {
    port: Number.isFinite(port) ? port : 3000,
    publicBaseUrl,
    sessionSecret: env.SESSION_SECRET ?? "nioret-development-only-secret",
    twitchClientId: env.TWITCH_CLIENT_ID ?? "",
    twitchClientSecret: env.TWITCH_CLIENT_SECRET ?? "",
    twitchRedirectUri:
      env.TWITCH_REDIRECT_URI ?? `${publicBaseUrl}/auth/twitch/callback`,
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-6-astra",
    demoMode: env.DEMO_MODE === "true",
    isProduction: env.NODE_ENV === "production",
  };
}

export function twitchIsConfigured(config: AppConfig) {
  return Boolean(config.twitchClientId && config.twitchClientSecret);
}
