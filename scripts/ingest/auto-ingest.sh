#!/bin/bash
# Local replacement for the .github/workflows/ingest-new-episodes.yml
# pipeline: refresh the YouTube catalog, ingest any new long-form
# episodes, commit + push, fire a macOS notification with the count.
#
# Runs from a residential IP so it doesn't get the YouTube bot block
# that kills the GitHub Action. Wire into cron/launchd for a periodic
# poll, or run on demand.
#
# Cron example (every 6h, log to /tmp):
#   0 */6 * * * /Users/mariuszdabrowski/Sites/doac-episodes/scripts/ingest/auto-ingest.sh >> /tmp/doac-auto-ingest.log 2>&1

set -e
cd "$(dirname "$0")/../.."

# Pick up the LTS Node from .nvmrc. Cron's PATH is minimal, source
# nvm explicitly. Same for the python venv (face detection).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
source ~/.nvm/nvm.sh
nvm use > /dev/null

notify() {
  osascript -e "display notification \"$2\" with title \"DOAC episodes\" subtitle \"$1\""
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Refreshing YouTube catalog…"
npm run fetch:channel > /dev/null

NEW=$(node scripts/ingest/next-candidates.mjs 50 30 2>/dev/null \
  | grep -E '^[a-zA-Z0-9_-]{11}' | awk '{print $1}')
COUNT=$(printf '%s\n' "$NEW" | grep -c . || true)

if [ "$COUNT" -eq 0 ]; then
  echo "No new episodes."
  exit 0
fi

echo "Found $COUNT new episode(s); ingesting…"
SUCCESS=0
FAILED=()
while IFS= read -r id; do
  [ -z "$id" ] && continue
  echo "========== $id =========="
  if node scripts/ingest/ingest-episode.mjs "$id"; then
    SUCCESS=$((SUCCESS + 1))
  else
    FAILED+=("$id")
  fi
done <<< "$NEW"

if [ "$SUCCESS" -gt 0 ]; then
  git add data/episodes.json data/guests.json public/portraits/
  git commit -m "Auto-ingest: $SUCCESS new episode(s)"
  git push
  notify "Ingest complete" "$SUCCESS new episode(s) ingested and pushed."
else
  notify "Ingest failed" "0 of $COUNT episodes ingested."
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed: ${FAILED[*]}"
fi
