import { BadGatewayException, Injectable, UnauthorizedException } from "@nestjs/common";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 20;

export interface MicrosoftTodoListRecord {
  id: string;
  displayName: string;
  isOwner?: boolean | null;
  wellknownListName?: string | null;
}

export interface MicrosoftTodoTaskRecord {
  id: string;
  title: string;
  status?: string | null;
  importance?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  dueDateTime?: { dateTime?: string | null; timeZone?: string | null } | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
}

export interface CreateMicrosoftTodoTaskRecord {
  title: string;
  body: { contentType: "text" | "html"; content: string };
}

interface GraphPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/** Minimal, read-only Microsoft Graph client for Microsoft To Do imports. */
@Injectable()
export class MicrosoftGraphService {
  listTodoLists(accessToken: string): Promise<MicrosoftTodoListRecord[]> {
    return this.collect<MicrosoftTodoListRecord>(
      `${GRAPH_ROOT}/me/todo/lists`,
      accessToken,
    );
  }

  listTasks(accessToken: string, listId: string): Promise<MicrosoftTodoTaskRecord[]> {
    const encodedId = encodeURIComponent(listId);
    return this.collect<MicrosoftTodoTaskRecord>(
      `${GRAPH_ROOT}/me/todo/lists/${encodedId}/tasks`,
      accessToken,
    );
  }

  async createTask(
    accessToken: string,
    listId: string,
    task: CreateMicrosoftTodoTaskRecord,
  ): Promise<MicrosoftTodoTaskRecord> {
    const url = `${GRAPH_ROOT}/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
    const response = await this.request(url, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task),
    });
    const created = (await response.json()) as MicrosoftTodoTaskRecord;
    if (!created.id) throw new BadGatewayException("Microsoft Graph hat keine Aufgaben-ID zurückgegeben.");
    return created;
  }

  async deleteTask(accessToken: string, listId: string, taskId: string): Promise<void> {
    const url = `${GRAPH_ROOT}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
    await this.request(url, accessToken, { method: "DELETE" }, true);
  }

  async updateTask(
    accessToken: string,
    listId: string,
    taskId: string,
    task: CreateMicrosoftTodoTaskRecord,
  ): Promise<MicrosoftTodoTaskRecord> {
    const url = `${GRAPH_ROOT}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
    const response = await this.request(url, accessToken, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task),
    });
    return (await response.json()) as MicrosoftTodoTaskRecord;
  }

  private async collect<T>(initialUrl: string, accessToken: string): Promise<T[]> {
    const records: T[] = [];
    let url: string | undefined = initialUrl;
    let page = 0;
    while (url && page < MAX_PAGES) {
      const response = await this.request(url, accessToken);
      const body = (await response.json()) as GraphPage<T>;
      records.push(...(Array.isArray(body.value) ? body.value : []));
      url = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : undefined;
      page += 1;
    }
    if (url) throw new BadGatewayException("Die Microsoft-Antwort überschreitet das sichere Seitenlimit.");
    return records;
  }

  private async request(url: string, accessToken: string, init: RequestInit = {}, allowNotFound = false): Promise<Response> {
    this.assertGraphUrl(url);
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new BadGatewayException("Microsoft Graph ist momentan nicht erreichbar.");
    });
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("Die Microsoft-Verbindung muss erneut autorisiert werden.");
    }
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new BadGatewayException(`Microsoft Graph antwortete mit HTTP ${response.status}.`);
    }
    return response;
  }

  private assertGraphUrl(value: string): void {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) {
      throw new BadGatewayException("Microsoft Graph lieferte einen ungültigen Folgelink.");
    }
  }
}
