import React, { useState } from 'react';
import {
  Dialog, DialogContent, Box, Typography, TextField,
  Button, IconButton, CircularProgress, Divider
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';

export default function AuthModal({ open, onClose, onSuccess }) {
  const { login, register } = useAuth();
  const [mode, setMode]       = useState('login'); // 'login' | 'register'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => { setEmail(''); setPassword(''); setError(''); setLoading(false); };

  const switchMode = (m) => { setMode(m); setError(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      reset();
      onSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          bgcolor: '#0f172a',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          width: '100%',
          maxWidth: 420,
          m: 2
        }
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 3.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </Typography>
              <Typography sx={{ color: '#64748b', fontSize: 13, mt: 0.25 }}>
                {mode === 'login'
                  ? 'Your resume will be remembered across sessions'
                  : 'Upload once — never lose your search again'}
              </Typography>
            </Box>
            <IconButton onClick={handleClose} size="small" sx={{ color: '#475569' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Form */}
          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              size="small"
              sx={inputSx}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              size="small"
              helperText={mode === 'register' ? 'At least 6 characters' : ''}
              sx={inputSx}
            />

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Typography sx={{ color: '#f87171', fontSize: 13 }}>{error}</Typography>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              variant="contained"
              disabled={loading}
              sx={{
                mt: 0.5,
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                color: 'white', fontWeight: 700, borderRadius: 2, py: 1.1,
                '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' },
                '&.Mui-disabled': { opacity: 0.5 }
              }}
            >
              {loading
                ? <CircularProgress size={20} sx={{ color: 'white' }} />
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </Box>

          <Divider sx={{ my: 2.5, borderColor: 'rgba(255,255,255,0.06)' }} />

          {/* Switch mode */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: '#64748b', fontSize: 13 }}>
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <Box
                component="span"
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                sx={{ color: '#60a5fa', cursor: 'pointer', fontWeight: 600, '&:hover': { color: '#93c5fd' } }}
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </Box>
            </Typography>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

const inputSx = {
  '& .MuiOutlinedInput-root': {
    color: 'white',
    bgcolor: 'rgba(255,255,255,0.04)',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
  },
  '& .MuiInputLabel-root': { color: '#64748b' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#60a5fa' },
  '& .MuiFormHelperText-root': { color: '#475569' },
};
