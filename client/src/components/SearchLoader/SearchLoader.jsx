import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import RaceAnimation from './RaceAnimation';

// City positions as % of the SVG viewBox (roughly matching India map)
const CITIES = [
  { name: 'Delhi',     x: 42, y: 22 },
  { name: 'Mumbai',    x: 30, y: 52 },
  { name: 'Bangalore', x: 38, y: 72 },
  { name: 'Hyderabad', x: 44, y: 60 },
  { name: 'Chennai',   x: 46, y: 74 },
  { name: 'Pune',      x: 32, y: 57 },
  { name: 'Kolkata',   x: 62, y: 38 },
  { name: 'Ahmedabad', x: 26, y: 40 },
];

const MESSAGES = [
  'Scanning job boards...',
  'Checking ATS platforms...',
  'Matching your skills...',
  'Finding live openings...',
  'Ranking companies...',
  'Almost there...',
];

// Simplified India SVG path
const INDIA_PATH = "M42,8 L48,6 L55,10 L60,8 L65,12 L68,18 L72,22 L74,28 L70,34 L72,40 L68,46 L64,50 L66,56 L62,62 L58,68 L54,74 L50,80 L46,84 L42,86 L38,84 L34,80 L30,74 L26,68 L24,62 L22,56 L20,50 L22,44 L20,38 L22,32 L26,26 L28,20 L32,14 L38,10 Z";

export default function SearchLoader({ resumeData }) {
  const [visiblePins, setVisiblePins] = useState([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  // Drop pins one by one
  useEffect(() => {
    const timers = CITIES.map((_, i) =>
      setTimeout(() => {
        setVisiblePins(prev => [...prev, i]);
      }, i * 600)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Cycle through messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  // Animate progress bar
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 8, 92));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const skills = resumeData?.primarySkills?.slice(0, 4) || [];

  return (
    <Box sx={{
      height: '100vh', width: '100vw',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #060b18 0%, #0b1535 50%, #080f20 100%)',
      position: 'relative', overflow: 'hidden', gap: 2
    }}>
      {/* Running characters */}
      <RaceAnimation />

      {/* Background glow orbs */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', top: '10%', left: '20%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)', pointerEvents: 'none'
        }}
      />
      <motion.div
        animate={{ scale: [1, 0.85, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        style={{
          position: 'absolute', bottom: '10%', right: '15%',
          width: 350, height: 350, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)', pointerEvents: 'none'
        }}
      />

      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Typography sx={{
          color: 'white', fontWeight: 700, fontSize: { xs: 20, sm: 24 },
          textAlign: 'center', mb: 0.5
        }}>
          Finding companies hiring for your skills
        </Typography>
        {skills.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mb: 1 }}>
            {skills.map((skill, i) => (
              <motion.div
                key={skill}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.15, type: 'spring', damping: 12 }}
              >
                <Box sx={{
                  px: 1.5, py: 0.4, borderRadius: '20px', fontSize: 12, fontWeight: 600,
                  background: 'rgba(59,130,246,0.15)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  color: '#60a5fa'
                }}>
                  {skill}
                </Box>
              </motion.div>
            ))}
          </Box>
        )}
      </motion.div>

      {/* India map with dropping pins */}
      <Box sx={{ position: 'relative', width: 220, height: 260 }}>
        <svg
          viewBox="0 0 100 100"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
        >
          {/* India outline glow */}
          <path
            d={INDIA_PATH}
            fill="rgba(59,130,246,0.06)"
            stroke="rgba(59,130,246,0.25)"
            strokeWidth="0.8"
          />

          {/* City pins */}
          {CITIES.map((city, i) => (
            visiblePins.includes(i) && (
              <motion.g
                key={city.name}
                initial={{ y: -30, opacity: 0, scale: 0 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 10, stiffness: 200 }}
              >
                {/* Pulse ring */}
                <motion.circle
                  cx={city.x}
                  cy={city.y}
                  r="4"
                  fill="none"
                  stroke="rgba(96,165,250,0.5)"
                  strokeWidth="0.5"
                  animate={{ r: [3, 7, 3], opacity: [0.8, 0, 0.8] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                />
                {/* Pin dot */}
                <circle cx={city.x} cy={city.y} r="1.8" fill="#3b82f6" />
                <circle cx={city.x} cy={city.y} r="0.8" fill="white" />
                {/* City label */}
                <text
                  x={city.x + 2.5}
                  y={city.y + 0.8}
                  fontSize="3.5"
                  fill="rgba(255,255,255,0.7)"
                  fontFamily="sans-serif"
                >
                  {city.name}
                </text>
              </motion.g>
            )
          ))}
        </svg>
      </Box>

      {/* Animated status message */}
      <Box sx={{ height: 28, display: 'flex', alignItems: 'center' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={messageIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
          >
            <Typography sx={{ color: '#64748b', fontSize: 14, textAlign: 'center' }}>
              {MESSAGES[messageIndex]}
            </Typography>
          </motion.div>
        </AnimatePresence>
      </Box>

      {/* Progress bar */}
      <Box sx={{ width: 280, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', height: 4 }}>
        <motion.div
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
            borderRadius: 4
          }}
        />
      </Box>
    </Box>
  );
}
