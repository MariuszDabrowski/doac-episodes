import { ref } from 'vue';

// Last-seen cluster + topic filter, kept as module-scope refs so they
// persist across page navigations. HomePage and GuestsIndex update them
// when their local activeCluster/activeSubtopic changes; SiteHeader,
// GuestsIndex's back-pill, and HomePage's corner Guests link read them
// so a user's filter context follows them across all navigations until
// they explicitly clear it. Not persisted to storage; resets on full
// page reload.
const cluster = ref(null);
const topic = ref(null);

export function useFilterContext() {
  function setFilter(nextCluster, nextTopic) {
    // 'all' is FilterBar's no-filter pseudo-cluster; normalize to null
    // so the consumer doesn't have to special-case it.
    cluster.value = nextCluster && nextCluster !== 'all' ? nextCluster : null;
    topic.value = nextTopic || null;
  }

  function carryFilterQuery() {
    const q = {};
    if (topic.value) q.topic = topic.value;
    else if (cluster.value) q.cluster = cluster.value;
    return q;
  }

  return { cluster, topic, setFilter, carryFilterQuery };
}
