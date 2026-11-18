import type { z } from "zod";

export interface ToolContext {
  conversationId: string;
  phone: string;
}

export interface BusinessTool<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TSchema;
  execute(args: z.infer<TSchema>, ctx: ToolContext): Promise<unknown> | unknown;
}
