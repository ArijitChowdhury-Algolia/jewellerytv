type Fact = {
  field?: string;
  status?: string;
  strength?: string;
  certainty?: string;
  scope?: { kind?: string };
  value?: {
    kind?: string;
    cents?: number;
    currency?: string;
    basis?: string;
    operator?: string;
    alternatives?: Array<{ type?: string; purity?: string }>;
    text?: string;
  };
};
type State = { brief?: { facts?: unknown[] } };

export function hasActiveContext(state: State, field: 'recipient' | 'occasion', pattern: RegExp) {
  return (state.brief?.facts ?? []).some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const fact = raw as Fact;
    return (
      fact.field === field &&
      fact.status === 'active' &&
      fact.certainty === 'explicit' &&
      fact.value?.kind === 'text' &&
      typeof fact.value.text === 'string' &&
      pattern.test(fact.value.text)
    );
  });
}

function requirements(state: State): Fact[] {
  return (state.brief?.facts ?? []).filter((raw): raw is Fact => {
    if (!raw || typeof raw !== 'object') return false;
    const fact = raw as Fact;
    return (
      fact.status === 'active' &&
      fact.strength === 'requirement' &&
      fact.certainty === 'explicit' &&
      fact.scope?.kind === 'mission'
    );
  });
}

export function hasSterlingRequirement(state: State) {
  return requirements(state).some(
    (fact) =>
      fact.field === 'material' &&
      fact.value?.kind === 'material_alternatives' &&
      fact.value.alternatives?.some(
        (alternative) => alternative.type === 'Silver' && alternative.purity === 'Sterling',
      ),
  );
}

export function hasTotalBudget(state: State) {
  return requirements(state).some(
    (fact) =>
      fact.field === 'budget' &&
      fact.value?.kind === 'money' &&
      fact.value.cents === 30000 &&
      fact.value.currency === 'USD' &&
      fact.value.basis === 'total' &&
      fact.value.operator === 'lte',
  );
}

export function activeExclusionText(state: State) {
  return requirements(state)
    .filter((fact) => fact.field === 'exclusion')
    .map((fact) => fact.value?.text ?? JSON.stringify(fact.value ?? {}))
    .join(' ')
    .toLowerCase();
}
