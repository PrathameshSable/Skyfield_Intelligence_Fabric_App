import pino from "pino";
import { config } from "./config.js";

/**
 * Single shared logger. Pretty-prints in development, structured JSON in prod
 * (which is what Fabric / Azure log collectors want).
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
        },
      }
    : {}),
});
