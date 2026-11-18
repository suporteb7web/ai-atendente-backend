import { UUID_RE } from "../db/mapping.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function parseUuidParam(id: string): string {
  if (!UUID_RE.test(id)) throw new HttpError(404, "não encontrado");
  return id;
}

export function parseLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new HttpError(400, "limit inválido");
  const value = Number(raw);
  if (value < 1 || value > max) throw new HttpError(400, "limit inválido");
  return value;
}

export function parseCursor(raw: unknown): { at: Date; id: string } | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") throw new HttpError(400, "cursor inválido");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "cursor inválido");
  }
  if (!parsed || typeof parsed !== "object") throw new HttpError(400, "cursor inválido");
  const at = (parsed as { at?: unknown }).at;
  const id = (parsed as { id?: unknown }).id;
  if (typeof at !== "string" || typeof id !== "string" || !UUID_RE.test(id)) {
    throw new HttpError(400, "cursor inválido");
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "cursor inválido");
  return { at: date, id };
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id }), "utf8").toString("base64url");
}

export function parseOperatorText(body: unknown): string {
  const text = asRecord(body).text;
  if (typeof text !== "string") throw new HttpError(400, "body inválido");
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 4000) throw new HttpError(400, "body inválido");
  return trimmed;
}

export function parseHandoffEnabled(body: unknown): boolean {
  const enabled = asRecord(body).enabled;
  if (typeof enabled !== "boolean") throw new HttpError(400, "body inválido");
  return enabled;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
