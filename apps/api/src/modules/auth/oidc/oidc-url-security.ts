import { ServiceUnavailableException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Prüft OIDC-Ziele gegen SSRF auf Loopback-, Link-Local- und private Netze. */
export async function assertSafeOidcUrl(
  value: string | URL,
  label: string,
): Promise<URL> {
  const url = parseOidcUrl(value, label);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowTestLoopback =
    process.env.NODE_ENV === "test" &&
    process.env.OIDC_ALLOW_INSECURE_HTTP === "true" &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]");
  if (allowTestLoopback) return url;
  if (allowedPrivateHosts().has(hostname)) return url;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateAddress(hostname)
  ) {
    throw unsafe(label);
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ServiceUnavailableException(
      `${label} konnte nicht sicher aufgelöst werden.`,
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw unsafe(label);
  }
  return url;
}

export function parseOidcUrl(value: string | URL, label: string): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  const allowDevelopmentHttp =
    process.env.NODE_ENV !== "production" &&
    process.env.OIDC_ALLOW_INSECURE_HTTP === "true";
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(allowDevelopmentHttp && url.protocol === "http:"))
  ) {
    throw unsafe(label);
  }
  return url;
}

function allowedPrivateHosts(): Set<string> {
  return new Set(
    (process.env.OIDC_ALLOWED_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
}

function isPrivateAddress(value: string): boolean {
  const version = isIP(value);
  if (version === 4) {
    const [first, second] = value.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127) ||
      first >= 224
    );
  }
  if (version === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

function unsafe(label: string): ServiceUnavailableException {
  return new ServiceUnavailableException(
    `${label} verweist auf ein nicht freigegebenes internes Netzwerkziel.`,
  );
}
