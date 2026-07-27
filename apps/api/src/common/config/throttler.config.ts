/**
 * Konfiguration des globalen Rate-Limitings (Schutz vor Überlastung und
 * Brute-Force). Über die Umgebung anpassbar:
 *
 * - `THROTTLE_TTL`   Zeitfenster in Millisekunden (Standard 60000 = 1 Minute)
 * - `THROTTLE_LIMIT` Erlaubte Anfragen pro Fenster (Standard 100)
 *
 * Endpunkt-spezifische, strengere Limits (Login, Registrierung, Upload) werden
 * direkt am Controller per `@Throttle(...)` gesetzt.
 */
export interface ThrottlerConfig {
  /** Zeitfenster in Millisekunden. */
  ttl: number;
  /** Maximale Anzahl Anfragen pro Zeitfenster. */
  limit: number;
}

/** Liest die globale Throttler-Konfiguration aus der Umgebung (mit Fallbacks). */
export function getThrottlerConfig(): ThrottlerConfig {
  const ttl = Number(process.env.THROTTLE_TTL);
  const limit = Number(process.env.THROTTLE_LIMIT);
  return {
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60_000,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
  };
}
