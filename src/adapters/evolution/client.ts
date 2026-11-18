import type { MessagingPort } from "../../ports.js";

export class EvolutionClient implements MessagingPort {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) {}

  async sendText(phone: string, text: string): Promise<string> {
    const fetchImpl = this.options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const response = await fetchImpl(`${this.options.baseUrl}/send/text`, {
      method: "POST",
      headers: {
        apikey: this.options.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!response.ok) {
      throw new Error("envio falhou");
    }
    const payload: unknown = await response.json();
    const messageId = readMessageId(payload);
    if (!messageId) throw new Error("envio falhou");
    return messageId;
  }
}

function readMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const messageId = (payload as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.length > 0 ? messageId : null;
}
