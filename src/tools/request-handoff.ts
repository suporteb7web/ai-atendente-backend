import { z } from "zod";
import type { BusinessTool } from "./types.js";

const parameters = z.object({
  reason: z.string().min(1).describe("Motivo curto do handoff"),
});

export const requestHandoffTool: BusinessTool<typeof parameters> = {
  name: "request_handoff",
  description:
    "Pede um operador humano. Use quando o cliente pedir uma pessoa, o assunto estiver fora do playbook, ou uma tool falhar e a conversa não puder continuar. Não escreva mensagem para o cliente neste turno.",
  parameters,
  execute(args) {
    return { accepted: true, reason: args.reason };
  },
};
