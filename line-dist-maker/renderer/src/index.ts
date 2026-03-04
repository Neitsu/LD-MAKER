import {Composition, registerRoot} from 'remotion';
import React from 'react';
import {LineDistComposition} from './LineDistComposition';

const Root: React.FC = () => {
  return (
    <Composition
      id="LineDistribution"
      component={LineDistComposition}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={30}
      defaultProps={{
        songTitle: 'Untitled',
        backgroundVideo: 'runtime/default/bg.mp4',
        playbackAudio: 'runtime/default/audio.mp3',
        members: [],
        segments: [],
        mode: 'lead',
      }}
      calculateMetadata={({props}) => {
        const maxEnd = Math.max(1, ...(props.segments ?? []).map((s: {end: number}) => s.end));
        return {
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: Math.ceil(maxEnd * 30),
        };
      }}
    />
  );
};

registerRoot(Root);
