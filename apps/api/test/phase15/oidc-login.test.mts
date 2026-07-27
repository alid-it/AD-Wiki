import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { OidcSecretEncryptionService } from "../../dist/modules/auth/oidc/oidc-secret-encryption.service.js";
import {
  OidcLoginError,
  OidcService,
  oidcCallbackUrl,
  oidcWebLoginUrl,
} from "../../dist/modules/auth/oidc/oidc.service.js";

const PROVIDER_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const ROLE_ID = "30000000-0000-4000-8000-000000000003";
const PROVIDER_SLUG = "test-oidc";
const USER_AGENT = "AD-Wiki OIDC Test";
const SSO_KEY = Buffer.alloc(32, 7).toString("base64");

type OidcPrisma = ConstructorParameters<typeof OidcService>[0];
type OidcAuth = ConstructorParameters<typeof OidcService>[1];
type OidcAudit = ConstructorParameters<typeof OidcService>[3];
type OidcMonitoring = NonNullable<ConstructorParameters<typeof OidcService>[4]>;

test("OIDC-Code-Flow prüft PKCE, Nonce und Signatur und tauscht nur einen Einmalcode", async () => {
  const previousEnvironment = {
    SSO_ENCRYPTION_KEY: process.env.SSO_ENCRYPTION_KEY,
    OIDC_ALLOW_INSECURE_HTTP: process.env.OIDC_ALLOW_INSECURE_HTTP,
    OIDC_PUBLIC_API_URL: process.env.OIDC_PUBLIC_API_URL,
    WEB_URL: process.env.WEB_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.SSO_ENCRYPTION_KEY = SSO_KEY;
  process.env.OIDC_ALLOW_INSECURE_HTTP = "true";
  process.env.OIDC_PUBLIC_API_URL = "http://localhost:4000";
  process.env.WEB_URL = "http://localhost:3000";
  process.env.NODE_ENV = "test";

  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attackerKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = keyPair.publicKey.export({ format: "jwk" });
  const protocolState: {
    issuer?: string;
    nonce?: string;
    codeChallenge?: string;
    invalidSignature?: boolean;
    emailVerified?: boolean;
    tokenRequests: number;
  } = { tokenRequests: 0, emailVerified: true };

  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const issuer = protocolState.issuer;
      if (!issuer) return sendJson(response, 503, { error: "not_ready" });
      const url = new URL(request.url ?? "/", issuer);
      if (url.pathname === "/.well-known/openid-configuration") {
        return sendJson(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/jwks") {
        return sendJson(response, 200, {
          keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }],
        });
      }
      if (url.pathname === "/token" && request.method === "POST") {
        protocolState.tokenRequests += 1;
        const body = new URLSearchParams(await readBody(request));
        const verifier = body.get("code_verifier") ?? "";
        const challenge = createHash("sha256")
          .update(verifier, "utf8")
          .digest("base64url");
        if (
          body.get("code") !== "valid-code" ||
          challenge !== protocolState.codeChallenge
        ) {
          return sendJson(response, 400, { error: "invalid_grant" });
        }
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt(
          {
            iss: issuer,
            sub: "external-user-1",
            aud: "ad-wiki",
            exp: now + 300,
            iat: now,
            auth_time: now,
            nonce: protocolState.nonce,
            email: "linked@example.test",
            email_verified: protocolState.emailVerified,
            preferred_username: "linked",
            name: "Linked User",
          },
          protocolState.invalidSignature
            ? attackerKeyPair.privateKey
            : keyPair.privateKey,
        );
        return sendJson(response, 200, {
          access_token: "provider-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      return sendJson(response, 404, { error: "not_found" });
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  protocolState.issuer = `http://127.0.0.1:${address.port}`;

  try {
    const memory = createOidcPrisma(protocolState.issuer);
    const issuedSessions: string[] = [];
    const loginAttempts: boolean[] = [];
    const audits: Array<{ action: string; details: unknown }> = [];
    const service = new OidcService(
      memory.prisma,
      {
        createSessionForUser: async (userId: string) => {
          issuedSessions.push(userId);
          return {
            user: {
              id: USER_ID,
              email: "linked@example.test",
              username: "linked",
              displayName: "Linked User",
              roleId: ROLE_ID,
              role: "viewer",
              isActive: true,
              hasLocalPassword: true,
              isProtected: false,
            },
            accessToken: "internal-access-token",
            refreshToken: "internal-refresh-token",
          };
        },
      } as unknown as OidcAuth,
      new OidcSecretEncryptionService(),
      {
        log: async (
          _userId: string | null,
          action: string,
          _resource: string,
          _resourceId: string | null,
          details: unknown,
        ) => {
          audits.push({ action, details });
        },
      } as unknown as OidcAudit,
      {
        recordLoginAttempt: (success: boolean) => loginAttempts.push(success),
      } as unknown as OidcMonitoring,
    );

    const providers = await service.getLoginProviders();
    assert.deepEqual(providers, [
      { slug: PROVIDER_SLUG, name: "Test Login", type: "GENERIC_OIDC" },
    ]);

    const start = await service.startLogin(PROVIDER_SLUG);
    const authorizationUrl = new URL(start.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    protocolState.nonce = authorizationUrl.searchParams.get("nonce") ?? undefined;
    protocolState.codeChallenge =
      authorizationUrl.searchParams.get("code_challenge") ?? undefined;

    assert.ok(state);
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(
      authorizationUrl.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.equal(
      authorizationUrl.searchParams.get("redirect_uri"),
      oidcCallbackUrl(PROVIDER_SLUG),
    );
    assert.ok(protocolState.nonce);
    assert.ok(protocolState.codeChallenge);
    assert.equal(memory.authorizationRequests.size, 1);
    const storedRequest = [...memory.authorizationRequests.values()][0];
    assert.ok(storedRequest);
    assert.equal(JSON.stringify(storedRequest).includes(state), false);
    assert.equal(typeof storedRequest.encryptedCodeVerifier, "string");
    assert.equal(
      (storedRequest.encryptedCodeVerifier as string).includes(
        protocolState.codeChallenge,
      ),
      false,
    );

    const callback = new URL(oidcCallbackUrl(PROVIDER_SLUG));
    callback.searchParams.set("code", "valid-code");
    callback.searchParams.set("state", state);
    const completion = await service.completeLogin(
      PROVIDER_SLUG,
      callback,
      start.browserBinding,
      { userAgent: USER_AGENT, ipAddress: "127.0.0.1" },
    );
    assert.equal(completion.kind, "login");
    assert.ok(completion.kind === "login");
    const loginCode = completion.loginCode;
    assert.equal(loginCode.length, 43);
    assert.equal(protocolState.tokenRequests, 1);
    assert.equal(memory.authorizationRequests.size, 0);
    assert.equal(memory.loginCodes.size, 1);
    assert.equal(
      JSON.stringify([...memory.loginCodes.values()]).includes(loginCode),
      false,
    );

    const result = await service.exchangeLoginCode(loginCode, {
      userAgent: USER_AGENT,
      ipAddress: "127.0.0.1",
    });
    assert.equal(result.accessToken, "internal-access-token");
    assert.deepEqual(issuedSessions, [USER_ID]);
    assert.equal(loginAttempts.at(-1), true);
    assert.equal(audits.at(-1)?.action, "user.login");

    await assert.rejects(
      service.exchangeLoginCode(loginCode, { userAgent: USER_AGENT }),
      UnauthorizedException,
    );
    assert.deepEqual(issuedSessions, [USER_ID]);

    const nonceStart = await service.startLogin(PROVIDER_SLUG);
    const nonceAuthorization = new URL(nonceStart.authorizationUrl);
    const nonceState = nonceAuthorization.searchParams.get("state");
    assert.ok(nonceState);
    protocolState.codeChallenge =
      nonceAuthorization.searchParams.get("code_challenge") ?? undefined;
    protocolState.nonce = "manipulierter-nonce";
    const nonceCallback = new URL(oidcCallbackUrl(PROVIDER_SLUG));
    nonceCallback.searchParams.set("code", "valid-code");
    nonceCallback.searchParams.set("state", nonceState);
    await assert.rejects(
      service.completeLogin(
        PROVIDER_SLUG,
        nonceCallback,
        nonceStart.browserBinding,
        { userAgent: USER_AGENT },
      ),
      (error: unknown) =>
        error instanceof OidcLoginError &&
        error.code === "provider_unavailable",
    );

    const signatureStart = await service.startLogin(PROVIDER_SLUG);
    const signatureAuthorization = new URL(signatureStart.authorizationUrl);
    const signatureState = signatureAuthorization.searchParams.get("state");
    assert.ok(signatureState);
    protocolState.codeChallenge =
      signatureAuthorization.searchParams.get("code_challenge") ?? undefined;
    protocolState.nonce =
      signatureAuthorization.searchParams.get("nonce") ?? undefined;
    protocolState.invalidSignature = true;
    const signatureCallback = new URL(oidcCallbackUrl(PROVIDER_SLUG));
    signatureCallback.searchParams.set("code", "valid-code");
    signatureCallback.searchParams.set("state", signatureState);
    await assert.rejects(
      service.completeLogin(
        PROVIDER_SLUG,
        signatureCallback,
        signatureStart.browserBinding,
        { userAgent: USER_AGENT },
      ),
      (error: unknown) =>
        error instanceof OidcLoginError &&
        error.code === "provider_unavailable",
    );
    protocolState.invalidSignature = false;
    assert.deepEqual(issuedSessions, [USER_ID]);

    const claimsStart = await service.startLogin(PROVIDER_SLUG);
    const claimsAuthorization = new URL(claimsStart.authorizationUrl);
    const claimsState = claimsAuthorization.searchParams.get("state");
    assert.ok(claimsState);
    protocolState.codeChallenge =
      claimsAuthorization.searchParams.get("code_challenge") ?? undefined;
    protocolState.nonce =
      claimsAuthorization.searchParams.get("nonce") ?? undefined;
    protocolState.emailVerified = false;
    const claimsCallback = new URL(oidcCallbackUrl(PROVIDER_SLUG));
    claimsCallback.searchParams.set("code", "valid-code");
    claimsCallback.searchParams.set("state", claimsState);
    await assert.rejects(
      service.completeLogin(
        PROVIDER_SLUG,
        claimsCallback,
        claimsStart.browserBinding,
        { userAgent: USER_AGENT },
      ),
      (error: unknown) =>
        error instanceof OidcLoginError &&
        error.code === "claims_invalid",
    );
    assert.deepEqual(issuedSessions, [USER_ID]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    restoreEnvironment(previousEnvironment);
  }
});

test("OIDC-Helfer geben nur feste Callback- und fragmentbasierte Web-Ziele aus", () => {
  const previousApiUrl = process.env.OIDC_PUBLIC_API_URL;
  const previousWebUrl = process.env.WEB_URL;
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.OIDC_PUBLIC_API_URL = "http://localhost:4000";
  process.env.WEB_URL = "http://localhost:3000";
  process.env.NODE_ENV = "test";
  try {
    assert.equal(
      oidcCallbackUrl("keycloak"),
      "http://localhost:4000/api/v1/auth/oidc/keycloak/callback",
    );
    const target = new URL(oidcWebLoginUrl("oidc_code", "secret-code"));
    assert.equal(target.origin, "http://localhost:3000");
    assert.equal(target.pathname, "/login");
    assert.equal(target.search, "");
    assert.equal(target.hash, "#oidc_code=secret-code");
  } finally {
    restoreEnvironment({
      OIDC_PUBLIC_API_URL: previousApiUrl,
      WEB_URL: previousWebUrl,
      NODE_ENV: previousNodeEnvironment,
    });
  }
});

test("OIDC-Verschlüsselung erkennt manipulierte PKCE-Daten", () => {
  const previousKey = process.env.SSO_ENCRYPTION_KEY;
  process.env.SSO_ENCRYPTION_KEY = SSO_KEY;
  try {
    const encryption = new OidcSecretEncryptionService();
    const encrypted = encryption.encrypt("pkce-verifier");
    assert.equal(encryption.decrypt(encrypted), "pkce-verifier");
    const parts = encrypted.split(".");
    const cipherText = Buffer.from(parts[3] ?? "", "base64url");
    cipherText[0] = (cipherText[0] ?? 0) ^ 1;
    parts[3] = cipherText.toString("base64url");
    const tampered = parts.join(".");
    assert.throws(() => encryption.decrypt(tampered));
  } finally {
    restoreEnvironment({ SSO_ENCRYPTION_KEY: previousKey });
  }
});

function createOidcPrisma(issuer: string) {
  const provider = {
    id: PROVIDER_ID,
    name: "Test Login",
    slug: PROVIDER_SLUG,
    type: "GENERIC_OIDC",
    issuer,
    clientId: "ad-wiki",
    clientAuthMethod: "NONE",
    encryptedClientSecret: null,
    scopes: ["openid", "profile", "email"],
    claimMapping: {
      subject: "sub",
      email: "email",
      emailVerified: "email_verified",
      username: "preferred_username",
      displayName: "name",
    },
    isActive: true,
    displayOrder: 0,
    allowJitProvisioning: false,
    defaultRoleId: null,
    maxSessionAgeMinutes: 480,
  };
  const authorizationRequests = new Map<string, Record<string, unknown>>();
  const loginCodes = new Map<string, Record<string, unknown>>();
  let authorizationSequence = 0;
  let loginCodeSequence = 0;

  const prisma = {
    identityProvider: {
      findMany: async () => [
        { slug: provider.slug, name: provider.name, type: provider.type },
      ],
      findUnique: async () => provider,
    },
    oidcAuthorizationRequest: {
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") {
          const deleted = authorizationRequests.delete(where.id);
          return { count: deleted ? 1 : 0 };
        }
        return { count: 0 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        authorizationSequence += 1;
        const id = `authorization-${authorizationSequence}`;
        const stored = { id, ...data };
        authorizationRequests.set(id, stored);
        return stored;
      },
      findUnique: async ({
        where,
      }: {
        where: { stateHash: string };
      }) => {
        const stored = [...authorizationRequests.values()].find(
          (item) => item.stateHash === where.stateHash,
        );
        return stored ? { ...stored, provider } : null;
      },
    },
    oidcLoginCode: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        loginCodeSequence += 1;
        const id = `login-code-${loginCodeSequence}`;
        const stored = { id, usedAt: null, createdAt: new Date(), ...data };
        loginCodes.set(id, stored);
        return stored;
      },
      findUnique: async ({
        where,
      }: {
        where: { tokenHash: string };
      }) => {
        const stored = [...loginCodes.values()].find(
          (item) => item.tokenHash === where.tokenHash,
        );
        return stored
          ? {
              ...stored,
              user: { id: USER_ID, isActive: true },
              provider: {
                id: PROVIDER_ID,
                name: provider.name,
                maxSessionAgeMinutes: provider.maxSessionAgeMinutes,
              },
              externalIdentity: { id: "external-identity-1" },
            }
          : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { usedAt: Date };
      }) => {
        const existing = loginCodes.get(where.id);
        if (!existing || existing.usedAt) return { count: 0 };
        loginCodes.set(where.id, { ...existing, usedAt: data.usedAt });
        return { count: 1 };
      },
    },
    externalIdentity: {
      findUnique: async () => ({
        id: "external-identity-1",
        user: { id: USER_ID, isActive: true, isProtected: false },
      }),
      update: async () => ({ id: "external-identity-1" }),
    },
    $transaction: async (
      input:
        | Promise<unknown>[]
        | ((transaction: unknown) => Promise<unknown>),
    ) =>
      typeof input === "function"
        ? input(prisma)
        : Promise.all(input),
  };

  return {
    prisma: prisma as unknown as OidcPrisma,
    authorizationRequests,
    loginCodes,
  };
}

function signJwt(
  payload: Record<string, unknown>,
  privateKey: Parameters<typeof sign>[2],
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const unsigned = `${header}.${body}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned, "ascii"), privateKey);
  return `${unsigned}.${signature.toString("base64url")}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function restoreEnvironment(
  values: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
