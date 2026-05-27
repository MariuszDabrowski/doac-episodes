import episodesData from '@data/episodes.json';

// Module-load, one pass over the catalog. Result: per-guest lookup of
// the earliest episode where they're the primary guest (guestIds[0]),
// plus the set of guests who have any such episode. The per-episode
// thumbnail of that primary appearance is what we want to show for the
// guest, since:
//
//  1. auto-portrait targets the primary, so the extracted face is
//     usually theirs even on multi-guest panels;
//  2. per-episode thumbnails are re-extracted with the latest pipeline,
//     so they're fresher than the canonical /portraits/<id>.jpg which
//     may have been seeded by a buggier extraction earlier.
//
// Fallback when no primary-appearance exists: the guest's canonical
// portrait (still wrong-ish for panel-only guests, but the consumer
// usually checks `hasReliablePortrait(id)` first and falls back to an
// initials disk in that case).
const bestEpByGuest = new Map();
const guestsWithReliablePortrait = new Set();
for (const ep of episodesData) {
  const primary = ep.guestIds[0];
  if (!primary) continue;
  guestsWithReliablePortrait.add(primary);
  const prev = bestEpByGuest.get(primary);
  if (!prev || ep.date < prev.date) bestEpByGuest.set(primary, ep);
}

export function useGuestPortrait() {
  return {
    bestEpByGuest,
    guestsWithReliablePortrait,
    portraitOf(guest) {
      return bestEpByGuest.get(guest.id)?.thumbnail || guest.portrait;
    },
    portrait2xOf(guest) {
      return bestEpByGuest.get(guest.id)?.thumbnail2x || guest.portrait2x;
    },
    hasReliablePortrait(guestId) {
      return guestsWithReliablePortrait.has(guestId);
    },
  };
}
