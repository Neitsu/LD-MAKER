#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import minimist from 'minimist';
import {bundle} from '@remotion/bundler';
import {getCompositions, renderMedia, selectComposition} from '@remotion/renderer';

const args = minimist(process.argv.slice(2));
const configPath = path.resolve(args.config || 'examples/project.example.json');
const outPath = path.resolve(args.out || 'out.mp4');
const reanalyze = Boolean(args.reanalyze);

if (!fs.existsSync(configPath)) {
  console.error(`[render] config not found: ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const projectId = cfg.projectId;
const runtimeDir = path.resolve('renderer/public/runtime', projectId);
fs.mkdirSync(runtimeDir, {recursive: true});

const segmentsPath = path.join(runtimeDir, 'segments.json');
const summaryPath = path.join(runtimeDir, 'summary.json');

const cp = (src, dstName) => {
  const dst = path.join(runtimeDir, dstName);
  fs.copyFileSync(path.resolve(src), dst);
  return `runtime/${projectId}/${dstName}`;
};

const bgRuntime = cp(cfg.backgroundVideo, 'background' + path.extname(cfg.backgroundVideo));
const playbackRuntime = cp(cfg.playbackAudio, 'playback' + path.extname(cfg.playbackAudio));
const logoRuntime = cfg.songLogo ? cp(cfg.songLogo, 'logo' + path.extname(cfg.songLogo)) : undefined;

const members = cfg.members.map((m) => ({
  ...m,
  avatar: cp(m.avatar, `avatar_${m.id}${path.extname(m.avatar)}`),
}));

if (reanalyze || !fs.existsSync(segmentsPath)) {
  const py = spawnSync(
    'python3',
    [
      path.resolve('analyzer/analyze.py'),
      '--config',
      configPath,
      '--segments-out',
      segmentsPath,
      '--summary-out',
      summaryPath,
    ],
    {stdio: 'inherit'}
  );
  if (py.status !== 0) process.exit(py.status ?? 1);
}

const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf-8'));
const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) : null;

const entry = path.resolve('renderer/src/index.ts');
const bundleLocation = await bundle({entryPoint: entry});
const comps = await getCompositions(bundleLocation, {
  inputProps: {
    songTitle: cfg.songTitle,
    songLogo: logoRuntime,
    backgroundVideo: bgRuntime,
    playbackAudio: playbackRuntime,
    background: cfg.background,
    members,
    segments: segments.segments,
    mode: segments.mode,
    barMaxMode: cfg.render?.barMaxMode ?? 'dynamic',
    showDynamicSdv: cfg.render?.showDynamicSdv ?? true,
    summary,
  },
});
const composition = selectComposition({compositions: comps, id: 'LineDistribution'});

await renderMedia({
  codec: 'h264',
  composition,
  serveUrl: bundleLocation,
  outputLocation: outPath,
  inputProps: {
    songTitle: cfg.songTitle,
    songLogo: logoRuntime,
    backgroundVideo: bgRuntime,
    playbackAudio: playbackRuntime,
    background: cfg.background,
    members,
    segments: segments.segments,
    mode: segments.mode,
    barMaxMode: cfg.render?.barMaxMode ?? 'dynamic',
    showDynamicSdv: cfg.render?.showDynamicSdv ?? true,
  },
});

console.log(`[render] done -> ${outPath}`);
