import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { MonitoringService } from "@/health/monitoring.service";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");
  constructor(private readonly monitoring: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const requestId = validRequestId(req.headers["x-request-id"]) ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const startedAt = Date.now();
    return next.handle().pipe(finalize(() => {
      const durationMs = Date.now() - startedAt;
      const route = normalizedRoute(req);
      this.monitoring.recordHttp(req.method, route, res.statusCode, durationMs);
      this.logger.log({
        event: "http.request.completed", requestId, method: req.method, route,
        statusCode: res.statusCode, durationMs, ...(req.user?.id ? { userId: req.user.id } : {}),
      });
    }));
  }
}

function validRequestId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : null;
}

function normalizedRoute(req: Request): string {
  const path = typeof req.route?.path === "string" ? req.route.path : req.path;
  return `${req.baseUrl || ""}${path}`.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").slice(0, 300);
}
