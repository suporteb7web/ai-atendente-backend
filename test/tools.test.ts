import { describe, expect, it } from "vitest";
import { isoInSaoPaulo } from "../src/tools/current-time.js";
import { requestHandoffTool } from "../src/tools/request-handoff.js";

describe("tools", () => {
  it("current_time devolve ISO-8601 em America/Sao_Paulo", () => {
    const iso = isoInSaoPaulo(new Date("2026-11-17T15:00:00.000Z"));
    expect(iso).toBe("2026-11-17T12:00:00.000-03:00");
  });

  it("request_handoff não altera estado e devolve o motivo", async () => {
    expect(requestHandoffTool.execute({ reason: "cliente pediu humano" }, { conversationId: "c", phone: "1" })).toEqual({
      accepted: true,
      reason: "cliente pediu humano",
    });
  });
});
