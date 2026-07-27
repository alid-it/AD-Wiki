import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import type { Prisma } from "@prisma/client";
import type {
  AssignUserRoleInput,
  CreateUserInput,
  UpdateProfileInput,
  UpdateUserInput,
} from "@ad-wiki/shared-types";
import { assertMayAssignRole } from "@/modules/auth/permission-ceiling";
import { PrismaService } from "@/prisma/prisma.service";

/** User inklusive Rolle und Seitenzähler – Basis für die Admin-Ausgabe. */
type UserWithRole = Prisma.UserGetPayload<{
  include: { role: true; _count: { select: { pages: true } } };
}>;

const adminInclude = {
  role: true,
  _count: { select: { pages: true } },
} satisfies Prisma.UserInclude;

const SALT_ROUNDS = 12;

/** Geschäftslogik rund um Benutzer (eigenes Profil + Admin-Verwaltung). */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aktualisiert das eigene Profil (aktuell nur den Anzeigenamen). */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: input.displayName },
      include: { role: true },
    });

    // Gleiche Form wie /auth/me, damit das Frontend den User direkt ersetzen kann.
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roleId: user.role.id,
      role: user.role.name,
      isActive: user.isActive,
      hasLocalPassword: user.hasLocalPassword,
    };
  }

  // ── Admin ──────────────────────────────────────────────

  /** Legt einen Benutzer mit expliziter Rolle und gehashtem Startpasswort an. */
  async create(input: CreateUserInput, actorId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { email: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === input.email
          ? "E-Mail ist bereits vergeben."
          : "Benutzername ist bereits vergeben.",
      );
    }
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) {
      throw new BadRequestException("Die ausgewählte Rolle existiert nicht.");
    }
    await assertMayAssignRole(this.prisma, actorId, role.id);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        password: await bcrypt.hash(input.password, SALT_ROUNDS),
        roleId: role.id,
      },
      include: adminInclude,
    });
    return this.toAdminUser(user);
  }

  /** Alle Benutzer auflisten (älteste zuerst). */
  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: adminInclude,
    });
    return users.map((u) => this.toAdminUser(u));
  }

  /** Rollenoptionen für die Benutzeranlage und -zuweisung. */
  async roleOptions() {
    return this.prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isSystem: true },
    });
  }

  /** Einzelnen Benutzer laden. */
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: adminInclude,
    });
    if (!user) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }
    return this.toAdminUser(user);
  }

  /** Aktiv-Status eines Benutzers ändern. */
  async updateByAdmin(id: string, input: UpdateUserInput) {
    await this.ensureManageable(id);

    const data: Prisma.UserUpdateInput = {};
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: adminInclude,
    });
    return this.toAdminUser(user);
  }

  /** Weist einem Benutzer eine Rolle über den gesonderten Sicherheitsweg zu. */
  async assignRole(id: string, input: AssignUserRoleInput, actorId: string) {
    await this.ensureManageable(id);
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) {
      throw new BadRequestException("Die ausgewählte Rolle existiert nicht.");
    }
    await assertMayAssignRole(this.prisma, actorId, role.id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { role: { connect: { id: role.id } } },
      include: adminInclude,
    });
    return this.toAdminUser(user);
  }

  /** Benutzer deaktivieren (Soft-Delete: isActive = false). */
  async deactivate(id: string) {
    await this.ensureManageable(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      include: adminInclude,
    });
    return this.toAdminUser(user);
  }

  /** Das beim Setup angelegte Notfallkonto darf nicht administrativ verändert werden. */
  private async ensureManageable(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isProtected: true },
    });
    if (!user) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }
    if (user.isProtected) {
      throw new ForbiddenException("Das geschützte Setup-Admin-Konto kann nicht administrativ geändert werden.");
    }
  }

  private toAdminUser(user: UserWithRole) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roleId: user.role.id,
      role: user.role.name,
      isActive: user.isActive,
      isProtected: user.isProtected,
      pageCount: user._count.pages,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
