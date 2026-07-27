import { HttpException, Logger } from "@nestjs/common";

const logger = new Logger("McpTools");

/** Vereinheitlicht strukturierte Leseantworten und gibt keine internen Fehlerdetails preis. */
export async function executeReadTool<T extends object>(
  operation: () => Promise<T>,
) {
  try {
    const output = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() < 500) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: error.message }],
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`MCP-Werkzeug fehlgeschlagen: ${message}`);
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Interner Tool-Fehler." }],
    };
  }
}

/** Schreibwerkzeuge verwenden dasselbe neutrale Fehlerformat wie Lesewerkzeuge. */
export const executeWriteTool = executeReadTool;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const CREATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const UPDATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const INTELLIGENCE_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // Ein optional konfigurierter Intelligence-Provider kann später extern sein.
  openWorldHint: true,
} as const;
