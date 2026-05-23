<script setup>
import episodesData from '~/data/episodes.json';
import guestsData from '~/data/guests.json';
import taxonomiesData from '~/data/taxonomies.json';

const guestsById = Object.fromEntries(guestsData.map((g) => [g.id, g]));
const rolesById = Object.fromEntries(taxonomiesData.roles.map((r) => [r.id, r]));
const topicsById = Object.fromEntries(taxonomiesData.topics.map((t) => [t.id, t]));

const episodes = [...episodesData].sort((a, b) => b.date.localeCompare(a.date));

function appearanceCountFor(guestId, episodeId) {
  const guestEpisodes = episodesData
    .filter((e) => e.guestIds.includes(guestId))
    .sort((a, b) => a.date.localeCompare(b.date));
  return guestEpisodes.findIndex((e) => e.id === episodeId) + 1;
}
</script>

<template>
  <main>
    <section class="grid">
      <EpisodeCard
        v-for="ep in episodes"
        :key="ep.id"
        :episode="ep"
        :guests="ep.guestIds.map((id) => guestsById[id])"
        :appearance-counts="ep.guestIds.map((id) => appearanceCountFor(id, ep.id))"
        :roles-by-id="rolesById"
        :topics-by-id="topicsById"
      />
    </section>
  </main>
</template>

<style scoped>
main {
  min-height: 100vh;
  padding: 3rem 3rem;
}

header {
  max-width: 110rem;
  margin: 0 auto 2.5rem;
}

header h1 {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 2.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: #fafafa;
}

header p {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: #a1a1aa;
}

.grid {
  max-width: 110rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1920px) {
  .grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}
</style>
