import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useChat } from 'react-instantsearch';
import type { ChatOnFinishCallback, UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import Markdown from 'markdown-to-jsx';
import { ShoppingWorkspace } from '../ShoppingWorkspace';
import { ConciergeWorkspaceLayout } from './ConciergeWorkspaceLayout';
import { ConnectedShoppingBrief } from './ConnectedShoppingBrief';
import { createConciergeWorkspaceSession } from './ConciergeWorkspaceProvider';
import { createSdkClientTools } from './sdkTools';
import { hasFailedTool, isCompletedAssistantTurn } from './turnCompletion';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types.js';
import type { ShopperMessage } from '../../shared/concierge/state/updateShoppingState.js';
import { applyBriefOperationsV3, undoBriefV3 } from '../../shared/briefState.js';
import { buildTurnContext } from './turnContext.js';

type TurnFinish = {
  messages: UIMessage[];
  isAbort: boolean;
  isError: boolean;
};
type PendingTurn = { sourceMessageId: string; turnId: string };
type ResetOutcome = { ok: true } | { ok: false; reason: string };
type TurnOutcome = Pick<TurnFinish, 'isAbort' | 'isError'> | null;

/** Resetting closes the send gate before its async persistence work begins. */
export function canSubmitConnectedTurn(
  text: string,
  pending: boolean,
  resetting: boolean,
  blocked?: string,
) {
  return !!text.trim() && !pending && !resetting && !blocked;
}

/**
 * Keep the synchronous reset lock until the SDK transcript has actually been
 * cleared and the prompt has been restored. This is deliberately callback
 * based so the race is testable without reaching into SDK internals.
 */
export async function resetConnectedConversation(
  resettingRef: { current: boolean },
  resetMission: () => Promise<ResetOutcome>,
  clearMessages: () => void,
  setInput: (value: string) => void,
  focusInput: () => void,
): Promise<ResetOutcome> {
  if (resettingRef.current) return { ok: false, reason: 'reset_in_progress' };
  resettingRef.current = true;
  try {
    const result = await resetMission();
    if (!result.ok) return result;
    clearMessages();
    setInput('');
    focusInput();
    return result;
  } finally {
    resettingRef.current = false;
  }
}

function newId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${random ?? Math.random().toString(36).slice(2)}`;
}

function safeStorage(): Storage {
  if (typeof window !== 'undefined') {
    try {
      return window.sessionStorage;
    } catch {
      // Private browsing and blocked storage still get an in-memory session.
    }
  }
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function latestAssistant(messages: readonly UIMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

export function parseVerifiedProductLink(
  href: string | undefined,
  knownIds: ReadonlySet<string>,
  verifiedIds: ReadonlySet<string>,
) {
  const match = href?.match(/^\/product\/([^/?#]+)$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return knownIds.has(id) && verifiedIds.has(id) ? id : null;
}

/** Fixed UI status, never presented as generated Concierge language. */
export function getConnectedTurnSystemNotice(messages: readonly UIMessage[], finish: TurnOutcome) {
  const assistant = latestAssistant(messages);
  const text = assistant ? messageText(assistant) : '';
  if (text.startsWith('[System notice]')) return text;
  if (finish?.isAbort)
    return '[System notice] This request was stopped before a complete response. Existing product choices remain.';
  if (finish?.isError || hasFailedTool(messages))
    return '[System notice] This request could not be completed. Existing product choices remain.';
  return '[System notice] This request did not produce a complete response. Existing product choices remain.';
}

export function ConversationMessage({
  message,
  revealed,
  onProductLink,
}: {
  message: UIMessage;
  revealed: boolean;
  onProductLink?: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const text = messageText(message);
  if (!text) return null;
  if (message.role === 'user')
    return <p className="connected-message connected-user-message">{text}</p>;
  if (!revealed) return null;
  return (
    <div className="connected-message connected-assistant-message connected-markdown">
      <span className="connected-assistant-label" aria-hidden="true">
        Concierge
      </span>
      <Markdown
        options={{
          disableParsingRawHTML: true,
          overrides: {
            a: {
              component: ({
                href,
                children,
                ...props
              }: {
                href?: string;
                children?: ReactNode;
                [key: string]: unknown;
              }) => (
                <a
                  {...props}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    const match = href?.match(/^\/product\/([^/?#]+)$/);
                    if (match && onProductLink) {
                      try {
                        onProductLink(decodeURIComponent(match[1]), event);
                      } catch {
                        /* retain normal PDP navigation */
                      }
                    }
                  }}
                >
                  {children}
                </a>
              ),
            },
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function ConnectedConcierge({
  context,
  blocked,
  onClose,
  open = true,
}: {
  context?: () => Record<string, string>;
  blocked?: string;
  onClose: () => void;
  open?: boolean;
}) {
  const shopperMessage = useRef<ShopperMessage | null>(null);
  const latestTurn = useRef<{ turnId: string; sourceMessageId: string }>({
    turnId: '',
    sourceMessageId: '',
  });
  const finishRef = useRef<TurnFinish | null>(null);
  const resettingRef = useRef(false);
  const manualEditEpoch = useRef(0);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [systemNotices, setSystemNotices] = useState<string[]>([]);
  const [section, setSection] = useState<'conversation' | 'products'>('conversation');
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [briefControls, setBriefControls] = useState<HTMLDivElement | null>(null);
  const session = useMemo(
    () =>
      createConciergeWorkspaceSession({
        storage: safeStorage(),
        initialMissionId: newId('mission'),
        getCurrentShopperMessage: () => shopperMessage.current,
        fetchEvidence: async (body, signal): Promise<RetrieveEvidenceResult> => {
          const response = await fetch('/api/agent-evidence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          });
          if (!response.ok) throw new Error('Evidence retrieval failed.');
          return (await response.json()) as RetrieveEvidenceResult;
        },
      }),
    [],
  );
  const snapshot = useSyncExternalStore(
    session.store.subscribe,
    session.store.getSnapshot,
    session.store.getSnapshot,
  );
  const model = session.getModel();
  const runtime = session.runtime;
  const brief = snapshot?.brief;
  const verifiedProductIds = useMemo(
    () =>
      new Set(
        [...(snapshot?.products ?? []), ...(snapshot?.selectionRecords ?? [])]
          .filter((item) => item.binding === 'evidence_bound')
          .map((item) => item.objectID),
      ),
    [snapshot],
  );
  const handleProductLink = useCallback(
    (id: string, event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const knownIds = new Set([
        ...model.products.map((item) => item.product.id),
        ...model.discoveries.flatMap((group) => group.items.map((item) => item.product.id)),
      ]);
      if (
        !parseVerifiedProductLink(
          `/product/${encodeURIComponent(id)}`,
          knownIds,
          verifiedProductIds,
        )
      )
        return;
      event.preventDefault();
      model.setView(model.products.some((item) => item.product.id === id) ? 'saved' : 'discover');
      setFocusProductId(id);
      setSection('products');
    },
    [model, verifiedProductIds],
  );
  const applyBrief = useCallback(
    async (operation: Parameters<typeof applyBriefOperationsV3>[1]['operations'][number]) => {
      if (!brief) throw new Error('The shopping brief is unavailable.');
      const result = await session.store.transact({
        expectedRevision: brief.revision,
        apply: (current) => ({
          ...current,
          brief: applyBriefOperationsV3(current.brief, {
            missionId: current.missionId,
            expectedRevision: current.brief.revision,
            turnId: newId('ui-turn'),
            operations: [operation],
          }),
        }),
      });
      if (!result.ok)
        throw new Error('The preference changed while this edit was being saved. Try again.');
      manualEditEpoch.current++;
      runtime.invalidateTurn();
    },
    [brief, runtime, session],
  );
  const onUndo = useCallback(async () => {
    if (!brief?.events.length) return;
    const result = await session.store.transact({
      expectedRevision: brief.revision,
      apply: (current) => ({
        ...current,
        brief: undoBriefV3(current.brief, current.brief.revision),
      }),
    });
    if (!result.ok) setError('Undo could not be saved. Try again.');
    else {
      manualEditEpoch.current++;
      runtime.invalidateTurn();
    }
  }, [brief, runtime, session]);
  const tools = useMemo(() => createSdkClientTools(runtime), [runtime]);

  const chatContext = useCallback(() => {
    const currentSession = session.store.getSnapshot();
    const base = context?.() ?? {};
    const latest = latestTurn.current;
    return buildTurnContext(currentSession, base, {
      turnId: latest.turnId,
      sourceMessageId: latest.sourceMessageId,
    });
  }, [context, session]);

  const onFinish = useCallback<ChatOnFinishCallback<UIMessage>>((value) => {
    finishRef.current = {
      messages: value.messages,
      isAbort: value.isAbort,
      isError: value.isError || value.isDisconnect,
    };
  }, []);
  const chat = useChat<UIMessage>({
    transport: { api: '/api/chat' },
    context: chatContext,
    tools,
    persistence: false,
    onFinish,
    requiresSearch: false,
  });

  const onSystemNotice = useCallback((text: string) => {
    setSystemNotices((previous) => (previous.includes(text) ? previous : [...previous, text]));
  }, []);

  const send = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = chat.input.trim();
      if (!canSubmitConnectedTurn(text, !!pending, resettingRef.current, blocked)) return;
      const sourceMessageId = newId('shopper');
      const turnId = newId('turn');
      const startManualEditEpoch = manualEditEpoch.current;
      latestTurn.current = { turnId, sourceMessageId };
      shopperMessage.current = { id: sourceMessageId, text };
      finishRef.current = null;
      runtime.beginTurn(turnId, sourceMessageId);
      setError('');
      setSystemNotices([]);
      setPending({ sourceMessageId, turnId });
      chat.setInput('');
      try {
        await chat.sendMessage({ text, messageId: sourceMessageId });
        await Promise.resolve();
        // The callback is invoked by the SDK while the promise is settling;
        // the assertion keeps TypeScript from treating the mutable ref as its
        // initial null value inside this async closure.
        const finish = finishRef.current as TurnFinish | null;
        const messages = finish?.messages ?? chat.messages;
        const completed =
          !!finish &&
          !finish.isAbort &&
          !finish.isError &&
          !hasFailedTool(messages) &&
          manualEditEpoch.current === startManualEditEpoch &&
          isCompletedAssistantTurn(messages, 'ready');
        if (completed) {
          const committed = await runtime.finishTurnAndPersist(turnId, 'completed');
          const presentationAttempted = runtime.hadPresentationAttempt();
          if (presentationAttempted && !committed) {
            runtime.endTurn(turnId);
            onSystemNotice(
              '[System notice] This request did not produce a validated product selection. Existing product choices remain.',
            );
            return;
          }
          runtime.endTurn(turnId);
          const assistant = latestAssistant(messages);
          if (assistant) setRevealed((previous) => new Set(previous).add(assistant.id));
        } else {
          if (import.meta.env.DEV)
            console.warn('JTV Concierge turn incomplete', {
              hasFinish: !!finish,
              isAbort: finish?.isAbort ?? false,
              isError: finish?.isError ?? false,
              failedTool: hasFailedTool(messages),
              messageCount: messages.length,
            });
          runtime.finishTurn(
            turnId,
            finish?.isAbort ? 'aborted' : finish?.isError ? 'error' : 'exhausted',
          );
          runtime.endTurn(turnId);
          onSystemNotice(getConnectedTurnSystemNotice(messages, finish));
        }
      } catch (cause) {
        if (import.meta.env.DEV)
          console.warn(
            `JTV Concierge send failed: ${cause instanceof Error ? cause.name : typeof cause}: ${cause instanceof Error ? cause.message.slice(0, 180) : 'unknown'}`,
          );
        runtime.finishTurn(turnId, 'error');
        runtime.endTurn(turnId);
        const failedMessages = (finishRef.current as TurnFinish | null)?.messages ?? chat.messages;
        onSystemNotice(
          getConnectedTurnSystemNotice(failedMessages, { isAbort: false, isError: true }),
        );
      } finally {
        setPending(null);
      }
    },
    [blocked, chat, onSystemNotice, pending, runtime],
  );

  const stop = useCallback(() => {
    void chat.stop();
  }, [chat]);
  const startNewConversation = useCallback(async () => {
    if (resettingRef.current) return;
    setResetting(true);
    const result = await resetConnectedConversation(
      resettingRef,
      async () => {
        if (pending) await chat.stop();
        try {
          return await runtime.resetMission(newId('mission'));
        } catch {
          return { ok: false as const, reason: 'reset_failed' };
        }
      },
      chat.clearMessages,
      chat.setInput,
      chat.focusInput,
    );
    if (!result.ok) {
      setResetting(false);
      setError(
        result.reason === 'corrupt_state'
          ? 'The saved session is corrupt, so it was left untouched. New conversation is unavailable.'
          : 'A new conversation could not be saved. Your current session is still here.',
      );
      return;
    }
    finishRef.current = null;
    shopperMessage.current = null;
    latestTurn.current = { turnId: '', sourceMessageId: '' };
    setPending(null);
    setResetting(false);
    setError('');
    setSystemNotices([]);
    setRevealed(new Set());
    setSection('conversation');
  }, [chat, pending, runtime]);
  const visibleMessages = chat.messages;
  const status = pending
    ? chat.status === 'submitted'
      ? 'Sending to Concierge…'
      : 'Concierge is considering your request…'
    : blocked || error || '';

  return (
    <ConciergeWorkspaceLayout
      open={open}
      headerActions={
        <>
          <button
            type="button"
            className="connected-new-conversation"
            aria-label="Start a new conversation"
            title="Start a new conversation"
            disabled={resetting}
            onClick={() => void startNewConversation()}
          >
            New
          </button>
          <div ref={setBriefControls} className="brief-header-controls" />
          <button type="button" aria-label="Close Concierge" onClick={onClose}>
            Close
          </button>
        </>
      }
      preferenceContent={
        brief ? (
          <ConnectedShoppingBrief
            brief={brief}
            controlsTarget={briefControls}
            busy={!!pending}
            onAdd={(fact) => applyBrief({ type: 'add', fact })}
            onReplace={(factIds, fact) => applyBrief({ type: 'replace', factIds, fact })}
            onRetract={(factIds) => applyBrief({ type: 'retract', factIds })}
            onUndo={onUndo}
          />
        ) : null
      }
      sectionSwitch={
        <>
          <button
            aria-pressed={section === 'conversation'}
            onClick={() => setSection('conversation')}
          >
            Conversation
          </button>
          <button aria-pressed={section === 'products'} onClick={() => setSection('products')}>
            Products
          </button>
        </>
      }
      section={section === 'products' ? 'shopping' : 'conversation'}
      messages={
        <>
          {!visibleMessages.length && (
            <div className="connected-welcome">
              <h2>What can I help you find?</h2>
              <p>Tell me who you are shopping for or what caught your eye.</p>
            </div>
          )}
          {visibleMessages.map((message) => (
            <ConversationMessage
              key={message.id}
              message={message}
              revealed={revealed.has(message.id)}
              onProductLink={handleProductLink}
            />
          ))}
          {systemNotices.map((notice) => (
            <p className="connected-system-notice" role="status" key={notice}>
              {notice}
            </p>
          ))}
        </>
      }
      status={
        status ? (
          <p className="connected-status" role="status">
            {status}
          </p>
        ) : null
      }
      composer={
        <form className="connected-prompt" onSubmit={send}>
          <div className="connected-prompt-row">
            <input
              id="connected-concierge-input"
              aria-label="Message the Concierge"
              value={chat.input}
              onChange={(event) => chat.setInput(event.currentTarget.value)}
              disabled={!!pending || resetting || !!blocked}
              placeholder="What are you looking for?"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!canSubmitConnectedTurn(chat.input, !!pending, resetting, blocked)}
            >
              Send
            </button>
          </div>
          {pending && (
            <button className="connected-stop" type="button" onClick={stop}>
              Stop
            </button>
          )}
        </form>
      }
      productWorkspace={<ShoppingWorkspace model={model} focusProductId={focusProductId} />}
    />
  );
}
