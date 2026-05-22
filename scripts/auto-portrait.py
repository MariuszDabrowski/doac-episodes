#!/usr/bin/env python3
"""Pick the top-N best-framed faces from a folder of candidate frames and save
4:5 portrait crops. The top-scoring one is saved as <output> (the default the
UI will use); the 2nd and 3rd as <output-base>-2.jpg and <output-base>-3.jpg
(fallback options if the top pick is wrong).

Usage:  .venv/bin/python scripts/auto-portrait.py <frames-dir> <output-jpg> [top-n=3]
"""

import cv2
import sys
import os
import glob

if len(sys.argv) < 3:
    print("Usage: auto-portrait.py <frames-dir> <output-jpg> [top-n=3]", file=sys.stderr)
    sys.exit(1)

frames_dir = sys.argv[1].rstrip("/")
output_path = sys.argv[2]
top_n = int(sys.argv[3]) if len(sys.argv) > 3 else 3

cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def crop_16_9(img, bbox, target_w, target_h):
    h, w = img.shape[:2]
    x, y, fw, fh = bbox
    face_cx = x + fw // 2
    face_cy = y + fh // 2

    target_ratio = 16 / 9
    crop_h = min(int(fh * 2.6), h)
    crop_w = min(int(crop_h * target_ratio), w)
    crop_h = int(crop_w / target_ratio)
    if crop_h > h:
        crop_h = h
        crop_w = int(crop_h * target_ratio)

    crop_x1 = face_cx - crop_w // 2
    crop_y1 = face_cy - int(crop_h * 0.4)
    crop_x1 = max(0, min(crop_x1, w - crop_w))
    crop_y1 = max(0, min(crop_y1, h - crop_h))

    out = img[crop_y1 : crop_y1 + crop_h, crop_x1 : crop_x1 + crop_w]
    return cv2.resize(out, (target_w, target_h), interpolation=cv2.INTER_AREA)


candidates = []
for path in sorted(glob.glob(f"{frames_dir}/*.jpg")):
    img = cv2.imread(path)
    if img is None:
        continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))

    if len(faces) != 1:
        continue

    h, w = img.shape[:2]
    x, y, fw, fh = faces[0]
    area_pct = (fw * fh) / (w * h)
    if area_pct < 0.02:
        continue
    cx_norm = (x + fw / 2) / w
    cy_norm = (y + fh / 2) / h
    center_offset = abs(cx_norm - 0.5) + abs(cy_norm - 0.5)
    score = area_pct - center_offset * 0.5

    candidates.append(
        {
            "path": path,
            "img": img,
            "bbox": (x, y, fw, fh),
            "score": score,
            "area_pct": area_pct,
        }
    )

if not candidates:
    print("No suitable frame found.", file=sys.stderr)
    sys.exit(1)

candidates.sort(key=lambda c: c["score"], reverse=True)
top = candidates[:top_n]

os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
base, ext = os.path.splitext(output_path)

for i, c in enumerate(top):
    out_1x = output_path if i == 0 else f"{base}-{i + 1}{ext}"
    out_2x = out_1x.replace(ext, f"@2x{ext}")
    cv2.imwrite(out_1x, crop_16_9(c["img"], c["bbox"], 800, 450), [cv2.IMWRITE_JPEG_QUALITY, 88])
    cv2.imwrite(out_2x, crop_16_9(c["img"], c["bbox"], 1600, 900), [cv2.IMWRITE_JPEG_QUALITY, 88])
    rank = "default" if i == 0 else f"alt {i + 1}"
    print(
        f"[{rank}] {os.path.basename(c['path'])} "
        f"(score {c['score']:.3f}, face {c['area_pct'] * 100:.1f}%) → {out_1x} + @2x"
    )
