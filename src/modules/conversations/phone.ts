/**
 * Identidade da conversa. O mesmo resultado é usado para buscar e para enviar.
 * Número brasileiro móvel com 12 dígitos (55 + DDD + 8) ganha o nono dígito.
 */
export function normalizePhone(value: string): string {
  const head = value.includes("@") ? value.slice(0, value.indexOf("@")) : value;
  const digits = head.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 12) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}
