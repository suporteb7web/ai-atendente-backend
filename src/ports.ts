import type { Author } from "./domain.js";

export interface MessagingPort {
  sendText(phone: string, text: string): Promise<string>;
}

export interface TranscriptionPort {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}

export interface AgentHistoryMessage {
  author: Author;
  body: string;
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
}

export interface AgentRunInput {
  conversationId: string;
  phone: string;
  history: AgentHistoryMessage[];
}

export interface AgentRunResult {
  text: string;
  toolCalls: AgentToolCall[];
  handoffRequested: boolean;
  toolRoundsExceeded: boolean;
}

export interface AgentPort {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
