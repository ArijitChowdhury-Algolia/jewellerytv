import { z } from 'zod';
import type { UserClientSideTools } from 'instantsearch-ui-components';
import type { createConciergeToolRuntime } from './toolRuntime.js';
import { catalogueGroupBasisSchema } from '../../shared/concierge/presentation-contract.js';

type Runtime = ReturnType<typeof createConciergeToolRuntime>;
const updateShape = z.object({ operations: z.array(z.unknown()).min(1).max(12) }).strict();
const retrieveShape = z
  .object({
    source: z.enum(['prod_catalog', 'blog']),
    query: z.string().max(300),
    count: z.number().int().min(1).max(12),
    exactObjectIDs: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]{1,150}$/))
      .min(1)
      .max(3)
      .nullable(),
    target: z.union([
      z.null(),
      z
        .object({
          kind: z.literal('item'),
          itemKey: z.string().min(1),
          productType: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();
const lineShape = z
  .object({
    evidenceRef: z.string().min(1),
    quantity: z.number().int().min(1).max(20),
    componentSlot: z.string().min(1),
    explanation: z.string().min(1).max(500),
  })
  .strict();
const presentShape = z
  .object({
    body: z.union([
      z
        .object({
          kind: z.literal('product_groups'),
          groups: z
            .array(
              z
                .object({
                  basis: catalogueGroupBasisSchema,
                  items: z.array(lineShape).min(1).max(3),
                })
                .strict(),
            )
            .min(1)
            .max(3),
          alternatives: z.null(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('complete_looks'),
          groups: z.null(),
          alternatives: z
            .array(
              z
                .object({
                  title: z.string().min(1).max(160),
                  lines: z.array(lineShape).min(1).max(3),
                })
                .strict(),
            )
            .min(1)
            .max(3),
        })
        .strict(),
    ]),
  })
  .strict();
function normalizeUpdate(input: unknown) {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const allowedRoot = new Set([
    'operations',
    'missionId',
    'expectedRevision',
    'operationId',
    'sourceMessageId',
  ]);
  if (Object.keys(source).some((key) => !allowedRoot.has(key)))
    throw new Error('semantic_update_unknown_field');
  const operations = Array.isArray(source.operations)
    ? source.operations.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('semantic_operation_invalid');
        const operation = value as Record<string, unknown>;
        const allowed = new Set(['action', 'factIds', 'fact', 'sourceQuote']);
        if (Object.keys(operation).some((key) => !allowed.has(key)))
          throw new Error('semantic_operation_unknown_field');
        const result: Record<string, unknown> = {};
        for (const key of ['action', 'factIds', 'fact', 'sourceQuote'])
          if (key in operation) result[key] = operation[key];
        return result;
      })
    : source.operations;
  return updateShape.parse({ operations });
}
function normalizeRetrieve(input: unknown) {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const allowedRoot = new Set([
    'source',
    'query',
    'count',
    'exactObjectIDs',
    'target',
    'missionId',
    'expectedRevision',
    'turnId',
  ]);
  if (Object.keys(source).some((key) => !allowedRoot.has(key)) || !Object.hasOwn(source, 'target'))
    throw new Error('semantic_retrieval_unknown_or_missing_field');
  const target = source.target;
  const targetValue =
    target === null || target === undefined
      ? null
      : (() => {
          if (!target || typeof target !== 'object' || Array.isArray(target))
            throw new Error('semantic_target_invalid');
          const value = target as Record<string, unknown>;
          const allowedTarget = new Set(['kind', 'itemKey', 'productType', 'key']);
          if (Object.keys(value).some((key) => !allowedTarget.has(key)))
            throw new Error('semantic_target_unknown_field');
          const itemKey = value.itemKey ?? value.key;
          const productType = value.productType ?? value.key;
          return { kind: 'item' as const, itemKey, productType };
        })();
  return retrieveShape.parse({
    source: source.source,
    query: source.query,
    count: source.count,
    exactObjectIDs: source.exactObjectIDs ?? null,
    target: targetValue,
  });
}
function normalizePresent(input: unknown) {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const allowedRoot = new Set([
    'body',
    'missionId',
    'expectedStateRevision',
    'expectedEvidenceBatchRevision',
    'turnId',
    'proposalId',
  ]);
  if (Object.keys(source).some((key) => !allowedRoot.has(key)))
    throw new Error('semantic_presentation_unknown_field');
  const body =
    source.body && typeof source.body === 'object' ? (source.body as Record<string, unknown>) : {};
  const normalizeLine = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('semantic_line_invalid');
    const line = value as Record<string, unknown>;
    const allowed = new Set([
      'evidenceRef',
      'quantity',
      'componentSlot',
      'explanation',
      'objectID',
      'contentHash',
    ]);
    if (Object.keys(line).some((key) => !allowed.has(key)))
      throw new Error('semantic_line_unknown_field');
    return {
      evidenceRef: line.evidenceRef,
      quantity: line.quantity,
      componentSlot: line.componentSlot,
      explanation: line.explanation,
    };
  };
  const normalized =
    body.kind === 'product_groups'
      ? {
          kind: body.kind,
          groups: Array.isArray(body.groups)
            ? body.groups.map((group) => {
                const item = group as Record<string, unknown>;
                if (Object.keys(item).some((key) => key !== 'basis' && key !== 'items'))
                  throw new Error('semantic_group_unknown_field');
                return {
                  basis: item.basis,
                  items: Array.isArray(item.items) ? item.items.map(normalizeLine) : [],
                };
              })
            : [],
          alternatives: null,
        }
      : {
          kind: body.kind,
          groups: null,
          alternatives: Array.isArray(body.alternatives)
            ? body.alternatives.map((group) => {
                const item = group as Record<string, unknown>;
                if (Object.keys(item).some((key) => key !== 'title' && key !== 'lines'))
                  throw new Error('semantic_group_unknown_field');
                return {
                  title: item.title,
                  lines: Array.isArray(item.lines) ? item.lines.map(normalizeLine) : [],
                };
              })
            : [],
        };
  return presentShape.parse({ body: normalized });
}

/** The SDK bridge accepts semantic fields only. Runtime owns identity and revisions. */
export function createSdkClientTools(
  runtime: Pick<
    Runtime,
    | 'updateSemantic'
    | 'retrieveSemantic'
    | 'presentSemantic'
    | 'getActiveTurnToken'
    | 'notePresentationAttempt'
  >,
): UserClientSideTools {
  let queue = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>) => {
    const next = queue.then(job, job);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    update_shopping_state: {
      timeout: 20_000,
      retryOnError: false,
      async onToolCall({ input, signal, addToolResult, toolCallId }) {
        const token = runtime.getActiveTurnToken();
        try {
          const output = await enqueue(() =>
            runtime.updateSemantic(normalizeUpdate(input), toolCallId, signal, token ?? undefined),
          );
          if (!signal.aborted) await addToolResult({ output });
        } catch {
          if (!signal.aborted)
            await addToolResult({
              output: { status: 'tool_failure', code: 'STATE_CALLBACK_FAILED' },
            });
        }
      },
    },
    retrieve_evidence: {
      timeout: 20_000,
      retryOnError: false,
      async onToolCall({ input, signal, addToolResult, toolCallId }) {
        const token = runtime.getActiveTurnToken();
        try {
          const output = await enqueue(() =>
            runtime.retrieveSemantic(
              normalizeRetrieve(input),
              toolCallId,
              signal,
              token ?? undefined,
            ),
          );
          if (!signal.aborted) await addToolResult({ output });
        } catch {
          if (!signal.aborted)
            await addToolResult({
              output: { status: 'tool_failure', code: 'RETRIEVAL_CALLBACK_FAILED' },
            });
        }
      },
    },
    present_choices: {
      timeout: 20_000,
      retryOnError: false,
      async onToolCall({ input, signal, addToolResult, toolCallId }) {
        const token = runtime.getActiveTurnToken();
        if (signal.aborted) return;
        runtime.notePresentationAttempt(token ?? undefined);
        try {
          const output = await enqueue(() =>
            runtime.presentSemantic(normalizePresent(input), toolCallId, token ?? undefined),
          );
          if (!signal.aborted) await addToolResult({ output });
        } catch {
          if (!signal.aborted)
            await addToolResult({
              output: { status: 'tool_failure', code: 'PRESENTATION_CALLBACK_FAILED' },
            });
        }
      },
    },
  };
}
