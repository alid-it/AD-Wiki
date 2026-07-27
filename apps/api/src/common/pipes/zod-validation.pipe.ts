import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodError, type ZodIssue, type ZodSchema } from "zod";

const FIELD_LABELS: Record<string, string> = {
  email: "E-Mail-Adresse",
  username: "Benutzername",
  displayName: "Anzeigename",
  password: "Passwort",
  currentPassword: "aktuelles Passwort",
  newPassword: "neues Passwort",
  confirmPassword: "Passwortbestätigung",
  title: "Titel",
  name: "Name",
  description: "Beschreibung",
  content: "Inhalt",
  page: "Seite",
  limit: "Anzahl",
  q: "Suchbegriff",
};

/**
 * Validiert eingehende Daten gegen ein Zod-Schema.
 * Wird pro Route mit dem passenden Schema aus @ad-wiki/shared-types
 * instanziiert, z. B. `@Body(new ZodValidationPipe(CreatePageSchema))`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  /** Parst den Wert; technische Zod-Texte werden niemals nach außen gegeben. */
  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          code: "VALIDATION_FAILED",
          message: "Bitte prüfe deine Angaben und versuche es erneut.",
          fieldErrors: error.issues.map((issue) => ({
            field: issue.path.map(String).join(".") || "request",
            message: publicValidationMessage(issue),
          })),
        });
      }
      throw error;
    }
  }
}

/** Erstellt bewusst formulierte Meldungen statt Zod-Systemtexten. */
export function publicValidationMessage(issue: ZodIssue): string {
  const field = FIELD_LABELS[String(issue.path.at(-1) ?? "")] ?? "dieses Feld";
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined"
        ? `Bitte fülle ${field === "dieses Feld" ? field : `das Feld „${field}“`} aus.`
        : `Bitte gib für ${field === "dieses Feld" ? field : `„${field}“`} einen gültigen Wert ein.`;
    case "invalid_string":
      return issue.validation === "email"
        ? "Bitte gib eine gültige E-Mail-Adresse ein."
        : `Bitte prüfe die Eingabe für ${field === "dieses Feld" ? field : `„${field}“`}.`;
    case "too_small":
      if (issue.type === "string") {
        return issue.minimum === 1
          ? `Bitte fülle ${field === "dieses Feld" ? field : `das Feld „${field}“`} aus.`
          : `${field === "dieses Feld" ? "Die Eingabe" : `„${field}“`} muss mindestens ${issue.minimum} Zeichen lang sein.`;
      }
      return `Der Wert für ${field === "dieses Feld" ? field : `„${field}“`} ist zu klein.`;
    case "too_big":
      if (issue.type === "string") {
        return `${field === "dieses Feld" ? "Die Eingabe" : `„${field}“`} darf höchstens ${issue.maximum} Zeichen lang sein.`;
      }
      return `Der Wert für ${field === "dieses Feld" ? field : `„${field}“`} ist zu groß.`;
    case "invalid_enum_value":
      return `Bitte wähle für ${field === "dieses Feld" ? field : `„${field}“`} einen gültigen Wert aus.`;
    case "unrecognized_keys":
      return "Die Anfrage enthält nicht unterstützte Felder.";
    case "custom":
      return issue.path.at(-1) === "confirmPassword"
        ? "Die beiden Passwörter stimmen nicht überein."
        : "Die Angaben passen nicht zusammen. Bitte prüfe sie erneut.";
    default:
      return `Bitte prüfe ${field === "dieses Feld" ? field : `das Feld „${field}“`}.`;
  }
}
