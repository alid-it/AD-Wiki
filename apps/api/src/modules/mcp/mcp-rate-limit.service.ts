import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { getMcpProductionConfig } from "@/modules/mcp/mcp-production.config";

export interface McpRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface MemoryBucket { count: number; resetAt: number }

@Injectable()
export class McpRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpRateLimitService.name);
  private readonly memory = new Map<string, MemoryBucket>();
  private redis: RedisClientType | null = null;

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("REDIS_URL ist in Produktion für gemeinsame MCP-Rate-Limits erforderlich.");
      }
      this.logger.warn("MCP-Rate-Limiting verwendet den lokalen In-Memory-Speicher.");
      return;
    }
    this.redis = createClient({ url: redisUrl });
    this.redis.on("error", (error) => this.logger.error(`Redis-Fehler im MCP-Rate-Limiter: ${safeError(error)}`));
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) await this.redis.quit();
  }

  async consume(tokenId: string, kind: "read" | "write"): Promise<McpRateLimitResult> {
    const config = getMcpProductionConfig();
    const limit = kind === "write" ? config.writeRateLimit : config.readRateLimit;
    const windowMs = config.rateLimitWindowMs;
    const key = `ad-wiki:mcp:rate:${kind}:${tokenId}`;
    let count: number;
    let ttl: number;
    if (this.redis) {
      try {
        const result = await this.redis.eval(
          "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {c,redis.call('PTTL',KEYS[1])}",
          { keys: [key], arguments: [String(windowMs)] },
        ) as [number, number];
        count = Number(result[0]);
        ttl = Math.max(1, Number(result[1]));
      } catch (error) {
        this.logger.error(`MCP-Rate-Limit konnte nicht geprüft werden: ${safeError(error)}`);
        throw new ServiceUnavailableException("Rate-Limit-Speicher ist nicht verfügbar.");
      }
    } else {
      const now = Date.now();
      const current = this.memory.get(key);
      const bucket = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: current.count + 1, resetAt: current.resetAt };
      this.memory.set(key, bucket);
      count = bucket.count;
      ttl = bucket.resetAt - now;
      if (this.memory.size > 10_000) {
        for (const [entryKey, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(entryKey);
      }
    }
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
    };
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Fehler";
}
