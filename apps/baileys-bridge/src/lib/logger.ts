import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: pino.Level): Logger {
  return pino({
    level,
    base: { service: "baileys-bridge" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
