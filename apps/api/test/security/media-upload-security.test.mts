import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { inspectMediaFile } from "../../dist/modules/media/media-file-inspection.js";

async function withFixture<T>(
  filename: string,
  content: Uint8Array | string,
  action: (path: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "ad-wiki-media-security-"));
  const path = join(directory, filename);
  try {
    await writeFile(path, content);
    return await action(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}

function validWebp(): Buffer {
  const content = Buffer.alloc(16);
  content.write("RIFF", 0, "ascii");
  content.writeUInt32LE(content.length - 8, 4);
  content.write("WEBP", 8, "ascii");
  return content;
}

test("erkennt unterstuetzte Dateiformate anhand ihres Inhalts", async () => {
  const fixtures: Array<{ filename: string; content: Uint8Array | string; mimetype: string }> = [
    { filename: "bild.jpg", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]), mimetype: "image/jpeg" },
    { filename: "bild.png", content: validPng(), mimetype: "image/png" },
    { filename: "animation.gif", content: Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(7), Buffer.from([0x3b])]), mimetype: "image/gif" },
    { filename: "bild.webp", content: validWebp(), mimetype: "image/webp" },
    { filename: "dokument.pdf", content: "%PDF-1.7\nTest\n%%EOF\n", mimetype: "application/pdf" },
    { filename: "seite.md", content: "# Gueltiges Markdown\n", mimetype: "text/markdown" },
  ];

  for (const fixture of fixtures) {
    await withFixture(fixture.filename, fixture.content, async (path) => {
      const result = await inspectMediaFile({ path, originalName: fixture.filename });
      assert.equal(result.mimetype, fixture.mimetype);
      assert.equal(result.size, Buffer.byteLength(fixture.content));
    });
  }
});

test("lehnt manipulierte Dateien trotz erlaubter Endung ab", async () => {
  await withFixture("angriff.png", "<script>alert('xss')</script>", async (path) => {
    await assert.rejects(
      inspectMediaFile({ path, originalName: "angriff.png" }),
      BadRequestException,
    );
  });

  await withFixture("falsches-format.png", "%PDF-1.7\n%%EOF\n", async (path) => {
    await assert.rejects(
      inspectMediaFile({ path, originalName: "falsches-format.png" }),
      BadRequestException,
    );
  });
});

test("deaktiviert SVG auch bei gueltigem SVG-Inhalt", async () => {
  await withFixture("vektor.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', async (path) => {
    await assert.rejects(
      inspectMediaFile({ path, originalName: "vektor.svg" }),
      BadRequestException,
    );
  });
});

test("Markdown muss UTF-8 sein und darf kein eingebettetes SVG enthalten", async () => {
  await withFixture("ungueltig.md", Buffer.from([0xc3, 0x28]), async (path) => {
    await assert.rejects(inspectMediaFile({ path, originalName: "ungueltig.md" }), BadRequestException);
  });

  await withFixture("svg.md", "# Inhalt\n<svg><script>alert(1)</script></svg>", async (path) => {
    await assert.rejects(inspectMediaFile({ path, originalName: "svg.md" }), BadRequestException);
  });
});
