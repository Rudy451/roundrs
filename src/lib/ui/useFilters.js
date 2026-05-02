// /lib/ui/useFilters.js
//
// Filter logic for the DraftBoard candidate list.
//
// Design rules:
//   - Filtering is a pure client-side operation over the already-fetched candidates.
//   - Scores are never recomputed. Rankings displayed re-number from 1
//     within the filtered view but the underlying adjustedScore is unchanged.
//   - "No filters active" always shows the full shortlist in its original order.
//   - All filter state is derived from URL-independent React state so
//     refreshing the data never breaks a user's active filter.

import { useState, useMemo } from "react";

// ─── Default filter state ─────────────────────────────────────────────────────

export const DEFAULT_FILTERS = {
  signalTypes:    [],    // string[] — empty = show all
  minScore:       0,     // number   — 0 = no threshold
  theme:          null,  // string|null — null = show all
};

// ─── Theme extraction ─────────────────────────────────────────────────────────
// Derives the theme(s) for a candidate from its samplePosts.
// A candidate can belong to multiple themes if its posts came from different queries.

export function getCandidateThemes(candidate) {
  if (!candidate?.samplePosts) return [];
  return [
    ...new Set(
      candidate.samplePosts
        .map(p => p.theme)
        .filter(Boolean)
    ),
  ];
}

// ─── Available filter options ─────────────────────────────────────────────────
// Derived from the actual candidate list — only show filters that have results.

export function deriveFilterOptions(candidates) {
  const signalTypes = [...new Set(candidates.map(c => c.signalType).filter(Boolean))].sort();

  const themes = [
    ...new Set(
      candidates.flatMap(c => getCandidateThemes(c))
    ),
  ].sort();

  const scores = candidates.map(c => c.adjustedScore).filter(Boolean);
  const scoreRange = scores.length > 0
    ? { min: Math.floor(Math.min(...scores)), max: Math.ceil(Math.max(...scores)) }
    : { min: 0, max: 100 };

  return { signalTypes, themes, scoreRange };
}

// ─── Core filter function ─────────────────────────────────────────────────────

/**
 * Apply active filters to a candidate list.
 * Returns a filtered array in the same order as the input.
 * Scores are never modified.
 *
 * @param {FinalCandidate[]} candidates
 * @param {object}           filters
 * @returns {FinalCandidate[]}
 */
export function applyFilters(candidates, filters) {
  if (!candidates?.length) return [];

  const { signalTypes, minScore, theme } = filters;
  const noFilters =
    signalTypes.length === 0 &&
    minScore <= 0 &&
    theme === null;

  if (noFilters) return candidates;

  return candidates.filter(c => {
    // Signal type filter
    if (signalTypes.length > 0 && !signalTypes.includes(c.signalType)) {
      return false;
    }

    // Score threshold filter
    if (minScore > 0 && c.adjustedScore < minScore) {
      return false;
    }

    // Theme filter — match if any of the candidate's themes matches
    if (theme !== null) {
      const candidateThemes = getCandidateThemes(c);
      if (!candidateThemes.includes(theme)) return false;
    }

    return true;
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages filter state and returns filtered candidates.
 *
 * @param {FinalCandidate[]} candidates — the full unfiltered list
 * @returns {{
 *   filters:         object,
 *   setFilter:       function,
 *   resetFilters:    function,
 *   filtered:        FinalCandidate[],
 *   options:         object,
 *   activeCount:     number,
 *   isFiltered:      boolean,
 * }}
 */
export function useFilters(candidates) {
  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);

  // Derived filter options — recalculated only when candidates change
  const options = useMemo(
    () => deriveFilterOptions(candidates ?? []),
    [candidates]
  );

  // Filtered result — recalculated only when candidates or filters change
  const filtered = useMemo(
    () => applyFilters(candidates ?? [], filters),
    [candidates, filters]
  );

  // How many filters are currently active
  const activeCount =
    (filters.signalTypes.length > 0 ? 1 : 0) +
    (filters.minScore > 0           ? 1 : 0) +
    (filters.theme !== null          ? 1 : 0);

  // Update a single filter key
  function setFilter(key, value) {
    setFiltersState(prev => ({ ...prev, [key]: value }));
  }

  // Toggle a signal type in/out of the active list
  function toggleSignalType(type) {
    setFiltersState(prev => {
      const current = prev.signalTypes;
      const next    = current.includes(type)
        ? current.filter(t => t !== type)
        : [...current, type];
      return { ...prev, signalTypes: next };
    });
  }

  function resetFilters() {
    setFiltersState(DEFAULT_FILTERS);
  }

  return {
    filters,
    setFilter,
    toggleSignalType,
    resetFilters,
    filtered,
    options,
    activeCount,
    isFiltered: activeCount > 0,
  };
}
