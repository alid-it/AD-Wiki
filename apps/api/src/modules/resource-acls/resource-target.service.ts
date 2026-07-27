import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CategoryScope, SpaceVisibility } from "@prisma/client";
import {
  PERMISSION_CATALOG,
  type Action,
  type Resource,
  type ResourceAclTargetType,
  type ResourceAclTargetRef,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";

export interface ResolvedResourceTarget extends ResourceAclTargetRef {
  key: string;
  allowedResources: Resource[];
}

export interface ResolvedTargetHierarchy {
  path: ResolvedResourceTarget[];
  spaceVisibility: "open" | "restricted" | null;
  personalNote: {
    ownerId: string;
    shares: Array<{ userId: string; permission: "VIEW" | "EDIT" }>;
  } | null;
}

const CONTENT_RESOURCES: Resource[] = [
  "pages",
  "categories",
  "notes",
  "standards",
  "spaces",
];

@Injectable()
export class ResourceTargetService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    type: ResourceAclTargetType,
    id: string,
  ): Promise<ResolvedResourceTarget> {
    switch (type) {
      case "space": {
        const value = await this.prisma.knowledgeSpace.findUnique({
          where: { id },
          select: { id: true, name: true },
        });
        if (!value) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
        return this.target("space", value.id, value.name, CONTENT_RESOURCES);
      }
      case "category": {
        const value = await this.prisma.category.findUnique({
          where: { id },
          select: { id: true, name: true, scope: true },
        });
        if (!value) throw new NotFoundException("Kategorie wurde nicht gefunden.");
        return this.target(
          "category",
          value.id,
          value.name,
          ["categories", this.resourceForScope(value.scope)],
        );
      }
      case "page": {
        const value = await this.prisma.page.findUnique({
          where: { id },
          select: { id: true, title: true },
        });
        if (!value) throw new NotFoundException("Wiki-Eintrag wurde nicht gefunden.");
        return this.target("page", value.id, value.title, ["pages"]);
      }
      case "note": {
        const value = await this.prisma.note.findUnique({
          where: { id },
          select: { id: true, title: true },
        });
        if (!value) throw new NotFoundException("Notiz wurde nicht gefunden.");
        return this.target("note", value.id, value.title ?? "Unbenannte Notiz", ["notes"]);
      }
      case "standard": {
        const value = await this.prisma.standard.findUnique({
          where: { id },
          select: { id: true, title: true },
        });
        if (!value) throw new NotFoundException("Richtlinie wurde nicht gefunden.");
        return this.target("standard", value.id, value.title, ["standards"]);
      }
    }
  }

  async resolveHierarchy(
    type: ResourceAclTargetType,
    id: string,
  ): Promise<ResolvedTargetHierarchy> {
    switch (type) {
      case "space":
        return this.spaceHierarchy(id);
      case "category":
        return this.categoryHierarchy(id);
      case "page":
        return this.pageHierarchy(id);
      case "note":
        return this.noteHierarchy(id);
      case "standard":
        return this.standardHierarchy(id);
    }
  }

  /**
   * Löst gleichartige ACL-Ziele gebündelt auf. Listen- und Suchpfade können
   * dadurch ihre Kandidaten vor Sortierung und Pagination auf erlaubte IDs
   * begrenzen, ohne pro Datensatz eine eigene Hierarchieabfrage auszuführen.
   */
  async resolveHierarchies(
    type: ResourceAclTargetType,
    ids: readonly string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    switch (type) {
      case "space":
        return this.spaceHierarchies(uniqueIds);
      case "category":
        return this.categoryHierarchies(uniqueIds);
      case "page":
        return this.pageHierarchies(uniqueIds);
      case "note":
        return this.noteHierarchies(uniqueIds);
      case "standard":
        return this.standardHierarchies(uniqueIds);
    }
  }

  assertActionSupported(
    target: ResolvedResourceTarget,
    action: Action,
  ): void {
    const supported = target.allowedResources.some((resource) =>
      (PERMISSION_CATALOG[resource] as readonly Action[]).includes(action),
    );
    if (!supported) {
      throw new BadRequestException(
        `Die Aktion "${action}" wird für dieses ACL-Ziel nicht unterstützt.`,
      );
    }
  }

  assertResourceMatches(
    target: ResolvedResourceTarget,
    resource: Resource,
  ): void {
    if (!target.allowedResources.includes(resource)) {
      throw new BadRequestException(
        `Die Ressource "${resource}" passt nicht zum ACL-Ziel "${target.type}".`,
      );
    }
  }

  key(type: ResourceAclTargetType, id: string): string {
    return `${type}:${id}`;
  }

  private async spaceHierarchy(id: string): Promise<ResolvedTargetHierarchy> {
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id },
      select: { id: true, name: true, visibility: true },
    });
    if (!space) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    return {
      path: [this.target("space", space.id, space.name, CONTENT_RESOURCES)],
      spaceVisibility: this.visibility(space.visibility),
      personalNote: null,
    };
  }

  private async spaceHierarchies(
    ids: string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const spaces = await this.prisma.knowledgeSpace.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, visibility: true },
    });
    return new Map(
      spaces.map((space) => [
        space.id,
        {
          path: [
            this.target("space", space.id, space.name, CONTENT_RESOURCES),
          ],
          spaceVisibility: this.visibility(space.visibility),
          personalNote: null,
        },
      ]),
    );
  }

  private async categoryHierarchy(id: string): Promise<ResolvedTargetHierarchy> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        scope: true,
        space: { select: { id: true, name: true, visibility: true } },
      },
    });
    if (!category) throw new NotFoundException("Kategorie wurde nicht gefunden.");
    const resource = this.resourceForScope(category.scope);
    return {
      path: [
        this.target("category", category.id, category.name, ["categories", resource]),
        this.target("space", category.space.id, category.space.name, CONTENT_RESOURCES),
      ],
      spaceVisibility: this.visibility(category.space.visibility),
      personalNote: null,
    };
  }

  private async categoryHierarchies(
    ids: string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        scope: true,
        space: { select: { id: true, name: true, visibility: true } },
      },
    });
    return new Map(
      categories.map((category) => {
        const resource = this.resourceForScope(category.scope);
        return [
          category.id,
          {
            path: [
              this.target("category", category.id, category.name, [
                "categories",
                resource,
              ]),
              this.target(
                "space",
                category.space.id,
                category.space.name,
                CONTENT_RESOURCES,
              ),
            ],
            spaceVisibility: this.visibility(category.space.visibility),
            personalNote: null,
          },
        ];
      }),
    );
  }

  private async pageHierarchy(id: string): Promise<ResolvedTargetHierarchy> {
    const path: ResolvedResourceTarget[] = [];
    const visited = new Set<string>();
    let currentId: string | null = id;
    let categoryId: string | null = null;
    let spaceId: string | null = null;

    while (currentId) {
      if (visited.has(currentId) || visited.size >= 100) {
        throw new BadRequestException("Die Wiki-Elternkette ist zyklisch oder zu tief.");
      }
      visited.add(currentId);
      const page: {
        id: string;
        title: string;
        parentId: string | null;
        categoryId: string | null;
        spaceId: string;
      } | null = await this.prisma.page.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          title: true,
          parentId: true,
          categoryId: true,
          spaceId: true,
        },
      });
      if (!page) {
        throw new NotFoundException(
          currentId === id
            ? "Wiki-Eintrag wurde nicht gefunden."
            : "Ein Elternordner wurde nicht gefunden.",
        );
      }
      if (spaceId && page.spaceId !== spaceId) {
        throw new BadRequestException("Die Wiki-Elternkette überschreitet einen Bereich.");
      }
      spaceId = page.spaceId;
      if (visited.size > 1 && page.categoryId !== categoryId) {
        throw new BadRequestException(
          "Die Wiki-Elternkette überschreitet eine Kategorie.",
        );
      }
      categoryId ??= page.categoryId;
      path.push(this.target("page", page.id, page.title, ["pages"]));
      currentId = page.parentId;
    }

    if (!spaceId) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true, name: true, spaceId: true },
      });
      if (!category || category.spaceId !== spaceId) {
        throw new BadRequestException("Wiki-Kategorie und Bereich stimmen nicht überein.");
      }
      path.push(this.target("category", category.id, category.name, ["categories", "pages"]));
    }
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: spaceId },
      select: { id: true, name: true, visibility: true },
    });
    if (!space) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    path.push(this.target("space", space.id, space.name, CONTENT_RESOURCES));
    return {
      path,
      spaceVisibility: this.visibility(space.visibility),
      personalNote: null,
    };
  }

  private async pageHierarchies(
    ids: string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const candidates = await this.prisma.page.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        parentId: true,
        categoryId: true,
        spaceId: true,
      },
    });
    if (candidates.length === 0) return new Map();
    const spaceIds = [...new Set(candidates.map((page) => page.spaceId))];
    const allPages = await this.prisma.page.findMany({
      where: { spaceId: { in: spaceIds } },
      select: {
        id: true,
        title: true,
        parentId: true,
        categoryId: true,
        spaceId: true,
      },
    });
    const categoryIds = [
      ...new Set(
        candidates
          .map((page) => page.categoryId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const [categories, spaces] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, spaceId: true },
      }),
      this.prisma.knowledgeSpace.findMany({
        where: { id: { in: spaceIds } },
        select: { id: true, name: true, visibility: true },
      }),
    ]);
    const pagesById = new Map(allPages.map((page) => [page.id, page]));
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const spacesById = new Map(spaces.map((space) => [space.id, space]));
    const result = new Map<string, ResolvedTargetHierarchy>();

    for (const candidate of candidates) {
      const path: ResolvedResourceTarget[] = [];
      const visited = new Set<string>();
      let current:
        | {
            id: string;
            title: string;
            parentId: string | null;
            categoryId: string | null;
            spaceId: string;
          }
        | undefined = candidate;
      while (current) {
        if (visited.has(current.id) || visited.size >= 100) {
          throw new BadRequestException(
            "Die Wiki-Elternkette ist zyklisch oder zu tief.",
          );
        }
        if (
          current.spaceId !== candidate.spaceId ||
          current.categoryId !== candidate.categoryId
        ) {
          throw new BadRequestException(
            "Die Wiki-Elternkette überschreitet einen Bereich oder eine Kategorie.",
          );
        }
        visited.add(current.id);
        path.push(this.target("page", current.id, current.title, ["pages"]));
        if (!current.parentId) break;
        current = pagesById.get(current.parentId);
        if (!current) {
          throw new BadRequestException(
            "Ein Elternordner der Wiki-Hierarchie fehlt.",
          );
        }
      }

      if (candidate.categoryId) {
        const category = categoriesById.get(candidate.categoryId);
        if (!category || category.spaceId !== candidate.spaceId) {
          throw new BadRequestException(
            "Wiki-Kategorie und Bereich stimmen nicht überein.",
          );
        }
        path.push(
          this.target("category", category.id, category.name, [
            "categories",
            "pages",
          ]),
        );
      }
      const space = spacesById.get(candidate.spaceId);
      if (!space) continue;
      path.push(
        this.target("space", space.id, space.name, CONTENT_RESOURCES),
      );
      result.set(candidate.id, {
        path,
        spaceVisibility: this.visibility(space.visibility),
        personalNote: null,
      });
    }
    return result;
  }

  private async noteHierarchy(id: string): Promise<ResolvedTargetHierarchy> {
    const note = await this.prisma.note.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        ownerId: true,
        spaceId: true,
        categoryId: true,
        shares: { select: { userId: true, permission: true } },
      },
    });
    if (!note) throw new NotFoundException("Notiz wurde nicht gefunden.");
    const path = [
      this.target("note", note.id, note.title ?? "Unbenannte Notiz", ["notes"]),
    ];
    if (!note.spaceId) {
      return {
        path,
        spaceVisibility: null,
        personalNote: {
          ownerId: note.ownerId,
          shares: note.shares,
        },
      };
    }
    if (note.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: note.categoryId },
        select: { id: true, name: true, spaceId: true },
      });
      if (!category || category.spaceId !== note.spaceId) {
        throw new BadRequestException("Notizkategorie und Bereich stimmen nicht überein.");
      }
      path.push(this.target("category", category.id, category.name, ["categories", "notes"]));
    }
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: note.spaceId },
      select: { id: true, name: true, visibility: true },
    });
    if (!space) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    path.push(this.target("space", space.id, space.name, CONTENT_RESOURCES));
    return {
      path,
      spaceVisibility: this.visibility(space.visibility),
      personalNote: null,
    };
  }

  private async noteHierarchies(
    ids: string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const notes = await this.prisma.note.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        ownerId: true,
        shares: { select: { userId: true, permission: true } },
        category: { select: { id: true, name: true, spaceId: true } },
        space: { select: { id: true, name: true, visibility: true } },
      },
    });
    const result = new Map<string, ResolvedTargetHierarchy>();
    for (const note of notes) {
      const path = [
        this.target(
          "note",
          note.id,
          note.title ?? "Unbenannte Notiz",
          ["notes"],
        ),
      ];
      if (!note.space) {
        result.set(note.id, {
          path,
          spaceVisibility: null,
          personalNote: { ownerId: note.ownerId, shares: note.shares },
        });
        continue;
      }
      if (note.category) {
        if (note.category.spaceId !== note.space.id) {
          throw new BadRequestException(
            "Notizkategorie und Bereich stimmen nicht überein.",
          );
        }
        path.push(
          this.target("category", note.category.id, note.category.name, [
            "categories",
            "notes",
          ]),
        );
      }
      path.push(
        this.target(
          "space",
          note.space.id,
          note.space.name,
          CONTENT_RESOURCES,
        ),
      );
      result.set(note.id, {
        path,
        spaceVisibility: this.visibility(note.space.visibility),
        personalNote: null,
      });
    }
    return result;
  }

  private async standardHierarchy(id: string): Promise<ResolvedTargetHierarchy> {
    const standard = await this.prisma.standard.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        spaceId: true,
        categoryId: true,
      },
    });
    if (!standard) throw new NotFoundException("Richtlinie wurde nicht gefunden.");
    const path = [
      this.target("standard", standard.id, standard.title, ["standards"]),
    ];
    if (standard.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: standard.categoryId },
        select: { id: true, name: true, spaceId: true },
      });
      if (!category || category.spaceId !== standard.spaceId) {
        throw new BadRequestException("Richtlinienkategorie und Bereich stimmen nicht überein.");
      }
      path.push(this.target("category", category.id, category.name, ["categories", "standards"]));
    }
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: standard.spaceId },
      select: { id: true, name: true, visibility: true },
    });
    if (!space) throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    path.push(this.target("space", space.id, space.name, CONTENT_RESOURCES));
    return {
      path,
      spaceVisibility: this.visibility(space.visibility),
      personalNote: null,
    };
  }

  private async standardHierarchies(
    ids: string[],
  ): Promise<Map<string, ResolvedTargetHierarchy>> {
    const standards = await this.prisma.standard.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        category: { select: { id: true, name: true, spaceId: true } },
        space: { select: { id: true, name: true, visibility: true } },
      },
    });
    const result = new Map<string, ResolvedTargetHierarchy>();
    for (const standard of standards) {
      const path = [
        this.target("standard", standard.id, standard.title, ["standards"]),
      ];
      if (standard.category) {
        if (standard.category.spaceId !== standard.space.id) {
          throw new BadRequestException(
            "Richtlinienkategorie und Bereich stimmen nicht überein.",
          );
        }
        path.push(
          this.target("category", standard.category.id, standard.category.name, [
            "categories",
            "standards",
          ]),
        );
      }
      path.push(
        this.target(
          "space",
          standard.space.id,
          standard.space.name,
          CONTENT_RESOURCES,
        ),
      );
      result.set(standard.id, {
        path,
        spaceVisibility: this.visibility(standard.space.visibility),
        personalNote: null,
      });
    }
    return result;
  }

  private target(
    type: ResourceAclTargetType,
    id: string,
    label: string,
    allowedResources: Resource[],
  ): ResolvedResourceTarget {
    return {
      type,
      id,
      label,
      key: this.key(type, id),
      allowedResources: [...new Set(allowedResources)],
    };
  }

  private resourceForScope(scope: CategoryScope): Resource {
    if (scope === CategoryScope.NOTE) return "notes";
    if (scope === CategoryScope.STANDARD) return "standards";
    return "pages";
  }

  private visibility(value: SpaceVisibility): "open" | "restricted" {
    return value === SpaceVisibility.OPEN ? "open" : "restricted";
  }
}
