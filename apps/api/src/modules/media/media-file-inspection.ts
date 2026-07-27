import { BadRequestException } from "@nestjs/common";
import { extname } from "node:path";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { MAX_FILE_SIZE } from "@/modules/media/media.config";

const HEADER_BYTES = 16;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type BinaryMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";

export interface InspectedMediaFile {
  mimetype: BinaryMediaType | "text/markdown";
  size: number;
}

interface MediaFileInput {
  path: string;
  originalName: string;
}

/**
 * Prüft die gespeicherte Datei selbst. Browser-MIME-Typ und Dateiendung gelten
 * nur als Hinweis; erst eine passende Signatur beziehungsweise gültiges UTF-8
 * macht den Upload zulässig.
 */
export async function inspectMediaFile(input: MediaFileInput): Promise<InspectedMediaFile> {
  const extension = extname(input.originalName).slice(1).toLowerCase();
  if (extension === "svg" || extension === "svgz") {
    throw new BadRequestException("SVG-Dateien sind aus Sicherheitsgründen nicht erlaubt.");
  }

  const handle = await open(input.path, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_FILE_SIZE) {
      throw new BadRequestException("Die Datei ist leer, zu groß oder kein reguläres Dateiformat.");
    }

    if (extension === "md" || extension === "markdown") {
      const content = await handle.readFile();
      if (content.includes(0)) {
        throw new BadRequestException("Die Markdown-Datei enthält unzulässige Binärdaten.");
      }
      let text: string;
      try {
        text = UTF8_DECODER.decode(content);
      } catch (error) {
        throw new BadRequestException("Markdown-Dateien müssen gültig als UTF-8 kodiert sein.", { cause: error });
      }
      if (/<\s*svg\b|<!doctype\s+svg\b/i.test(text)) {
        throw new BadRequestException("Eingebettete SVG-Inhalte sind in Markdown-Dateien nicht erlaubt.");
      }
      return { mimetype: "text/markdown", size: stats.size };
    }

    const header = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const tailLength = Math.min(stats.size, 1024);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.length, stats.size - tailLength);
    const detected = detectBinaryType(header.subarray(0, bytesRead), tail, stats.size);
    if (!detected || !extensionMatches(extension, detected)) {
      throw new BadRequestException(
        "Dateiendung und tatsächlicher Dateiinhalt stimmen nicht überein oder das Format wird nicht unterstützt.",
      );
    }
    return { mimetype: detected, size: stats.size };
  } finally {
    await handle.close();
  }
}

function detectBinaryType(header: Buffer, tail: Buffer, size: number): BinaryMediaType | null {
  if (size >= 4 && startsWith(header, [0xff, 0xd8, 0xff]) && endsWith(tail, [0xff, 0xd9])) return "image/jpeg";
  if (
    size >= 24
    && startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    && header.toString("ascii", 12, 16) === "IHDR"
    && endsWith(tail, [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  ) return "image/png";
  const ascii = header.toString("ascii");
  if (size >= 14 && (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) && tail.at(-1) === 0x3b) {
    return "image/gif";
  }
  if (
    size >= 12
    && ascii.startsWith("RIFF")
    && ascii.slice(8, 12) === "WEBP"
    && header.readUInt32LE(4) + 8 === size
  ) return "image/webp";
  if (size >= 8 && ascii.startsWith("%PDF-") && /%%EOF\s*$/.test(tail.toString("latin1"))) {
    return "application/pdf";
  }
  return null;
}

function extensionMatches(extension: string, mimetype: BinaryMediaType): boolean {
  switch (mimetype) {
    case "image/jpeg":
      return extension === "jpg" || extension === "jpeg";
    case "image/png":
      return extension === "png";
    case "image/gif":
      return extension === "gif";
    case "image/webp":
      return extension === "webp";
    case "application/pdf":
      return extension === "pdf";
  }
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => buffer[index] === value);
}

function endsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  const offset = buffer.length - signature.length;
  return signature.every((value, index) => buffer[offset + index] === value);
}
