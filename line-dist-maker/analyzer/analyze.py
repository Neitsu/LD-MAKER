#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import numpy as np

try:
    import webrtcvad
except Exception:
    webrtcvad = None

FRAME_MS = 30
SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2
CHANNELS = 1


@dataclass
class Segment:
    start: float
    end: float
    member: str


def run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe_duration(path: str) -> float:
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
        "default=noprint_wrappers=1:nokey=1", path,
    ]).stdout.strip()
    return float(out)


def ensure_pcm(input_path: str, out_wav: str, target_duration: float) -> None:
    run([
        "ffmpeg", "-y", "-i", input_path,
        "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16",
        "-af", f"apad,atrim=0:{target_duration:.6f}",
        out_wav,
    ])


def read_pcm_frames(wav_path: str, frame_ms: int = FRAME_MS):
    with wave.open(wav_path, "rb") as wf:
        frame_size = int(SAMPLE_RATE * frame_ms / 1000)
        bytes_per_frame = frame_size * SAMPLE_WIDTH
        data = wf.readframes(wf.getnframes())

    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
    total_frames = len(samples) // frame_size
    frames, rms = [], []

    for i in range(total_frames):
        start = i * frame_size
        end = start + frame_size
        frame_samples = samples[start:end]
        frame_bytes = frame_samples.astype(np.int16).tobytes()
        if len(frame_bytes) == bytes_per_frame:
            frames.append(frame_bytes)
            rms.append(float(np.sqrt(np.mean(np.square(frame_samples))) + 1e-9))

    duration = len(samples) / SAMPLE_RATE
    return frames, rms, duration


def vad_frames(frames: List[bytes], aggressiveness: int) -> List[bool]:
    if webrtcvad is None:
        raise RuntimeError("webrtcvad unavailable")
    vad = webrtcvad.Vad(max(0, min(3, aggressiveness)))
    return [vad.is_speech(f, SAMPLE_RATE) for f in frames]


def rms_fallback(rms: List[float]) -> List[bool]:
    arr = np.array(rms)
    threshold = np.percentile(arr, 65) * 0.7
    return [v > threshold for v in arr]


def smooth_mask(mask: List[bool], frame_ms: int, fill_gap_ms: int, min_seg_ms: int) -> List[bool]:
    out = mask[:]
    gap = max(1, fill_gap_ms // frame_ms)
    min_seg = max(1, min_seg_ms // frame_ms)

    i = 0
    while i < len(out):
        if out[i]:
            i += 1
            continue
        j = i
        while j < len(out) and not out[j]:
            j += 1
        if i > 0 and j < len(out) and (j - i) <= gap:
            for k in range(i, j):
                out[k] = True
        i = j

    i = 0
    while i < len(out):
        if not out[i]:
            i += 1
            continue
        j = i
        while j < len(out) and out[j]:
            j += 1
        if (j - i) < min_seg:
            for k in range(i, j):
                out[k] = False
        i = j

    return out


def mask_to_segments(mask: List[bool], member: str, frame_ms: int, pad_ms: int, duration: float) -> List[Segment]:
    segments: List[Segment] = []
    i = 0
    while i < len(mask):
        if not mask[i]:
            i += 1
            continue
        j = i
        while j < len(mask) and mask[j]:
            j += 1
        start = max(0.0, i * frame_ms / 1000.0 - pad_ms / 1000.0)
        end = min(duration, j * frame_ms / 1000.0 + pad_ms / 1000.0)
        segments.append(Segment(start=start, end=end, member=member))
        i = j
    return segments


def sample_std(values: List[float]) -> float:
    arr = np.array(values, dtype=np.float64)
    if len(arr) <= 1:
        return 0.0
    return float(np.std(arr, ddof=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--segments-out", required=True)
    parser.add_argument("--summary-out", required=True)
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    analysis = config.get("analysis", {})
    mode = analysis.get("mode", "lead")
    group_label = analysis.get("groupLabel", "DUO/ALL")
    aggr = int(analysis.get("vadAggressiveness", 2))
    min_segment_ms = int(analysis.get("minSegmentMs", 120))
    fill_gap_ms = int(analysis.get("fillGapMs", 150))
    pad_ms = int(analysis.get("padMs", 50))

    members = config["members"]
    durations = [probe_duration(m["acapella"]) for m in members]
    duration = max(durations)
    print(f"[analyzer] members={len(members)} max_duration={duration:.3f}s mode={mode}")

    member_masks: Dict[str, List[bool]] = {}
    member_rms: Dict[str, List[float]] = {}
    max_frames = 0

    with tempfile.TemporaryDirectory() as td:
        for m in members:
            wav = os.path.join(td, f"{m['id']}.wav")
            ensure_pcm(m["acapella"], wav, duration)
            frames, rms, wav_duration = read_pcm_frames(wav)
            max_frames = max(max_frames, len(frames))

            used_fallback = False
            try:
                mask = vad_frames(frames, aggr)
            except Exception:
                used_fallback = True
                mask = rms_fallback(rms)

            mask = smooth_mask(mask, FRAME_MS, fill_gap_ms, min_segment_ms)
            member_masks[m["id"]] = mask
            member_rms[m["id"]] = rms
            duration = max(duration, wav_duration)
            print(f"[analyzer] {m['id']}: frames={len(frames)} fallback_rms={used_fallback}")

    for mid in member_masks:
        if len(member_masks[mid]) < max_frames:
            pad_n = max_frames - len(member_masks[mid])
            member_masks[mid].extend([False] * pad_n)
            member_rms[mid].extend([0.0] * pad_n)

    final_masks: Dict[str, List[bool]] = {m["id"]: [False] * max_frames for m in members}
    group_mask = [False] * max_frames

    for frame_idx in range(max_frames):
        active = [m["id"] for m in members if member_masks[m["id"]][frame_idx]]
        if not active:
            continue

        if mode == "overlap":
            for mid in active:
                final_masks[mid][frame_idx] = True
        elif mode == "group" and len(active) > 1:
            group_mask[frame_idx] = True
        else:
            winner = max(active, key=lambda mid: member_rms[mid][frame_idx])
            final_masks[winner][frame_idx] = True

    segments: List[Segment] = []
    for m in members:
        segments.extend(mask_to_segments(final_masks[m["id"]], m["id"], FRAME_MS, pad_ms, duration))

    include_group = mode == "group" and any(group_mask)
    if include_group:
        segments.extend(mask_to_segments(group_mask, "group", FRAME_MS, pad_ms, duration))

    segments.sort(key=lambda s: (s.start, s.end))

    totals = {m["id"]: 0.0 for m in members}
    for seg in segments:
        if seg.member in totals:
            totals[seg.member] += max(0.0, seg.end - seg.start)

    sum_totals = sum(totals.values())
    denom = max(sum_totals, 1e-9)
    percents = {mid: (sec / denom) * 100.0 for mid, sec in totals.items()}

    percent_values = list(percents.values())
    n = len(percent_values)
    baseline = (100.0 / n) if n else 0.0
    sdv = (sample_std(percent_values) / baseline * 100.0) if baseline > 0 else 0.0

    payload_members = [
        {"id": m["id"], "name": m["name"], "color": m["color"], "avatar": m["avatar"]}
        for m in members
    ]
    if include_group:
        payload_members.append({
            "id": "group",
            "name": group_label,
            "color": analysis.get("groupColor", "#95a5a6"),
            "avatar": analysis.get("groupAvatar", ""),
        })

    segments_payload = {
        "duration": round(duration, 3),
        "fps": int(config.get("render", {}).get("fps", 30)),
        "members": payload_members,
        "segments": [{"start": round(s.start, 3), "end": round(s.end, 3), "member": s.member} for s in segments],
        "mode": mode,
    }

    summary_payload = {
        "totals": {k: round(v, 3) for k, v in totals.items()},
        "percents": {k: round(v, 3) for k, v in percents.items()},
        "sdv": round(sdv, 3),
    }

    Path(args.segments_out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.segments_out, "w", encoding="utf-8") as f:
        json.dump(segments_payload, f, indent=2)
    with open(args.summary_out, "w", encoding="utf-8") as f:
        json.dump(summary_payload, f, indent=2)

    print(f"[analyzer] wrote {args.segments_out} and {args.summary_out}")


if __name__ == "__main__":
    main()
