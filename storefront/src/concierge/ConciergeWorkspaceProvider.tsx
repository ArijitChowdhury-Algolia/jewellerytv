import { normalizeProduct, type Product } from '../catalog';
import type { WorkspaceViewModel } from '../ProductWorkspace';
import { createSessionStore } from './sessionStore.js';
import { createConciergeToolRuntime } from './toolRuntime';
import type { StorageLike } from './sessionPersistence.js';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types.js';
import type { ShopperMessage } from '../../shared/concierge/state/updateShoppingState.js';
import type { SourceBoundProduct } from '../../shared/concierge/sessionContract.js';
import { createExactProductRefresh } from './exactProductRefresh.js';

type Runtime = ReturnType<typeof createConciergeToolRuntime>;
type Store = ReturnType<typeof createSessionStore>;
type ProductEntry = { product: Product; quantity: number; observedAt: string };

function normalize(raw: unknown): Product | null {
  try {
    return normalizeProduct(raw);
  } catch {
    return null;
  }
}
function entry(raw: SourceBoundProduct): ProductEntry | null {
  const product = normalize(raw.raw);
  return product ? { product, quantity: raw.quantity, observedAt: raw.observedAt ?? '' } : null;
}

export type ConciergeWorkspaceSession = {
  store: Store;
  runtime: Runtime;
  getModel: () => WorkspaceViewModel;
};

export function createConciergeWorkspaceSession(options: {
  storage: StorageLike;
  initialMissionId: string;
  getCurrentShopperMessage: () => ShopperMessage | null;
  fetchEvidence: (body: unknown, signal?: AbortSignal) => Promise<RetrieveEvidenceResult>;
  fetchExactProducts?: (body: unknown, signal?: AbortSignal) => Promise<RetrieveEvidenceResult>;
}): ConciergeWorkspaceSession {
  const store = createSessionStore(options.storage, options.initialMissionId);
  const runtime = createConciergeToolRuntime({
    ...options,
    sessionStore: store,
    fetchEvidence: options.fetchEvidence as Parameters<
      typeof createConciergeToolRuntime
    >[0]['fetchEvidence'],
  });
  const fetchExactProducts =
    options.fetchExactProducts ??
    (async (body: unknown) => {
      const response = await fetch('/api/agent-product-refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Exact product refresh failed');
      return (await response.json()) as RetrieveEvidenceResult;
    });
  const refresh = createExactProductRefresh(store, fetchExactProducts);
  function getModel(): WorkspaceViewModel {
    const session = store.getSnapshot();
    if (!session) {
      const disabled = () => undefined;
      return {
        products: [],
        selectionRecords: [],
        discoveries: [],
        activeView: 'discover',
        setView: disabled,
        compareIds: [],
        combinationIds: [],
        combinationQuantities: {},
        toggleCompare: disabled,
        toggleCombination: disabled,
        pin: disabled,
        remove: disabled,
        setQuantity: disabled,
        refreshProducts: refresh.refreshProducts,
        refreshing: false,
        refreshError: 'The saved session is unavailable. Workspace actions are disabled.',
        budgetCents: null,
        budgetScope: 'total',
        assessment: () => 'Needs verification',
      };
    }
    const state = session;
    const all = [...(state?.products ?? []), ...(state?.selectionRecords ?? [])];
    const products = new Map(all.map((item) => [item.objectID, item]));
    const proposal = state.committedProposal ?? null;
    const groups =
      proposal?.groups.flatMap((group) => {
        const items = group.lines.flatMap((line) => {
          const persisted = products.get(line.objectID);
          const raw = persisted?.raw;
          const product = normalize(raw);
          return product
            ? [
                {
                  product,
                  why: line.explanation,
                  assessment:
                    proposal.assessment.perItem === 'accepted'
                      ? ('compliant' as const)
                      : ('unknown' as const),
                },
              ]
            : [];
        });
        return items.length ? [{ title: group.title, items }] : [];
      }) ?? [];
    const proposedLooks =
      proposal?.kind === 'complete_looks'
        ? proposal.groups.map((group) => ({
            title: group.title,
            lines: group.lines.flatMap((line) => {
              const product = normalize(products.get(line.objectID)?.raw);
              return product ? [{ product, why: line.explanation, quantity: line.quantity }] : [];
            }),
            itemSubtotalCents: group.itemSubtotalCents,
          }))
        : [];
    const selectedProducts = new Map<string, Product>();
    for (const item of all) {
      const product = normalize(item.raw);
      if (product) selectedProducts.set(item.objectID, product);
    }
    for (const group of groups)
      for (const item of group.items) selectedProducts.set(item.product.id, item.product);
    const expectedRevision = state?.brief.revision ?? 0;
    const transact = (apply: (current: typeof state) => typeof state | Promise<typeof state>) => {
      if (!state) return;
      void store.transact({
        expectedRevision,
        apply: (current) => apply(current as typeof state) as typeof current,
      });
    };
    const legacyIds = new Set(
      (state?.products ?? [])
        .filter((item) => item.binding === 'legacy_unbound')
        .map((item) => item.objectID),
    );
    const verifiedIds = new Set(
      proposal?.assessment.perItem === 'accepted'
        ? proposal.groups.flatMap((group) => group.lines.map((line) => line.objectID))
        : [],
    );
    const assessment = (product: Product, status?: 'compliant' | 'unknown') => {
      if (verifiedIds.has(product.id)) return null;
      if (legacyIds.has(product.id) || !status) return 'Needs verification';
      return status === 'unknown' ? 'Needs verification' : null;
    };
    const budgetFact = state?.brief.facts.find(
      (fact) =>
        fact.status === 'active' &&
        fact.field === 'budget' &&
        fact.strength === 'requirement' &&
        fact.certainty === 'explicit' &&
        fact.value.kind === 'money' &&
        fact.value.basis !== 'unresolved',
    );
    const model: WorkspaceViewModel = {
      products: state.products.flatMap(entry).filter((item): item is ProductEntry => item !== null),
      selectionRecords: [...selectedProducts.values()],
      discoveries: groups,
      proposedLooks,
      activeView: state.activeView ?? 'discover',
      setView: (activeView) => transact((current) => ({ ...current, activeView })),
      compareIds: state.compareIds ?? [],
      combinationIds: state.combinationIds ?? [],
      combinationQuantities: state.combinationQuantities ?? {},
      toggleCompare: (id) =>
        transact((current) => {
          const ids = [...current.compareIds];
          const index = ids.indexOf(id);
          if (index >= 0) ids.splice(index, 1);
          else if (ids.length < 3 && selectedProducts.has(id)) ids.push(id);
          else return current;
          return { ...current, compareIds: ids };
        }),
      toggleCombination: (id) =>
        transact((current) => {
          const ids = [...current.combinationIds];
          const index = ids.indexOf(id);
          if (index >= 0) ids.splice(index, 1);
          else if (ids.length < 3 && selectedProducts.has(id)) ids.push(id);
          else return current;
          return { ...current, combinationIds: ids };
        }),
      pin: (raw) => {
        if ((state?.products.length ?? 0) >= 12) return;
        const product = normalize(raw);
        if (!product || state.products.some((item) => item.objectID === product.id)) return;
        const existing = state.selectionRecords.find((item) => item.objectID === product.id);
        if (!existing || existing.binding !== 'evidence_bound') return;
        transact((current) => ({ ...current, products: [...current.products, existing] }));
      },
      remove: (id) =>
        transact((current) => ({
          ...current,
          products: current.products.filter((item) => item.objectID !== id),
        })),
      setQuantity: (id, quantity) => {
        if (quantity >= 1 && quantity <= 10)
          transact((current) => ({
            ...current,
            combinationQuantities: { ...current.combinationQuantities, [id]: quantity },
          }));
      },
      refreshProducts: refresh.refreshProducts,
      refreshing: refresh.isRefreshing(),
      refreshError: refresh.getError(),
      budgetCents:
        budgetFact?.value.kind === 'money' && budgetFact.value.currency === 'USD'
          ? budgetFact.value.cents
          : null,
      budgetScope:
        budgetFact?.value.kind === 'money' && budgetFact.value.basis === 'per-item'
          ? 'per-item'
          : 'total',
      assessment,
    };
    return model;
  }
  return { store, runtime, getModel };
}
