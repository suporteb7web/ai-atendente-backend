import { z } from "zod";
import type { BusinessTool } from "./types.js";

export const currentTimeTool: BusinessTool = {
  name: "current_time",
  description: "Devolve a data e hora atuais em America/Sao_Paulo, no formato ISO-8601.",
  parameters: z.object({}),
  execute() {
    return { iso: isoInSaoPaulo(new Date()) };
  },
};

export function isoInSaoPaulo(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    fractionalSecondDigits: 3,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = parts.year ?? "0000";
  const month = parts.month ?? "01";
  const day = parts.day ?? "01";
  let hour = parts.hour ?? "00";
  if (hour === "24") hour = "00";
  const minute = parts.minute ?? "00";
  const second = parts.second ?? "00";
  const fraction = (parts.fractionalSecond ?? "000").padEnd(3, "0").slice(0, 3);
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction));
  const offsetMinutes = Math.round((asUtc - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction}${sign}${offsetHour}:${offsetMinute}`;
}
