/**
 * Zentrale, sichere Auflösung des JWT-Secrets.
 *
 * Bewusst KEIN Entwicklungs-Fallback: Fehlt `JWT_SECRET`, bricht die
 * Anwendung beim Start hart ab, statt still mit einem öffentlich bekannten
 * Secret zu laufen (mit dem sich Tokens fälschen ließen).
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "JWT_SECRET ist nicht gesetzt. Die Anwendung kann ohne sicheres " +
        "Token-Secret nicht gestartet werden. Bitte JWT_SECRET in der " +
        "Umgebung (.env) definieren.",
    );
  }
  return secret;
}
