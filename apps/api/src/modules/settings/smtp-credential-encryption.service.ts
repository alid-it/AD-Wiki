import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Verschlüsselt SMTP-Zugangsdaten mit dem vorhandenen Integrations-Secret. */
@Injectable()
export class SmtpCredentialEncryptionService {
  encrypt(plainText: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    try {
      const [version, encodedIv, encodedTag, encodedCipherText, extra] = value.split(".");
      if (version !== VERSION || !encodedIv || !encodedTag || !encodedCipherText || extra) throw new Error("format");
      const iv = Buffer.from(encodedIv, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("length");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCipherText, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new InternalServerErrorException("Gespeicherte SMTP-Zugangsdaten konnten nicht entschlüsselt werden.");
    }
  }

  private key(): Buffer {
    const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
    if (!raw) throw new InternalServerErrorException("Der Verschlüsselungsschlüssel für SMTP ist nicht konfiguriert.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32 || key.toString("base64") !== raw) {
      throw new InternalServerErrorException("Der Verschlüsselungsschlüssel für SMTP ist ungültig.");
    }
    return key;
  }
}
