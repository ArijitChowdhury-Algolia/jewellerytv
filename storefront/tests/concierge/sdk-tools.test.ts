import { describe, expect, it, vi } from 'vitest';
import { createSdkClientTools } from '../../src/concierge/sdkTools';
import type { createConciergeToolRuntime } from '../../src/concierge/toolRuntime';

type Tool = ReturnType<typeof createSdkClientTools>[string];
type ToolCall = Parameters<NonNullable<Tool['onToolCall']>>[0];
type Runtime = Pick<
  ReturnType<typeof createConciergeToolRuntime>,
  | 'updateSemantic'
  | 'retrieveSemantic'
  | 'presentSemantic'
  | 'getActiveTurnToken'
  | 'notePresentationAttempt'
>;

function call(
  tool: NonNullable<Tool['onToolCall']>,
  input: unknown,
  signal = new AbortController().signal,
) {
  const addToolResult = vi.fn(async (_output: unknown) => {});
  return {
    addToolResult,
    run: () =>
      tool({ input, signal, addToolResult, toolCallId: 'call-1', toolName: 'test' } as ToolCall),
  };
}

describe('installed SDK client-tool callback registration', () => {
  it('registers exactly the approved three names and submits structured results', async () => {
    const runtime = {
      updateSemantic: vi.fn(async () => ({ status: 'applied', revision: 1 })),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok', records: [] })),
      presentSemantic: vi.fn(async () => ({ status: 'staged' })),
      getActiveTurnToken: vi.fn(() => 1),
      notePresentationAttempt: vi.fn(() => true),
    };
    const tools = createSdkClientTools(runtime as unknown as Runtime);
    expect(Object.keys(tools).sort()).toEqual([
      'present_choices',
      'retrieve_evidence',
      'update_shopping_state',
    ]);
    for (const name of Object.keys(tools)) {
      const { run, addToolResult } = call(tools[name].onToolCall!, { test: name });
      await run();
      expect(addToolResult).toHaveBeenCalledOnce();
      expect(addToolResult.mock.calls[0][0]).toMatchObject({
        output: { status: expect.any(String) },
      });
    }
  });

  it('does not submit a second result after abort and never exposes thrown details', async () => {
    const controller = new AbortController();
    controller.abort();
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => {
        throw new Error('secret');
      }),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok' })),
      presentSemantic: vi.fn(async () => ({ status: 'staged' })),
      getActiveTurnToken: vi.fn(() => 1),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const aborted = call(tools.update_shopping_state.onToolCall!, {}, controller.signal);
    await aborted.run();
    expect(aborted.addToolResult).not.toHaveBeenCalled();
    const failed = call(tools.update_shopping_state.onToolCall!, {});
    await failed.run();
    expect(failed.addToolResult).toHaveBeenCalledWith({
      output: { status: 'tool_failure', code: 'STATE_CALLBACK_FAILED' },
    });
  });
  it('submits empty-operation validation as one structured result', async () => {
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => ({
        status: 'invalid_input',
        failure: { code: 'NO_OPERATIONS' },
      })),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok' })),
      presentSemantic: vi.fn(async () => ({ status: 'staged' })),
      getActiveTurnToken: vi.fn(() => 1),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const empty = call(tools.update_shopping_state.onToolCall!, {
      operations: [{ action: 'add' }],
    });
    await empty.run();
    expect(empty.addToolResult).toHaveBeenCalledOnce();
    expect(empty.addToolResult).toHaveBeenCalledWith({
      output: { status: 'invalid_input', failure: { code: 'NO_OPERATIONS' } },
    });
  });
  it('serializes dependent update and retrieve callbacks in FIFO order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => {
        order.push('update-start');
        await gate;
        order.push('update-end');
        return { status: 'applied' };
      }),
      retrieveSemantic: vi.fn(async () => {
        order.push('retrieve');
        return { status: 'ok' };
      }),
      presentSemantic: vi.fn(async () => ({ status: 'staged' })),
      getActiveTurnToken: vi.fn(() => 1),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const update = call(tools.update_shopping_state.onToolCall!, {
      operations: [{ action: 'add' }],
    });
    const retrieve = call(tools.retrieve_evidence.onToolCall!, {
      source: 'prod_catalog',
      query: 'ring',
      count: 1,
      target: null,
    });
    const first = update.run();
    const second = retrieve.run();
    await Promise.resolve();
    expect(order).toEqual(['update-start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['update-start', 'update-end', 'retrieve']);
  });
  it('records a presentation attempt even when semantic input fails before runtime staging', async () => {
    const notePresentationAttempt = vi.fn(() => true);
    const presentSemantic = vi.fn(async () => ({ status: 'staged' }));
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => ({ status: 'applied' })),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok' })),
      presentSemantic,
      getActiveTurnToken: vi.fn(() => 3),
      notePresentationAttempt,
    } as unknown as Runtime);
    const failed = call(tools.present_choices.onToolCall!, { body: { kind: 'not-a-choice' } });
    await failed.run();
    expect(notePresentationAttempt).toHaveBeenCalledWith(3);
    expect(presentSemantic).not.toHaveBeenCalled();
    expect(failed.addToolResult).toHaveBeenCalledWith({
      output: { status: 'tool_failure', code: 'PRESENTATION_CALLBACK_FAILED' },
    });
  });
  it('passes a catalogue-backed group basis through to runtime', async () => {
    const presentSemantic = vi.fn(async () => ({ status: 'staged' }));
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => ({ status: 'applied' })),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok' })),
      presentSemantic,
      getActiveTurnToken: vi.fn(() => 4),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const input = {
      body: {
        kind: 'product_groups',
        groups: [
          {
            basis: { attribute: 'Catalog_WatchCaseSize', value: '36mm' },
            items: [
              {
                evidenceRef: 'prod_catalog/watch/hash',
                quantity: 1,
                componentSlot: 'watch',
                explanation: 'A 36mm case',
              },
            ],
          },
        ],
        alternatives: null,
      },
    };
    const submitted = call(tools.present_choices.onToolCall!, input);
    await submitted.run();
    expect(presentSemantic).toHaveBeenCalledWith(input, 'call-1', 4);
    expect(submitted.addToolResult).toHaveBeenCalledWith({ output: { status: 'staged' } });
  });
  it('returns a precise group mismatch to the Concierge for one correction', async () => {
    const failure = {
      status: 'invalid_input',
      reasons: ['group_basis_mismatch'],
      basisFailure: {
        groupIndex: 0,
        evidenceRef: 'prod_catalog/item/hash',
        attribute: 'Catalog_NecklaceType',
        expectedValue: 'Dainty',
        observedValues: ['Center Design'],
      },
    };
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => ({ status: 'applied' })),
      retrieveSemantic: vi.fn(async () => ({ status: 'ok' })),
      presentSemantic: vi.fn(async () => failure),
      getActiveTurnToken: vi.fn(() => 1),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const submitted = call(tools.present_choices.onToolCall!, {
      body: {
        kind: 'product_groups',
        groups: [
          {
            basis: { attribute: 'Catalog_NecklaceType', value: 'Dainty' },
            items: [
              {
                evidenceRef: 'prod_catalog/item/hash',
                quantity: 1,
                componentSlot: 'necklace',
                explanation: 'A necklace',
              },
            ],
          },
        ],
        alternatives: null,
      },
    });
    await submitted.run();
    expect(submitted.addToolResult).toHaveBeenCalledWith({ output: failure });
  });
  it('passes exact product IDs to retrieval without treating them as search text', async () => {
    const retrieveSemantic = vi.fn(async () => ({ status: 'ok', records: [] }));
    const tools = createSdkClientTools({
      updateSemantic: vi.fn(async () => ({ status: 'applied' })),
      retrieveSemantic,
      presentSemantic: vi.fn(async () => ({ status: 'staged' })),
      getActiveTurnToken: vi.fn(() => 6),
      notePresentationAttempt: vi.fn(() => true),
    } as unknown as Runtime);
    const submitted = call(tools.retrieve_evidence.onToolCall!, {
      source: 'prod_catalog',
      query: '',
      count: 2,
      target: { kind: 'item', itemKey: 'Necklace', productType: 'Necklace' },
      exactObjectIDs: ['DOQ140', 'RST2197'],
    });
    await submitted.run();
    expect(retrieveSemantic).toHaveBeenCalledWith(
      {
        source: 'prod_catalog',
        query: '',
        count: 2,
        target: { kind: 'item', itemKey: 'Necklace', productType: 'Necklace' },
        exactObjectIDs: ['DOQ140', 'RST2197'],
      },
      'call-1',
      expect.any(AbortSignal),
      6,
    );
  });
});
