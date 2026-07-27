import { BadRequestException } from "@nestjs/common";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { diskStorage } from "multer";
import type { Request } from "express";

/**
 * Zielordner für Uploads: `uploads/` relativ zum Arbeitsverzeichnis
 * (Projektroot beim Start der API). Über UPLOAD_DIR überschreibbar.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");

/** Maximale Dateigröße: 10 MB. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Erlaubte Dateiendungen (kleingeschrieben, ohne Punkt). */
const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "md",
  "markdown",
]);

/** Legt den Upload-Ordner an, falls er noch nicht existiert. */
export function ensureUploadDir(): void {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Extrahiert die Endung eines Dateinamens (ohne Punkt, kleingeschrieben). */
function fileExtension(filename: string): string {
  return extname(filename).replace(".", "").toLowerCase();
}

/**
 * Multer-Optionen für den Datei-Upload:
 * - Speicherung auf der Festplatte unter einem UUID-Dateinamen
 * - frühe Filterung anhand erlaubter Endungen; die verbindliche Inhaltsprüfung
 *   erfolgt anschließend im MediaService
 * - Größenbegrenzung auf 10 MB
 */
export const multerOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file: Express.Multer.File, cb) => {
      // Dateiname: zufällige UUID + originale Endung.
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (ALLOWED_EXTENSIONS.has(fileExtension(file.originalname))) {
      cb(null, true);
      return;
    }
    cb(
      new BadRequestException(
        "Dateityp nicht erlaubt. Erlaubt: jpg, jpeg, png, gif, webp, pdf, md und markdown. SVG ist deaktiviert.",
      ),
      false,
    );
  },
  limits: { fileSize: MAX_FILE_SIZE },
};
