import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import {
  canSubmitConnectedTurn,
  getConnectedTurnSystemNotice,
  resetConnectedConversation,
} from '../../src/concierge/ConnectedConcierge';

describe('connected Concierge reset gate', () => {
  it('blocks an immediate send while New conversation persistence is settling', () => {
    expect(canSubmitConnectedTurn('Find a ring', false, true)).toBe(false);
    expect(canSubmitConnectedTurn('Find a ring', false, false)).toBe(true);
    expect(canSubmitConnectedTurn('', false, false)).toBe(false);
  });
  it('keeps the synchronous lock through deferred reset and transcript clearing', async () => {
    const resettingRef = { current: false };
    let release!: (value: { ok: true }) => void;
    const clearOrder: string[] = [];
    const reset = resetConnectedConversation(
      resettingRef,
      () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
      () => clearOrder.push('clear'),
      () => clearOrder.push('input'),
      () => clearOrder.push('focus'),
    );
    expect(resettingRef.current).toBe(true);
    expect(canSubmitConnectedTurn('Send immediately', false, resettingRef.current)).toBe(false);
    release({ ok: true });
    await reset;
    expect(clearOrder).toEqual(['clear', 'input', 'focus']);
    expect(resettingRef.current).toBe(false);
  });
  it('labels tool failures as system UI without exposing tool details', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Find a necklace' }] },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-retrieve_evidence',
              toolCallId: 'call-1',
              state: 'output-error',
              input: {},
              errorText: 'operations [] rejected',
            },
          ],
        },
      ] as unknown as UIMessage[],
      { isAbort: false, isError: true },
    );
    expect(notice).toContain('[System notice]');
    expect(notice).toContain('Existing product choices remain.');
    expect(notice).not.toContain('operations');
    expect(notice).not.toContain('retrieve_evidence');
  });
  it('labels an exhausted turn with no final assistant text and keeps prior choices visible', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Find a necklace' }] },
        { id: 'assistant-1', role: 'assistant', parts: [] },
      ] as unknown as UIMessage[],
      null,
    );
    expect(notice).toBe(
      '[System notice] This request did not produce a complete response. Existing product choices remain.',
    );
  });
  it('preserves an agent-provided system notice without duplicating it', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '[System notice] Please refine the request.' }],
        },
      ] as unknown as UIMessage[],
      { isAbort: false, isError: true },
    );
    expect(notice).toBe('[System notice] Please refine the request.');
  });
});
