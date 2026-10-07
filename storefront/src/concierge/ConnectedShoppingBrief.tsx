import { ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useId, useState, type FormEvent } from 'react';
import {
  formatBriefV3Value,
  type BriefFactV3,
  type BriefFactV3Input,
  type BriefStateV3,
} from '../../shared/briefSchema.js';
import '../shopping-brief.css';

const EDITABLE_FIELDS = [
  'budget',
  'material',
  'style',
  'recipient',
  'occasion',
  'exclusion',
  'product_type',
  'gemstone',
  'other',
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
type ScopeKind = BriefFactV3Input['scope']['kind'];
type Strength = BriefFactV3Input['strength'];
type Certainty = BriefFactV3Input['certainty'];
type MaterialAlternative = Extract<
  BriefFactV3Input['value'],
  { kind: 'material_alternatives' }
>['alternatives'][number];

export type ConnectedShoppingBriefProps = {
  brief: BriefStateV3;
  onAdd: (fact: BriefFactV3Input) => void | Promise<void>;
  onReplace: (factIds: string[], fact: BriefFactV3Input) => void | Promise<void>;
  onRetract: (factIds: string[]) => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  busy?: boolean;
  error?: string;
  controlsTarget?: HTMLElement | null;
};

const labels: Record<string, string> = {
  budget: 'Budget',
  material: 'Material',
  style: 'Style',
  recipient: 'Recipient',
  occasion: 'Occasion',
  exclusion: 'Avoid',
  product_type: 'Jewellery type',
  gemstone: 'Gemstone',
  watch_dial_color: 'Dial colour',
  watch_band_type: 'Watch band',
  watch_band_material: 'Band material',
  other: 'Preference',
};

function id(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function valueText(fact: BriefFactV3) {
  return formatBriefV3Value(fact.value);
}

function initialDraft(fact?: BriefFactV3) {
  if (!fact) return '';
  if (fact.value.kind === 'text') return fact.value.text;
  if (fact.value.kind === 'money') return String(fact.value.cents / 100);
  if (fact.value.kind === 'facet') return fact.value.values.join(', ');
  return valueText(fact);
}

function makeInput(
  selected: BriefFactV3 | undefined,
  field: EditableField,
  value: BriefFactV3Input['value'],
  scope: BriefFactV3Input['scope'],
  strength: Strength,
  certainty: Certainty,
): BriefFactV3Input {
  const factId = id('ui-fact');
  return {
    id: factId,
    field,
    value,
    scope,
    strength,
    certainty,
    origin: selected?.origin ?? 'ui',
    evidence: selected?.evidence ?? {
      messageId: id('ui-message'),
      quote: formatBriefV3Value(value),
      explicit: true,
      verified: true,
    },
  };
}

export function ConnectedShoppingBrief({
  brief,
  onAdd,
  onReplace,
  onRetract,
  onUndo,
  busy = false,
  error,
  controlsTarget,
}: ConnectedShoppingBriefProps) {
  const panelId = useId();
  const facts = brief.facts.filter(
    (fact) => fact.status === 'active' || fact.status === 'tentative',
  );
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const selected = facts.find((fact) => fact.id === editing);
  const [field, setField] = useState<EditableField>('budget');
  const [draft, setDraft] = useState('');
  const [operator, setOperator] = useState<'lt' | 'lte' | 'gt' | 'gte' | 'around'>('lte');
  const [basis, setBasis] = useState<'total' | 'per-item' | 'unresolved'>('total');
  const [currency, setCurrency] = useState('USD');
  const [facetOperator, setFacetOperator] = useState<'any' | 'all' | 'none'>('any');
  const [scopeKind, setScopeKind] = useState<ScopeKind>('mission');
  const [scopeKey, setScopeKey] = useState('');
  const [strength, setStrength] = useState<Strength>('preference');
  const [certainty, setCertainty] = useState<Certainty>('explicit');
  const [materialAlternativeIndex, setMaterialAlternativeIndex] = useState(0);
  const [materialType, setMaterialType] = useState<MaterialAlternative['type']>(null);
  const [materialColor, setMaterialColor] = useState<MaterialAlternative['color']>(null);
  const [materialPurity, setMaterialPurity] = useState<MaterialAlternative['purity']>(null);
  const [platingPresence, setPlatingPresence] = useState<'unknown' | 'required' | 'forbidden'>(
    'unknown',
  );
  const [platingPurity, setPlatingPurity] =
    useState<
      MaterialAlternative['plating'] extends infer P
        ? P extends { purity: infer U }
          ? U
          : null
        : null
    >(null);
  const [localError, setLocalError] = useState('');

  function openEditor(fact?: BriefFactV3) {
    setEditing(fact?.id ?? 'new');
    setField((fact?.field as EditableField | undefined) ?? 'budget');
    setDraft(initialDraft(fact));
    setOperator(fact?.value.kind === 'money' ? fact.value.operator : 'lte');
    setBasis(fact?.value.kind === 'money' ? fact.value.basis : 'total');
    setCurrency(fact?.value.kind === 'money' ? fact.value.currency : 'USD');
    setFacetOperator(fact?.value.kind === 'facet' ? fact.value.operator : 'any');
    setScopeKind(fact?.scope.kind ?? 'mission');
    setScopeKey(fact?.scope.key ?? '');
    setStrength(fact?.strength === 'context' ? 'preference' : (fact?.strength ?? 'preference'));
    setCertainty(fact?.certainty ?? 'explicit');
    const materials = fact?.value.kind === 'material_alternatives' ? fact.value.alternatives : [];
    const material = materials[0];
    setMaterialAlternativeIndex(0);
    setMaterialType(material?.type ?? null);
    setMaterialColor(material?.color ?? null);
    setMaterialPurity(material?.purity ?? null);
    setPlatingPresence(material?.plating?.presence ?? 'unknown');
    setPlatingPurity(material?.plating?.purity ?? null);
    setLocalError('');
    setExpanded(true);
  }

  function closeEditor() {
    setEditing(null);
    setLocalError('');
  }

  function valueForEditor(): BriefFactV3Input['value'] {
    if (field === 'material') {
      const alternative: MaterialAlternative = {
        type: materialType,
        color: materialColor,
        purity: materialPurity,
        plating:
          platingPresence === 'unknown'
            ? null
            : {
                presence: platingPresence,
                purity: platingPresence === 'required' ? platingPurity : null,
              },
      };
      if (!alternative.type && !alternative.color && !alternative.purity && !alternative.plating)
        throw new Error('Choose a material detail or leave plating unknown.');
      const alternatives =
        selected?.value.kind === 'material_alternatives'
          ? selected.value.alternatives.map((item, index) =>
              index === materialAlternativeIndex ? alternative : item,
            )
          : [alternative];
      return { kind: 'material_alternatives', alternatives };
    }
    if (selected && !['text', 'money', 'facet'].includes(selected.value.kind))
      return selected.value;
    if (field === 'budget') {
      if (!/^\d+(\.\d{1,2})?$/.test(draft) || Number(draft) > 1000000)
        throw new Error('Enter a valid amount from $0 to $1,000,000.');
      return {
        kind: 'money',
        cents: Math.round(Number(draft) * 100),
        currency: currency.toUpperCase(),
        operator,
        basis,
      };
    }
    if (selected?.value.kind === 'facet' || field === 'exclusion') {
      const values = draft
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!values.length) throw new Error('Enter at least one value.');
      return {
        kind: 'facet',
        attribute: selected?.value.kind === 'facet' ? selected.value.attribute : field,
        values,
        operator: facetOperator,
      };
    }
    if (!draft.trim()) throw new Error('Enter a preference.');
    return { kind: 'text', text: draft.trim().slice(0, 500) };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const value = valueForEditor();
      const scope =
        scopeKind === 'mission'
          ? { kind: 'mission' as const, key: null }
          : { kind: scopeKind, key: scopeKey.trim() || null };
      if (scope.kind !== 'mission' && !scope.key)
        throw new Error('Add a scope key for this preference.');
      const fact = makeInput(selected, field, value, scope, strength, certainty);
      if (selected) await onReplace([selected.id], fact);
      else await onAdd(fact);
      closeEditor();
    } catch (caught) {
      setLocalError(
        caught instanceof Error ? caught.message : 'This preference could not be saved.',
      );
    }
  }

  const controls = (
    <button
      type="button"
      aria-label={`Preferences (${facts.length})`}
      title="Review and edit preferences"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={() => setExpanded((open) => !open)}
    >
      <SlidersHorizontal size={18} aria-hidden="true" />
      <span>Preferences</span>
      <b className="cb-count" aria-hidden="true">
        ({facts.length})
      </b>
      <ChevronDown
        className={expanded ? 'cb-chevron cb-chevron-open' : 'cb-chevron'}
        size={14}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <section
      className={controlsTarget && !expanded ? 'conversation-brief cb-empty' : 'conversation-brief'}
      aria-label="Your preferences"
    >
      {controlsTarget ? (
        createPortal(<div className="cb-controls">{controls}</div>, controlsTarget)
      ) : (
        <div className="cb-controls">{controls}</div>
      )}
      <div id={panelId} hidden={!expanded} className="cb-panel">
        <div className="cb-panel-actions">
          <button type="button" onClick={() => openEditor()}>
            Add preference
          </button>
          {brief.events.length > 0 && (
            <button type="button" onClick={() => void onUndo()}>
              <RotateCcw size={16} aria-hidden="true" />
              Undo
            </button>
          )}
          <button
            type="button"
            className="cb-close"
            aria-label="Close preferences"
            onClick={() => setExpanded(false)}
          >
            Close
          </button>
        </div>
        {!facts.length && !editing && (
          <p className="cb-context">
            Preferences will appear here as we talk. You can also add one.
          </p>
        )}
        {!!facts.length && (
          <div className="cb-chips">
            {facts.map((fact) => (
              <div
                key={fact.id}
                className={fact.status === 'tentative' ? 'cb-chip cb-tentative' : 'cb-chip'}
              >
                <button
                  type="button"
                  className="cb-chip-edit"
                  onClick={() => openEditor(fact)}
                  aria-label={`Edit ${labels[fact.field] ?? fact.field}: ${valueText(fact)}`}
                >
                  <span>
                    {fact.status === 'tentative' ? 'To clarify: ' : ''}
                    {labels[fact.field] ?? fact.field}: {valueText(fact)}
                  </span>
                  {fact.scope.kind !== 'mission' && <small>{fact.scope.key}</small>}
                </button>
                <button
                  type="button"
                  className="cb-chip-remove"
                  aria-label={`Remove ${labels[fact.field] ?? fact.field}: ${valueText(fact)}`}
                  onClick={() => void onRetract([fact.id])}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        {editing && (
          <form
            className="cb-editor"
            onSubmit={save}
            aria-label={
              selected ? `Edit ${labels[selected.field] ?? selected.field}` : 'Add a preference'
            }
          >
            {!selected && (
              <div className="cb-field-choices" aria-label="Choose a preference">
                {EDITABLE_FIELDS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={field === item}
                    onClick={() => {
                      setField(item);
                      setDraft('');
                    }}
                  >
                    {labels[item]}
                  </button>
                ))}
              </div>
            )}
            {selected &&
              selected.value.kind !== 'material_alternatives' &&
              !['text', 'money', 'facet'].includes(selected.value.kind) && (
                <p className="cb-context">
                  This structured value is preserved while you edit its scope and importance.
                </p>
              )}
            {field === 'material' &&
              (selected?.value.kind === 'material_alternatives' || !selected) && (
                <>
                  {selected?.value.kind === 'material_alternatives' &&
                    selected.value.alternatives.length > 1 && (
                      <label>
                        Alternative
                        <select
                          value={materialAlternativeIndex}
                          onChange={(event) => {
                            const index = Number(event.currentTarget.value);
                            const alternative =
                              selected.value.kind === 'material_alternatives'
                                ? selected.value.alternatives[index]
                                : undefined;
                            setMaterialAlternativeIndex(index);
                            setMaterialType(alternative?.type ?? null);
                            setMaterialColor(alternative?.color ?? null);
                            setMaterialPurity(alternative?.purity ?? null);
                            setPlatingPresence(alternative?.plating?.presence ?? 'unknown');
                            setPlatingPurity(alternative?.plating?.purity ?? null);
                          }}
                        >
                          {selected.value.alternatives.map((_, index) => (
                            <option key={index} value={index}>
                              Option {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  <div className="cb-row">
                    <label>
                      Base material
                      <select
                        value={materialType ?? ''}
                        onChange={(event) =>
                          setMaterialType(
                            (event.currentTarget.value || null) as MaterialAlternative['type'],
                          )
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="Gold">Gold</option>
                        <option value="Silver">Silver</option>
                      </select>
                    </label>
                    <label>
                      Colour
                      <select
                        value={materialColor ?? ''}
                        onChange={(event) =>
                          setMaterialColor(
                            (event.currentTarget.value || null) as MaterialAlternative['color'],
                          )
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="White">White</option>
                      </select>
                    </label>
                  </div>
                  <div className="cb-row">
                    <label>
                      Purity
                      <select
                        value={materialPurity ?? ''}
                        onChange={(event) =>
                          setMaterialPurity(
                            (event.currentTarget.value || null) as MaterialAlternative['purity'],
                          )
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="Sterling">Sterling</option>
                      </select>
                    </label>
                    <label>
                      Plating
                      <select
                        value={platingPresence}
                        onChange={(event) =>
                          setPlatingPresence(event.currentTarget.value as typeof platingPresence)
                        }
                      >
                        <option value="unknown">Unknown</option>
                        <option value="required">Required</option>
                        <option value="forbidden">Forbidden</option>
                      </select>
                    </label>
                  </div>
                  {platingPresence === 'required' && (
                    <label>
                      Plating purity
                      <select
                        value={platingPurity ?? ''}
                        onChange={(event) =>
                          setPlatingPurity(
                            (event.currentTarget.value || null) as typeof platingPurity,
                          )
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="Sterling">Sterling</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            {field === 'budget' && (
              <label>
                Amount ({currency})
                <input
                  autoFocus
                  value={draft}
                  inputMode="decimal"
                  onChange={(event) => setDraft(event.currentTarget.value)}
                />
              </label>
            )}
            {field !== 'budget' &&
              (!selected || ['text', 'facet'].includes(selected.value.kind)) && (
                <label>
                  {selected?.value.kind === 'facet' ? 'Values' : labels[field]}
                  <input
                    autoFocus
                    value={draft}
                    maxLength={500}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    placeholder="Separate multiple values with commas"
                  />
                </label>
              )}
            {field === 'budget' && (
              <div className="cb-row">
                <label>
                  Currency
                  <input
                    value={currency}
                    maxLength={3}
                    onChange={(event) => setCurrency(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Limit
                  <select
                    value={operator}
                    onChange={(event) => setOperator(event.currentTarget.value as typeof operator)}
                  >
                    <option value="lte">Up to and including</option>
                    <option value="lt">Strictly under</option>
                    <option value="gte">At least</option>
                    <option value="gt">Strictly over</option>
                    <option value="around">Around</option>
                  </select>
                </label>
                <label>
                  For
                  <select
                    value={basis}
                    onChange={(event) => setBasis(event.currentTarget.value as typeof basis)}
                  >
                    <option value="total">Combined total</option>
                    <option value="per-item">Per item</option>
                    <option value="unresolved">Still deciding</option>
                  </select>
                </label>
              </div>
            )}
            {(field === 'exclusion' || selected?.value.kind === 'facet') && (
              <label>
                Match
                <select
                  value={facetOperator}
                  onChange={(event) =>
                    setFacetOperator(event.currentTarget.value as typeof facetOperator)
                  }
                >
                  <option value="any">Any</option>
                  <option value="all">All</option>
                  <option value="none">Exclude</option>
                </select>
              </label>
            )}
            <div className="cb-row">
              <label>
                Scope
                <select
                  value={scopeKind}
                  onChange={(event) => setScopeKind(event.currentTarget.value as ScopeKind)}
                >
                  <option value="mission">This mission</option>
                  <option value="recipient">Recipient</option>
                  <option value="item">Specific item</option>
                  <option value="component">Component</option>
                </select>
              </label>
              {scopeKind !== 'mission' && (
                <label>
                  Scope key
                  <input
                    value={scopeKey}
                    onChange={(event) => setScopeKey(event.currentTarget.value)}
                  />
                </label>
              )}
            </div>
            <div className="cb-row">
              <label>
                Importance
                <select
                  value={strength}
                  onChange={(event) => setStrength(event.currentTarget.value as Strength)}
                >
                  <option value="preference">Preference</option>
                  <option value="requirement">Must-have</option>
                  <option value="context">Context</option>
                </select>
              </label>
              <label>
                Certainty
                <select
                  value={certainty}
                  onChange={(event) => setCertainty(event.currentTarget.value as Certainty)}
                >
                  <option value="explicit">Explicit</option>
                  <option value="tentative">Tentative</option>
                </select>
              </label>
            </div>
            {localError && (
              <p role="alert" className="cb-error">
                {localError}
              </p>
            )}
            <div className="cb-actions">
              <button type="submit" disabled={busy}>
                Save
              </button>
              <button type="button" onClick={closeEditor}>
                Cancel
              </button>
              {selected && (
                <button
                  type="button"
                  onClick={() => {
                    void onRetract([selected.id]);
                    closeEditor();
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      {busy && (
        <p className="cb-context" role="status">
          Updating your preferences…
        </p>
      )}
      {error && (
        <p className="cb-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
