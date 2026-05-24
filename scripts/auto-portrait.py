#!/usr/bin/env python3
"""Pick the top-N best-framed faces from a folder of candidate frames and save
4:5 portrait crops. The top-scoring one is saved as <output> (the default the
UI will use); the 2nd and 3rd as <output-base>-2.jpg and <output-base>-3.jpg
(fallback options if the top pick is wrong).

Usage:  .venv/bin/python scripts/auto-portrait.py <frames-dir> <output-jpg> [top-n=3]
"""

import cv2
import face_recognition
import mediapipe as mp
import numpy as np
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
face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=True, max_num_faces=1, refine_landmarks=False, min_detection_confidence=0.5
)

# Host (Steven Bartlett) reference. We blacklist him: any candidate face that
# matches gets a penalty heavy enough to override face-size advantage. Since
# DOAC frames contain exactly one face (filtered upstream) and the host is
# the only consistent identity across episodes, "not the host" = "the guest"
# by elimination — no per-guest reference needed.
HOST_REFERENCE_PATH = "data/host-bartlett.jpg"
HOST_DISTANCE_DEFINITE = 0.50  # below this → definitely the host
HOST_DISTANCE_LIKELY = 0.60  # face_recognition's default tolerance
HOST_PENALTY_DEFINITE = -0.30  # must exceed face-size advantage (~0.25 max)
HOST_PENALTY_LIKELY = -0.10

_host_image = face_recognition.load_image_file(HOST_REFERENCE_PATH)
_host_encodings = face_recognition.face_encodings(_host_image)
if not _host_encodings:
    print(f"ERROR: no face found in {HOST_REFERENCE_PATH}", file=sys.stderr)
    sys.exit(1)
HOST_ENCODING = _host_encodings[0]

# Eye Aspect Ratio (EAR): vertical eye opening / horizontal eye width. Open
# eyes ≈ 0.28-0.35; squinting ≈ 0.20-0.25; closed/blinking ≤ 0.18. This
# replaces the Haar eye cascade, which kept missing partial-blinks and
# false-positiving on nostrils.
EAR_OPEN = 0.25
EAR_PARTIAL = 0.18
EYE_OPEN_BONUS = 0.06
EYE_PARTIAL_BONUS = 0.02
EYE_CLOSED_PENALTY = -0.04
EYE_NO_LANDMARKS_PENALTY = -0.02  # face too small/angled for FaceMesh

# MediaPipe FaceMesh landmark indices for the eye outline. Using the standard
# 4-point EAR (outer + inner corners + top + bottom lid). The 6-point dlib
# formula is more robust, but FaceMesh's outline points scatter; 4-point is
# simpler and works well enough at our face sizes.
LEFT_EYE = {"outer": 33, "inner": 133, "top": 159, "bottom": 145}
RIGHT_EYE = {"inner": 362, "outer": 263, "top": 386, "bottom": 374}


def _ear(lm, w, h, indices):
    top = lm[indices["top"]]
    bottom = lm[indices["bottom"]]
    outer = lm[indices["outer"]]
    inner = lm[indices["inner"]]
    vertical = abs(top.y - bottom.y) * h
    horizontal = max(1.0, abs(outer.x - inner.x) * w)
    return vertical / horizontal


def face_encoding(img_bgr, face_bbox):
    """Return the 128-dim face encoding for the bbox, or None on failure."""
    x, y, fw, fh = face_bbox
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    # face_recognition expects (top, right, bottom, left)
    location = (y, x + fw, y + fh, x)
    encs = face_recognition.face_encodings(rgb, known_face_locations=[location])
    return encs[0] if encs else None


def host_match_score(encoding):
    """Return (distance, penalty). distance is None if encoding is None."""
    if encoding is None:
        return None, 0.0
    distance = float(face_recognition.face_distance([HOST_ENCODING], encoding)[0])
    if distance < HOST_DISTANCE_DEFINITE:
        penalty = HOST_PENALTY_DEFINITE
    elif distance < HOST_DISTANCE_LIKELY:
        penalty = HOST_PENALTY_LIKELY
    else:
        penalty = 0.0
    return distance, penalty


# Face clustering: across the 20 sample frames, the actual guest's face
# appears in most of them while B-roll/news-clip faces (e.g. Saddam
# Hussein archive footage in a geopolitics episode) only appear in 1-2
# frames. By grouping candidate faces by embedding similarity and
# keeping only the dominant cluster, we filter out one-off B-roll
# matches without needing a per-episode reference photo.
CLUSTER_DISTANCE = 0.55  # face_recognition's "definitely same person" threshold


def dominant_face_indices(encodings):
    """Cluster faces by similarity (union-find) and return the indices of
    the largest cluster — but ONLY if it's significantly larger than the
    next-largest (≥ 2×). On multi-guest panels both guests' clusters are
    similarly sized; in that case we return all valid indices (skip
    filtering) so the existing scoring can pick the right person.
    Indices for which encoding is None are left out."""
    n = len(encodings)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    valid = [i for i, e in enumerate(encodings) if e is not None]
    for i_pos, i in enumerate(valid):
        for j in valid[i_pos + 1 :]:
            dist = float(face_recognition.face_distance([encodings[i]], encodings[j])[0])
            if dist < CLUSTER_DISTANCE:
                union(i, j)

    clusters = {}
    for i in valid:
        root = find(i)
        clusters.setdefault(root, []).append(i)
    if not clusters:
        return set(valid)

    sorted_clusters = sorted(clusters.values(), key=len, reverse=True)
    largest = sorted_clusters[0]
    if len(sorted_clusters) > 1:
        next_largest = sorted_clusters[1]
        # Panel detection: if the second cluster is at least half the size
        # of the dominant one, there's no clear "main" face — likely a
        # multi-guest episode. Skip filtering.
        if len(next_largest) * 2 >= len(largest):
            return set(valid)
    return set(largest)


def eye_metrics(img_bgr, face_bbox):
    """Return (ear_avg, eye_score). ear_avg is None when FaceMesh fails."""
    x, y, fw, fh = face_bbox
    h, w = img_bgr.shape[:2]
    pad = int(max(fw, fh) * 0.4)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(w, x + fw + pad), min(h, y + fh + pad)
    face_img = img_bgr[y0:y1, x0:x1]
    rgb = cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)
    result = face_mesh.process(rgb)
    if not result.multi_face_landmarks:
        return None, EYE_NO_LANDMARKS_PENALTY
    lm = result.multi_face_landmarks[0].landmark
    crop_h, crop_w = face_img.shape[:2]
    ear_left = _ear(lm, crop_w, crop_h, LEFT_EYE)
    ear_right = _ear(lm, crop_w, crop_h, RIGHT_EYE)
    ear_avg = (ear_left + ear_right) / 2
    if ear_avg >= EAR_OPEN:
        score = EYE_OPEN_BONUS
    elif ear_avg >= EAR_PARTIAL:
        score = EYE_PARTIAL_BONUS
    else:
        score = EYE_CLOSED_PENALTY
    return ear_avg, score


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

    ear_avg, eye_score = eye_metrics(img, (x, y, fw, fh))
    encoding = face_encoding(img, (x, y, fw, fh))
    host_distance, host_penalty = host_match_score(encoding)

    score = area_pct - center_offset * 0.5 + eye_score + host_penalty

    candidates.append(
        {
            "path": path,
            "img": img,
            "bbox": (x, y, fw, fh),
            "score": score,
            "area_pct": area_pct,
            "ear": ear_avg,
            "eye_score": eye_score,
            "host_distance": host_distance,
            "host_penalty": host_penalty,
            "encoding": encoding,
        }
    )

if not candidates:
    print("No suitable frame found.", file=sys.stderr)
    sys.exit(1)

# Filter to the dominant face cluster — keeps the guest, drops B-roll
# faces (news clips, sponsor reads, archive footage) that only appear in
# a handful of frames. Mask out clear-host frames from the clustering
# pool first: in shows that cut back to the host often, Bartlett's face
# can form the largest cluster, and we'd "dominantly" pick him.
encodings_for_cluster = [
    c["encoding"] if (c["encoding"] is not None and (c["host_distance"] is None or c["host_distance"] >= HOST_DISTANCE_DEFINITE)) else None
    for c in candidates
]
valid_count = sum(1 for e in encodings_for_cluster if e is not None)
if valid_count >= 3:
    dominant = dominant_face_indices(encodings_for_cluster)
    dropped = [c for i, c in enumerate(candidates) if i not in dominant and c["encoding"] is not None]
    if dropped and len(dominant) < valid_count:
        print(
            f"face clustering: kept {len(dominant)}/{valid_count} non-host frames in dominant cluster, "
            f"dropped {len(dropped)} (host or B-roll): {', '.join(os.path.basename(c['path']) for c in dropped[:5])}{'…' if len(dropped) > 5 else ''}"
        )
        candidates = [c for i, c in enumerate(candidates) if i in dominant or c["encoding"] is None]

candidates.sort(key=lambda c: c["score"], reverse=True)
top = candidates[:top_n]

os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
base, ext = os.path.splitext(output_path)

for i, c in enumerate(top):
    out_1x = output_path if i == 0 else f"{base}-{i + 1}{ext}"
    out_2x = out_1x.replace(ext, f"@2x{ext}")
    crop_1x = crop_16_9(c["img"], c["bbox"], 800, 450)
    crop_2x = crop_16_9(c["img"], c["bbox"], 1600, 900)
    cv2.imwrite(out_1x, crop_1x, [cv2.IMWRITE_JPEG_QUALITY, 88])
    cv2.imwrite(out_2x, crop_2x, [cv2.IMWRITE_JPEG_QUALITY, 88])
    # Mean grayscale brightness (0-1) — used to compute uniform scrim
    gray = cv2.cvtColor(crop_1x, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray)) / 255.0
    rank = "default" if i == 0 else f"alt {i + 1}"
    ear_str = f"{c['ear']:.2f}" if c["ear"] is not None else "n/a"
    host_str = f"{c['host_distance']:.2f}" if c["host_distance"] is not None else "n/a"
    print(
        f"[{rank}] {os.path.basename(c['path'])} "
        f"(score {c['score']:.3f}, face {c['area_pct'] * 100:.1f}%, "
        f"ear {ear_str} ({c['eye_score']:+.3f}), "
        f"host {host_str} ({c['host_penalty']:+.3f}), "
        f"brightness {brightness:.3f}) "
        f"→ {out_1x} + @2x"
    )
