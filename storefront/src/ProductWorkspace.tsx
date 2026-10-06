import { useState, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useShopping, type PinnedProduct } from './ShoppingProvider';
import { type Product } from './catalog';
import { productURL } from './routing';
import { pairTotal } from '../shared/shopping';
import './product-workspace.css';
import { markWorkspace, markWorkspaceImage, type WorkspaceTraceBinding } from './telemetry';
import { checkBriefConflicts, checkCombinationBudget } from '../shared/briefConstraints';
export type View = 'discover' | 'compare' | 'saved' | 'combination';
type Discovery = {
  title: string;
  why?: string;
  items: { product: Product; why?: string; assessment?: 'compliant' | 'unknown' }[];
};
export type WorkspaceViewModel = {
  products: PinnedProduct[];
  selectionRecords: Product[];
  discoveries: Discovery[];
  proposedLooks?: {
    title: string;
    lines: { product: Product; why: string; quantity: number }[];
    itemSubtotalCents: number | null;
  }[];
  displayIntro?: string;
  comparisonIntro?: string;
  activeView: View;
  setView: (v: View) => void;
  compareIds: string[];
  combinationIds: string[];
  combinationQuantities: Record<string, number>;
  toggleCompare: (id: string) => void;
  toggleCombination: (id: string) => void;
  pin: (raw: unknown) => void;
  remove: (id: string) => void;
  setQuantity: (id: string, n: number) => void;
  refreshProducts: (ids: string[]) => Promise<void>;
  refreshing: boolean;
  refreshError: string;
  budgetCents: number | null;
  budgetScope: 'total' | 'per-item';
  assessment?: (product: Product, retrievalStatus?: 'compliant' | 'unknown') => ReactNode;
  combinationAssessment?: (
    selected: readonly { product: Product; quantity: number }[],
  ) => ReactNode;
  budgetSummary?: (args: {
    knownSubtotalCents: number;
    totalCents: number | null;
    unknownCount: number;
    budgetCents: number | null;
    budgetScope: 'total' | 'per-item';
  }) => ReactNode;
};
type ProductShopping = WorkspaceViewModel & { brief?: import('../shared/briefSchema').BriefState };
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function workspaceSaveAction(model: WorkspaceViewModel, product: Product) {
  return model.products.some((item) => item.product.id === product.id)
    ? model.remove(product.id)
    : model.pin(product.raw);
}
export function workspaceCompareAction(model: WorkspaceViewModel, product: Product) {
  return model.toggleCompare(product.id);
}
export function workspaceCombinationAction(model: WorkspaceViewModel, product: Product) {
  return model.toggleCombination(product.id);
}
function PlainText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, i) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </>
  );
}
function ProductImage({ product, binding }: { product: Product; binding?: WorkspaceTraceBinding }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const source = product.images[0];
  const report = (outcome: 'loaded' | 'failed') => {
    if (binding) markWorkspaceImage(binding, `${product.id}:${source}`, outcome);
  };
  useEffect(() => {
    setFailed(false);
    if (img.current?.complete && source) report(img.current.naturalWidth > 0 ? 'loaded' : 'failed');
  }, [source, binding?.requestId]);
  return (
    <div className="pw-image">
      {source && !failed ? (
        <img
          ref={img}
          src={source}
          alt={product.title}
          loading="lazy"
          onLoad={() => report('loaded')}
          onError={() => {
            setFailed(true);
            report('failed');
          }}
        />
      ) : (
        <span>Image unavailable</span>
      )}
    </div>
  );
}
function EmptyProducts({ hint }: { hint: string }) {
  return (
    <div className="pw-empty-brand">
      <h2>
        Jewelry you’ll love.
        <br />A little help finding it.
      </h2>
      <p>{hint}</p>
    </div>
  );
}
function Price({ product }: { product: Product }) {
  return (
    <strong className="pw-price">
      {product.price === null ? 'Price unavailable' : money(Math.round(product.price * 100))}
    </strong>
  );
}
export function ProductWorkspace({
  onAsk,
  model,
  focusProductId,
}: {
  onAsk?: (text: string) => void;
  model?: WorkspaceViewModel;
  focusProductId?: string | null;
}) {
  const legacy = useShopping();
  const location = typeof window === 'undefined' ? { pathname: '/', search: '' } : window.location;
  const raw = model ?? legacy;
  const supplied = !!model;
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    if (!previewId || !raw) return;
    const exists =
      raw.products.some((p) => p.product.id === previewId) ||
      raw.discoveries.some((g) => g.items.some((i) => i.product.id === previewId));
    if (!exists) setPreviewId(null);
  }, [previewId, raw?.products, raw?.discoveries]);
  const displayBinding = legacy?.displayTrace;
  const displayCount = raw?.discoveries.reduce((n, g) => n + g.items.length, 0) ?? 0;
  useLayoutEffect(() => {
    if (!displayBinding || !displayCount) return;
    markWorkspace(displayBinding, 'commit', displayCount);
    let afterPaint = 0;
    const beforePaint = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() =>
        markWorkspace(displayBinding, 'paint-observed', displayCount),
      );
    });
    return () => {
      cancelAnimationFrame(beforePaint);
      cancelAnimationFrame(afterPaint);
    };
  }, [displayBinding?.requestId, displayBinding?.revision, displayCount]);
  useEffect(() => {
    if (!focusProductId || typeof document === 'undefined') return;
    const target = document.querySelector<HTMLElement>(
      `[data-product-id="${CSS.escape(focusProductId)}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  }, [focusProductId, raw?.activeView]);
  if (!raw) return null;
  // This view consumes the provider contract; the provider remains the sole state owner.
  const s = raw as ProductShopping;
  const discoveries = s.discoveries ?? [];
  const view = s.activeView ?? 'discover';
  const byId = new Map<string, Product>();
  s.selectionRecords.forEach((p) => byId.set(p.id, p));
  discoveries.forEach((g) => g.items.forEach((i) => byId.set(i.product.id, i.product)));
  s.products.forEach((p) => byId.set(p.product.id, p.product));
  const activePreview = previewId && byId.has(previewId) ? previewId : null;
  const selectedIds = view === 'combination' ? (s.combinationIds ?? []) : s.compareIds;
  const selected = selectedIds.flatMap((id) => {
    const product = byId.get(id);
    return product ? [{ product, quantity: s.combinationQuantities[id] ?? 1 }] : [];
  });
  const missing = selectedIds.filter((id) => !byId.has(id)).length;
  const totals = pairTotal(selected.map((p) => ({ price: p.product.price, quantity: p.quantity })));
  const combinationCheck =
    !supplied && s.brief
      ? checkCombinationBudget(
          s.brief,
          selected.map((p) => ({ price: p.product.price, quantity: p.quantity })),
        )
      : null;
  function imageBinding(p: Product) {
    return discoveries.some((g) => g.items.some((i) => i.product.id === p.id))
      ? displayBinding
      : undefined;
  }
  function assessment(p: Product, retrievalStatus?: 'compliant' | 'unknown') {
    if (supplied && s.assessment) return s.assessment(p, retrievalStatus);
    if (retrievalStatus !== undefined)
      return retrievalStatus === 'unknown' ? (
        <details className="pw-status">
          <summary>Needs verification</summary>
        </details>
      ) : null;
    if (supplied || !s.brief) return null;
    const result = checkBriefConflicts(s.brief, p.raw);
    if (result.status === 'compliant') return null;
    return (
      <details className={result.status === 'conflict' ? 'pw-error' : 'pw-status'}>
        <summary>
          {result.status === 'conflict' ? 'Check against your brief' : 'Needs verification'}
        </summary>
        {result.reasons.length > 0 && (
          <ul>
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {result.status === 'conflict' && onAsk && (
          <button
            onClick={() =>
              onAsk(`Find an alternative to ${p.title} (${p.id}) that fits my current brief.`)
            }
          >
            Find an alternative
          </button>
        )}
      </details>
    );
  }
  async function changeView(next: View) {
    setPreviewId(null);
    s.setView(next);
    const ids =
      next === 'compare'
        ? s.compareIds
        : next === 'combination'
          ? (s.combinationIds ?? [])
          : next === 'saved'
            ? s.products.map((p) => p.product.id)
            : [];
    if (ids.length) await s.refreshProducts(ids);
  }
  function actions(p: Product) {
    const saved = s.products.some((x) => x.product.id === p.id);
    return (
      <div className="pw-actions">
        <button aria-pressed={saved} onClick={() => workspaceSaveAction(s, p)}>
          {saved ? 'Remove from saved' : 'Save'}
        </button>
        <button
          aria-pressed={s.compareIds.includes(p.id)}
          disabled={!s.compareIds.includes(p.id) && s.compareIds.length >= 3}
          onClick={() => workspaceCompareAction(s, p)}
        >
          {s.compareIds.includes(p.id) ? 'Comparing ✓' : 'Compare'}
        </button>
        <details className="pw-more">
          <summary>More</summary>
          <button
            disabled={!s.combinationIds.includes(p.id) && s.combinationIds.length >= 3}
            onClick={() => workspaceCombinationAction(s, p)}
          >
            {s.combinationIds.includes(p.id) ? 'Remove from combination' : 'Add to combination'}
          </button>
        </details>
      </div>
    );
  }
  function tile(
    p: Product,
    why?: string,
    direction?: string,
    retrievalStatus?: 'compliant' | 'unknown',
  ) {
    return (
      <article className="pw-product" key={p.id} data-product-id={p.id} tabIndex={-1}>
        <p className="pw-direction">{direction || ''}</p>
        <button
          className="pw-image-button"
          aria-label={`View details: ${p.title}`}
          onClick={() => {
            setPreviewId(p.id);
            void s.refreshProducts([p.id]);
          }}
        >
          <ProductImage product={p} binding={imageBinding(p)} />
        </button>
        <div className="pw-product-copy">
          <h3>{p.title}</h3>
          <Price product={p} />
          <p className="pw-why">{why && <PlainText text={why} />}</p>
          <div className="pw-evidence">
            <small>
              {p.inStock === true
                ? 'Listed in stock'
                : p.inStock === false
                  ? 'Listed unavailable'
                  : 'Availability not recorded'}
            </small>
            {assessment(p, retrievalStatus)}
          </div>
          {actions(p)}
        </div>
      </article>
    );
  }
  const groupedDiscoveries = discoveries.map((group) => ({
    ...group,
    items: [...new Map(group.items.map((item) => [item.product.id, item] as const)).values()],
  }));
  return (
    <section className="product-workspace" aria-label="Shopping choices">
      <nav className="pw-views" aria-label="Product views">
        {(['discover', 'compare', 'saved', 'combination'] as View[]).map((v) => (
          <button
            key={v}
            aria-current={view === v ? 'page' : undefined}
            onClick={() => void changeView(v)}
          >
            {v === 'discover'
              ? 'Discover'
              : v === 'compare'
                ? `Compare${s.compareIds.length ? ` (${s.compareIds.length})` : ''}`
                : v === 'saved'
                  ? `Saved${s.products.length ? ` (${s.products.length})` : ''}`
                  : `Combination${s.combinationIds?.length ? ` (${s.combinationIds.length})` : ''}`}
          </button>
        ))}
      </nav>
      {s.refreshing && (
        <p className="pw-status" role="status">
          Checking the latest catalogue details…
        </p>
      )}
      {s.refreshError && (
        <p className="pw-error" role="alert">
          {s.refreshError}
        </p>
      )}
      {activePreview && (
        <section className="pw-preview" aria-label="Product preview">
          <button onClick={() => setPreviewId(null)}>Back to choices</button>
          <ProductImage
            product={byId.get(activePreview!)!}
            binding={imageBinding(byId.get(activePreview!)!)}
          />
          <h3>{byId.get(activePreview!)!.title}</h3>
          <Price product={byId.get(activePreview!)!} />
          <p>{byId.get(activePreview!)!.description}</p>
          <a
            className="pw-pdp-link"
            href={productURL(byId.get(activePreview!)!.id, location.pathname, location.search)}
          >
            View product page
          </a>
          <dl>
            {byId.get(activePreview!)!.attributes.map((a) => (
              <div key={a.label}>
                <dt>{a.label}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
          {actions(byId.get(activePreview!)!)}
        </section>
      )}
      {!activePreview && view === 'discover' && (
        <div className="pw-discover">
          {!discoveries.length ? (
            <EmptyProducts hint="Discover a new favorite in every shade, stone and style." />
          ) : (
            <div className="pw-discovery-groups" data-group-count={groupedDiscoveries.length}>
              {groupedDiscoveries.map((group, index) => (
                <section
                  className="pw-discovery-group"
                  key={`${group.title}-${index}`}
                  aria-labelledby={`pw-group-${index}`}
                >
                  <h3 id={`pw-group-${index}`}>{group.title}</h3>
                  <div className="pw-group-items">
                    {group.items.map(({ product, why, assessment: retrievalStatus }) =>
                      tile(product, why, undefined, retrievalStatus),
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      {!activePreview && view === 'saved' && (
        <div className="pw-saved">
          {s.products.length ? (
            <div className="pw-grid">{s.products.map(({ product }) => tile(product))}</div>
          ) : (
            <EmptyProducts hint="Save a piece you like, and keep it here." />
          )}
        </div>
      )}
      {!activePreview && view === 'combination' && !!s.proposedLooks?.length && (
        <div className="pw-proposed-looks" aria-label="Concierge look options">
          {s.proposedLooks.map((look, index) => (
            <section className="pw-discovery-group" key={`${look.title}-${index}`}>
              <h3>{look.title}</h3>
              <div className="pw-group-items">
                {look.lines.map(({ product, why, quantity }) =>
                  tile(product, quantity > 1 ? `${why} · Quantity ${quantity}` : why),
                )}
              </div>
              <p className="pw-subtotal">
                <span>
                  {look.itemSubtotalCents === null ? 'Known item subtotal' : 'Item subtotal'}
                </span>
                <strong>
                  {look.itemSubtotalCents === null ? 'Unavailable' : money(look.itemSubtotalCents)}
                </strong>
              </p>
            </section>
          ))}
        </div>
      )}
      {!activePreview && (view === 'compare' || view === 'combination') && (
        <div className="pw-selection">
          {missing > 0 && (
            <p className="pw-error">
              {missing} selected piece{missing > 1 ? 's need' : ' needs'} to be retrieved again
              before we can show a complete {view}.
            </p>
          )}
          {!selected.length ? (
            view === 'combination' && s.proposedLooks?.length ? null : (
              <EmptyProducts
                hint={
                  view === 'compare'
                    ? 'Choose Compare on up to three pieces in Discover or Saved.'
                    : 'Add pieces to a combination to see their item subtotal together.'
                }
              />
            )
          ) : (
            <>
              <p className="pw-intro">
                <PlainText
                  text={
                    view === 'compare'
                      ? 'The details that make each piece different. A missing detail stays unknown.'
                      : 'Your selected pieces together. Quantities refer to catalogue items, which may themselves be sets.'
                  }
                />
              </p>
              <div className="pw-comparison" data-count={selected.length}>
                {selected.map(({ product: p, quantity }) => (
                  <article className="pw-compare-product" key={p.id}>
                    <ProductImage product={p} binding={imageBinding(p)} />
                    <h3>{p.title}</h3>
                    <Price product={p} />
                    {assessment(p)}
                    {view === 'compare' ? (
                      <dl>
                        {[
                          ['Brand', p.brand],
                          ...[
                            'Material',
                            'Material purity',
                            'Gemstone shape',
                            'Gemstone dimensions',
                          ].map((label) => [
                            label,
                            p.attributes.find((a) => a.label === label)?.value,
                          ]),
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value || 'Not recorded'}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <label className="pw-quantity">
                        Quantity
                        <select
                          aria-label={`Quantity for ${p.title}`}
                          value={quantity}
                          onChange={(e) => s.setQuantity(p.id, Number(e.target.value))}
                        >
                          {Array.from({ length: 10 }, (_, i) => (
                            <option key={i + 1}>{i + 1}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="pw-actions">
                      <button
                        onClick={() => {
                          setPreviewId(p.id);
                          void s.refreshProducts([p.id]);
                        }}
                      >
                        View details
                      </button>
                      <button
                        onClick={() =>
                          s.products.some((x) => x.product.id === p.id)
                            ? s.remove(p.id)
                            : s.pin(p.raw)
                        }
                      >
                        {s.products.some((x) => x.product.id === p.id)
                          ? 'Remove from saved'
                          : 'Save piece'}
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        view === 'compare' ? s.toggleCompare(p.id) : s.toggleCombination(p.id)
                      }
                    >
                      Remove from {view === 'compare' ? 'comparison' : 'combination'}
                    </button>
                  </article>
                ))}
              </div>
              {view === 'combination' && (
                <div className="pw-subtotal">
                  {s.combinationAssessment
                    ? s.combinationAssessment(selected)
                    : combinationCheck &&
                      combinationCheck.status !== 'compliant' && (
                        <p
                          className={
                            combinationCheck.status === 'conflict' ? 'pw-error' : 'pw-status'
                          }
                        >
                          {combinationCheck.reasons.join('. ')}
                        </p>
                      )}
                  <span>
                    {totals.totalCents === null || missing
                      ? 'Known item subtotal'
                      : 'Item subtotal'}
                  </span>
                  <strong>{money(totals.knownSubtotalCents)}</strong>
                  {(totals.unknownCount > 0 || missing > 0) && (
                    <p className="pw-error">
                      The full total is unknown because a price or selected record is missing.
                    </p>
                  )}
                  {s.budgetSummary
                    ? s.budgetSummary({
                        knownSubtotalCents: totals.knownSubtotalCents,
                        totalCents: totals.totalCents,
                        unknownCount: totals.unknownCount,
                        budgetCents: s.budgetCents,
                        budgetScope: s.budgetScope,
                      })
                    : !supplied &&
                      s.budgetCents !== null && (
                        <p>
                          Your saved limit: {money(s.budgetCents)}{' '}
                          {s.budgetScope === 'total' ? 'total' : 'per item'}.
                          {combinationCheck?.status === 'compliant' &&
                          !missing &&
                          totals.totalCents !== null &&
                          s.budgetScope === 'total'
                            ? ` ${money(s.budgetCents - totals.totalCents)} remains before other charges.`
                            : ''}
                        </p>
                      )}
                </div>
              )}
              <p className="pw-footnote">
                Catalogue prices and details can change. Taxes, shipping and any discounts need
                checking before purchase.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
