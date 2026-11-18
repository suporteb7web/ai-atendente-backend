import { safeEqual } from "../../auth.js";

export const UNSUPPORTED_BODY = "[mensagem não suportada]";

export interface AcceptedInbound {
  providerMessageId: string;
  rawPhone: string;
  pushName: string | null;
  providerTimestamp: Date | null;
  type: "text" | "audio" | "unsupported";
  body: string;
  audio?: {
    base64?: string;
    mediaUrl?: string;
    mimeType: string;
  };
}

export type ParseResult =
  | { action: "unauthorized" }
  | { action: "discard"; reason: string }
  | { action: "accept"; inbound: AcceptedInbound };

export function tokenMatches(body: unknown, expected: string): boolean {
  const token = asRecord(body).instanceToken;
  if (typeof token !== "string") return false;
  return safeEqual(token, expected);
}

export function parseEvolutionEnvelope(body: unknown, expectedToken: string): ParseResult {
  if (!tokenMatches(body, expectedToken)) return { action: "unauthorized" };
  const root = asRecord(body);
  if (root.event !== "Message") return { action: "discard", reason: "evento ignorado" };

  const info = asRecord(asRecord(root.data).Info);
  if (info.IsFromMe === true) return { action: "discard", reason: "fromMe" };

  const chat = chatToString(info.Chat);
  if (!chat) return { action: "discard", reason: "sem chat" };
  if (info.IsGroup === true || chat.endsWith("@g.us") || chat.endsWith("@broadcast")) {
    return { action: "discard", reason: "grupo ou broadcast" };
  }

  const providerMessageId = typeof info.ID === "string" ? info.ID.trim() : "";
  if (!providerMessageId) return { action: "discard", reason: "sem id" };

  const message = asRecord(asRecord(root.data).Message);
  const shared = {
    providerMessageId,
    rawPhone: chat,
    pushName: typeof info.PushName === "string" && info.PushName.trim() ? info.PushName : null,
    providerTimestamp: parseTimestamp(info.Timestamp),
  };

  const audio = readAudio(info, message);
  if (audio) {
    return { action: "accept", inbound: { ...shared, type: "audio", body: "", audio } };
  }
  if (isUnsupportedMedia(info, message)) {
    return { action: "accept", inbound: { ...shared, type: "unsupported", body: UNSUPPORTED_BODY } };
  }
  const text = readText(message);
  if (text === null) {
    return { action: "accept", inbound: { ...shared, type: "unsupported", body: UNSUPPORTED_BODY } };
  }
  return { action: "accept", inbound: { ...shared, type: "text", body: text } };
}

function readText(message: Record<string, unknown>): string | null {
  if (typeof message.conversation === "string") return message.conversation;
  const extended = asRecord(message.extendedTextMessage);
  if (typeof extended.text === "string") return extended.text;
  const pascal = asRecord(message.ExtendedTextMessage);
  if (typeof pascal.Text === "string") return pascal.Text;
  return null;
}

function readAudio(
  info: Record<string, unknown>,
  message: Record<string, unknown>,
): AcceptedInbound["audio"] | null {
  const mediaType = typeof info.MediaType === "string" ? info.MediaType.toLowerCase() : "";
  if (mediaType !== "audio" && message.audioMessage == null) return null;
  const audioMessage = asRecord(message.audioMessage);
  return {
    base64: typeof message.base64 === "string" ? message.base64 : undefined,
    mediaUrl: typeof message.mediaUrl === "string" ? message.mediaUrl : undefined,
    mimeType: audioMime(audioMessage),
  };
}

function audioMime(audioMessage: Record<string, unknown>): string {
  const raw = audioMessage.mimetype ?? audioMessage.mimeType;
  if (typeof raw !== "string" || raw.trim() === "") return "audio/ogg";
  if (raw.toLowerCase().includes("opus")) return "audio/ogg";
  const type = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("audio/") ? type : "audio/ogg";
}

function isUnsupportedMedia(info: Record<string, unknown>, message: Record<string, unknown>): boolean {
  const mediaType = typeof info.MediaType === "string" ? info.MediaType.toLowerCase() : "";
  if (["image", "video", "document", "sticker"].includes(mediaType)) return true;
  return ["imageMessage", "videoMessage", "documentMessage", "stickerMessage"].some((key) => message[key] != null);
}

/**
 * O EvolutionGo manda o chat como JID string ou como objeto `{ User, Server }`.
 * Os dois viram a mesma string antes da normalização.
 */
function chatToString(chat: unknown): string {
  if (typeof chat === "string") return chat;
  if (!chat || typeof chat !== "object") return "";
  const record = chat as Record<string, unknown>;
  const user = record.User ?? record.user;
  const server = record.Server ?? record.server;
  if (typeof user === "string" && typeof server === "string" && user && server) return `${user}@${server}`;
  if (typeof user === "string") return user;
  return "";
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
