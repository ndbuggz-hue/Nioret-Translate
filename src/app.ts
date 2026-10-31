import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import type { AppConfig } from "./config.js";
import { twitchIsConfigured } from "./config.js";
import { LANGUAGES } from "./languages.js";
import { LiveHub } from "./live-hub.js";
import {
  OpenAITranslator,
  UnavailableTranslator,
  type Translator,
} from "./translation/translator.js";
import { TwitchEventSubClient } from "./twitch/eventsub.js";
import { buildTwitchAuthorizationUrl, TwitchAuthClient } from "./twitch/oauth.js";
import type { ChatMessage, TwitchTokenSet, TwitchUser } from "./types.js";

interface ActiveConnection {
  ownerUserId: string;
  channel: TwitchUser;
  client: TwitchEventSubClient;
}

export interface Application {
  app: express.Express;
  server: Server;
  hub: LiveHub;
  close: () => Promise<void>;
}

export interface ApplicationDependencies {
  translator?: Translator;
  twitchAuth?: TwitchAuthClient;
}

function saveSession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function redirectWithError(response: Response, message: string) {
  response.redirect(`/?error=${encodeURIComponent(message)}`);
}

function requireTwitchSession(request: Request, response: Response) {
  const twitch = request.session.twitch;
  if (!twitch) {
    response.status(401).json({ error: "Sign in with Twitch first." });
    return null;
  }
  return twitch;
}

export function createApplication(
  config: AppConfig,
  dependencies: ApplicationDependencies = {},
): Application {
  const app = express();
  const server = createServer(app);
  const translator =
    dependencies.translator ??
    (config.openaiApiKey
      ? new OpenAITranslator(config.openaiApiKey, config.openaiModel)
      : new UnavailableTranslator());
  const twitchAuth = dependencies.twitchAuth ?? new TwitchAuthClient(config);
  const hub = new LiveHub(server, translator);
  let activeConnection: ActiveConnection | null = null;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(
    session({
      name: "nioret.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        maxAge: 12 * 60 * 60 * 1_000,
      },
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "nioret-translate" });
  });

  app.get("/api/status", (request, response) => {
    response.json({
      twitchConfigured: twitchIsConfigured(config),
      openaiConfigured: Boolean(config.openaiApiKey),
      authenticatedUser: request.session.twitch?.user ?? null,
      connection: hub.getStatus(),
      languages: LANGUAGES,
      demoMode: config.demoMode,
    });
  });

  app.get("/auth/twitch", (request, response) => {
    if (!twitchIsConfigured(config)) {
      redirectWithError(response, "Twitch credentials are not configured on the server.");
      return;
    }
    const state = randomBytes(24).toString("hex");
    request.session.oauthState = state;
    request.session.save((error) => {
      if (error) {
        redirectWithError(response, "Could not start the Twitch sign-in session.");
        return;
      }
      response.redirect(buildTwitchAuthorizationUrl(config, state));
    });
  });

  app.get("/auth/twitch/callback", async (request, response, next) => {
    try {
      const code = typeof request.query.code === "string" ? request.query.code : "";
      const state = typeof request.query.state === "string" ? request.query.state : "";
      const oauthError =
        typeof request.query.error_description === "string"
          ? request.query.error_description
          : typeof request.query.error === "string"
            ? request.query.error
            : "";

      if (oauthError) {
        redirectWithError(response, `Twitch authorization failed: ${oauthError}`);
        return;
      }
      if (!code || !state || state !== request.session.oauthState) {
        redirectWithError(response, "Twitch OAuth state validation failed. Try signing in again.");
        return;
      }

      const tokens = await twitchAuth.exchangeCode(code);
      const validation = await twitchAuth.validate(tokens.accessToken);
      if (validation.client_id !== config.twitchClientId) {
        throw new Error("Twitch returned a token for a different client ID.");
      }
      if (!validation.scopes.includes("user:read:chat")) {
        throw new Error("Twitch did not grant the required user:read:chat scope.");
      }
      const user = await twitchAuth.getCurrentUser(tokens.accessToken);
      if (user.id !== validation.user_id) {
        throw new Error("Twitch token validation did not match the authenticated user.");
      }

      await regenerateSession(request);
      request.session.twitch = { user, tokens };
      await saveSession(request);
      response.redirect("/?connected=twitch");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/twitch/connect", async (request, response, next) => {
    try {
      const twitch = requireTwitchSession(request, response);
      if (!twitch) return;
      const requestedLogin =
        typeof request.body?.channel === "string"
          ? request.body.channel.trim().replace(/^#/, "").toLowerCase()
          : twitch.user.login;
      if (!/^[a-z0-9_]{1,25}$/.test(requestedLogin)) {
        response.status(400).json({ error: "Enter a valid Twitch channel login." });
        return;
      }

      const accessToken = await twitchAuth.validAccessToken(twitch.tokens);
      const channel = await twitchAuth.getUserByLogin(requestedLogin, accessToken);
      activeConnection?.client.stop();

      const client = new TwitchEventSubClient({
        auth: twitchAuth,
        tokens: twitch.tokens,
        authenticatedUserId: twitch.user.id,
        channel,
        onMessage: (message) => hub.publishChat(message),
        onStatus: (status) => hub.setStatus(status),
      });
      activeConnection = { ownerUserId: twitch.user.id, channel, client };
      client.start();
      await saveSession(request);
      response.status(202).json({ channel, connection: hub.getStatus() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/twitch/disconnect", (request, response) => {
    const twitch = requireTwitchSession(request, response);
    if (!twitch) return;
    if (activeConnection?.ownerUserId === twitch.user.id) {
      activeConnection.client.stop();
      activeConnection = null;
    }
    response.status(204).end();
  });

  app.post("/auth/logout", async (request, response, next) => {
    try {
      if (
        request.session.twitch &&
        activeConnection?.ownerUserId === request.session.twitch.user.id
      ) {
        activeConnection.client.stop();
        activeConnection = null;
      }
      await destroySession(request);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/demo/message", (request, response) => {
    if (!config.demoMode) {
      response.status(404).json({ error: "Demo mode is disabled." });
      return;
    }
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text || text.length > 500) {
      response.status(400).json({ error: "Demo text must be between 1 and 500 characters." });
      return;
    }
    const message: ChatMessage = {
      id: `demo-${randomUUID()}`,
      broadcasterId: "demo",
      broadcasterLogin: "nioret_demo",
      chatterId: "demo-viewer",
      chatterLogin: "demo_viewer",
      chatterName: "DemoViewer",
      text,
      color: "#71e4ff",
      receivedAt: new Date().toISOString(),
    };
    hub.publishChat(message);
    response.status(202).json({ accepted: true, source: "local-demo-injector" });
  });

  const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const publicDirectory = path.join(projectDirectory, "public");
  app.get("/overlay", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "overlay.html"));
  });
  app.use(express.static(publicDirectory));

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.path}: ${message}`);
    if (request.path.startsWith("/auth/")) {
      redirectWithError(response, message);
      return;
    }
    response.status(500).json({ error: message });
  });

  return {
    app,
    server,
    hub,
    close: async () => {
      activeConnection?.client.stop();
      hub.close();
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
