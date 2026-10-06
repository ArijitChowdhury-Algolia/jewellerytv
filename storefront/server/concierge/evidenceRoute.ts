import { z } from 'zod';
import { briefStateV3Schema } from '../../shared/briefSchema.js';
import { retrieveEvidenceInputSchema } from '../../shared/concierge/retrieval/schema.js';
import { createAlgoliaEvidenceSearch, createEvidenceRetriever } from './retrieveEvidence.js';

const requestSchema = z
  .object({
    input: retrieveEvidenceInputSchema,
    brief: briefStateV3Schema,
  })
  .strict();

/** The browser supplies its accepted brief snapshot, never a model-authored filter.
 * The client callback must recheck its live revision after this response, since
 * a server request cannot observe a later edit in tab-scoped session state. */
export async function runEvidenceRoute(
  raw: unknown,
  options: {
    appId: string;
    searchOnlyApiKey: string;
    fetch: typeof fetch;
    signal: AbortSignal;
  },
) {
  const request = requestSchema.parse(raw);
  const retrieve = createEvidenceRetriever({
    search: createAlgoliaEvidenceSearch(options),
    currentState: () => request.brief,
    signal: options.signal,
  });
  return retrieve(request.input);
}
