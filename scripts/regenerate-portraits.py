#!/usr/bin/env python3
"""Regenerate per-episode portraits for every episode in episodes.json.

Each episode's primary guest gets a unique portrait derived from THAT
episode's frames, saved to:

    public/portraits/doac-{videoId}.{jpg,webp,avif}
    public/portraits/doac-{videoId}@2x.{jpg,webp,avif}

Then episode.thumbnail / thumbnail2x / thumbnailBrightness are pointed
at the new files. The guest's canonical portrait stays untouched as a
fallback (used only when an episode lacks a thumbnail override).

Prereq: data/_frames/{videoId}/ must exist for every episode. They do
already for everything ingested through scripts/ingest-episode.mjs.
"""

import json
import re
import subprocess
import sys

with open("data/episodes.json") as f:
    episodes = json.load(f)

print(f"Regenerating portraits for {len(episodes)} episodes...\n")

updated = []
failed = []
for i, ep in enumerate(episodes, 1):
    vid = ep["id"].replace("doac-", "")
    out_path = f"public/portraits/doac-{vid}.jpg"

    print(f"[{i}/{len(episodes)}] {vid} → {out_path}")
    result = subprocess.run(
        [".venv/bin/python", "scripts/auto-portrait.py", f"data/_frames/{vid}", out_path, "1"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  FAILED: {result.stderr.strip()[:200]}")
        failed.append(ep["id"])
        continue

    new_brightness = None
    for line in result.stdout.split("\n"):
        m = re.search(r"brightness ([\d.]+)", line)
        if m:
            new_brightness = float(m.group(1))
            break

    ep["thumbnail"] = f"/portraits/doac-{vid}.jpg"
    ep["thumbnail2x"] = f"/portraits/doac-{vid}@2x.jpg"
    if new_brightness is not None:
        ep["thumbnailBrightness"] = new_brightness
    updated.append(ep["id"])

print()
print(f"Updated: {len(updated)}, Failed: {len(failed)}")
if failed:
    print("Failed IDs:")
    for fid in failed:
        print(f"  {fid}")

with open("data/episodes.json", "w") as f:
    json.dump(episodes, f, indent=2)
    f.write("\n")
print("\nWrote data/episodes.json.")
