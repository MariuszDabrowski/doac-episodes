#!/usr/bin/env python3
"""Generate WebP and AVIF versions of every JPG in public/portraits/.

Run once after adding new portraits. The auto-portrait pipeline also
emits all three formats going forward, so this is mostly for backfill.

Quality settings are chosen to match the perceived quality of the source
JPEGs (currently saved at quality 88 by auto-portrait.py):
  - WebP at 80 is roughly indistinguishable from JPEG 88
  - AVIF at 55 hits similar perceived quality with much smaller files
"""

import glob
import os
import sys
from PIL import Image

WEBP_QUALITY = 80
AVIF_QUALITY = 55

jpgs = sorted(glob.glob("public/portraits/*.jpg"))
if not jpgs:
    print("No .jpg files found in public/portraits/")
    sys.exit(1)

print(f"Converting {len(jpgs)} files to WebP + AVIF...")
print()

total_jpg = total_webp = total_avif = 0
for jpg_path in jpgs:
    base = jpg_path[:-4]
    webp_path = f"{base}.webp"
    avif_path = f"{base}.avif"

    img = Image.open(jpg_path).convert("RGB")
    img.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)
    img.save(avif_path, "AVIF", quality=AVIF_QUALITY, speed=4)

    jpg_size = os.path.getsize(jpg_path)
    webp_size = os.path.getsize(webp_path)
    avif_size = os.path.getsize(avif_path)
    total_jpg += jpg_size
    total_webp += webp_size
    total_avif += avif_size
    print(
        f"{os.path.basename(jpg_path):40s}  "
        f"jpg {jpg_size / 1024:6.1f}K  →  "
        f"webp {webp_size / 1024:6.1f}K ({webp_size * 100 / jpg_size:3.0f}%)  "
        f"avif {avif_size / 1024:6.1f}K ({avif_size * 100 / jpg_size:3.0f}%)"
    )

print()
print(
    f"Totals: jpg {total_jpg / 1024:.0f}K, "
    f"webp {total_webp / 1024:.0f}K ({total_webp * 100 / total_jpg:.0f}%), "
    f"avif {total_avif / 1024:.0f}K ({total_avif * 100 / total_jpg:.0f}%)"
)
