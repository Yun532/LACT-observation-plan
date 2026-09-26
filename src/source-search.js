// Normalize input for lookup without changing catalog names or source identity.
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/\b(?:mrk|mkn)(?=\s*\d|\b)/g, 'markarian').replace(/\s+/g, '');

export function matchesSource(source, query) {
  const needle = normalize(query);
  return !needle || [source.name, source.type, ...(source.aliases || [])]
    .some(value => normalize(value).includes(needle));
}
