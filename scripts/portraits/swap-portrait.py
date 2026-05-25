#!/usr/bin/env python3
"""Swap an episode's portrait to one of the top-N auto-portrait candidates.

Two-step workflow when the default pick is wrong:

  # 1) Generate top-5 candidates into a working dir
  mkdir -p /tmp/_picks/<videoId>
  .venv/bin/python scripts/portraits/auto-portrait.py \
    data/_frames/<videoId> /tmp/_picks/<videoId>/out.jpg 5

  # 2) Visually review /tmp/_picks/<videoId>/out{,-2,-3,-4,-5}.jpg
  #    then swap the chosen pick in as the primary portrait:
  .venv/bin/python scripts/portraits/swap-portrait.py <videoId> <pick-1-5>

The script copies all six format files (jpg/webp/avif × 1x/@2x) into
public/portraits/doac-<videoId>.* and updates the episode's
thumbnailBrightness in data/episodes.json based on the new primary.
"""

import json
import os
import shutil
import sys
import tempfile

import cv2
import numpy as np


def write_json_atomic(path, data):
    """Write JSON via a temp file + os.replace so Vite's watcher never sees
    a partial file. Same rationale as the JS-side helpers in
    scripts/ingest/lib/utils.mjs and server/index.mjs."""
    dirname = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(dir=dirname, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        os.unlink(tmp)
        raise

if len(sys.argv) < 3 or len(sys.argv) > 4:
    sys.exit("Usage: swap-portrait.py <videoId> <pick-1-5> [src-dir]")

vid = sys.argv[1]
pick = int(sys.argv[2])
if pick < 1 or pick > 5:
    sys.exit("Pick must be 1-5")

src_dir = sys.argv[3] if len(sys.argv) == 4 else f"/tmp/_picks/{vid}"
src_base = f"{src_dir}/out" + (f"-{pick}" if pick > 1 else "")
dst_base = f"public/portraits/doac-{vid}"

for ext in ("jpg", "webp", "avif"):
    shutil.copy(f"{src_base}.{ext}", f"{dst_base}.{ext}")
    shutil.copy(f"{src_base}@2x.{ext}", f"{dst_base}@2x.{ext}")

# Recompute brightness from the new primary 1x JPG so the card scrim matches.
img = cv2.imread(f"{dst_base}.jpg")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
brightness = round(float(np.mean(gray)) / 255.0, 3)

with open("data/episodes.json") as f:
    eps = json.load(f)
for ep in eps:
    if ep["id"] == f"doac-{vid}":
        # Always point the episode at the per-episode file we just wrote.
        # Older entries may still have a canonical /portraits/<guestId>.jpg
        # in their thumbnail field; without this update the JSON points at
        # an unchanged file and the swap appears to do nothing on the site.
        ep["thumbnail"] = f"/portraits/doac-{vid}.jpg"
        ep["thumbnail2x"] = f"/portraits/doac-{vid}@2x.jpg"
        ep["thumbnailBrightness"] = brightness
        break
else:
    sys.exit(f"Episode doac-{vid} not found in episodes.json")
write_json_atomic("data/episodes.json", eps)

print(f"Swapped doac-{vid} → pick {pick}, brightness {brightness}")
