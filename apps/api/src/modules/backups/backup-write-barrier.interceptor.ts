import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MCP_WRITE_TOOLS = new Set([
  "create_page",
  "update_page",
  "create_note",
  "update_note",
  "create_standard_draft",
]);

/** Blockiert nur Mutationen waehrend des konsistenten Backup-Snapshots. */
@Injectable()
export class BackupWriteBarrierInterceptor implements NestInterceptor {
  constructor(private readonly coordination: BackupCoordinationService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    if (!isWriteRequest(request)) return next.handle();

    const entered = await this.coordination.enterWrite();
    if (!entered) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: "BackupWriteProtection",
        message: "Die Anwendung erstellt gerade ein konsistentes Backup. Bitte erneut versuchen.",
        retryAfterSeconds: 5,
      });
    }
    return next.handle().pipe(finalize(() => {
      void this.coordination.leaveWrite().catch(() => undefined);
    }));
  }
}

function isWriteRequest(request: Request): boolean {
  if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) return false;
  if (request.path === "/mcp" || request.originalUrl.split("?")[0] === "/mcp") {
    if (!isRecord(request.body) || request.body.method !== "tools/call" || !isRecord(request.body.params)) {
      return false;
    }
    return typeof request.body.params.name === "string" && MCP_WRITE_TOOLS.has(request.body.params.name);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
