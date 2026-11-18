import { createHash, timingSafeEqual } from "node:crypto";

/** Compara strings sem vazar o tamanho pelo tempo da comparação. */
export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
