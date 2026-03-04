import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Img, Sequence, Video, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BarsList} from './ui/BarsList';
import {Gauge} from './ui/Gauge';
import {fontStack} from './ui/typography';

type Member = {id: string; name: string; color: string; avatar: string};
type Segment = {start: number; end: number; member: string};

type Props = {
  songTitle: string;
  songLogo?: string;
  backgroundVideo: string;
  playbackAudio: string;
  background?: {opacity?: number; blur?: number; darken?: number};
  members: Member[];
  segments: Segment[];
  mode: string;
  barMaxMode?: 'dynamic' | 'final';
  showDynamicSdv?: boolean;
};

const sampleStd = (values: number[]) => {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const toStatic = (p?: string) => (p ? staticFile(p.replace(/^\//, '')) : undefined);

export const LineDistComposition: React.FC<Props> = (props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const runtime = useMemo(() => {
    const maxEnd = Math.max(...props.segments.map((s) => s.end), 1);
    const frameCount = Math.ceil(maxEnd * fps);
    const byFrame: Record<string, number[]> = {};
    const activeByFrame: string[] = new Array(frameCount).fill('');

    props.members.forEach((m) => {
      byFrame[m.id] = new Array(frameCount).fill(0);
    });

    const deltas: Record<string, number[]> = {};
    props.members.forEach((m) => {
      deltas[m.id] = new Array(frameCount + 1).fill(0);
    });

    props.segments.forEach((seg) => {
      if (!deltas[seg.member]) return;
      const startF = Math.max(0, Math.floor(seg.start * fps));
      const endF = Math.min(frameCount, Math.ceil(seg.end * fps));
      if (startF < endF) {
        deltas[seg.member][startF] += 1;
        deltas[seg.member][endF] -= 1;
      }
    });

    const activeCounts: Record<string, number> = {};
    props.members.forEach((m) => {
      activeCounts[m.id] = 0;
    });

    for (let f = 0; f < frameCount; f++) {
      let firstActive = '';
      for (const m of props.members) {
        activeCounts[m.id] += deltas[m.id][f];
        const prev = f > 0 ? byFrame[m.id][f - 1] : 0;
        byFrame[m.id][f] = prev + (activeCounts[m.id] > 0 ? 1 / fps : 0);
        if (!firstActive && activeCounts[m.id] > 0) {
          firstActive = m.id;
        }
      }
      activeByFrame[f] = firstActive;
    }

    const finalTotals: Record<string, number> = {};
    props.members.forEach((m) => {
      finalTotals[m.id] = byFrame[m.id][frameCount - 1] ?? 0;
    });

    const dynamicSdv = new Array(frameCount).fill(0).map((_, f) => {
      const total = props.members.reduce((acc, m) => acc + byFrame[m.id][f], 0);
      if (total <= 0) return 0;
      const pcts = props.members.map((m) => (byFrame[m.id][f] / total) * 100);
      const baseline = 100 / props.members.length;
      return (sampleStd(pcts) / baseline) * 100;
    });

    return {byFrame, activeByFrame, finalTotals, dynamicSdv, frameCount};
  }, [props.members, props.segments, fps]);

  const clampedFrame = Math.max(0, Math.min(frame, runtime.frameCount - 1));
  const totalNow = props.members.reduce((acc, m) => acc + (runtime.byFrame[m.id][clampedFrame] ?? 0), 0);
  const finalMax = Math.max(...props.members.map((m) => runtime.finalTotals[m.id] ?? 0), 0.001);
  const dynamicMax = Math.max(...props.members.map((m) => runtime.byFrame[m.id][clampedFrame] ?? 0), 0.001);
  const denom = props.barMaxMode === 'final' ? finalMax : dynamicMax;

  const memberStates = props.members.map((m) => {
    const seconds = runtime.byFrame[m.id][clampedFrame] ?? 0;
    return {
      ...m,
      seconds,
      percent: totalNow > 0 ? (seconds / totalNow) * 100 : 0,
      active: runtime.activeByFrame[clampedFrame] === m.id,
      maxSeconds: denom,
      avatar: toStatic(m.avatar) ?? '',
    };
  });

  const sdv = props.showDynamicSdv
    ? runtime.dynamicSdv[clampedFrame] ?? 0
    : runtime.dynamicSdv[runtime.frameCount - 1] ?? 0;

  return (
    <AbsoluteFill style={{fontFamily: fontStack, backgroundColor: 'black'}}>
      <Video
        src={toStatic(props.backgroundVideo)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: props.background?.opacity ?? 0.35,
          filter: `blur(${props.background?.blur ?? 2}px)`,
        }}
      />
      <AbsoluteFill style={{backgroundColor: `rgba(0,0,0,${props.background?.darken ?? 0.35})`}} />
      <Audio src={toStatic(props.playbackAudio)} />

      <AbsoluteFill style={{padding: '80px 60px 120px 60px', display: 'flex'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <div>
            <div style={{fontSize: 56, color: 'white', fontWeight: 800}}>{props.songTitle}</div>
            {props.songLogo ? <Img src={toStatic(props.songLogo)!} style={{marginTop: 12, width: 190, objectFit: 'contain'}} /> : null}
          </div>
          <Gauge value={sdv} />
        </div>
        <div style={{marginTop: 80}}>
          <BarsList members={memberStates} />
        </div>
      </AbsoluteFill>

      <Sequence from={0}>
        <AbsoluteFill style={{pointerEvents: 'none', opacity: interpolate(frame, [0, 12], [0, 1])}} />
      </Sequence>
    </AbsoluteFill>
  );
};
