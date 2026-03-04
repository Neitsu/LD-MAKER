#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import minimist from 'minimist';
import {bundle} from '@remotion/bundler';
import {getCompositions, renderMedia, selectComposition} from '@remotion/renderer';

type Member = {id: string; name: string; color: string; avatar: string; acapella: string};

type ProjectConfig = {
  projectId: string;
  songTitle: string;
  songLogo?: string;
  backgroundVideo: string;
  background?: {opacity?: number; blur?: number; darken?: number};
  playbackAudio: string;
  members: Member[];
  analysis?: Record<string, unknown>;
  render?: Record<string, unknown>;
};

const args = minimist(process.argv.slice(2));
const configPath = path.resolve(args.config || 'examples/project.example.json');
const outPath = path.resolve(args.out || 'out.mp4');
const reanalyze = Boolean(args.reanalyze);

if (!fs.existsSync(configPath)) {
  console.error(`[render] config not found: ${configPath}`);
  process.exit(1);
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const configDir = path.dirname(configPath);
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
const projectId = cfg.projectId;

if (!projectId) {
  console.error('[render] missing projectId in config');
  process.exit(1);
}

const runtimeDir = path.resolve('renderer/public/runtime', projectId);
fs.mkdirSync(runtimeDir, {recursive: true});

const segmentsPath = path.join(runtimeDir, 'segments.json');
const summaryPath = path.join(runtimeDir, 'summary.json');

const resolveFromConfig = (p: string) => (path.isAbsolute(p) ? p : path.resolve(configDir, p));

const copyRuntime = (src: string, dstName: string) => {
  const absSrc = resolveFromConfig(src);
  if (!fs.existsSync(absSrc)) {
    throw new Error(`Asset not found: ${absSrc}`);
  }
  const dst = path.join(runtimeDir, dstName);
  fs.copyFileSync(absSrc, dst);
  return `runtime/${projectId}/${dstName}`;
};

console.log(`[render] projectId=${projectId}`);

const bgRuntime = copyRuntime(cfg.backgroundVideo, `background${path.extname(cfg.backgroundVideo)}`);
const playbackRuntime = copyRuntime(cfg.playbackAudio, `playback${path.extname(cfg.playbackAudio)}`);
const logoRuntime = cfg.songLogo ? copyRuntime(cfg.songLogo, `logo${path.extname(cfg.songLogo)}`) : undefined;

const members = cfg.members.map((m) => ({
  ...m,
  avatar: copyRuntime(m.avatar, `avatar_${m.id}${path.extname(m.avatar)}`),
  acapella: resolveFromConfig(m.acapella),
}));

const analyzerConfigPath = path.join(runtimeDir, 'analysis-input.json');
const analyzerConfig = {
  ...cfg,
  members: members.map((m) => ({...m, avatar: m.avatar, acapella: m.acapella})),
};
fs.writeFileSync(analyzerConfigPath, JSON.stringify(analyzerConfig, null, 2));

if (reanalyze || !fs.existsSync(segmentsPath)) {
  console.log('[render] running analyzer...');
  const py = spawnSync(
    'python3',
    [
      path.resolve('analyzer/analyze.py'),
      '--config', analyzerConfigPath,
      '--segments-out', segmentsPath,
      '--summary-out', summaryPath,
    ],
    {stdio: 'inherit'}
  );
  if (py.status !== 0) {
    process.exit(py.status ?? 1);
  }
} else {
  console.log('[render] reusing existing segments.json/summary.json');
}

const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf-8'));

const inputProps = {
  songTitle: cfg.songTitle,
  songLogo: logoRuntime,
  backgroundVideo: bgRuntime,
  playbackAudio: playbackRuntime,
  background: cfg.background,
  members,
  segments: segments.segments,
  mode: segments.mode,
  barMaxMode: (cfg.render?.barMaxMode as 'dynamic' | 'final' | undefined) ?? 'dynamic',
  showDynamicSdv: (cfg.render?.showDynamicSdv as boolean | undefined) ?? true,
};

const entry = path.resolve('renderer/src/index.ts');
const bundleLocation = await bundle({entryPoint: entry});
const compositions = await getCompositions(bundleLocation, {inputProps});
const composition = selectComposition({compositions, id: 'LineDistribution'});

await renderMedia({
  codec: 'h264',
  composition,
  serveUrl: bundleLocation,
  outputLocation: outPath,
  inputProps,
});

console.log(`[render] done -> ${outPath}`);
