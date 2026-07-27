import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  ConfidentialClientApplication,
  CryptoProvider,
  InteractionRequiredAuthError,
} from "@azure/msal-node";
import {
  IntegrationConnectionStatus,
  IntegrationProvider,
  IntegrationSyncStatus,
  ExternalItemSyncDirection,
  NoteStatus,
  Prisma,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type {
  IntegrationSyncRun,
  MicrosoftConnection,
  MicrosoftTodoList,
  MicrosoftTodoTaskLink,
} from "@ad-wiki/shared-types";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { PrismaService } from "@/prisma/prisma.service";
import { IntegrationEncryptionService } from "./integration-encryption.service";
import {
  MicrosoftGraphService,
  type MicrosoftTodoTaskRecord,
} from "./microsoft-graph.service";

const PROVIDER = IntegrationProvider.MICROSOFT_TODO;
const GRAPH_SCOPES = ["Tasks.ReadWrite"];
const AUTH_SCOPES = ["openid", "profile", "offline_access", ...GRAPH_SCOPES];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type ConnectionRecord = Prisma.IntegrationConnectionGetPayload<Record<string, never>>;
type MappingRecord = Prisma.ExternalItemMappingGetPayload<Record<string, never>>;

@Injectable()
export class MicrosoftIntegrationService {
  private readonly logger = new Logger(MicrosoftIntegrationService.name);
  private readonly syncingConnections = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: IntegrationEncryptionService,
    private readonly graph: MicrosoftGraphService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Interval(60_000)
  async autoSync(): Promise<void> {
    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        provider: PROVIDER,
        status: IntegrationConnectionStatus.ACTIVE,
        encryptedTokenCache: { not: null },
        selectedListIds: { isEmpty: false },
      },
      select: { userId: true },
    });
    for (const item of connections) {
      const connection = await this.requireActiveConnection(item.userId).catch(() => null);
      if (!connection || this.syncingConnections.has(connection.id)) continue;
      this.syncingConnections.add(connection.id);
      try {
        await this.performSync(connection, item.userId, undefined, true);
      } catch (error) {
        this.logger.warn(`Microsoft-Autosync fehlgeschlagen (${connection.id}): ${this.safeError(error)}`);
      } finally {
        this.syncingConnections.delete(connection.id);
      }
    }
  }

  async status(userId: string): Promise<MicrosoftConnection> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    return this.toStatus(connection);
  }

  async startOAuth(userId: string): Promise<{ authorizationUrl: string }> {
    this.requireConfiguration();
    const state = randomBytes(32).toString("base64url");
    const pkce = await new CryptoProvider().generatePkceCodes();
    await this.prisma.$transaction([
      this.prisma.integrationOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.integrationOAuthState.create({
        data: {
          userId,
          provider: PROVIDER,
          stateHash: this.hashState(state),
          encryptedCodeVerifier: this.encryption.encrypt(pkce.verifier),
          expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        },
      }),
    ]);
    const app = this.createMsalClient();
    const authorizationUrl = await app.getAuthCodeUrl({
      scopes: AUTH_SCOPES,
      redirectUri: this.redirectUri(),
      state,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      prompt: "select_account",
    });
    return { authorizationUrl };
  }

  async completeOAuth(code: string, state: string, ipAddress?: string): Promise<void> {
    this.requireConfiguration();
    const stateHash = this.hashState(state);
    const oauthState = await this.prisma.integrationOAuthState.findUnique({ where: { stateHash } });
    if (!oauthState || oauthState.provider !== PROVIDER || oauthState.expiresAt <= new Date()) {
      if (oauthState) await this.prisma.integrationOAuthState.delete({ where: { id: oauthState.id } });
      throw new BadRequestException("Der Microsoft-Anmeldevorgang ist ungültig oder abgelaufen.");
    }
    await this.prisma.integrationOAuthState.delete({ where: { id: oauthState.id } });
    const app = this.createMsalClient();
    const result = await app.acquireTokenByCode({
      code,
      scopes: AUTH_SCOPES,
      redirectUri: this.redirectUri(),
      codeVerifier: this.encryption.decrypt(oauthState.encryptedCodeVerifier),
    });
    const account = result.account;
    if (!account) throw new UnauthorizedException("Microsoft hat kein verwendbares Benutzerkonto zurückgegeben.");
    const encryptedTokenCache = this.encryption.encrypt(app.getTokenCache().serialize());
    const connection = await this.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId: oauthState.userId, provider: PROVIDER } },
      create: {
        userId: oauthState.userId,
        provider: PROVIDER,
        encryptedTokenCache,
        scopes: result.scopes,
        status: IntegrationConnectionStatus.ACTIVE,
        externalAccountId: account.homeAccountId,
        externalAccountName: account.username || account.name || null,
        expiresAt: result.expiresOn ?? null,
      },
      update: {
        encryptedTokenCache,
        scopes: result.scopes,
        status: IntegrationConnectionStatus.ACTIVE,
        externalAccountId: account.homeAccountId,
        externalAccountName: account.username || account.name || null,
        expiresAt: result.expiresOn ?? null,
      },
    });
    await this.audit.log(oauthState.userId, "integration.connected", "integration", connection.id, {
      provider: "microsoft_todo",
      scopes: result.scopes,
    }, ipAddress);
  }

  async discardOAuthState(state: string): Promise<void> {
    if (!state) return;
    await this.prisma.integrationOAuthState.deleteMany({ where: { stateHash: this.hashState(state) } });
  }

  async lists(userId: string): Promise<MicrosoftTodoList[]> {
    const connection = await this.requireActiveConnection(userId);
    const accessToken = await this.accessToken(connection);
    const lists = await this.graph.listTodoLists(accessToken);
    const selected = new Set(connection.selectedListIds);
    return lists.map((list) => ({
      id: list.id,
      displayName: list.displayName,
      isOwner: list.isOwner ?? null,
      wellknownListName: list.wellknownListName ?? null,
      selected: selected.has(list.id),
    }));
  }

  async selectLists(userId: string, listIds: string[]): Promise<MicrosoftConnection> {
    const connection = await this.requireActiveConnection(userId);
    const accessToken = await this.accessToken(connection);
    const available = await this.graph.listTodoLists(accessToken);
    const availableIds = new Set(available.map((list) => list.id));
    if (listIds.some((id) => !availableIds.has(id))) {
      throw new BadRequestException("Mindestens eine gewählte Microsoft-To-Do-Liste existiert nicht oder ist nicht zugänglich.");
    }
    const updated = await this.prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { selectedListIds: [...new Set(listIds)] },
    });
    return this.toStatus(updated);
  }

  async exportNote(
    userId: string,
    noteId: string,
    listId: string,
    ipAddress?: string,
  ): Promise<MicrosoftTodoTaskLink> {
    const connection = await this.requireActiveConnection(userId);
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, ownerId: userId, deletedAt: null },
      select: { id: true, title: true, content: true, updatedAt: true },
    });
    if (!note) throw new NotFoundException("Eigene Notiz wurde nicht gefunden.");
    const existing = await this.prisma.externalItemMapping.findUnique({
      where: {
        connectionId_localResourceType_localResourceId: {
          connectionId: connection.id,
          localResourceType: "note",
          localResourceId: note.id,
        },
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException("Diese Notiz ist bereits mit Microsoft To Do verknüpft.");

    const accessToken = await this.accessToken(connection);
    if (!connection.selectedListIds.includes(listId)) {
      throw new BadRequestException("Die gewählte Liste ist in den Integrationseinstellungen nicht für den Sync ausgewählt.");
    }
    const availableLists = await this.graph.listTodoLists(accessToken);
    if (!availableLists.some((list) => list.id === listId)) {
      throw new BadRequestException("Die gewählte Microsoft-To-Do-Liste existiert nicht oder ist nicht zugänglich.");
    }
    const title = this.noteTitle(note);
    const createdTask = await this.graph.createTask(accessToken, listId, {
      title,
      body: this.noteBody(note.content),
    });
    try {
      const mapping = await this.prisma.externalItemMapping.create({
        data: {
          connectionId: connection.id,
          provider: PROVIDER,
          externalId: createdTask.id,
          externalListId: listId,
          localResourceType: "note",
          localResourceId: note.id,
          direction: ExternalItemSyncDirection.EXPORT,
          lastLocalHash: this.localHash(note),
          lastExternalHash: this.externalHash(createdTask),
          localUpdatedAt: note.updatedAt,
          externalUpdatedAt: this.externalUpdatedAt(createdTask),
        },
      });
      await this.audit.log(userId, "integration.note_exported", "integration", connection.id, {
        provider: "microsoft_todo",
        noteId: note.id,
        listId,
        mappingId: mapping.id,
      }, ipAddress);
      return {
        mappingId: mapping.id,
        noteId: note.id,
        listId,
        externalTaskId: createdTask.id,
        createdAt: mapping.createdAt.toISOString(),
      };
    } catch (error) {
      await this.graph.deleteTask(accessToken, listId, createdTask.id).catch(() => undefined);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Diese Notiz ist bereits mit Microsoft To Do verknüpft.");
      }
      throw error;
    }
  }

  async sync(userId: string, ipAddress?: string): Promise<IntegrationSyncRun> {
    const connection = await this.requireActiveConnection(userId);
    if (connection.selectedListIds.length === 0) {
      throw new BadRequestException("Wähle vor der Synchronisierung mindestens eine Microsoft-To-Do-Liste aus.");
    }
    if (this.syncingConnections.has(connection.id)) {
      throw new ConflictException("Für diese Microsoft-Verbindung läuft bereits eine Synchronisierung.");
    }
    this.syncingConnections.add(connection.id);
    try {
      return await this.performSync(connection, userId, ipAddress, false);
    } finally {
      this.syncingConnections.delete(connection.id);
    }
  }

  private async performSync(
    connection: ConnectionRecord,
    userId: string,
    ipAddress: string | undefined,
    automatic: boolean,
  ): Promise<IntegrationSyncRun> {
    const run = await this.prisma.integrationSyncRun.create({ data: { connectionId: connection.id } });
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    try {
      const accessToken = await this.accessToken(connection);
      const lists = await this.graph.listTodoLists(accessToken);
      const listNames = new Map(lists.map((list) => [list.id, list.displayName]));
      const tasksByExternalId = new Map<string, { listId: string; listName: string; task: MicrosoftTodoTaskRecord }>();
      const fetchedListIds = new Set<string>();
      for (const listId of connection.selectedListIds) {
        if (!listNames.has(listId)) {
          failedCount += 1;
          continue;
        }
        const tasks = await this.graph.listTasks(accessToken, listId);
        fetchedListIds.add(listId);
        for (const task of tasks) {
          tasksByExternalId.set(task.id, { listId, listName: listNames.get(listId)!, task });
        }
      }

      const mappings = await this.prisma.externalItemMapping.findMany({
        where: {
          connectionId: connection.id,
          localResourceType: "note",
          externalListId: { in: connection.selectedListIds },
        },
      });
      const mappingsByExternalId = new Map(mappings.map((mapping) => [mapping.externalId, mapping]));
      const processedMappings = new Set<string>();

      for (const { listId, listName, task } of tasksByExternalId.values()) {
        const mapping = mappingsByExternalId.get(task.id);
        if (!mapping) {
          const imported = await this.importTask(connection.id, userId, listId, listName, task);
          if (imported) importedCount += 1;
          else skippedCount += 1;
          continue;
        }
        processedMappings.add(mapping.id);
        if (mapping.detachedAt) {
          skippedCount += 1;
          continue;
        }
        const outcome = await this.reconcileTask(mapping, task, accessToken, userId);
        if (outcome === "updated") updatedCount += 1;
        else if (outcome === "deleted") deletedCount += 1;
        else skippedCount += 1;
      }

      for (const mapping of mappings) {
        if (processedMappings.has(mapping.id) || mapping.detachedAt || mapping.externalDeletedAt || !mapping.externalListId || !fetchedListIds.has(mapping.externalListId)) continue;
        const note = await this.prisma.note.findUnique({
          where: { id: mapping.localResourceId },
          select: { id: true, title: true, ownerId: true, deletedAt: true, shares: { select: { userId: true } } },
        });
        if (!note || note.deletedAt) {
          skippedCount += 1;
          continue;
        }
        const deletedAt = new Date();
        await this.prisma.$transaction([
          this.prisma.note.update({ where: { id: note.id }, data: { deletedAt, deletedById: userId } }),
          this.prisma.externalItemMapping.update({
            where: { id: mapping.id },
            data: { externalDeletedAt: deletedAt, lastSyncedAt: deletedAt },
          }),
        ]);
        this.notifyNote(note, userId, "deleted");
        deletedCount += 1;
      }

      const finishedAt = new Date();
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: finishedAt } });
        return tx.integrationSyncRun.update({
          where: { id: run.id },
          data: { status: IntegrationSyncStatus.SUCCEEDED, importedCount, skippedCount, failedCount, updatedCount, deletedCount, finishedAt },
        });
      });
      const changed = importedCount + updatedCount + deletedCount;
      if (automatic && changed === 0 && failedCount === 0) {
        await this.prisma.integrationSyncRun.delete({ where: { id: run.id } });
      }
      if (!automatic || changed > 0 || failedCount > 0) {
        await this.audit.log(userId, "integration.synced", "integration", connection.id, {
          provider: "microsoft_todo", automatic, importedCount, updatedCount, deletedCount, skippedCount, failedCount,
        }, ipAddress);
      }
      return this.toSyncRun(updated);
    } catch (error) {
      const message = this.safeError(error);
      await this.prisma.integrationSyncRun.update({
        where: { id: run.id },
        data: { status: IntegrationSyncStatus.FAILED, importedCount, skippedCount, failedCount, updatedCount, deletedCount, error: message, finishedAt: new Date() },
      });
      await this.audit.log(userId, "integration.sync_failed", "integration", connection.id, {
        provider: "microsoft_todo", automatic, importedCount, updatedCount, deletedCount, skippedCount, failedCount,
      }, ipAddress);
      if (error instanceof Error) throw error;
      throw new InternalServerErrorException("Die Microsoft-Synchronisierung ist fehlgeschlagen.");
    }
  }

  async syncRuns(userId: string): Promise<IntegrationSyncRun[]> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
      select: { id: true },
    });
    if (!connection) return [];
    const runs = await this.prisma.integrationSyncRun.findMany({
      where: { connectionId: connection.id },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    return runs.map((run) => this.toSyncRun(run));
  }

  async handlePermanentNoteDeletion(
    userId: string,
    noteId: string,
    deleteExternal: boolean,
    ipAddress?: string,
  ): Promise<void> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    if (!connection) return;
    const mapping = await this.prisma.externalItemMapping.findUnique({
      where: {
        connectionId_localResourceType_localResourceId: {
          connectionId: connection.id,
          localResourceType: "note",
          localResourceId: noteId,
        },
      },
    });
    if (!mapping) return;
    if (deleteExternal && !mapping.externalDeletedAt && !mapping.detachedAt) {
      if (!mapping.externalListId || connection.status !== IntegrationConnectionStatus.ACTIVE || !connection.encryptedTokenCache) {
        throw new ConflictException("Die Microsoft-Aufgabe kann ohne aktive Verbindung nicht gelöscht werden.");
      }
      const accessToken = await this.accessToken(connection);
      await this.graph.deleteTask(accessToken, mapping.externalListId, mapping.externalId);
      await this.prisma.externalItemMapping.delete({ where: { id: mapping.id } });
    } else {
      await this.prisma.externalItemMapping.update({
        where: { id: mapping.id },
        data: { detachedAt: new Date(), lastSyncedAt: new Date() },
      });
    }
    await this.audit.log(userId, "integration.note_unlinked", "integration", connection.id, {
      provider: "microsoft_todo", noteId, deleteExternal,
    }, ipAddress);
  }

  async disconnect(userId: string, ipAddress?: string): Promise<MicrosoftConnection> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    if (!connection) throw new NotFoundException("Es besteht keine Microsoft-Verbindung.");
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.integrationOAuthState.deleteMany({ where: { userId, provider: PROVIDER } });
      return tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          encryptedTokenCache: null,
          status: IntegrationConnectionStatus.DISCONNECTED,
          externalAccountId: null,
          externalAccountName: null,
          scopes: [],
          selectedListIds: [],
          expiresAt: null,
        },
      });
    });
    await this.audit.log(userId, "integration.disconnected", "integration", connection.id, {
      provider: "microsoft_todo",
    }, ipAddress);
    return this.toStatus(updated);
  }

  webRedirect(result: "connected" | "denied" | "error"): string {
    const base = (process.env.WEB_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
    return `${base}/settings/integrations?microsoft=${result}`;
  }

  private async accessToken(connection: ConnectionRecord): Promise<string> {
    if (!connection.encryptedTokenCache || !connection.externalAccountId) {
      throw new UnauthorizedException("Die Microsoft-Verbindung muss erneut hergestellt werden.");
    }
    const app = this.createMsalClient();
    app.getTokenCache().deserialize(this.encryption.decrypt(connection.encryptedTokenCache));
    const accounts = await app.getTokenCache().getAllAccounts();
    const account = accounts.find((candidate) => candidate.homeAccountId === connection.externalAccountId);
    if (!account) {
      await this.markNeedsReauth(connection.id);
      throw new UnauthorizedException("Die Microsoft-Verbindung muss erneut hergestellt werden.");
    }
    try {
      const result = await app.acquireTokenSilent({ account, scopes: GRAPH_SCOPES });
      if (!result?.accessToken) {
        await this.markNeedsReauth(connection.id);
        throw new UnauthorizedException("Die Microsoft-Verbindung muss erneut autorisiert werden.");
      }
      const serialized = app.getTokenCache().serialize();
      await this.prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          encryptedTokenCache: this.encryption.encrypt(serialized),
          status: IntegrationConnectionStatus.ACTIVE,
          expiresAt: result.expiresOn ?? null,
        },
      });
      return result.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        await this.markNeedsReauth(connection.id);
        throw new UnauthorizedException("Die Microsoft-Verbindung muss erneut autorisiert werden.");
      }
      throw error;
    }
  }

  private async reconcileTask(
    mapping: MappingRecord,
    task: MicrosoftTodoTaskRecord,
    accessToken: string,
    userId: string,
  ): Promise<"updated" | "deleted" | "skipped"> {
    const note = await this.prisma.note.findUnique({
      where: { id: mapping.localResourceId },
      select: {
        id: true,
        title: true,
        content: true,
        updatedAt: true,
        deletedAt: true,
        ownerId: true,
        shares: { select: { userId: true } },
      },
    });
    if (!note || note.deletedAt) return "skipped";

    const localHash = this.localHash(note);
    const externalHash = this.externalHash(task);
    const externalUpdatedAt = this.externalUpdatedAt(task);
    if (!mapping.lastLocalHash || !mapping.lastExternalHash) {
      await this.prisma.externalItemMapping.update({
        where: { id: mapping.id },
        data: { lastLocalHash: localHash, lastExternalHash: externalHash, localUpdatedAt: note.updatedAt, externalUpdatedAt, externalDeletedAt: null, lastSyncedAt: new Date() },
      });
      return "skipped";
    }

    const localChanged = localHash !== mapping.lastLocalHash;
    const externalChanged = externalHash !== mapping.lastExternalHash;
    if (!localChanged && !externalChanged) {
      await this.prisma.externalItemMapping.update({ where: { id: mapping.id }, data: { lastSyncedAt: new Date() } });
      return "skipped";
    }

    const externalWins = externalChanged && (!localChanged || externalUpdatedAt > note.updatedAt);
    if (externalWins) {
      const updatedNote = await this.prisma.note.update({
        where: { id: note.id },
        data: {
          title: task.title?.trim().slice(0, 200) || "Microsoft-To-Do-Aufgabe",
          content: this.taskContent(task),
        },
        select: { id: true, title: true, content: true, updatedAt: true },
      });
      await this.prisma.externalItemMapping.update({
        where: { id: mapping.id },
        data: {
          lastLocalHash: this.localHash(updatedNote),
          lastExternalHash: externalHash,
          localUpdatedAt: updatedNote.updatedAt,
          externalUpdatedAt,
          externalDeletedAt: null,
          lastSyncedAt: new Date(),
        },
      });
      this.notifyNote(note, userId, "updated");
      return "updated";
    }

    const updatedTask = await this.graph.updateTask(accessToken, mapping.externalListId!, task.id, {
      title: this.noteTitle(note),
      body: this.noteBody(note.content),
    });
    await this.prisma.externalItemMapping.update({
      where: { id: mapping.id },
      data: {
        lastLocalHash: localHash,
        lastExternalHash: this.externalHash(updatedTask),
        localUpdatedAt: note.updatedAt,
        externalUpdatedAt: this.externalUpdatedAt(updatedTask),
        externalDeletedAt: null,
        lastSyncedAt: new Date(),
      },
    });
    return "updated";
  }

  private async importTask(
    connectionId: string,
    userId: string,
    listId: string,
    _listName: string,
    task: MicrosoftTodoTaskRecord,
  ): Promise<boolean> {
    if (!task.id) return false;
    try {
      const note = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.externalItemMapping.findUnique({
          where: { connectionId_externalId: { connectionId, externalId: task.id } },
          select: { id: true },
        });
        if (existing) {
          await tx.externalItemMapping.update({ where: { id: existing.id }, data: { lastSyncedAt: new Date() } });
          return null;
        }
        const note = await tx.note.create({
          data: {
            ownerId: userId,
            title: task.title?.trim() || "Microsoft-To-Do-Aufgabe",
            content: this.taskContent(task),
            status: NoteStatus.CAPTURED,
            mcpVisible: false,
          },
        });
        await tx.externalItemMapping.create({
          data: {
            connectionId,
            provider: PROVIDER,
            externalId: task.id,
            externalListId: listId,
            localResourceType: "note",
            localResourceId: note.id,
            direction: ExternalItemSyncDirection.IMPORT,
            lastLocalHash: this.localHash(note),
            lastExternalHash: this.externalHash(task),
            localUpdatedAt: note.updatedAt,
            externalUpdatedAt: this.externalUpdatedAt(task),
          },
        });
        return note;
      });
      if (!note) return false;
      this.notifyNote({ ...note, shares: [] }, userId, "created");
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }

  private taskContent(task: MicrosoftTodoTaskRecord): string {
    const body = task.body?.content?.trim() ?? "";
    return body || task.title?.trim() || "Microsoft-To-Do-Aufgabe";
  }

  private noteBody(content: string): { contentType: "text" | "html"; content: string } {
    const trimmed = content.trim();
    return {
      contentType: /^<([a-z][a-z0-9]*)\b[^>]*>/i.test(trimmed) ? "html" : "text",
      content: trimmed.slice(0, 65_000),
    };
  }

  private noteTitle(note: { title: string | null; content: string }): string {
    const plainContent = note.content
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
    return (note.title?.trim() || plainContent || "AD-Wiki-Notiz").slice(0, 200);
  }

  private localHash(note: { title: string | null; content: string }): string {
    return createHash("sha256").update(JSON.stringify({ title: note.title?.trim() || "", content: note.content })).digest("hex");
  }

  private externalHash(task: MicrosoftTodoTaskRecord): string {
    return createHash("sha256").update(JSON.stringify({ title: task.title?.trim() || "", content: this.taskContent(task) })).digest("hex");
  }

  private externalUpdatedAt(task: MicrosoftTodoTaskRecord): Date {
    const parsed = task.lastModifiedDateTime ? new Date(task.lastModifiedDateTime) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private notifyNote(
    note: { id: string; title: string | null; ownerId: string; shares: Array<{ userId: string }> },
    userId: string,
    action: "created" | "updated" | "deleted",
  ): void {
    this.notifications.notifyNoteChanged(
      note,
      { id: userId, displayName: "Microsoft To Do" },
      action,
      [note.ownerId, ...note.shares.map((share) => share.userId)],
    );
  }

  private async requireActiveConnection(userId: string): Promise<ConnectionRecord> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    if (!connection || connection.status === IntegrationConnectionStatus.DISCONNECTED || !connection.encryptedTokenCache) {
      throw new NotFoundException("Es besteht keine aktive Microsoft-Verbindung.");
    }
    return connection;
  }

  private createMsalClient(): ConfidentialClientApplication {
    this.requireConfiguration();
    return new ConfidentialClientApplication({
      auth: {
        clientId: process.env.MICROSOFT_CLIENT_ID!.trim(),
        authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID!.trim()}`,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
      },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined } },
    });
  }

  private requireConfiguration(): void {
    const required = ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URI"];
    if (required.some((name) => !process.env[name]?.trim()) || !this.encryption.isConfigured()) {
      throw new InternalServerErrorException("Die Microsoft-Integration ist serverseitig nicht vollständig konfiguriert.");
    }
  }

  private redirectUri(): string {
    return process.env.MICROSOFT_REDIRECT_URI!.trim();
  }

  private hashState(state: string): string {
    return createHash("sha256").update(state, "utf8").digest("hex");
  }

  private markNeedsReauth(id: string): Promise<ConnectionRecord> {
    return this.prisma.integrationConnection.update({
      where: { id },
      data: { status: IntegrationConnectionStatus.NEEDS_REAUTH },
    });
  }

  private isConfigured(): boolean {
    return ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URI"]
      .every((name) => Boolean(process.env[name]?.trim())) && this.encryption.isConfigured();
  }

  private toStatus(connection: ConnectionRecord | null): MicrosoftConnection {
    const status = !connection || connection.status === IntegrationConnectionStatus.DISCONNECTED
      ? "disconnected"
      : connection.status === IntegrationConnectionStatus.ACTIVE
        ? "active"
        : connection.status === IntegrationConnectionStatus.NEEDS_REAUTH
          ? "needs_reauth"
          : "error";
    return {
      configured: this.isConfigured(),
      connected: status !== "disconnected",
      status,
      accountName: connection?.externalAccountName ?? null,
      scopes: connection?.scopes ?? [],
      selectedListIds: connection?.selectedListIds ?? [],
      expiresAt: connection?.expiresAt?.toISOString() ?? null,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      createdAt: connection?.createdAt.toISOString() ?? null,
      updatedAt: connection?.updatedAt.toISOString() ?? null,
    };
  }

  private toSyncRun(run: {
    id: string;
    status: IntegrationSyncStatus;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    updatedCount: number;
    deletedCount: number;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  }): IntegrationSyncRun {
    return {
      id: run.id,
      status: run.status === IntegrationSyncStatus.RUNNING ? "running" : run.status === IntegrationSyncStatus.SUCCEEDED ? "succeeded" : "failed",
      importedCount: run.importedCount,
      skippedCount: run.skippedCount,
      failedCount: run.failedCount,
      updatedCount: run.updatedCount,
      deletedCount: run.deletedCount,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  private safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : "Unbekannter Synchronisierungsfehler";
    return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 1000);
  }
}
