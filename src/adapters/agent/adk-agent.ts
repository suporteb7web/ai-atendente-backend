import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FunctionTool,
  InMemoryRunner,
  LlmAgent,
  createEvent,
  isFinalResponse,
  isLlmCallsLimitExceededError,
  type Event,
} from "@google/adk";
import type { AgentPort, AgentRunInput, AgentRunResult, AgentToolCall } from "../../ports.js";
import { businessTools } from "../../tools/registry.js";
import { OpenAiLlm } from "./openai-llm.js";

const AGENT_NAME = "atendente";
const TOOL_ROUND_LIMIT = "limite de rodadas de tool";

export class ToolRoundLimitError extends Error {
  constructor() {
    super(TOOL_ROUND_LIMIT);
    this.name = "ToolRoundLimitError";
  }
}

export class AdkAgent implements AgentPort {
  private readonly llm: OpenAiLlm;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      maxToolRounds: number;
    },
  ) {
    this.llm = new OpenAiLlm({ apiKey: options.apiKey, model: options.model });
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    if (input.history.length === 0) throw new Error("histórico vazio");
    const toolCalls: AgentToolCall[] = [];
    let rounds = 0;
    let countedThisRound = false;

    let exceeded = false;

    const tools = businessTools.map(
      (tool) =>
        new FunctionTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as never,
          execute: async (args) => {
            const record = asRecord(args);
            try {
              const result = toJson(
                await tool.execute(args, {
                  conversationId: input.conversationId,
                  phone: input.phone,
                }),
              );
              toolCalls.push({ name: tool.name, arguments: record, result, status: "success" });
              return result;
            } catch (error) {
              const result = { error: error instanceof Error ? error.message : "tool falhou" };
              toolCalls.push({ name: tool.name, arguments: record, result, status: "error" });
              return result;
            }
          },
        }),
    );

    const agent = new LlmAgent({
      name: AGENT_NAME,
      model: this.llm,
      instruction: readInstruction(),
      tools,
      disallowTransferToParent: true,
      disallowTransferToPeers: true,
      beforeModelCallback: () => {
        countedThisRound = false;
        return undefined;
      },
      beforeToolCallback: ({ context }) => {
        if (!countedThisRound) {
          if (rounds >= this.options.maxToolRounds) {
            exceeded = true;
            context.invocationContext.endInvocation = true;
            return { error: "limite de rodadas de tool" };
          }
          rounds += 1;
          countedThisRound = true;
        }
        return undefined;
      },
    });

    const runner = new InMemoryRunner({ agent, appName: "atendente" });
    try {
      const session = await runner.sessionService.createSession({
        appName: runner.appName,
        userId: input.phone,
        state: { conversationId: input.conversationId, phone: input.phone },
      });
      for (const message of input.history.slice(0, -1)) {
        const fromCustomer = message.author === "customer";
        const fromOperator = message.author === "operator";
        await runner.sessionService.appendEvent({
          session,
          event: createEvent({
            invocationId: "history",
            author: fromCustomer || fromOperator ? "user" : AGENT_NAME,
            content: {
              role: fromCustomer || fromOperator ? "user" : "model",
              parts: [{ text: fromOperator ? `Operador: ${message.body}` : message.body }],
            },
          }),
        });
      }
      const last = input.history[input.history.length - 1]!;
      let text = "";
      for await (const event of runner.runAsync({
        userId: input.phone,
        sessionId: session.id,
        newMessage: { role: "user", parts: [{ text: last.body }] },
        runConfig: { maxLlmCalls: this.options.maxToolRounds + 1 },
      })) {
        if (event.author === AGENT_NAME && isFinalResponse(event)) {
          const next = eventText(event);
          if (next) text = next;
        }
      }
      return {
        text: exceeded ? "" : text,
        toolCalls,
        handoffRequested: requestedHandoff(toolCalls),
        toolRoundsExceeded: exceeded,
      };
    } catch (error) {
      if (isRoundLimit(error) || exceeded) {
        return {
          text: "",
          toolCalls,
          handoffRequested: requestedHandoff(toolCalls),
          toolRoundsExceeded: true,
        };
      }
      throw error;
    } finally {
      await runner.close();
    }
  }
}

export function readInstruction(): string {
  const root = process.cwd();
  const system = readFileSync(join(root, "src/prompt/system.md"), "utf8").trim();
  const playbook = readFileSync(join(root, "src/prompt/playbook.md"), "utf8").trim();
  return `${system}\n\n${playbook}`;
}

function requestedHandoff(toolCalls: AgentToolCall[]): boolean {
  return toolCalls.some((call) => call.name === "request_handoff" && call.status === "success");
}

function eventText(event: Event): string {
  return (event.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? {})) as unknown;
}

function isRoundLimit(error: unknown): boolean {
  const seen = new Set<unknown>();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof ToolRoundLimitError) return true;
    if (isLlmCallsLimitExceededError(current)) return true;
    if (current instanceof Error && (current.name === "ToolRoundLimitError" || current.message === TOOL_ROUND_LIMIT)) {
      return true;
    }
    if ("cause" in current) queue.push((current as { cause?: unknown }).cause);
    if ("errors" in current && Array.isArray((current as { errors?: unknown }).errors)) {
      queue.push(...((current as { errors: unknown[] }).errors));
    }
  }
  return false;
}
