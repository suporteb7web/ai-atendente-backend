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

// ---- Conexão do número de WhatsApp (single-tenant: uma instância do EvolutionGo) ----

export type WhatsappStatus =
  | "unavailable" // o EvolutionGo não responde
  | "license_required" // o EvolutionGo ainda não teve a licença ativada
  | "not_created" // licença ok, mas a instância ainda não existe
  | "disconnected" // instância existe, sem sessão do WhatsApp
  | "connecting" // aguardando o QR ser lido
  | "connected"; // número pareado e no ar

export interface WhatsappState {
  status: WhatsappStatus;
  /** Nome do perfil do WhatsApp conectado. */
  name: string | null;
  /** Telefone conectado, só dígitos com DDI. */
  phone: string | null;
}

export type WhatsappErrorKind = "license" | "config" | "upstream" | "invalid";

export class WhatsappConnectionError extends Error {
  constructor(
    readonly kind: WhatsappErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "WhatsappConnectionError";
  }
}

export interface WhatsappConnectionPort {
  getState(): Promise<WhatsappState>;
  /** Cria a instância se faltar e começa a gerar o QR. */
  connect(): Promise<void>;
  /** QR como data URL PNG, ou null enquanto não há QR (ou já está conectado). */
  getQr(): Promise<string | null>;
  /** Encerra a sessão ou cancela a tentativa de conexão. */
  disconnect(): Promise<void>;
  /** URL de cadastro da licença; depois do cadastro o provedor volta para redirectUri?code=... */
  getLicenseRegisterUrl(redirectUri: string): Promise<string>;
  activateLicense(code: string): Promise<void>;
}
