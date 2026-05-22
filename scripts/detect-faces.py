#!/usr/bin/env python3
"""Score frames by face quality.

For each .jpg in the given folder, detect faces. Score frames with exactly
one face by face area + how centered it is. Output sorted JSON.

Usage:  .venv/bin/python scripts/detect-faces.py data/_frames/<video-id>
"""

import cv2
import sys
import json
import os
import glob

if len(sys.argv) < 2:
    print("Usage: detect-faces.py <frames-dir>", file=sys.stderr)
    sys.exit(1)

frames_dir = sys.argv[1].rstrip("/")
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

results = []
for path in sorted(glob.glob(f"{frames_dir}/*.jpg")):
    img = cv2.imread(path)
    if img is None:
        continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # scaleFactor 1.1, minNeighbors 5, minSize 80px (filter out tiny false positives)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))

    h, w = img.shape[:2]
    entry = {
        "file": os.path.basename(path),
        "faces": len(faces),
    }

    if len(faces) == 1:
        x, y, fw, fh = faces[0]
        area_pct = (fw * fh) / (w * h)
        cx = (x + fw / 2) / w
        cy = (y + fh / 2) / h
        center_offset = abs(cx - 0.5) + abs(cy - 0.5)
        # higher score = better. Big face, near center.
        score = area_pct - center_offset * 0.5
        entry.update(
            {
                "face_area_pct": round(area_pct * 100, 1),
                "center_offset": round(center_offset, 3),
                "score": round(score, 3),
                "bbox": [int(x), int(y), int(fw), int(fh)],
            }
        )
    else:
        entry["score"] = -1

    results.append(entry)

results.sort(key=lambda r: r["score"], reverse=True)
print(json.dumps(results, indent=2))
