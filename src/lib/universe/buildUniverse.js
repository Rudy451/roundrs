import { themeMap } from "./Thememap";

export function buildUniverse(selectedThemes) {
  const set = new Set();
  selectedThemes.forEach(theme => {
    (themeMap[theme] ?? []).forEach(t => set.add(t));
  });
  return Array.from(set);
}
