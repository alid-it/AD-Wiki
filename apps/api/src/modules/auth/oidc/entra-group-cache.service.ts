import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

const CACHE_PREFIX = "ad-wiki:oidc:entra-groups";

/** Kurzlebiger, pseudonymisierter Cache für bereits aufgelöste Entra-Gruppen-IDs. */
@Injectable()
export class EntraGroupCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntraGroupCacheService.name);
  private readonly memory = new Map<
    string,
    { groupIds: string[]; expiresAt: number }
  >();
  private client: RedisClientType | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return;
    const client = createClient({ url });
    client.on("error", (error: Error) =>
      this.logger.error(`Redis-Fehler im Entra-Cache: ${safeErrorName(error)}`),
    );
    await client.connect();
    this.client = client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
    this.client = null;
  }

  async get(
    providerId: string,
    subject: string,
    membershipMode: string,
  ): Promise<string[] | null> {
    const key = cacheKey(providerId, subject, membershipMode);
    if (this.client) {
      const raw = await this.client.get(key);
      return raw ? parseGroupIds(raw) : null;
    }
    this.requireDevelopmentFallback();
    const cached = this.memory.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return [...cached.groupIds];
  }

  async set(
    providerId: string,
    subject: string,
    membershipMode: string,
    groupIds: string[],
    ttlMinutes: number,
  ): Promise<void> {
    const key = cacheKey(providerId, subject, membershipMode);
    const ttlSeconds = Math.max(60, Math.min(3_600, ttlMinutes * 60));
    const value = JSON.stringify(groupIds);
    if (this.client) {
      await this.client.set(key, value, { EX: ttlSeconds });
      return;
    }
    this.requireDevelopmentFallback();
    this.memory.set(key, {
      groupIds: [...groupIds],
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  private requireDevelopmentFallback(): void {
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException(
        "Der sichere Entra-Gruppencache ist nicht verfügbar.",
      );
    }
  }
}

function cacheKey(
  providerId: string,
  subject: string,
  membershipMode: string,
): string {
  const identityHash = createHash("sha256")
    .update(providerId, "utf8")
    .update("\0", "utf8")
    .update(subject, "utf8")
    .update("\0", "utf8")
    .update(membershipMode, "utf8")
    .digest("hex");
  return `${CACHE_PREFIX}:${identityHash}`;
}

function parseGroupIds(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.length <= 500 &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
