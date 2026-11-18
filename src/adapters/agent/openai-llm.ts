import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiResponse {
  choices?: Array<{ message?: OpenAiMessage }>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * `@google/adk` e `@google/adk-integrations` 2.5.0 não exportam conector de OpenAI
 * (só Anthropic). Este BaseLlm chama a API de chat completions sem streaming.
 */
export class OpenAiLlm extends BaseLlm {
  static override readonly supportedModels = [/gpt-.*/];

  constructor(
    private readonly options: {
      model: string;
      apiKey: string;
      fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) {
    super({ model: options.model });
  }

  override async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream = false,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    const model = llmRequest.model || this.model;
    const body: Record<string, unknown> = {
      model,
      messages: toMessages(llmRequest),
    };
    const tools = toTools(llmRequest);
    if (tools.length > 0) body.tools = tools;

    const fetchImpl = this.options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error("openai falhou");
    const payload = (await response.json()) as OpenAiResponse;
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("openai falhou");
    yield { content: toContent(message) };
  }

  override connect(_llmRequest: LlmRequest): Promise<never> {
    return Promise.reject(new Error(`conexão live não suportada para ${this.model}`));
  }
}

function toMessages(request: LlmRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const system = systemText(request);
  if (system) messages.push({ role: "system", content: system });

  const pendingIds: string[] = [];
  let sequence = 0;
  for (const content of request.contents ?? []) {
    const parts = content.parts ?? [];
    const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
    const responses = parts.flatMap((part) => (part.functionResponse ? [part.functionResponse] : []));
    const text = parts.map((part) => part.text ?? "").join("").trim();

    if (calls.length > 0) {
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call) => {
          const id = usableId(call.id) ?? `call_${sequence++}`;
          pendingIds.push(id);
          return {
            id,
            type: "function" as const,
            function: {
              name: call.name ?? "tool",
              arguments: JSON.stringify(call.args ?? {}),
            },
          };
        }),
      });
    }

    for (const response of responses) {
      messages.push({
        role: "tool",
        tool_call_id: usableId(response.id) ?? pendingIds.shift() ?? `call_${sequence++}`,
        content: JSON.stringify(response.response ?? {}),
      });
    }

    if (calls.length === 0 && responses.length === 0 && text) {
      messages.push({
        role: content.role === "model" ? "assistant" : "user",
        content: text,
      });
    }
  }
  return messages;
}

function toTools(request: LlmRequest) {
  const declarations = (request.config?.tools ?? []).flatMap((tool) => {
    if (!tool || typeof tool !== "object" || !("functionDeclarations" in tool)) return [];
    return tool.functionDeclarations ?? [];
  });
  return declarations.flatMap((declaration) => {
    if (!declaration.name) return [];
    return [
      {
        type: "function" as const,
        function: {
          name: declaration.name,
          description: declaration.description ?? "",
          parameters: toOpenAiSchema(declaration.parameters),
        },
      },
    ];
  });
}

function toContent(message: OpenAiMessage): LlmResponse["content"] {
  const parts = [];
  if (typeof message.content === "string" && message.content.trim()) {
    parts.push({ text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    const name = call.function?.name;
    if (!name) continue;
    parts.push({
      functionCall: {
        name,
        id: call.id,
        args: parseArgs(call.function?.arguments),
      },
    });
  }
  return { role: "model", parts };
}

function toOpenAiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "$schema" || key === "additionalProperties") continue;
    if (key === "type" && typeof value === "string") {
      output.type = value.toLowerCase();
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      output.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, property]) => [name, toOpenAiSchema(property)]),
      );
      continue;
    }
    if (key === "items") {
      output.items = toOpenAiSchema(value);
      continue;
    }
    output[key] = value;
  }
  if (typeof output.type !== "string") output.type = "object";
  if (output.type === "object" && output.properties === undefined) output.properties = {};
  return output;
}

function systemText(request: LlmRequest): string | undefined {
  const instruction = request.config?.systemInstruction;
  if (!instruction) return undefined;
  if (typeof instruction === "string") return instruction;
  if (Array.isArray(instruction)) {
    return (
      instruction
        .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
        .join("") || undefined
    );
  }
  if (typeof instruction === "object" && "parts" in instruction) {
    const parts = instruction.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    return text || undefined;
  }
  return undefined;
}

function usableId(id: string | undefined): string | undefined {
  if (!id || id.startsWith("adk-")) return undefined;
  return id;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}
