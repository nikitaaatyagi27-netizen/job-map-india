import React from 'react';

// Realistic running stick figure with alternating stride poses
function Runner({ color, size, pose }) {
  const c = color;
  // pose 0 = left leg forward, pose 1 = right leg forward
  const p = pose % 2;

  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 50 80" fill="none">
      {/* Head */}
      <circle cx="25" cy="8" r="7" fill={c} />

      {/* Neck */}
      <line x1="25" y1="15" x2="25" y2="22" stroke={c} strokeWidth="3" strokeLinecap="round" />

      {/* Torso — leaning forward */}
      <line x1="25" y1="22" x2="23" y2="45" stroke={c} strokeWidth="3.5" strokeLinecap="round" />

      {/* Arms */}
      {p === 0 ? (
        <>
          {/* Left arm forward-up */}
          <line x1="25" y1="26" x2="10" y2="18" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="10" y1="18" x2="5" y2="26" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          {/* Right arm back-down */}
          <line x1="25" y1="26" x2="38" y2="34" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="38" y1="34" x2="44" y2="28" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Left arm back-down */}
          <line x1="25" y1="26" x2="12" y2="34" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="12" y1="34" x2="6" y2="28" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          {/* Right arm forward-up */}
          <line x1="25" y1="26" x2="40" y2="18" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="40" y1="18" x2="45" y2="26" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {/* Hips */}
      <circle cx="23" cy="45" r="2" fill={c} />

      {/* Legs */}
      {p === 0 ? (
        <>
          {/* Left leg forward — knee high */}
          <line x1="23" y1="45" x2="14" y2="58" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="14" y1="58" x2="8" y2="72" stroke={c} strokeWidth="3" strokeLinecap="round" />
          {/* Foot */}
          <line x1="8" y1="72" x2="2" y2="72" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          {/* Right leg back — extended behind */}
          <line x1="23" y1="45" x2="34" y2="60" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="34" y1="60" x2="42" y2="72" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="42" y1="72" x2="48" y2="70" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Right leg forward — knee high */}
          <line x1="23" y1="45" x2="32" y2="58" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="32" y1="58" x2="38" y2="72" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="38" y1="72" x2="44" y2="72" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
          {/* Left leg back — extended behind */}
          <line x1="23" y1="45" x2="12" y2="60" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="12" y1="60" x2="4" y2="72" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <line x1="4" y1="72" x2="-2" y2="70" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// AnimatedRunner switches between pose 0 and pose 1 using CSS animation on two overlaid divs
function AnimatedRunner({ color, size, strideSpeed }) {
  return (
    <div style={{ position: 'relative', width: size, height: size * 1.6 }}>
      <style>{`
        @keyframes stride {
          0%, 49%  { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes strideAlt {
          0%, 49%  { opacity: 0; }
          50%, 100% { opacity: 1; }
        }
      `}</style>
      {/* Pose 0 */}
      <div style={{ position: 'absolute', top: 0, left: 0, animation: `stride ${strideSpeed}s steps(1) infinite` }}>
        <Runner color={color} size={size} pose={0} />
      </div>
      {/* Pose 1 */}
      <div style={{ position: 'absolute', top: 0, left: 0, animation: `strideAlt ${strideSpeed}s steps(1) infinite` }}>
        <Runner color={color} size={size} pose={1} />
      </div>
    </div>
  );
}

const RUNNERS = [
  // Row 1 — top
  { color: '#60a5fa', size: 48, top: '5%',  duration: 5,  delay: '-1s',   stride: 0.25 },
  { color: '#f472b6', size: 44, top: '5%',  duration: 7,  delay: '-3.5s', stride: 0.3  },
  { color: '#a78bfa', size: 52, top: '5%',  duration: 6,  delay: '-5s',   stride: 0.28 },
  // Row 2
  { color: '#34d399', size: 46, top: '20%', duration: 7,  delay: '-2s',   stride: 0.3  },
  { color: '#fbbf24', size: 50, top: '20%', duration: 5,  delay: '-4s',   stride: 0.25 },
  { color: '#f472b6', size: 44, top: '20%', duration: 8,  delay: '-6s',   stride: 0.32 },
  // Row 3
  { color: '#60a5fa', size: 50, top: '38%', duration: 6,  delay: '-1.5s', stride: 0.28 },
  { color: '#a78bfa', size: 46, top: '38%', duration: 7,  delay: '-4.5s', stride: 0.3  },
  { color: '#34d399', size: 44, top: '38%', duration: 5,  delay: '-2.5s', stride: 0.25 },
  // Row 4
  { color: '#fbbf24', size: 52, top: '58%', duration: 8,  delay: '-3s',   stride: 0.32 },
  { color: '#60a5fa', size: 48, top: '58%', duration: 6,  delay: '-5.5s', stride: 0.28 },
  { color: '#f472b6', size: 44, top: '58%', duration: 7,  delay: '-1s',   stride: 0.3  },
  // Row 5
  { color: '#a78bfa', size: 50, top: '75%', duration: 5,  delay: '-2s',   stride: 0.25 },
  { color: '#34d399', size: 46, top: '75%', duration: 7,  delay: '-4s',   stride: 0.3  },
  { color: '#fbbf24', size: 48, top: '75%', duration: 6,  delay: '-6.5s', stride: 0.28 },
  // Row 6 — bottom
  { color: '#60a5fa', size: 44, top: '88%', duration: 7,  delay: '-3.5s', stride: 0.3  },
  { color: '#f472b6', size: 50, top: '88%', duration: 5,  delay: '-1.5s', stride: 0.25 },
  { color: '#a78bfa', size: 46, top: '88%', duration: 8,  delay: '-5s',   stride: 0.32 },
];

export default function RaceAnimation() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10, overflow: 'hidden' }}>
      <style>{`
        @keyframes runAcross {
          from { transform: translateX(-100px); }
          to   { transform: translateX(calc(100vw + 100px)); }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0px);  }
          50%       { transform: translateY(-8px); }
        }
      `}</style>

      {RUNNERS.map((r, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: r.top,
            left: 0,
            opacity: 0.85,
            animation: `runAcross ${r.duration}s ${r.delay} linear infinite`,
            willChange: 'transform',
          }}
        >
          <div style={{ animation: `bob ${r.stride * 2}s ease-in-out infinite` }}>
            <AnimatedRunner color={r.color} size={r.size} strideSpeed={r.stride} />
          </div>
        </div>
      ))}
    </div>
  );
}
