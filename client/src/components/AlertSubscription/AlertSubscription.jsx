import React, { useState } from 'react';
import {
  Box, Typography, TextField, Button, Chip, CircularProgress,
  ToggleButton, ToggleButtonGroup
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const CITIES = ['Bangalore', 'Mumbai', 'Hyderabad', 'Pune', 'Chennai', 'Noida', 'Gurgaon', 'Remote'];

export default function AlertSubscription({ resumeData }) {
  const [email, setEmail]       = useState('');
  const [cities, setCities]     = useState([]);
  const [frequency, setFreq]    = useState('daily');
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState('');

  const toggleCity = (city) => {
    setCities(prev =>
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  };

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/alerts/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          domain: resumeData.domain,
          primarySkills: resumeData.primarySkills || [],
          secondarySkills: resumeData.secondarySkills || [],
          roles: resumeData.roles || [],
          cities,
          frequency
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to subscribe');
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 36, mb: 1 }} />
        <Typography variant="body2" sx={{ color: '#22c55e', fontWeight: 700 }}>
          You're subscribed!
        </Typography>
        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
          We'll email you when new matching jobs appear.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <NotificationsActiveIcon sx={{ color: '#f59e0b', fontSize: 18 }} />
        <Typography variant="subtitle2" sx={{ color: 'white', fontWeight: 700 }}>
          Get notified about new matching jobs
        </Typography>
      </Box>

      <TextField
        size="small"
        fullWidth
        placeholder="your@email.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        InputProps={{
          sx: {
            bgcolor: '#0f172a', color: 'white', borderRadius: 1.5, fontSize: 13,
            '& fieldset': { borderColor: '#334155' },
            '&:hover fieldset': { borderColor: '#475569' },
            '& input': { color: 'white', '&::placeholder': { color: '#475569' } }
          }
        }}
        sx={{ mb: 1.5 }}
      />

      {/* City filter */}
      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.75 }}>
        Cities to watch (leave blank for all India)
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
        {CITIES.map(city => (
          <Chip
            key={city}
            label={city}
            size="small"
            onClick={() => toggleCity(city)}
            sx={{
              cursor: 'pointer',
              bgcolor: cities.includes(city) ? '#1d4ed8' : '#1e293b',
              color: cities.includes(city) ? 'white' : '#64748b',
              border: cities.includes(city) ? '1px solid #3b82f6' : '1px solid #334155',
              fontSize: 11,
              '&:hover': { bgcolor: cities.includes(city) ? '#1e40af' : '#334155' }
            }}
          />
        ))}
      </Box>

      {/* Frequency */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Typography variant="caption" sx={{ color: '#64748b' }}>Frequency:</Typography>
        <ToggleButtonGroup
          size="small"
          value={frequency}
          exclusive
          onChange={(_, v) => v && setFreq(v)}
        >
          {['daily', 'weekly'].map(f => (
            <ToggleButton
              key={f}
              value={f}
              sx={{
                color: '#64748b', borderColor: '#334155', fontSize: 11, py: 0.25, px: 1.5,
                '&.Mui-selected': { bgcolor: '#1e293b', color: 'white', borderColor: '#475569' }
              }}
            >
              {f}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {error && (
        <Typography variant="caption" sx={{ color: '#ef4444', display: 'block', mb: 1 }}>
          {error}
        </Typography>
      )}

      <Button
        variant="contained"
        size="small"
        fullWidth
        onClick={handleSubmit}
        disabled={loading}
        startIcon={loading ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <NotificationsActiveIcon sx={{ fontSize: 16 }} />}
        sx={{
          bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' },
          color: '#0f172a', fontWeight: 700, borderRadius: 1.5,
          textTransform: 'none', fontSize: 13
        }}
      >
        {loading ? 'Setting up…' : 'Notify me of new jobs'}
      </Button>
    </Box>
  );
}
