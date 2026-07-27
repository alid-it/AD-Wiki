import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { MulterError } from "multer";
import type { ApiError } from "@ad-wiki/shared-types";
import { MonitoringService } from "@/health/monitoring.service";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Die Anfrage enthält ungültige oder unvollständige Angaben.",
  401: "Bitte melde dich an oder prüfe deine Zugangsdaten.",
  403: "Du hast keine Berechtigung für diese Aktion.",
  404: "Der angeforderte Inhalt wurde nicht gefunden.",
  409: "Die Änderung konnte wegen eines Konflikts nicht gespeichert werden.",
  413: "Die übermittelte Datei oder Anfrage ist zu groß.",
  429: "Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.",
  500: "Die Anfrage konnte gerade nicht verarbeitet werden. Bitte versuche es später erneut.",
  503: "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
};

const TECHNICAL_MESSAGE = /^(bad request|unauthorized|forbidden|not found|conflict|internal server error|service unavailable|payload too large|too many requests)$|^cannot\s+(get|post|put|patch|delete)|validation failed|unexpected token|unexpected end|\bjson\b|prisma|postgres|sqlstate|syntaxerror|typeerror|at\s+\S+\s*\(/i;

interface PublicErrorResult {
  status: number;
  body: ApiError;
}

/**
 * Wandelt ausnahmslos jeden REST-Fehler in eine kontrollierte öffentliche
 * Antwort um. Interne Fehlerdetails bleiben ausschließlich in den Serverlogs.
 */
@Catch()
@Injectable()
export class PublicApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PublicApiErrorFilter.name);

  constructor(private readonly monitoring: MonitoringService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const result = publicErrorFromException(exception);
    this.monitoring.recordSecurityHttpResponse(result.status);

    if (result.status >= 500) {
      this.logger.error({
        event: "http.request.failed",
        method: request.method,
        path: request.path,
        errorName: exception instanceof Error ? exception.name : "UnknownError",
        errorMessage: exception instanceof Error ? exception.message : "Unbekannter interner Fehler",
      });
    }

    response.status(result.status).json(result.body);
  }
}

/** Exportiert für Sicherheitstests ohne laufenden HTTP-Server. */
export function publicErrorFromException(exception: unknown): PublicErrorResult {
  if (exception instanceof MulterError) {
    const tooLarge = exception.code === "LIMIT_FILE_SIZE";
    return buildError(
      tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST,
      tooLarge ? "UPLOAD_TOO_LARGE" : "UPLOAD_INVALID",
      tooLarge
        ? "Die Datei ist zu groß. Erlaubt sind maximal 10 MB."
        : "Die Datei konnte nicht verarbeitet werden. Bitte prüfe Format und Größe.",
    );
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === "P2002") {
      return buildError(HttpStatus.CONFLICT, "ENTRY_ALREADY_EXISTS", "Dieser Eintrag ist bereits vorhanden.");
    }
    if (exception.code === "P2025") {
      return buildError(HttpStatus.NOT_FOUND, "ENTRY_NOT_FOUND", STATUS_MESSAGES[404]);
    }
    return buildError(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", STATUS_MESSAGES[500]);
  }

  if (exception instanceof HttpException) {
    const status = normalizeStatus(exception.getStatus());
    const response = exception.getResponse();
    const details = isRecord(response) ? response : null;
    const configuredCode = details && typeof details.code === "string" ? details.code : null;
    const configuredMessage = typeof response === "string"
      ? response
      : details && typeof details.message === "string"
        ? details.message
        : null;
    const fieldErrors = details ? validFieldErrors(details.fieldErrors) : undefined;
    const message = status >= 500 || !isPublicMessage(configuredMessage)
      ? messageForStatus(status)
      : configuredMessage;
    const code = configuredCode && /^[A-Z][A-Z0-9_]{1,63}$/.test(configuredCode)
      ? configuredCode
      : codeForStatus(status);
    return buildError(status, code, message, fieldErrors);
  }

  const status = statusFromUnknown(exception);
  return buildError(status, codeForStatus(status), messageForStatus(status));
}

function buildError(
  status: number,
  code: string,
  message: string,
  fieldErrors?: Array<{ field: string; message: string }>,
): PublicErrorResult {
  return {
    status,
    body: {
      success: false,
      error: {
        code,
        message,
        ...(fieldErrors && fieldErrors.length > 0 ? { fieldErrors } : {}),
      },
    },
  };
}

function validFieldErrors(value: unknown): Array<{ field: string; message: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const errors = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.field !== "string" || typeof entry.message !== "string") return [];
    if (!isPublicMessage(entry.message)) return [];
    return [{ field: entry.field.slice(0, 200), message: entry.message.slice(0, 500) }];
  });
  return errors.length > 0 ? errors.slice(0, 50) : undefined;
}

function isPublicMessage(message: string | null): message is string {
  return Boolean(message && message.length <= 1000 && !TECHNICAL_MESSAGE.test(message));
}

function statusFromUnknown(exception: unknown): number {
  if (!isRecord(exception)) return HttpStatus.INTERNAL_SERVER_ERROR;
  const candidate = typeof exception.status === "number"
    ? exception.status
    : typeof exception.statusCode === "number"
      ? exception.statusCode
      : HttpStatus.INTERNAL_SERVER_ERROR;
  return normalizeStatus(candidate);
}

function normalizeStatus(status: number): number {
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");
}

function messageForStatus(status: number): string {
  return STATUS_MESSAGES[status]
    ?? (status >= 500 ? STATUS_MESSAGES[500] : "Die Anfrage konnte nicht verarbeitet werden.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
