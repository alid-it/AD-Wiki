import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

/**
 * Angepasster Rate-Limiting-Guard.
 *
 * Da dieser Guard global (vor den Auth-Guards) läuft, ist `request.user` noch
 * nicht gesetzt. Für ein Limit „pro Benutzer" (z. B. Uploads) wird die User-ID
 * daher direkt – ohne Signaturprüfung – aus dem Bearer-Token gelesen. Das
 * genügt zur Bucket-Bildung; die eigentliche Autorisierung erfolgt später durch
 * den JwtAuthGuard. Ohne Token wird pro IP-Adresse gezählt (Brute-Force-Schutz
 * für Login/Registrierung).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Bildet den Zähl-Schlüssel: pro Benutzer, sonst pro IP. */
  protected getTracker(req: Request): Promise<string> {
    const userId = extractUserId(req);
    const tracker = userId ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
    return Promise.resolve(tracker);
  }

  /** Deutsche Fehlermeldung bei Überschreitung (HTTP 429). */
  protected getErrorMessage(): Promise<string> {
    return Promise.resolve(
      "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
    );
  }
}

/**
 * Liest die User-ID (`userId`) aus dem JWT im Authorization-Header, ohne die
 * Signatur zu prüfen. Bei Fehlern wird `null` zurückgegeben (→ Zählung per IP).
 */
function extractUserId(req: Request): string | null {
  const header = req.headers?.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { userId?: unknown };
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}
