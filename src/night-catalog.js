import M from './planning.mjs';

/** Minute-resolution availability using the same constraints as the night planner. */
export function summarizeNight(night, sources, config = M.defaults) {
  const names = new Map(sources.map(source => [source.id, source.name]));
  return sources.map(source => {
    const windows = M.windows(M.mask(night, source.id, config));
    return {id: source.id, minutes: windows.reduce((sum, [start, end]) => sum + end - start, 0), windows};
  }).sort((a, b) => b.minutes - a.minutes || names.get(a.id).localeCompare(names.get(b.id)));
}
