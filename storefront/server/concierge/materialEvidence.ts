export type MaterialAlternative = {
  type: string | null;
  color: string | null;
  purity: string | null;
  plating: { presence: 'required' | 'forbidden'; purity: string | null } | null;
};
export type MaterialRequirement =
  | {
      attribute: 'MaterialType' | 'MaterialColor' | 'MaterialPurity';
      values: string[];
      exclude: boolean;
      factId: string;
    }
  | { alternatives: MaterialAlternative[]; factId: string };

export function materialMatch(
  record: Record<string, unknown>,
  requirements: MaterialRequirement[],
): 'match' | 'conflict' | 'unknown' {
  if (!requirements.length) return 'match';
  const entries = record.Catalog_MaterialInformation;
  if (!Array.isArray(entries) || !entries.length) return 'unknown';
  const objects = entries.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === 'object' && !Array.isArray(entry),
  );
  if (!objects.length) return 'unknown';
  const alternatives = requirements.filter(
    (requirement): requirement is { alternatives: MaterialAlternative[]; factId: string } =>
      'alternatives' in requirement,
  );
  let alternativeUnknown = false;
  if (alternatives.length) {
    const match = alternatives.every((group) =>
      group.alternatives.some((alternative) =>
        objects.some((entry) => {
          if (
            alternative.plating?.presence === 'forbidden' &&
            (!entry.MaterialPlatingPurity || !String(entry.MaterialPlatingPurity).trim())
          )
            return false;
          if (
            alternative.plating?.presence === 'forbidden' &&
            String(entry.MaterialPlatingPurity).trim()
          )
            return false;
          return (
            (!alternative.type || String(entry.MaterialType ?? '') === alternative.type) &&
            (!alternative.color || String(entry.MaterialColor ?? '') === alternative.color) &&
            (!alternative.purity || String(entry.MaterialPurity ?? '') === alternative.purity) &&
            (!alternative.plating ||
              alternative.plating.presence === 'forbidden' ||
              (typeof entry.MaterialPlatingPurity === 'string' &&
                !!entry.MaterialPlatingPurity.trim() &&
                (!alternative.plating.purity ||
                  entry.MaterialPlatingPurity === alternative.plating.purity)))
          );
        }),
      ),
    );
    if (
      !match &&
      objects.some((entry) =>
        alternatives.some((group) =>
          group.alternatives.some(
            (alternative) =>
              (alternative.type && entry.MaterialType == null) ||
              (alternative.color && entry.MaterialColor == null) ||
              (alternative.purity && entry.MaterialPurity == null) ||
              (alternative.plating?.presence === 'forbidden' &&
                (!entry.MaterialPlatingPurity || !String(entry.MaterialPlatingPurity).trim())),
          ),
        ),
      )
    )
      alternativeUnknown = true;
    if (!match && !alternativeUnknown) return 'conflict';
  }
  const simple = requirements.filter(
    (
      requirement,
    ): requirement is Exclude<
      MaterialRequirement,
      { alternatives: MaterialAlternative[]; factId: string }
    > => !('alternatives' in requirement),
  );
  const positives = simple.filter((requirement) => !requirement.exclude);
  const exclusions = simple.filter((requirement) => requirement.exclude);
  let possiblePositive = !positives.length;
  let possibleUnknown = false;
  for (const entry of objects) {
    let entryUnknown = false;
    const entryMatch = positives.every((requirement) => {
      const raw = entry[requirement.attribute];
      if (raw === undefined || raw === null || raw === '') {
        entryUnknown = true;
        return false;
      }
      return requirement.values.includes(String(raw));
    });
    if (entryMatch) possiblePositive = true;
    else if (entryUnknown) possibleUnknown = true;
  }
  for (const entry of objects)
    for (const requirement of exclusions) {
      const raw = entry[requirement.attribute];
      if (raw === undefined || raw === null || raw === '') possibleUnknown = true;
      else if (requirement.values.includes(String(raw))) return 'conflict';
    }
  if (possibleUnknown || alternativeUnknown) return 'unknown';
  return possiblePositive ? 'match' : 'conflict';
}
