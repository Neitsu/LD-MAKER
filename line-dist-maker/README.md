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
  - `lead`: gagnant RMS par frame (somme des % ≈ 100)
  - `overlap`: chacun gagne du temps
  - `group`: overlap déplacé vers piste `group` (`DUO/ALL` par défaut)
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

## Commande de rendu (recommandée)

Depuis `line-dist-maker/`:

```bash
npm --prefix renderer run render -- --config examples/project.example.json --out out.mp4 --reanalyze
```

## Format `project.json`

Voir `examples/project.example.json`.

Points clés:
- Les chemins sont résolus relativement au dossier du fichier `project.json`.
- Toutes les acapellas doivent être alignées temporellement (start à 00:00).
- Le script aligne/tronque/pad automatiquement les acapellas à la durée max détectée.

## Pourquoi vous pouviez voir un écran 404

Le renderer attend des assets dans `renderer/public/runtime/<projectId>/`.
Cette version:
- copie automatiquement les assets dans ce dossier,
- convertit les URLs assets avec `staticFile(...)` côté Remotion,
- évite les chemins relatifs cassés.

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

```txt
SDV = (sample_std_dev(percents, ddof=1) / (100/N)) * 100
```

## Dépannage

- Si `ffmpeg` absent: installer via gestionnaire système.
- Si VAD échoue: fallback RMS activé automatiquement.
- Pour prévisualiser la composition:

```bash
npm --prefix renderer run studio
```
