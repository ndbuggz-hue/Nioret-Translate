export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

export interface TwitchTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface ChatMessage {
  id: string;
  broadcasterId: string;
  broadcasterLogin: string;
  chatterId: string;
  chatterLogin: string;
  chatterName: string;
  text: string;
  color: string;
  receivedAt: string;
}

export interface TranslationResult {
  sourceLanguageCode: string;
  sourceLanguageName: string;
  targetLanguageCode: string;
  translatedText: string;
}

export interface TranslatedChatMessage extends ChatMessage, TranslationResult {
  originalText: string;
}

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "subscribing"
  | "live"
  | "reconnecting"
  | "error";

export interface ConnectionStatus {
  phase: ConnectionPhase;
  detail: string;
  channel: TwitchUser | null;
}
