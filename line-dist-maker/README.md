# Line Distribution Maker

Outil local (K-pop style) pour générer automatiquement une vidéo verticale **1080x1920 / 30fps** de line distribution.

## Features

- Analyse automatique des acapellas par membre (VAD WebRTC + fallback RMS).
- Détection de segments chantés avec smoothing:
  - frames 30ms
  - comblement de gaps courts
  - suppression de segments courts
  - padding optionnel
- Modes d’overlap:
  - `lead`: gagnant RMS par frame (somme ≈ 100%)
  - `overlap`: chaque membre cumule son temps
  - `group`: overlap déplacé vers une piste `group`
- Exports:
  - `segments.json`
  - `summary.json` (totaux, %, SDV)
  - rendu MP4 H.264 via Remotion
- UI overlay TikTok:
  - colonne gauche: avatars + nom + `%` + secondes + barres
  - top: titre + logo optionnel
  - top-right: jauge circulaire SDV

## Structure

```txt
line-dist-maker/
  analyzer/
    analyze.py
    requirements.txt
  renderer/
    package.json
    render.ts
    src/
      index.ts
      LineDistComposition.tsx
      ui/
        BarsList.tsx
        Gauge.tsx
        typography.ts
  examples/
    project.example.json
```

## Prérequis

- Python 3.10+
- Node 18+
- `ffmpeg` et `ffprobe` installés et dans le PATH

## Installation

Depuis `line-dist-maker/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r analyzer/requirements.txt
cd renderer && npm i && cd ..
```

## Format `project.json`

Voir `examples/project.example.json`.

Points clés:
- Toutes les acapellas doivent être alignées temporellement (start à 00:00).
- Le script aligne/tronque/pad automatiquement les fichiers à la durée max détectée.

## Commande de rendu

```bash
node renderer/render.ts --config examples/project.example.json --out out.mp4
```

Options:
- `--reanalyze`: force régénération `segments.json` / `summary.json`.

## Analyse audio

Pipeline de `analyzer/analyze.py`:

1. Probe durée de chaque acapella (`ffprobe`)
2. Conversion PCM mono 16kHz 16-bit (`ffmpeg`)
3. VAD WebRTC (aggressiveness 0..3)
4. Fallback RMS si VAD indisponible/erreur
5. Smoothing (fill gaps / min segment)
6. Résolution overlaps selon le mode
7. Export JSON

### SDV

Formule:

```txt
SDV = (sample_std_dev(percents, ddof=1) / (100/N)) * 100
```

## Notes performance

- Le rendu pré-calcule les cumuls par frame.
- Convient pour morceaux ~3-4 minutes.

## Dépannage

- Si `ffmpeg` absent: installer via gestionnaire système.
- Si VAD échoue: fallback RMS activé automatiquement.
- Si Node ne lance pas `.ts` directement, exécuter:

```bash
node --experimental-strip-types renderer/render.ts --config examples/project.example.json --out out.mp4
```

(ou renommer en `.mjs` selon votre environnement)
