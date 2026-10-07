import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  Configure,
  InstantSearch,
  Pagination,
  SortBy,
  useHits,
  useInstantSearch,
} from 'react-instantsearch';
import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { searchClient } from './client';
import { useSearchRouting } from './SearchRouting';
import { categories, facetsByCategory, sortOptions } from './catalog';
import { readAgentConstraints, agentFilterExpression } from './routing';
import { visibleResultIds, sameRefinements, samePriceRange } from './resultContext';
import { buildContext, type PageContextState } from './context';
import { DevInspector } from './DevInspector';
import { Shell, Home } from './shell';
import { ProductCard } from './ProductCard';
import { ProductPage } from './ProductPage';
import { ActiveFilters, Facet, PersistentSearchState } from './Filters';
import { Concierge, demoTrace, type ConciergeHandle } from './Concierge';
function Listing() {
  const { slug } = useParams();
  const location = useLocation();
  const category = categories.find((c) => c.slug === slug);
  const { items, results } = useHits();
  const { status, error, refresh } = useInstantSearch({ catchError: true });
  const [list, setList] = useState(false);
  const [filters, setFilters] = useState(() => window.innerWidth >= 768);
  const definitions = facetsByCategory[slug || 'rings'] || facetsByCategory.rings;
  const query = results?.query;
  const heading = category?.label || (query ? `Search results for “${query}”` : 'Explore jewelry');
  return (
    <main className="page listing">
      <nav className="breadcrumbs">
        <Link to="/">JTV</Link> / {category ? 'Jewelry / ' : ''}
        {category?.label || 'Search'}
      </nav>
      <div className="category-heading">
        <h1>{heading}</h1>
        <p>{category?.description || 'Discover jewelry, gemstones and a little inspiration.'}</p>
      </div>
      <nav className="category-strip" aria-label="Shop by product type">
        {categories.map((c) => (
          <Link key={c.slug} to={`/category/${c.slug}`}>
            <img src={c.image} alt="" />
            <span>{c.label}</span>
          </Link>
        ))}
      </nav>
      <div className="listing-toolbar">
        <button
          className="filter-toggle"
          aria-expanded={filters}
          onClick={() => setFilters(!filters)}
        >
          <SlidersHorizontal size={17} /> {filters ? 'Hide filters' : 'Filter & Sort'}
        </button>
        <span aria-live="polite">{(results?.nbHits || 0).toLocaleString()} products</span>
        <div className="view-toggle">
          <button aria-label="Grid view" aria-pressed={!list} onClick={() => setList(false)}>
            <LayoutGrid size={18} />
          </button>
          <button aria-label="List view" aria-pressed={list} onClick={() => setList(true)}>
            <List size={18} />
          </button>
        </div>
        <label className="sort-label">
          Sort: <SortBy items={sortOptions} />
        </label>
      </div>
      {new URLSearchParams(location.search).has('agent') && (
        <p className="agent-search-notice">
          Showing the concierge’s search. <Link to="/search">Start a new search</Link>
        </p>
      )}
      <ActiveFilters />
      {error && (
        <div className="error-state" role="alert">
          Search could not load: {error.message} <button onClick={refresh}>Retry</button>
        </div>
      )}
      <div className={`listing-layout ${filters ? 'filters-open' : ''}`}>
        <aside className="filters" aria-label="Filter products">
          {definitions.map((d) => (
            <Facet key={d.attribute} definition={d} />
          ))}
        </aside>
        <section
          className="results"
          aria-label="Products"
          aria-busy={status === 'loading' || status === 'stalled'}
        >
          {status === 'stalled' && <p role="status">Searching the catalogue…</p>}
          {!items.length && !error && status === 'idle' && (
            <div className="empty-state">
              <h2>No products found</h2>
              <p>Try a different search or remove a filter.</p>
            </div>
          )}
          <div hidden={!!error} className={`product-grid ${list ? 'list-view' : ''}`}>
            {items.map((item) => (
              <ProductCard key={item.objectID} item={item} />
            ))}
          </div>
          <Pagination padding={2} />
          <p className="catalogue-note">
            Catalogue results may differ from JTV’s website. Prices and availability are not
            checkout confirmation.
          </p>
        </section>
      </div>
    </main>
  );
}
function HomeProducts() {
  const { items } = useHits();
  const { error, refresh } = useInstantSearch({ catchError: true });
  if (error)
    return (
      <section className="error-state" role="alert">
        <p>The catalogue could not load.</p>
        <button onClick={refresh}>Retry</button>
      </section>
    );
  return (
    <section className="home-products">
      <h2>Discover your next favorite</h2>
      <div className="product-grid">
        {items.slice(0, 4).map((item) => (
          <ProductCard key={item.objectID} item={item} />
        ))}
      </div>
      <Link className="secondary-button" to="/search">
        Explore all jewelry
      </Link>
    </section>
  );
}
function Experience() {
  const location = useLocation();
  const { indexUiState, results, status, error } = useInstantSearch({ catchError: true });
  const { items } = useHits();
  const chat = useRef<ConciergeHandle>(null);
  const selection = useRef<{ id: string | null; size: string | null }>({ id: null, size: null });
  const contextState = useRef<PageContextState>({});
  const readiness = useRef('');
  const revision = useRef(0);
  const slug = location.pathname.startsWith('/category/')
    ? location.pathname.split('/')[2]
    : location.pathname.startsWith('/product/')
      ? new URLSearchParams(location.search).get('category') || ''
      : '';
  const category = categories.find((c) => c.slug === slug);
  const params = new URLSearchParams(location.search);
  const agentConstraints = useMemo(
    () => readAgentConstraints(location.pathname + location.search),
    [location.pathname, location.search],
  );
  let agentExpression = '';
  let agentError = '';
  try {
    agentExpression = agentFilterExpression(agentConstraints);
  } catch (e: unknown) {
    agentError = e instanceof Error ? e.message : 'Unsupported concierge search';
  }
  const filters = useMemo(
    () =>
      [
        agentExpression,
        category
          ? `Catalog_ConsumerProductCategoryDisplayNames:${JSON.stringify(category.categoryValue)}`
          : '',
        params.get('clearance') === '1' ? 'Pricing_Clearance:true' : '',
      ]
        .filter(Boolean)
        .join(' AND '),
    [category, location.search, agentExpression],
  );
  const resultState = results?._state;
  const ready =
    status === 'idle' &&
    !error &&
    !!results &&
    resultState?.query === (indexUiState.query || '') &&
    (resultState?.filters || '') === filters &&
    sameRefinements(resultState?.disjunctiveFacetsRefinements, indexUiState.refinementList) &&
    samePriceRange(indexUiState.range, resultState?.numericRefinements);
  contextState.current = {
    route: location.pathname,
    category: category?.label,
    query: indexUiState.query || '',
    sort: indexUiState.sortBy || 'prod_catalog_featured',
    refinements: {
      refinementList: indexUiState.refinementList || {},
      range: indexUiState.range || {},
      ...(filters ? { filters } : {}),
      ...agentConstraints,
    },
    visibleProductIds: visibleResultIds(
      location.pathname,
      ready,
      items.map((i) => i.objectID),
    ),
    selectedProductId: selection.current.id,
    selectedSize: selection.current.size,
    revision: revision.current,
  };
  useEffect(() => {
    revision.current++;
  }, [location, indexUiState, results]);
  const onSelection = useCallback((id: string | null, size: string | null) => {
    selection.current = { id, size };
    contextState.current = { ...contextState.current, selectedProductId: id, selectedSize: size };
    revision.current++;
  }, []);
  const getContext = useCallback(() => {
    try {
      if (readiness.current) throw new Error(readiness.current);
      const value = buildContext(contextState.current);
      demoTrace.context = value;
      return value;
    } catch (e: unknown) {
      demoTrace.contextError =
        e instanceof Error ? e.message : 'Page context could not be prepared';
      throw e;
    }
  }, []);
  let contextError = '';
  try {
    buildContext(contextState.current);
  } catch (e: unknown) {
    contextError = e instanceof Error ? e.message : 'Page context could not be prepared';
  }
  const blocked =
    agentError ||
    contextError ||
    ((location.pathname === '/' ||
      location.pathname === '/search' ||
      location.pathname.startsWith('/category/')) &&
    !ready
      ? 'Wait for the current search to finish, or retry the failed search.'
      : '');
  // Pending page search already contributes no visible product IDs. It must not
  // prevent an independent Concierge request from reaching the agent.
  readiness.current = agentError || contextError;
  demoTrace.contextError = blocked;
  useEffect(() => {
    Object.assign(window, { __JTV_DEMO_TRACE__: demoTrace });
  }, []);
  return (
    <>
      <Configure
        hitsPerPage={24}
        filters={filters}
        analytics={false}
        clickAnalytics={false}
        enableABTest={false}
      />
      <PersistentSearchState />
      <Shell>
        {agentError && (
          <p className="error-state" role="alert">
            {agentError}. <Link to="/search">Start a new search</Link>
          </p>
        )}
        <Routes>
          <Route
            path="/"
            element={
              <Home>
                <HomeProducts />
              </Home>
            }
          />
          <Route path="/category/:slug" element={<Listing />} />
          <Route path="/search" element={<Listing />} />
          <Route
            path="/product/:objectID"
            element={<ProductPage onSelection={onSelection} onAsk={() => chat.current?.ask()} />}
          />
          <Route
            path="*"
            element={
              <main className="page empty-state">
                <h1>{params.get('section') || 'This section'} is outside this demo</h1>
                <p>Explore the catalogue or talk to the jewelry concierge.</p>
                <Link to="/search">Browse jewelry</Link>
              </main>
            }
          />
        </Routes>
        {import.meta.env.DEV &&
          new URLSearchParams(window.location.search).get('debug') === '1' && (
            <DevInspector state={contextState} />
          )}
      </Shell>
      <Concierge ref={chat} context={getContext} />
    </>
  );
}
const future = { preserveSharedStateOnUnmount: true };
function Storefront() {
  const routing = useSearchRouting();
  return (
    <InstantSearch
      indexName="prod_catalog"
      searchClient={searchClient}
      routing={routing}
      future={future}
      insights={false}
    >
      <Experience />
    </InstantSearch>
  );
}
export function App() {
  return (
    <BrowserRouter>
      <Storefront />
    </BrowserRouter>
  );
}
