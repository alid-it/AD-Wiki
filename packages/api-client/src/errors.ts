/**
 * Einheitlicher Fehlertyp des API-Clients. Kapselt HTTP-Status und einen
 * maschinenlesbaren Code, damit die UI gezielt reagieren kann. Die `message`
 * ist stets eine benutzerfreundliche deutsche Meldung.
 */
export class ApiClientError extends Error {
  constructor(
    /** Maschinenlesbarer Code, z. B. "UNAUTHORIZED" oder "NETWORK". */
    public readonly code: string,
    message: string,
    /** HTTP-Statuscode; 0 bei Netzwerk-/Verbindungsfehlern. */
    public readonly status: number,
    /** Optionale, bereits bereinigte Feldfehler aus der API-Validierung. */
    public readonly fieldErrors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}
