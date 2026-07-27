import { Injectable } from "@nestjs/common";
import {
  EntraGraphMembershipMode,
  IdentityProviderType,
} from "@prisma/client";
import { EntraGroupCacheService } from "@/modules/auth/oidc/entra-group-cache.service";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_GROUP_LIMIT = 500;
const GRAPH_PAGE_LIMIT = 20;
const GRAPH_TIMEOUT_MS = 10_000;
const OBJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EntraProvider = {
  id: string;
  type: IdentityProviderType;
  groupClaim: string | null;
  entraGraphFallbackEnabled: boolean;
  entraGraphMembershipMode: EntraGraphMembershipMode;
  entraGraphCacheTtlMinutes: number;
};

export type EntraGroupResolutionErrorCode =
  | "graph_fallback_disabled"
  | "graph_claim_configuration_invalid"
  | "graph_identity_missing"
  | "graph_token_missing"
  | "graph_consent_missing"
  | "graph_response_invalid"
  | "graph_group_limit_exceeded"
  | "graph_unavailable";

export class EntraGroupResolutionError extends Error {
  constructor(readonly code: EntraGroupResolutionErrorCode) {
    super(code);
    this.name = "EntraGroupResolutionError";
  }
}

/** Löst ausschließlich bei signalisiertem Entra-Overage stabile Gruppen-Objekt-IDs auf. */
@Injectable()
export class EntraGroupResolverService {
  constructor(private readonly cache: EntraGroupCacheService) {}

  async resolveClaims(
    provider: EntraProvider,
    claims: Record<string, unknown>,
    accessToken: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (
      provider.type !== IdentityProviderType.MICROSOFT_ENTRA ||
      !hasEntraGroupOverage(claims)
    ) {
      return claims;
    }
    if (!provider.entraGraphFallbackEnabled) {
      throw new EntraGroupResolutionError("graph_fallback_disabled");
    }
    if (!provider.groupClaim) {
      throw new EntraGroupResolutionError(
        "graph_claim_configuration_invalid",
      );
    }
    const subject = claims.sub;
    if (typeof subject !== "string" || !subject.trim()) {
      throw new EntraGroupResolutionError("graph_identity_missing");
    }

    const cached = await this.cache.get(
      provider.id,
      subject,
      provider.entraGraphMembershipMode,
    );
    const groupIds =
      cached ??
      (await this.fetchGroupIds(
        provider.entraGraphMembershipMode,
        accessToken,
      ));
    if (!cached) {
      await this.cache.set(
        provider.id,
        subject,
        provider.entraGraphMembershipMode,
        groupIds,
        provider.entraGraphCacheTtlMinutes,
      );
    }
    return setClaimAtPath(claims, provider.groupClaim, groupIds);
  }

  private async fetchGroupIds(
    membershipMode: EntraGraphMembershipMode,
    accessToken: string | undefined,
  ): Promise<string[]> {
    if (!accessToken) {
      throw new EntraGroupResolutionError("graph_token_missing");
    }
    const relationship =
      membershipMode === EntraGraphMembershipMode.DIRECT
        ? "memberOf"
        : "transitiveMemberOf";
    let nextUrl = new URL(
      `/v1.0/me/${relationship}/microsoft.graph.group?$select=id&$top=999`,
      GRAPH_ORIGIN,
    );
    const groupIds = new Set<string>();

    for (let page = 0; page < GRAPH_PAGE_LIMIT; page += 1) {
      assertGraphUrl(nextUrl);
      let response: Response;
      try {
        response = await fetch(nextUrl, {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        });
      } catch {
        throw new EntraGroupResolutionError("graph_unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        throw new EntraGroupResolutionError("graph_consent_missing");
      }
      if (!response.ok) {
        throw new EntraGroupResolutionError("graph_unavailable");
      }

      const body = await parseGraphPage(response);
      for (const item of body.value) {
        if (!OBJECT_ID_PATTERN.test(item.id)) {
          throw new EntraGroupResolutionError("graph_response_invalid");
        }
        groupIds.add(item.id.toLowerCase());
        if (groupIds.size > GRAPH_GROUP_LIMIT) {
          throw new EntraGroupResolutionError("graph_group_limit_exceeded");
        }
      }
      if (!body.nextLink) return [...groupIds].sort();
      nextUrl = new URL(body.nextLink);
    }
    throw new EntraGroupResolutionError("graph_group_limit_exceeded");
  }
}

export function hasEntraGroupOverage(
  claims: Record<string, unknown>,
): boolean {
  if (claims.hasgroups === true) return true;
  const claimNames = claims._claim_names;
  return (
    typeof claimNames === "object" &&
    claimNames !== null &&
    !Array.isArray(claimNames) &&
    (claimNames as Record<string, unknown>).groups !== undefined
  );
}

function setClaimAtPath(
  claims: Record<string, unknown>,
  path: string,
  value: string[],
): Record<string, unknown> {
  const segments = path.split(".");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    throw new EntraGroupResolutionError("graph_claim_configuration_invalid");
  }
  const result = structuredClone(claims);
  let target = result;
  for (const segment of segments.slice(0, -1)) {
    const current = target[segment];
    if (
      current !== undefined &&
      (typeof current !== "object" ||
        current === null ||
        Array.isArray(current))
    ) {
      throw new EntraGroupResolutionError(
        "graph_claim_configuration_invalid",
      );
    }
    const next =
      current === undefined
        ? {}
        : { ...(current as Record<string, unknown>) };
    target[segment] = next;
    target = next;
  }
  const finalSegment = segments.at(-1);
  if (!finalSegment) {
    throw new EntraGroupResolutionError("graph_claim_configuration_invalid");
  }
  target[finalSegment] = value;
  return result;
}

async function parseGraphPage(
  response: Response,
): Promise<{ value: Array<{ id: string }>; nextLink?: string }> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      throw new Error("body");
    }
    const record = body as Record<string, unknown>;
    if (
      !Array.isArray(record.value) ||
      !record.value.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).id === "string",
      )
    ) {
      throw new Error("value");
    }
    const nextLink = record["@odata.nextLink"];
    if (nextLink !== undefined && typeof nextLink !== "string") {
      throw new Error("nextLink");
    }
    return {
      value: record.value as Array<{ id: string }>,
      ...(nextLink ? { nextLink } : {}),
    };
  } catch (error) {
    if (error instanceof EntraGroupResolutionError) throw error;
    throw new EntraGroupResolutionError("graph_response_invalid");
  }
}

function assertGraphUrl(url: URL): void {
  if (
    url.origin !== GRAPH_ORIGIN ||
    !url.pathname.startsWith("/v1.0/") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new EntraGroupResolutionError("graph_response_invalid");
  }
}
