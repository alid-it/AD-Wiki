import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { NoteSharePermission, NoteStatus } from "@prisma/client";
import { toggleCheckboxInContent } from "../../dist/common/content/toggle-checkbox.js";
import { NotesService } from "../../dist/modules/notes/notes.service.js";

type NotesPrisma = ConstructorParameters<typeof NotesService>[0];
type PagesDependency = ConstructorParameters<typeof NotesService>[1];

test("Markdown-Checklisten werden indexstabil geschaltet und Code-Fences ignoriert", () => {
  const content = [
    "- [ ] erste",
    "```md",
    "- [ ] nur Beispiel",
    "```",
    "  - [x] zweite",
  ].join("\r\n");

  assert.equal(
    toggleCheckboxInContent(content, 1, false),
    ["- [ ] erste", "```md", "- [ ] nur Beispiel", "```", "  - [ ] zweite"].join("\r\n"),
  );
});

test("Tiptap-Task-Items werden anhand von data-checked geschaltet", () => {
  const content = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A</p></li><li data-type="taskItem" data-checked="true"><p>B</p></li></ul>';
  const updated = toggleCheckboxInContent(content, 1, false);
  assert.ok(updated?.includes('<li data-type="taskItem" data-checked="false"><p>B</p>'));
});

test("ein unbekannter Checkbox-Index verändert den Inhalt nicht", () => {
  assert.equal(toggleCheckboxInContent("- [ ] einzige", 2, true), null);
});

test("Notiz-Checkboxen verwenden die bestehende Edit-Freigabe", async () => {
  const userId = "10000000-0000-4000-8000-000000000001";
  const ownerId = "20000000-0000-4000-8000-000000000002";
  const now = new Date("2026-07-15T00:00:00.000Z");
  const note = {
    id: "30000000-0000-4000-8000-000000000003",
    title: "Geteilt",
    content: "- [ ] prüfen",
    status: NoteStatus.CAPTURED,
    mcpVisible: false,
    ownerId,
    owner: { id: ownerId, displayName: "Owner", email: "owner@example.test" },
    categoryId: null,
    category: null,
    tags: [],
    shares: [{ userId, permission: NoteSharePermission.EDIT, sharedAt: now, user: { id: userId, displayName: "Editor", email: "editor@example.test" } }],
    promotedPageId: null,
    suggestedType: null,
    classificationConfidence: null,
    classificationReason: null,
    qualityScore: null,
    maturityScore: null,
    sensitivity: null,
    assessedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  let editWhere: unknown;
  const prisma = {
    note: {
      findFirst: async (input: { where: unknown }) => { editWhere = input.where; return note; },
      update: async (input: { data: { content: string } }) => ({ ...note, content: input.data.content }),
    },
  } as unknown as NotesPrisma;
  const subject = new NotesService(prisma, {} as PagesDependency);

  const result = await subject.toggleCheckbox(note.id, { checkboxIndex: 0, checked: true }, userId);

  assert.equal(result.content, "- [x] prüfen");
  assert.equal(JSON.stringify(editWhere).includes(NoteSharePermission.EDIT), true);
});

test("Notiz-Checkboxen werden ohne Eigentum oder Edit-Freigabe abgelehnt", async () => {
  const prisma = {
    note: { findFirst: async () => null, update: async () => { throw new Error("darf nicht laufen"); } },
  } as unknown as NotesPrisma;
  const subject = new NotesService(prisma, {} as PagesDependency);

  await assert.rejects(
    subject.toggleCheckbox("30000000-0000-4000-8000-000000000003", { checkboxIndex: 0, checked: true }, "10000000-0000-4000-8000-000000000001"),
    ForbiddenException,
  );
});
