import { currentTimeTool } from "./current-time.js";
import { requestHandoffTool } from "./request-handoff.js";
import type { BusinessTool } from "./types.js";

/** Tools de negócio. Novas tools entram aqui e em mais nenhum lugar. */
export const businessTools: BusinessTool[] = [requestHandoffTool, currentTimeTool];
