import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import { useChat } from 'react-instantsearch';
import type { ChatOnFinishCallback, UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import Markdown from 'markdown-to-jsx';
import { X } from 'lucide-react';
import { ShoppingWorkspace } from '../ShoppingWorkspace';
import { ConciergeWorkspaceLayout } from './ConciergeWorkspaceLayout';
import { ResponsiveAnswerTable } from './ResponsiveAnswerTable';
import { ConnectedShoppingBrief } from './ConnectedShoppingBrief';
import { createConciergeWorkspaceSession } from './ConciergeWorkspaceProvider';
import { createSdkClientTools } from './sdkTools';
import { hasFailedTool, isCompletedAssistantTurn } from './turnCompletion';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types.js';
import type { ShopperMessage } from '../../shared/concierge/state/updateShoppingState.js';
import { applyBriefOperationsV3, undoBriefV3 } from '../../shared/briefState.js';
import { buildTurnContext } from './turnContext.js';
import { canonicalBlogUrlsFromMessages, verifiedBlogHref } from './verifiedBlogLinks.js';

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

/** Show only current-turn SDK activity; elapsed time is displayed separately. */
export function connectedProgressLabel(
  chatStatus: string,
  messages: readonly UIMessage[],
  sourceMessageId: string,
) {
  if (chatStatus === 'submitted') return 'Sending to Concierge';
  const sourceIndex = messages.findIndex(
    (message) => message.role === 'user' && message.id === sourceMessageId,
  );
  if (sourceIndex < 0) return 'Concierge is working';
  const parts = messages
    .slice(sourceIndex + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts) as Array<{ type: string; state?: string; text?: string }>;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part.type === 'text' && part.text?.trim()) return 'Concierge is replying';
    if (!part.type.startsWith('tool-')) continue;
    if (part.state === 'output-available' || part.state === 'output-error')
      return 'Continuing your request';
    if (part.state !== 'input-streaming' && part.state !== 'input-available') continue;
    if (part.type === 'tool-update_shopping_state') return 'Updating preferences';
    if (part.type === 'tool-retrieve_evidence') return 'Checking JTV information';
    if (part.type === 'tool-present_choices') return 'Preparing product choices';
    return 'Working with JTV information';
  }
  return 'Concierge is working';
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

function displayTextParts(message: UIMessage) {
  if (message.role === 'user') {
    const text = messageText(message);
    return text ? [text] : [];
  }
  const segments: string[] = [];
  let current = '';
  for (const part of message.parts) {
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      current += part.text;
    } else if (current.trim()) {
      segments.push(current);
      current = '';
    } else {
      current = '';
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

/** Persisted turns are shown after reload only when their final response is complete. */
export function isRestoredAssistantMessage(message: UIMessage) {
  if (message.role !== 'assistant') return false;
  let hasFinalText = false;
  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.state === 'streaming') return false;
      if (typeof part.text === 'string' && part.text.trim()) hasFinalText = true;
      continue;
    }
    if (
      'state' in part &&
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      part.state !== 'output-available'
    )
      return false;
  }
  return hasFinalText && !messageText(message).startsWith('[System notice]');
}

export function getConnectedChatPersistenceOptions(missionId: string) {
  return { id: missionId, persistence: true as const };
}

type CompletionReceipt = { version: 1; assistantMessageIds: string[] };

function completionReceiptKey(missionId: string) {
  return `jtv-concierge-completed-${missionId}`;
}

export function readCompletedAssistantMessageIds(storage: Storage, missionId: string) {
  try {
    const parsed = JSON.parse(
      storage.getItem(completionReceiptKey(missionId)) ?? 'null',
    ) as Partial<CompletionReceipt> | null;
    return parsed?.version === 1 && Array.isArray(parsed.assistantMessageIds)
      ? new Set(parsed.assistantMessageIds.filter((id): id is string => typeof id === 'string'))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function recordCompletedAssistantMessage(
  storage: Storage,
  missionId: string,
  assistantMessageId: string,
) {
  const ids = readCompletedAssistantMessageIds(storage, missionId);
  ids.add(assistantMessageId);
  try {
    storage.setItem(
      completionReceiptKey(missionId),
      JSON.stringify({ version: 1, assistantMessageIds: [...ids] } satisfies CompletionReceipt),
    );
  } catch {
    // Transcript persistence remains best effort when browser storage is unavailable.
  }
}

export function clearCompletedAssistantMessages(storage: Storage, missionId: string) {
  try {
    storage.removeItem(completionReceiptKey(missionId));
  } catch {
    // Storage failures must not block the mission reset itself.
  }
}

export function visibleConnectedTranscript(messages: UIMessage[], resetting: boolean) {
  return resetting ? [] : messages;
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
  provisional = false,
  verifiedBlogUrls,
  knownProductIds = new Set<string>(),
  verifiedProductIds = new Set<string>(),
  onProductLink,
}: {
  message: UIMessage;
  revealed: boolean;
  provisional?: boolean;
  verifiedBlogUrls?: ReadonlySet<string>;
  knownProductIds?: ReadonlySet<string>;
  verifiedProductIds?: ReadonlySet<string>;
  onProductLink?: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const textParts = displayTextParts(message);
  if (!textParts.length) return null;
  if (message.role === 'user')
    return <p className="connected-message connected-user-message">{textParts[0]}</p>;
  if (!revealed && !provisional) return null;
  return (
    <div
      className={`connected-message connected-assistant-message${provisional ? ' connected-provisional' : ' connected-markdown'}`}
      aria-live={provisional ? 'off' : undefined}
    >
      <span className="connected-assistant-label" aria-hidden="true">
        Concierge
      </span>
      {textParts.map((text, index) => (
        <div className="connected-assistant-text-part" key={`${message.id}-text-${index}`}>
          {provisional ? (
            text
          ) : (
            <Markdown
              options={{
                disableParsingRawHTML: true,
                overrides: {
                  table: {
                    component: ResponsiveAnswerTable,
                  },
                  a: {
                    component: ({ href, children }: { href?: string; children?: ReactNode }) => {
                      const productId = href?.match(/^\/product\/[^/?#]+$/)
                        ? parseVerifiedProductLink(href, knownProductIds, verifiedProductIds)
                        : null;
                      const productHref = productId ? href : null;
                      const articleHref = verifiedBlogHref(href, verifiedBlogUrls ?? new Set());
                      const safeHref = productHref ?? articleHref;
                      if (!safeHref) return <span>{children}</span>;
                      return (
                        <a
                          href={safeHref}
                          target={productHref ? undefined : '_blank'}
                          rel={productHref ? undefined : 'noopener noreferrer'}
                          onClick={
                            productId && onProductLink
                              ? (event) => onProductLink(productId, event)
                              : undefined
                          }
                        >
                          {children}
                        </a>
                      );
                    },
                  },
                },
              }}
            >
              {text}
            </Markdown>
          )}
        </div>
      ))}
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [systemNotices, setSystemNotices] = useState<string[]>([]);
  const [section, setSection] = useState<'conversation' | 'products'>('conversation');
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [focusProductRequest, setFocusProductRequest] = useState(0);
  const [briefControls, setBriefControls] = useState<HTMLDivElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  const onMessagesScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    followTranscriptRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
  }, []);
  const pendingTurnId = pending?.turnId;
  useEffect(() => {
    if (!pendingTurnId) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [pendingTurnId]);
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
        fetchVocabulary: async () => {
          const response = await fetch('/api/catalog-vocabulary');
          if (!response.ok) throw new Error('Catalogue vocabulary unavailable.');
          const payload = (await response.json()) as {
            builtAt: string;
            values: Record<string, string[]>;
          };
          return {
            values: payload.values,
            builtAt: payload.builtAt,
            hasValue: (attribute, value) => (payload.values[attribute] ?? []).includes(value),
            availableValues: (attribute) => payload.values[attribute] ?? [],
            isFilterable: (attribute) => attribute in payload.values,
          };
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
      event.preventDefault();
      const knownProductIds = new Set([
        ...model.products.map((item) => item.product.id),
        ...model.selectionRecords.map((item) => item.id),
        ...model.discoveries.flatMap((group) => group.items.map((item) => item.product.id)),
      ]);
      if (
        !parseVerifiedProductLink(
          `/product/${encodeURIComponent(id)}`,
          knownProductIds,
          verifiedProductIds,
        )
      )
        return;
      model.setView('discover');
      setFocusProductId(id);
      setFocusProductRequest((request) => request + 1);
      setSection('products');
      void model.refreshProducts([id]);
    },
    [model, verifiedProductIds],
  );
  const knownProductIds = useMemo(
    () =>
      new Set([
        ...model.products.map((item) => item.product.id),
        ...model.selectionRecords.map((item) => item.id),
        ...model.discoveries.flatMap((group) => group.items.map((item) => item.product.id)),
      ]),
    [model.products, model.selectionRecords, model.discoveries],
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

  const chatPersistenceOptions = useMemo(
    () => getConnectedChatPersistenceOptions(snapshot?.missionId ?? ''),
    [snapshot?.missionId],
  );

  const onFinish = useCallback<ChatOnFinishCallback<UIMessage>>((value) => {
    finishRef.current = {
      messages: value.messages,
      isAbort: value.isAbort,
      isError: value.isError || value.isDisconnect,
    };
  }, []);
  const chat = useChat<UIMessage>({
    ...chatPersistenceOptions,
    transport: { api: '/api/chat' },
    context: chatContext,
    tools,
    onFinish,
    requiresSearch: false,
  });

  const hydratedTranscriptId = useRef<string | null>(null);
  useEffect(() => {
    if (hydratedTranscriptId.current === chatPersistenceOptions.id) return;
    hydratedTranscriptId.current = chatPersistenceOptions.id;
    const completedIds = readCompletedAssistantMessageIds(safeStorage(), chatPersistenceOptions.id);
    const restored = chat.messages.filter(
      (message) => completedIds.has(message.id) && isRestoredAssistantMessage(message),
    );
    if (!restored.length) return;
    setRevealed((previous) => {
      const next = new Set(previous);
      restored.forEach((message) => next.add(message.id));
      return next.size === previous.size ? previous : next;
    });
  }, [chat.messages, chatPersistenceOptions.id]);

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
      followTranscriptRef.current = true;
      setElapsedSeconds(0);
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
          if (assistant) {
            recordCompletedAssistantMessage(safeStorage(), chatPersistenceOptions.id, assistant.id);
            setRevealed((previous) => new Set(previous).add(assistant.id));
          }
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
    [blocked, chat, chatPersistenceOptions.id, onSystemNotice, pending, runtime],
  );

  const startNewConversation = useCallback(async () => {
    if (resettingRef.current) return;
    const previousMissionId = chatPersistenceOptions.id;
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
    clearCompletedAssistantMessages(safeStorage(), previousMissionId);
    finishRef.current = null;
    shopperMessage.current = null;
    latestTurn.current = { turnId: '', sourceMessageId: '' };
    setPending(null);
    setResetting(false);
    setError('');
    setSystemNotices([]);
    setRevealed(new Set());
    setSection('conversation');
  }, [chat, chatPersistenceOptions.id, pending, runtime]);
  const visibleMessages = visibleConnectedTranscript(chat.messages, resetting);
  const pendingSourceIndex = pending
    ? visibleMessages.findIndex(
        (message) => message.role === 'user' && message.id === pending.sourceMessageId,
      )
    : -1;
  const pendingAssistantText =
    pendingSourceIndex < 0
      ? ''
      : visibleMessages
          .slice(pendingSourceIndex + 1)
          .filter((message) => message.role === 'assistant')
          .map(messageText)
          .join('\n');
  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (viewport && followTranscriptRef.current) viewport.scrollTop = viewport.scrollHeight;
  }, [pendingAssistantText, visibleMessages.length, revealed, systemNotices.length]);
  const verifiedBlogUrls = useMemo(
    () =>
      canonicalBlogUrlsFromMessages(visibleMessages.filter((message) => revealed.has(message.id))),
    [visibleMessages, revealed],
  );
  const pendingStatus = pending
    ? connectedProgressLabel(chat.status, chat.messages, pending.sourceMessageId)
    : '';
  const status = pending ? '' : blocked || error || '';

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
        </>
      }
      closeAction={
        <button type="button" aria-label="Close Concierge" title="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
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
      messagesViewportRef={messagesViewportRef}
      onMessagesScroll={onMessagesScroll}
      messages={
        <>
          {!visibleMessages.length && (
            <div className="connected-welcome">
              <img
                className="connected-welcome-logo"
                src="/assets/jtv-logo-full.png"
                alt="JTV — Jewelry Television"
                width="365"
                height="273"
              />
            </div>
          )}
          {visibleMessages.map((message, index) => (
            <ConversationMessage
              key={message.id}
              message={message}
              revealed={revealed.has(message.id)}
              provisional={
                pendingSourceIndex >= 0 &&
                index > pendingSourceIndex &&
                message.role === 'assistant' &&
                !revealed.has(message.id)
              }
              knownProductIds={knownProductIds}
              verifiedProductIds={verifiedProductIds}
              verifiedBlogUrls={verifiedBlogUrls}
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
            <div className="connected-prompt-field">
              <input
                id="connected-concierge-input"
                aria-label="Message the Concierge"
                aria-busy={!!pending}
                value={chat.input}
                onChange={(event) => chat.setInput(event.currentTarget.value)}
                disabled={!!pending || resetting || !!blocked}
                placeholder={pending ? '' : 'Shall we find something delighting?'}
                autoComplete="off"
              />
              {pending && (
                <span className="connected-progress" role="status" aria-live="polite">
                  <span className="connected-progress-dots" aria-hidden="true">
                    <span className="connected-progress-dot" />
                    <span className="connected-progress-dot" />
                    <span className="connected-progress-dot" />
                  </span>
                  <span className="connected-progress-label">{pendingStatus}</span>
                  <span className="connected-progress-time" aria-hidden="true">
                    {elapsedSeconds}s
                  </span>
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={!canSubmitConnectedTurn(chat.input, !!pending, resetting, blocked)}
            >
              Send
            </button>
          </div>
        </form>
      }
      productWorkspace={
        <ShoppingWorkspace
          model={model}
          focusProductId={focusProductId}
          focusProductRequest={focusProductRequest}
          onPreviewClose={() => setFocusProductId(null)}
          onStart={() => {
            setSection('conversation');
            requestAnimationFrame(() =>
              document.getElementById('connected-concierge-input')?.focus(),
            );
          }}
        />
      }
    />
  );
}
