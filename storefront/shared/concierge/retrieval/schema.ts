import { z } from 'zod';
const boundedId = z.string().trim().min(1).max(150);
const exactObjectId = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/,
    'Exact objectID must be a safe catalogue identifier',
  );
export const SUPPORTED_PRODUCT_TYPES = [
  'Ring',
  'Earrings',
  'Necklace',
  'Bracelet',
  'Pendant',
  'Wrist Watch',
] as const;
const common = {
  query: z.string().max(300),
  count: z.number().int().min(1).max(12),
  exactObjectIDs: z.array(exactObjectId).min(1).max(3).nullable().default(null),
  missionId: boundedId,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  turnId: boundedId,
  target: z.union([
    z
      .object({
        kind: z.literal('item'),
        itemKey: boundedId,
        productType: z.enum(SUPPORTED_PRODUCT_TYPES),
      })
      .strict(),
    z.null(),
  ]),
};
const product = z.object({ ...common, source: z.literal('prod_catalog') }).strict();
const blog = z.object({ ...common, source: z.literal('blog') }).strict();
export const retrieveEvidenceInputSchema = z
  .discriminatedUnion('source', [product, blog])
  .superRefine((input, ctx) => {
    if (input.source === 'blog' && input.exactObjectIDs !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['exactObjectIDs'],
        message: 'Blog evidence requires exactObjectIDs null',
      });
    if (input.source === 'blog' && input.target !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Blog evidence requires target null',
      });
  });

export type RetrieveEvidenceInput = z.infer<typeof retrieveEvidenceInputSchema>;
