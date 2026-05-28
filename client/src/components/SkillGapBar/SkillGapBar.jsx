import React from 'react';
import { Box, Chip, Typography, LinearProgress } from '@mui/material';

export default function SkillGapBar({ gap }) {
  if (!gap?.hasAnalysis) return null;

  const { matched, missing, matchScore } = gap;
  const color = matchScore >= 70 ? '#22c55e' : matchScore >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <Box sx={{ mt: 1, mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Skill Match
        </Typography>
        <Typography variant="caption" sx={{ color, fontWeight: 700, fontSize: 10 }}>
          {matchScore}%
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={matchScore}
        sx={{
          height: 4, borderRadius: 2, mb: 0.75,
          bgcolor: '#1e293b',
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 }
        }}
      />

      {matched.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
          {matched.slice(0, 4).map(s => (
            <Chip key={s} label={`✓ ${s}`} size="small"
              sx={{ bgcolor: '#14532d', color: '#4ade80', fontSize: 9, height: 18, fontWeight: 600 }} />
          ))}
        </Box>
      )}

      {missing.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {missing.slice(0, 3).map(s => (
            <Chip key={s} label={`+ ${s}`} size="small"
              sx={{ bgcolor: '#450a0a', color: '#fca5a5', fontSize: 9, height: 18 }} />
          ))}
          {missing.length > 3 && (
            <Chip label={`+${missing.length - 3} more`} size="small"
              sx={{ bgcolor: '#1e293b', color: '#64748b', fontSize: 9, height: 18 }} />
          )}
        </Box>
      )}
    </Box>
  );
}
