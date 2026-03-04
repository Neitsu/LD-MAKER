import React from 'react';
import {interpolate} from 'remotion';

export type MemberState = {
  id: string;
  name: string;
  color: string;
  avatar: string;
  seconds: number;
  percent: number;
  active: boolean;
  maxSeconds: number;
};

export const BarsList: React.FC<{ members: MemberState[] }> = ({ members }) => {
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
      {members.map((m) => {
        const scale = m.active ? 1.03 : 1;
        const glow = m.active ? `0 0 26px ${m.color}` : 'none';
        const ratio = m.maxSeconds > 0 ? m.seconds / m.maxSeconds : 0;
        const width = interpolate(ratio, [0, 1], [0, 560], {extrapolateRight: 'clamp'});
        return (
          <div key={m.id} style={{display: 'flex', alignItems: 'center', gap: 16, transform: `scale(${scale})`, transition: 'transform 200ms ease', filter: m.active ? 'brightness(1.2)' : 'brightness(0.9)'}}>
            <img src={m.avatar} style={{width: 74, height: 74, borderRadius: 999, objectFit: 'cover', border: `3px solid ${m.color}`, boxShadow: glow}} />
            <div style={{width: 720}}>
              <div style={{display: 'flex', justifyContent: 'space-between', color: 'white', fontSize: 34, fontWeight: 700}}>
                <span>{m.name}</span>
                <span>{m.percent.toFixed(1)}% · {m.seconds.toFixed(1)}s</span>
              </div>
              <div style={{height: 20, background: 'rgba(255,255,255,0.14)', borderRadius: 20, marginTop: 8}}>
                <div style={{height: '100%', width, borderRadius: 20, background: m.color, boxShadow: glow, transition: 'width 120ms linear'}} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
