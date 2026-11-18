let last = 0;

/** Relógio monotônico em milissegundos para a ordem de `created_at` no mesmo processo. */
export function nowTimestamp(): Date {
  const current = Date.now();
  last = Math.max(current, last + 1);
  return new Date(last);
}
