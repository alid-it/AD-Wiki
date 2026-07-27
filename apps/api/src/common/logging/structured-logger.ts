import { ConsoleLogger, type LoggerService, type LogLevel } from "@nestjs/common";

const SECRET_PATTERN = /(authorization|cookie|password|secret|token|content)/i;

export class StructuredLogger implements LoggerService {
  log(message: unknown, context?: string): void { this.write("info", message, context); }
  fatal(message: unknown, context?: string): void { this.write("fatal", message, context); }
  error(message: unknown, trace?: string, context?: string): void { this.write("error", message, context, trace ? { trace: trace.slice(0, 4000) } : undefined); }
  warn(message: unknown, context?: string): void { this.write("warn", message, context); }
  debug(message: unknown, context?: string): void { this.write("debug", message, context); }
  verbose(message: unknown, context?: string): void { this.write("trace", message, context); }
  setLogLevels(_levels: LogLevel[]): void {}

  private write(level: string, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    const output = `${JSON.stringify(structuredLogRecord(level, message, context, extra))}\n`;
    if (level === "error" || level === "fatal") process.stderr.write(output);
    else process.stdout.write(output);
  }
}

export function createApplicationLogger(): LoggerService {
  return process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production"
    ? new StructuredLogger()
    : new ConsoleLogger({ prefix: "AD-WIKI" });
}

export function structuredLogRecord(level: string, message: unknown, context?: string, extra?: Record<string, unknown>): Record<string, unknown> {
  const fields = isRecord(message) ? sanitize(message) : { message: safeText(message) };
  return {
    timestamp: new Date().toISOString(), level, service: "ad-wiki-api",
    ...(context ? { context } : {}), ...fields, ...(extra ? sanitize(extra) : {}),
  };
}

function sanitize(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, SECRET_PATTERN.test(key) ? "[REDACTED]" : safeValue(entry),
  ]));
}

function safeValue(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? value.slice(0, 2000) : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(safeValue);
  if (isRecord(value)) return sanitize(value);
  return safeText(value);
}

function safeText(value: unknown): string {
  return value instanceof Error ? value.message.slice(0, 2000) : String(value).slice(0, 2000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
