import WebSocket from "ws";
import type { TwitchAuthClient } from "./oauth.js";
import type {
  ChatMessage,
  ConnectionPhase,
  ConnectionStatus,
  TwitchTokenSet,
  TwitchUser,
} from "../types.js";

const EVENTSUB_WEBSOCKET_URL =
  "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";

interface EventSubEnvelope {
  metadata?: {
    message_id?: string;
    message_type?: string;
    subscription_type?: string;
  };
  payload?: {
    session?: {
      id?: string;
      reconnect_url?: string | null;
    };
    event?: {
      broadcaster_user_id?: string;
      broadcaster_user_login?: string;
      chatter_user_id?: string;
      chatter_user_login?: string;
      chatter_user_name?: string;
      message_id?: string;
      message?: { text?: string };
      color?: string;
    };
  };
}

interface EventSubOptions {
  auth: TwitchAuthClient;
  tokens: TwitchTokenSet;
  authenticatedUserId: string;
  channel: TwitchUser;
  onMessage: (message: ChatMessage) => void | Promise<void>;
  onStatus: (status: ConnectionStatus) => void;
}

export class TwitchEventSubClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private migrating = false;
  private readonly seenMessageIds = new Set<string>();

  constructor(private readonly options: EventSubOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus("connecting", "Opening Twitch EventSub WebSocket…");
    this.openSocket(EVENTSUB_WEBSOCKET_URL, false);
  }

  stop() {
    this.stopped = true;
    this.migrating = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Nioret Translate disconnected");
    this.setStatus("idle", "Not connected to a Twitch channel.");
  }

  private openSocket(url: string, inheritsSubscriptions: boolean, oldSocket?: WebSocket) {
    if (this.stopped) return;
    const socket = new WebSocket(url);
    if (!inheritsSubscriptions) this.socket = socket;

    socket.on("message", (data) => {
      void this.handleEnvelope(socket, data.toString(), inheritsSubscriptions, oldSocket);
    });

    socket.on("error", (error) => {
      this.setStatus("error", `Twitch WebSocket error: ${error.message}`);
    });

    socket.on("close", () => {
      if (this.stopped || this.socket !== socket) return;
      this.scheduleReconnect();
    });
  }

  private async handleEnvelope(
    socket: WebSocket,
    raw: string,
    inheritsSubscriptions: boolean,
    oldSocket?: WebSocket,
  ) {
    let envelope: EventSubEnvelope;
    try {
      envelope = JSON.parse(raw) as EventSubEnvelope;
    } catch {
      this.setStatus("error", "Twitch sent an unreadable EventSub message.");
      return;
    }

    const type = envelope.metadata?.message_type;
    if (type === "session_welcome") {
      const sessionId = envelope.payload?.session?.id;
      if (!sessionId) {
        this.setStatus("error", "Twitch EventSub welcome did not include a session ID.");
        return;
      }
      this.socket = socket;
      this.reconnectAttempt = 0;
      this.migrating = false;
      if (inheritsSubscriptions) {
        oldSocket?.close(1000, "Twitch EventSub migration complete");
        this.setStatus("live", `Listening to #${this.options.channel.login}.`);
        return;
      }

      this.setStatus("subscribing", `Subscribing to #${this.options.channel.login} chat…`);
      try {
        const accessToken = await this.options.auth.validAccessToken(this.options.tokens);
        await this.options.auth.createChatSubscription(
          accessToken,
          sessionId,
          this.options.channel.id,
          this.options.authenticatedUserId,
        );
        this.setStatus("live", `Listening to #${this.options.channel.login}.`);
      } catch (error) {
        this.setStatus("error", error instanceof Error ? error.message : String(error));
        socket.close();
      }
      return;
    }

    if (type === "session_reconnect") {
      const reconnectUrl = envelope.payload?.session?.reconnect_url;
      if (reconnectUrl && !this.migrating) {
        this.migrating = true;
        this.setStatus("reconnecting", "Twitch requested a seamless WebSocket migration…");
        this.openSocket(reconnectUrl, true, socket);
      }
      return;
    }

    if (
      type === "notification" &&
      envelope.metadata?.subscription_type === "channel.chat.message"
    ) {
      const event = envelope.payload?.event;
      const id = event?.message_id;
      const text = event?.message?.text;
      if (!id || !text || this.seenMessageIds.has(id)) return;
      this.rememberMessageId(id);
      await this.options.onMessage({
        id,
        broadcasterId: event.broadcaster_user_id ?? this.options.channel.id,
        broadcasterLogin: event.broadcaster_user_login ?? this.options.channel.login,
        chatterId: event.chatter_user_id ?? "unknown",
        chatterLogin: event.chatter_user_login ?? "unknown",
        chatterName: event.chatter_user_name ?? event.chatter_user_login ?? "Unknown",
        text,
        color: event.color || "#9b8cff",
        receivedAt: new Date().toISOString(),
      });
      return;
    }

    if (type === "revocation") {
      this.setStatus("error", "Twitch revoked the chat subscription; reconnect the channel.");
    }
  }

  private rememberMessageId(id: string) {
    this.seenMessageIds.add(id);
    if (this.seenMessageIds.size > 1_000) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest) this.seenMessageIds.delete(oldest);
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempt - 1));
    this.setStatus("reconnecting", `Twitch connection lost; retrying in ${delay / 1_000}s…`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openSocket(EVENTSUB_WEBSOCKET_URL, false);
    }, delay);
  }

  private setStatus(phase: ConnectionPhase, detail: string) {
    this.options.onStatus({ phase, detail, channel: this.options.channel });
  }
}
