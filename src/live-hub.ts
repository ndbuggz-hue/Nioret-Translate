import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { getLanguage } from "./languages.js";
import type { Translator } from "./translation/translator.js";
import type {
  ChatMessage,
  ConnectionStatus,
  TranslatedChatMessage,
} from "./types.js";

interface ClientState {
  language: string;
}

export class LiveHub {
  private readonly websocketServer: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly recent = new Map<string, TranslatedChatMessage[]>();
  private status: ConnectionStatus = {
    phase: "idle",
    detail: "Not connected to a Twitch channel.",
    channel: null,
  };

  constructor(server: Server, private readonly translator: Translator) {
    this.websocketServer = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/live") return;
      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.websocketServer.emit("connection", websocket, request);
      });
    });
    this.websocketServer.on("connection", (socket, request) => {
      this.registerClient(socket, request);
    });
  }

  setStatus(status: ConnectionStatus) {
    this.status = status;
    this.broadcastAll({ type: "status", status });
  }

  getStatus() {
    return this.status;
  }

  publishChat(message: ChatMessage) {
    const targetLanguages = new Set(
      [...this.clients.values()].map((client) => client.language),
    );
    for (const language of targetLanguages) this.enqueueTranslation(message, language);
  }

  close() {
    for (const client of this.clients.keys()) client.close(1001, "Server shutting down");
    this.websocketServer.close();
  }

  private registerClient(socket: WebSocket, request: IncomingMessage) {
    const url = new URL(request.url ?? "/live", "http://localhost");
    const language = getLanguage(url.searchParams.get("language")).code;
    this.clients.set(socket, { language });
    this.send(socket, {
      type: "ready",
      language,
      status: this.status,
      recent: this.recent.get(language) ?? [],
    });

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; language?: string };
        if (message.type === "set_language") {
          const nextLanguage = getLanguage(message.language).code;
          this.clients.set(socket, { language: nextLanguage });
          this.send(socket, {
            type: "language_changed",
            language: nextLanguage,
            recent: this.recent.get(nextLanguage) ?? [],
          });
        }
      } catch {
        this.send(socket, { type: "error", message: "Invalid live socket message." });
      }
    });
    socket.on("close", () => this.clients.delete(socket));
  }

  private enqueueTranslation(message: ChatMessage, language: string) {
    const previous = this.queues.get(language) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const translation = await this.translator.translate(message.text, language);
          const translated: TranslatedChatMessage = {
            ...message,
            ...translation,
            originalText: message.text,
            text: translation.translatedText,
          };
          const messages = this.recent.get(language) ?? [];
          messages.push(translated);
          if (messages.length > 50) messages.shift();
          this.recent.set(language, messages);
          this.broadcastLanguage(language, { type: "translation", message: translated });
        } catch (error) {
          this.broadcastLanguage(language, {
            type: "translation_error",
            messageId: message.id,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
    this.queues.set(language, next);
    void next.finally(() => {
      if (this.queues.get(language) === next) this.queues.delete(language);
    });
  }

  private broadcastLanguage(language: string, payload: unknown) {
    for (const [socket, state] of this.clients) {
      if (state.language === language) this.send(socket, payload);
    }
  }

  private broadcastAll(payload: unknown) {
    for (const socket of this.clients.keys()) this.send(socket, payload);
  }

  private send(socket: WebSocket, payload: unknown) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}
