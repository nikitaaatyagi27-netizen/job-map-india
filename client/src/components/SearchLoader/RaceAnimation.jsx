import React from 'react';
import { Box } from '@mui/material';
import { motion } from 'framer-motion';

// SVG stick figure runner — alternates between two stride poses
// type: 'male' | 'female' | 'briefcase'
function RunnerSVG({ type, color, size = 36 }) {
  const c = color || '#60a5fa';

  if (type === 'female') {
    return (
      <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
        {/* Head */}
        <circle cx="20" cy="6" r="5" fill={c} />
        {/* Hair */}
        <path d="M15 4 Q20 0 25 4" stroke={c} strokeWidth="2" fill="none" />
        {/* Body */}
        <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        {/* Skirt */}
        <path d="M13 28 Q20 34 27 28" stroke={c} strokeWidth="2" fill={`${c}33`} />
        {/* Left arm up */}
        <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Right arm back */}
        <line x1="20" y1="16" x2="30" y2="22" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Left leg forward */}
        <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Right leg back */}
        <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'briefcase') {
    return (
      <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
        {/* Head */}
        <circle cx="20" cy="6" r="5" fill={c} />
        {/* Body */}
        <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        {/* Left arm up */}
        <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Right arm holding briefcase */}
        <line x1="20" y1="16" x2="32" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Briefcase */}
        <rect x="30" y="24" width="10" height="7" rx="1.5" stroke={c} strokeWidth="1.5" fill={`${c}22`} />
        <path d="M33 24 V22 H37 V24" stroke={c} strokeWidth="1.5" fill="none" />
        {/* Left leg forward */}
        <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
        {/* Right leg back */}
        <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  // Default male runner
  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 40 56" fill="none">
      {/* Head */}
      <circle cx="20" cy="6" r="5" fill={c} />
      {/* Body */}
      <line x1="20" y1="11" x2="20" y2="30" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      {/* Left arm back */}
      <line x1="20" y1="16" x2="10" y2="24" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {/* Right arm forward */}
      <line x1="20" y1="16" x2="30" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {/* Left leg forward */}
      <line x1="20" y1="30" x2="12" y2="44" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="44" x2="8" y2="54" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {/* Right leg back */}
      <line x1="20" y1="30" x2="28" y2="42" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="42" x2="32" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Each runner has: type, color, speed, size, vertical position, delay
const RUNNER_CONFIGS = [
  { type: 'male',      color: '#60a5fa', duration: 6,  size: 32, top: '12%', delay: 0    },
  { type: 'female',    color: '#f472b6', duration: 7,  size: 28, top: '25%', delay: 1.2  },
  { type: 'briefcase', color: '#a78bfa', duration: 5,  size: 36, top: '18%', delay: 0.5  },
  { type: 'male',      color: '#34d399', duration: 8,  size: 24, top: '72%', delay: 0.8  },
  { type: 'female',    color: '#fbbf24', duration: 6,  size: 30, top: '80%', delay: 2    },
  { type: 'briefcase', color: '#60a5fa', duration: 9,  size: 22, top: '65%', delay: 1.5  },
  { type: 'male',      color: '#f472b6', duration: 5,  size: 26, top: '88%', delay: 0.3  },
  { type: 'female',    color: '#a78bfa', duration: 7,  size: 34, top: '58%', delay: 3    },
  { type: 'male',      color: '#fbbf24', duration: 6,  size: 20, top: '45%', delay: 1.8  },
  { type: 'briefcase', color: '#34d399', duration: 8,  size: 28, top: '38%', delay: 2.5  },
];

function Runner({ config }) {
  // Bob up and down while running
  const bobY = [0, -6, 0, -4, 0];

  return (
    <motion.div
      style={{
        position: 'fixed',
        top: config.top,
        left: 0,
        zIndex: 5,
        opacity: 0.7,
      }}
      animate={{ x: ['calc(-60px)', 'calc(100vw + 60px)'] }}
      initial={{ x: `calc(${Math.random() * 80}vw)` }}
      transition={{
        duration: config.duration,
        delay: 0,
        repeat: Infinity,
        ease: 'linear',
        repeatDelay: 0
      }}
    >
      {/* Bob animation */}
      <motion.div
        animate={{ y: bobY }}
        transition={{
          duration: config.duration / 5,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      >
        {/* Stride alternation — rotate legs slightly */}
        <motion.div
          animate={{ scaleX: [1, 1, 1], rotate: [0, 2, -2, 2, 0] }}
          transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <RunnerSVG type={config.type} color={config.color} size={config.size} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default function RaceAnimation() {
  return (
    <Box sx={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      pointerEvents: 'none', zIndex: 5
    }}>
      {RUNNER_CONFIGS.map((config, i) => (
        <Runner key={i} config={config} />
      ))}

      {/* Subtle ground lines */}
      {[15, 30, 50, 68, 82, 92].map((top, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            top: `${top}%`,
            left: 0, right: 0,
            height: '1px',
            background: 'rgba(255,255,255,0.03)',
          }}
        />
      ))}
    </Box>
  );
}
