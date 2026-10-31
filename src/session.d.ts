import "express-session";
import type { TwitchTokenSet, TwitchUser } from "./types.js";

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    twitch?: {
      user: TwitchUser;
      tokens: TwitchTokenSet;
    };
  }
}
