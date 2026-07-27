import { z } from 'zod';

/** Unterstützte Formate des vollständigen Wiki-Exports. */
export const ExportFormatSchema = z.enum(['markdown', 'html', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const BulkExportQuerySchema = z.object({
  format: ExportFormatSchema.default('markdown'),
});
export type BulkExportQuery = z.infer<typeof BulkExportQuerySchema>;
