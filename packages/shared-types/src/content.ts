import { z } from 'zod';

/** Schaltet genau einen gerenderten Checklisteneintrag anhand seines nullbasierten Index. */
export const ToggleCheckboxSchema = z.object({
  checkboxIndex: z.number().int().nonnegative().max(100_000),
  checked: z.boolean(),
});

export type ToggleCheckboxInput = z.infer<typeof ToggleCheckboxSchema>;
