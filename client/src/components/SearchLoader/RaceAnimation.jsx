import React from 'react';

function RunnerSVG({ type, color, size = 36 }) {
  const c = color || '#60a5fa';

  if (type === 'female') {
    return (
      <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
        <circle cx="20" cy="6" r="5" fill={c} />
        <path d="M15 4 Q20 0 25 4" stroke={c} strokeWidth="2" fill="none" />
        <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M13 28 Q20 34 27 28" stroke={c} strokeWidth="2" fill={`${c}33`} />
        <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="16" x2="30" y2="22" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'briefcase') {
    return (
      <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
        <circle cx="20" cy="6" r="5" fill={c} />
        <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="16" x2="32" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <rect x="30" y="24" width="10" height="7" rx="1.5" stroke={c} strokeWidth="1.5" fill={`${c}22`} />
        <path d="M33 24 V22 H37 V24" stroke={c} strokeWidth="1.5" fill="none" />
        <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
      <circle cx="20" cy="6" r="5" fill={c} />
      <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="16" x2="30" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const RUNNERS = [
  { type: 'male',      color: '#60a5fa', duration: 6,  size: 32, top: '10%', delay: '-2s'  },
  { type: 'female',    color: '#f472b6', duration: 7,  size: 28, top: '22%', delay: '-4s'  },
  { type: 'briefcase', color: '#a78bfa', duration: 5,  size: 36, top: '16%', delay: '-1s'  },
  { type: 'male',      color: '#34d399', duration: 8,  size: 24, top: '70%', delay: '-3s'  },
  { type: 'female',    color: '#fbbf24', duration: 6,  size: 30, top: '78%', delay: '-5s'  },
  { type: 'briefcase', color: '#60a5fa', duration: 9,  size: 22, top: '63%', delay: '-6s'  },
  { type: 'male',      color: '#f472b6', duration: 5,  size: 26, top: '86%', delay: '-0.5s'},
  { type: 'female',    color: '#a78bfa', duration: 7,  size: 34, top: '55%', delay: '-3.5s'},
  { type: 'male',      color: '#fbbf24', duration: 6,  size: 20, top: '43%', delay: '-2.5s'},
  { type: 'briefcase', color: '#34d399', duration: 8,  size: 28, top: '35%', delay: '-7s'  },
];

export default function RaceAnimation() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10, overflow: 'hidden' }}>
      <style>{`
        @keyframes runAcross {
          from { transform: translateX(-80px); }
          to   { transform: translateX(calc(100vw + 80px)); }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
      `}</style>

      {RUNNERS.map((r, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: r.top,
            left: 0,
            opacity: 0.75,
            animation: `runAcross ${r.duration}s ${r.delay} linear infinite`,
            willChange: 'transform',
          }}
        >
          <div style={{ animation: `bob 0.4s ease-in-out infinite` }}>
            <RunnerSVG type={r.type} color={r.color} size={r.size} />
          </div>
        </div>
      ))}
    </div>
  );
}
