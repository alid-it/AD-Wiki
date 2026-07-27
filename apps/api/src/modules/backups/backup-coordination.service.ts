import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

const WRITE_BARRIER_KEY = "ad-wiki:backup:write-barrier";
const ACTIVE_WRITES_KEY = "ad-wiki:backup:active-writes";
const WORKER_HEARTBEAT_KEY = "ad-wiki:backup:worker-heartbeat";

const ENTER_WRITE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[1])
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('DECR', KEYS[2])
  return 0
end
return 1
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Verteilte Koordination zwischen API-Instanzen und Backup-Worker. */
@Injectable()
export class BackupCoordinationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupCoordinationService.name);
  private client: RedisClientType | null = null;
  private readonly memoryLocks = new Map<string, { token: string; expiresAt: number }>();
  private memoryActiveWrites = 0;
  private memoryWorkerHeartbeat: Date | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("REDIS_URL ist fuer die Backup-Koordination in Produktion erforderlich.");
      }
      this.logger.warn("Backup-Koordination verwendet den lokalen Entwicklungsmodus ohne Redis.");
      return;
    }
    const client = createClient({ url });
    client.on("error", (error: Error) => this.logger.error(`Redis-Fehler: ${error.message}`));
    await client.connect();
    this.client = client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
    this.client = null;
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const namespaced = this.lockKey(key);
    if (this.client) {
      const result = await this.client.set(namespaced, token, { NX: true, PX: ttlMs });
      return result === "OK" ? token : null;
    }
    this.clearExpiredMemoryLocks();
    if (this.memoryLocks.has(namespaced)) return null;
    this.memoryLocks.set(namespaced, { token, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const namespaced = this.lockKey(key);
    if (this.client) {
      await this.client.eval(RELEASE_SCRIPT, { keys: [namespaced], arguments: [token] });
      return;
    }
    if (this.memoryLocks.get(namespaced)?.token === token) this.memoryLocks.delete(namespaced);
  }

  async enterWrite(): Promise<boolean> {
    if (this.client) {
      const result = await this.client.eval(ENTER_WRITE_SCRIPT, {
        keys: [WRITE_BARRIER_KEY, ACTIVE_WRITES_KEY],
        arguments: [String(6 * 60 * 60 * 1_000)],
      });
      return Number(result) === 1;
    }
    this.clearExpiredMemoryLocks();
    if (this.memoryLocks.has(WRITE_BARRIER_KEY)) return false;
    this.memoryActiveWrites += 1;
    if (this.memoryLocks.has(WRITE_BARRIER_KEY)) {
      this.memoryActiveWrites = Math.max(0, this.memoryActiveWrites - 1);
      return false;
    }
    return true;
  }

  async leaveWrite(): Promise<void> {
    if (this.client) {
      const current = await this.client.decr(ACTIVE_WRITES_KEY);
      if (current < 0) await this.client.set(ACTIVE_WRITES_KEY, "0", { PX: 6 * 60 * 60 * 1_000 });
      return;
    }
    this.memoryActiveWrites = Math.max(0, this.memoryActiveWrites - 1);
  }

  async acquireWriteBarrier(ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    if (this.client) {
      const result = await this.client.set(WRITE_BARRIER_KEY, token, { NX: true, PX: ttlMs });
      return result === "OK" ? token : null;
    }
    this.clearExpiredMemoryLocks();
    if (this.memoryLocks.has(WRITE_BARRIER_KEY)) return null;
    this.memoryLocks.set(WRITE_BARRIER_KEY, { token, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async releaseWriteBarrier(token: string): Promise<void> {
    if (this.client) {
      await this.client.eval(RELEASE_SCRIPT, { keys: [WRITE_BARRIER_KEY], arguments: [token] });
      return;
    }
    if (this.memoryLocks.get(WRITE_BARRIER_KEY)?.token === token) {
      this.memoryLocks.delete(WRITE_BARRIER_KEY);
    }
  }

  async waitForWritesToDrain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (await this.activeWrites() > 0) {
      if (Date.now() >= deadline) throw new Error("Aktive Schreibzugriffe wurden nicht rechtzeitig beendet.");
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  async markOnce(key: string, ttlMs: number): Promise<boolean> {
    const token = await this.acquireLock(`once:${key}`, ttlMs);
    return token !== null;
  }

  /** Hinterlegt einen nicht geheimen Lebensindikator des getrennten Backup-Workers. */
  async recordWorkerHeartbeat(at = new Date()): Promise<void> {
    if (this.client) {
      await this.client.set(WORKER_HEARTBEAT_KEY, at.toISOString());
      return;
    }
    this.memoryWorkerHeartbeat = at;
  }

  /** Liest den letzten Worker-Heartbeat für Statusseite und Monitoring. */
  async workerHeartbeat(): Promise<Date | null> {
    const raw = this.client
      ? await this.client.get(WORKER_HEARTBEAT_KEY)
      : this.memoryWorkerHeartbeat?.toISOString();
    if (!raw) return null;
    const heartbeat = new Date(raw);
    return Number.isNaN(heartbeat.getTime()) ? null : heartbeat;
  }

  /** Prüft die Erreichbarkeit der Koordination ohne Schlüssel oder Nutzdaten offenzulegen. */
  async health(): Promise<{ available: boolean; mode: "native" | "memory" }> {
    if (!this.client) {
      return {
        available: process.env.NODE_ENV !== "production",
        mode: "memory",
      };
    }
    try {
      return {
        available: await this.client.ping() === "PONG",
        mode: "native",
      };
    } catch {
      return { available: false, mode: "native" };
    }
  }

  private async activeWrites(): Promise<number> {
    if (this.client) return Number(await this.client.get(ACTIVE_WRITES_KEY) ?? "0");
    return this.memoryActiveWrites;
  }

  private lockKey(key: string): string {
    return `ad-wiki:backup:lock:${key}`;
  }

  private clearExpiredMemoryLocks(): void {
    const now = Date.now();
    for (const [key, lock] of this.memoryLocks) {
      if (lock.expiresAt <= now) this.memoryLocks.delete(key);
    }
  }
}
