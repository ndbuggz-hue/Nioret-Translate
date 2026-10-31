import type { AppConfig } from "../config.js";
import type { TwitchTokenSet, TwitchUser } from "../types.js";

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_API_URL = "https://api.twitch.tv/helix";

type Fetch = typeof globalThis.fetch;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string[];
}

interface ValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

interface TwitchUserResponse {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
  }>;
}

export function buildTwitchAuthorizationUrl(config: AppConfig, state: string) {
  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.twitchClientId,
    redirect_uri: config.twitchRedirectUri,
    scope: "user:read:chat",
    state,
  }).toString();
  return url.toString();
}

async function requireJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${context} failed (${response.status}): ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

function toTokenSet(payload: TokenResponse): TwitchTokenSet {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? "",
    expiresAt: Date.now() + payload.expires_in * 1_000,
    scopes: payload.scope ?? [],
  };
}

export class TwitchAuthClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  async exchangeCode(code: string): Promise<TwitchTokenSet> {
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      client_secret: this.config.twitchClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.twitchRedirectUri,
    });
    const response = await this.fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return toTokenSet(await requireJson<TokenResponse>(response, "Twitch token exchange"));
  }

  async refresh(tokens: TwitchTokenSet): Promise<TwitchTokenSet> {
    if (!tokens.refreshToken) {
      throw new Error("The Twitch session expired and has no refresh token; sign in again.");
    }
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      client_secret: this.config.twitchClientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });
    const response = await this.fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const refreshed = toTokenSet(
      await requireJson<TokenResponse>(response, "Twitch token refresh"),
    );
    if (!refreshed.refreshToken) refreshed.refreshToken = tokens.refreshToken;
    Object.assign(tokens, refreshed);
    return tokens;
  }

  async validAccessToken(tokens: TwitchTokenSet) {
    if (tokens.expiresAt <= Date.now() + 60_000) await this.refresh(tokens);
    return tokens.accessToken;
  }

  async validate(accessToken: string): Promise<ValidateResponse> {
    const response = await this.fetchImpl(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    return requireJson<ValidateResponse>(response, "Twitch token validation");
  }

  async getCurrentUser(accessToken: string): Promise<TwitchUser> {
    return this.getUser(new URL(`${TWITCH_API_URL}/users`), accessToken, "current user");
  }

  async getUserByLogin(login: string, accessToken: string): Promise<TwitchUser> {
    const url = new URL(`${TWITCH_API_URL}/users`);
    url.searchParams.set("login", login);
    return this.getUser(url, accessToken, `channel ${login}`);
  }

  private async getUser(url: URL, accessToken: string, label: string): Promise<TwitchUser> {
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.config.twitchClientId,
      },
    });
    const payload = await requireJson<TwitchUserResponse>(response, `Twitch ${label} lookup`);
    const user = payload.data[0];
    if (!user) throw new Error(`Twitch ${label} was not found.`);
    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
    };
  }

  async createChatSubscription(
    accessToken: string,
    sessionId: string,
    broadcasterId: string,
    userId: string,
  ) {
    const response = await this.fetchImpl(`${TWITCH_API_URL}/eventsub/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.config.twitchClientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: broadcasterId,
          user_id: userId,
        },
        transport: {
          method: "websocket",
          session_id: sessionId,
        },
      }),
    });
    await requireJson<unknown>(response, "Twitch EventSub subscription");
  }
}
