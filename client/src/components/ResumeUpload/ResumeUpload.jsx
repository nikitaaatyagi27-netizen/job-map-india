import React, { useState, useRef } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import API_BASE from '../../api';

// ── Company data ─────────────────────────────────────────────────────────────

const COMPANIES = [
  { name: 'Google',       domain: 'google.com',       initials: 'G',   color: '#4285f4' },
  { name: 'Microsoft',    domain: 'microsoft.com',    initials: 'MS',  color: '#00a4ef' },
  { name: 'Amazon',       domain: 'amazon.com',       initials: 'A',   color: '#ff9900' },
  { name: 'Meta',         domain: 'meta.com',         initials: 'M',   color: '#1877f2' },
  { name: 'Apple',        domain: 'apple.com',        initials: 'Ap',  color: '#555555' },
  { name: 'Netflix',      domain: 'netflix.com',      initials: 'N',   color: '#e50914' },
  { name: 'Adobe',        domain: 'adobe.com',        initials: 'Ad',  color: '#ff0000' },
  { name: 'Salesforce',   domain: 'salesforce.com',   initials: 'SF',  color: '#00a1e0' },
  { name: 'IBM',          domain: 'ibm.com',          initials: 'IBM', color: '#006699' },
  { name: 'Oracle',       domain: 'oracle.com',       initials: 'Or',  color: '#c74634' },
  { name: 'Nvidia',       domain: 'nvidia.com',       initials: 'Nv',  color: '#76b900' },
  { name: 'Intel',        domain: 'intel.com',        initials: 'In',  color: '#0068b5' },
  { name: 'LinkedIn',     domain: 'linkedin.com',     initials: 'Li',  color: '#0077b5' },
  { name: 'Uber',         domain: 'uber.com',         initials: 'Ub',  color: '#000000' },
  { name: 'Airbnb',       domain: 'airbnb.com',       initials: 'Ab',  color: '#ff5a5f' },
  { name: 'Stripe',       domain: 'stripe.com',       initials: 'St',  color: '#635bff' },
  { name: 'Spotify',      domain: 'spotify.com',      initials: 'Sp',  color: '#1db954' },
  { name: 'PayPal',       domain: 'paypal.com',       initials: 'PP',  color: '#003087' },
  { name: 'Shopify',      domain: 'shopify.com',      initials: 'Sh',  color: '#96bf48' },
  { name: 'Atlassian',    domain: 'atlassian.com',    initials: 'At',  color: '#0052cc' },
  { name: 'TCS',          domain: 'tcs.com',          initials: 'TCS', color: '#1e4fad' },
  { name: 'Infosys',      domain: 'infosys.com',      initials: 'IF',  color: '#007cc3' },
  { name: 'Wipro',        domain: 'wipro.com',        initials: 'Wi',  color: '#341c6b' },
  { name: 'HCL',          domain: 'hcltech.com',      initials: 'HCL', color: '#0052cc' },
  { name: 'Razorpay',     domain: 'razorpay.com',     initials: 'Rp',  color: '#2d6be4' },
  { name: 'Swiggy',       domain: 'swiggy.com',       initials: 'Sw',  color: '#fc8019' },
  { name: 'Zomato',       domain: 'zomato.com',       initials: 'Zm',  color: '#e23744' },
  { name: 'Paytm',        domain: 'paytm.com',        initials: 'Pt',  color: '#00baf2' },
  { name: 'Flipkart',     domain: 'flipkart.com',     initials: 'Fk',  color: '#2874f0' },
  { name: 'Freshworks',   domain: 'freshworks.com',   initials: 'Fw',  color: '#25c16f' },
  { name: 'Zoho',         domain: 'zoho.com',         initials: 'Zo',  color: '#e42527' },
  { name: 'PhonePe',      domain: 'phonepe.com',      initials: 'Ph',  color: '#5f259f' },
  { name: 'Ola',          domain: 'olacabs.com',      initials: 'Ol',  color: '#ef8c00' },
  { name: 'Dream11',      domain: 'dream11.com',      initials: 'D11', color: '#ef3e41' },
  { name: 'MakeMyTrip',   domain: 'makemytrip.com',   initials: 'MMT', color: '#da1a32' },
  { name: 'Zepto',        domain: 'zeptonow.com',     initials: 'Ze',  color: '#7b2ff7' },
  { name: 'Tech Mahindra',domain: 'techmahindra.com', initials: 'TM',  color: '#d4111e' },
  { name: 'Accenture',    domain: 'accenture.com',    initials: 'Ac',  color: '#a100ff' },
  { name: 'Cognizant',    domain: 'cognizant.com',    initials: 'Cg',  color: '#1a4ca1' },
  { name: 'BYJU\'S',      domain: 'byjus.com',        initials: 'By',  color: '#1c3557' },
];

const ORBIT_COMPANIES = [...COMPANIES];

const WALL_TILES = [
  { x: 5, y: 8,  s: 0.95, r: -8, company: 0 },
  { x: 12, y: 17, s: 0.76, r: 9, company: 1 },
  { x: 21, y: 7,  s: 1.12, r: -4, company: 2 },
  { x: 33, y: 14, s: 0.84, r: 12, company: 3 },
  { x: 46, y: 7,  s: 0.74, r: -10, company: 4 },
  { x: 58, y: 12, s: 1.02, r: 6, company: 5 },
  { x: 72, y: 8,  s: 0.82, r: -7, company: 6 },
  { x: 82, y: 16, s: 0.97, r: 11, company: 7 },
  { x: 88, y: 7,  s: 0.66, r: -14, company: 8 },

  { x: 3, y: 25,  s: 0.89, r: 13, company: 9 },
  { x: 15, y: 31, s: 1.04, r: -6, company: 10 },
  { x: 28, y: 27, s: 0.7, r: 9, company: 11 },
  { x: 39, y: 26, s: 0.86, r: -12, company: 12 },
  { x: 51, y: 24, s: 1.22, r: 5, company: 13 },
  { x: 66, y: 27, s: 0.75, r: -8, company: 14 },
  { x: 78, y: 25, s: 0.98, r: 10, company: 15 },
  { x: 90, y: 29, s: 0.8, r: -5, company: 16 },

  { x: 6, y: 40,  s: 1.02, r: -11, company: 17 },
  { x: 18, y: 43, s: 0.9, r: 8, company: 18 },
  { x: 31, y: 40, s: 0.78, r: -4, company: 19 },
  { x: 41, y: 44, s: 1.15, r: 7, company: 20 },
  { x: 54, y: 41, s: 0.86, r: -9, company: 21 },
  { x: 65, y: 44, s: 0.74, r: 13, company: 22 },
  { x: 76, y: 42, s: 0.92, r: -6, company: 23 },
  { x: 87, y: 41, s: 0.88, r: 8, company: 24 },

  { x: 4, y: 57,  s: 0.88, r: 10, company: 25 },
  { x: 16, y: 60, s: 0.73, r: -8, company: 26 },
  { x: 27, y: 57, s: 1.01, r: 5, company: 27 },
  { x: 39, y: 61, s: 0.82, r: -12, company: 28 },
  { x: 50, y: 58, s: 1.18, r: 7, company: 29 },
  { x: 63, y: 60, s: 0.75, r: -4, company: 30 },
  { x: 74, y: 57, s: 0.94, r: 11, company: 31 },
  { x: 86, y: 60, s: 0.87, r: -7, company: 32 },

  { x: 8, y: 75,  s: 1.06, r: -6, company: 33 },
  { x: 22, y: 77, s: 0.75, r: 9, company: 34 },
  { x: 35, y: 73, s: 0.9, r: -10, company: 35 },
  { x: 49, y: 76, s: 0.7, r: 6, company: 36 },
  { x: 61, y: 73, s: 1.0, r: -5, company: 37 },
  { x: 75, y: 77, s: 0.82, r: 12, company: 1 },
  { x: 89, y: 74, s: 0.96, r: -8, company: 4 },
  { x: 13, y: 89, s: 0.84, r: 4, company: 6 },
  { x: 29, y: 91, s: 0.68, r: -11, company: 8 },
  { x: 44, y: 88, s: 0.92, r: 9, company: 10 },
  { x: 57, y: 90, s: 0.78, r: -7, company: 12 },
  { x: 71, y: 88, s: 1.04, r: 5, company: 14 },
  { x: 84, y: 91, s: 0.72, r: -9, company: 16 },
];

function getSlice(offset, count) {
  const result = [];
  for (let i = 0; i < count; i++) result.push(COMPANIES[(offset + i) % COMPANIES.length]);
  return result;
}

// ── Logo chip ─────────────────────────────────────────────────────────────────

const LogoChip = React.memo(function LogoChip({ company, compact = false }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: compact ? 0 : 1,
      mx: compact ? 0 : 1.5,
      px: compact ? 1.3 : 2,
      py: compact ? 0.95 : 0.9,
      minWidth: compact ? 48 : 'auto',
      borderRadius: compact ? '999px' : '10px', flexShrink: 0,
      background: compact ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
      border: compact ? '1px solid rgba(127,84,22,0.12)' : '1px solid rgba(255,255,255,0.09)',
      boxShadow: compact ? '0 6px 18px rgba(127,84,22,0.1)' : 'none',
    }}>
      <img
        src={`https://logo.clearbit.com/${company.domain}`}
        alt={company.name}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          const fb = e.currentTarget.nextSibling;
          if (fb) fb.style.display = 'flex';
        }}
        style={{ width: compact ? 22 : 20, height: compact ? 22 : 20, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }}
      />
      <span style={{
        display: 'none', width: compact ? 22 : 20, height: compact ? 22 : 20, borderRadius: 3,
        backgroundColor: company.color, alignItems: 'center', justifyContent: 'center',
        fontSize: 8, fontWeight: 800, color: 'white', flexShrink: 0,
      }}>
        {company.initials}
      </span>
      {!compact && (
        <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {company.name}
        </Typography>
      )}
    </Box>
  );
});



function LogoWall() {
  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {WALL_TILES.map((tile, index) => {
        const company = ORBIT_COMPANIES[tile.company % ORBIT_COMPANIES.length];
        return (
          <motion.div
            key={`${company.domain}-${index}`}
            animate={{ y: [0, -6, 0], rotate: [tile.r, tile.r + 1.5, tile.r] }}
            transition={{ duration: 8 + (index % 5), repeat: Infinity, ease: 'easeInOut', delay: (index % 7) * 0.2 }}
            style={{
              position: 'absolute',
              left: `${tile.x}%`,
              top: `${tile.y}%`,
              width: 72,
              height: 72,
              transform: `translate(-50%, -50%) rotate(${tile.r}deg) scale(${tile.s})`,
            }}
          >
            <Box sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <img
                src={`https://logo.clearbit.com/${company.domain}`}
                alt={company.name}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fb = e.currentTarget.nextSibling;
                  if (fb) fb.style.display = 'flex';
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  filter: 'none',
                }}
              />
              <span style={{
                display: 'none',
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                color: company.color,
                fontWeight: 800,
                fontSize: 18,
                background: 'transparent',
              }}>
                {company.initials}
              </span>
            </Box>
          </motion.div>
        );
      })}
    </Box>
  );
}

// ── Animated upload icon (replaces 📄 emoji) ──────────────────────────────────


// ── Experience levels ─────────────────────────────────────────────────────────

const LEVELS = [
  {
    key: 'fresher', emoji: '🎓', title: 'Fresher', sub: '0 – 2 years',
    desc: 'Student, intern, or recent graduate looking for entry-level roles',
    color: '#22c55e', glow: 'rgba(34,197,94,0.4)', border: 'rgba(34,197,94,0.6)', bg: 'rgba(34,197,94,0.1)',
  },
  {
    key: 'mid', emoji: '💼', title: 'Mid Level', sub: '2 – 5 years',
    desc: 'Working professional ready to take on more responsibility',
    color: '#60a5fa', glow: 'rgba(96,165,250,0.4)', border: 'rgba(96,165,250,0.6)', bg: 'rgba(96,165,250,0.1)',
  },
  {
    key: 'senior', emoji: '⭐', title: 'Senior', sub: '5+ years',
    desc: 'Lead, architect, or specialist with deep domain expertise',
    color: '#f59e0b', glow: 'rgba(245,158,11,0.4)', border: 'rgba(245,158,11,0.6)', bg: 'rgba(245,158,11,0.1)',
  },
];

// ── Main component ────────────────────────────────────────────────────────────

const ResumeUpload = ({ onSkillsExtracted }) => {
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [step, setStep]             = useState('upload');
  const [parsedData, setParsedData] = useState(null);
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowed.includes(file.type)) { setError('Please upload a PDF or Word document.'); return; }
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);
      const res = await fetch(`${API_BASE}/api/resume/parse`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to parse resume');
      const data = await res.json();
      setParsedData(data);
      setStep('experience');
    } catch {
      setError('Could not parse resume. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLevel = (level) => onSkillsExtracted({ ...parsedData, experienceLevel: level });


  return (
    <Box sx={{
      height: '100vh', width: '100vw',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(circle at top, #fff5bf 0%, #f9e69a 35%, #f4d97a 68%, #efcc61 100%)',
      position: 'relative', overflow: 'hidden',
    }}>
      <LogoWall />
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(255,248,216,0.18) 0%, rgba(255,248,216,0.06) 100%)' }} />

      <Box sx={{ position: 'relative', zIndex: 3, width: '100%' }}>
        <AnimatePresence mode="wait">

          {/* ── Step 1: Upload ── */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -80, filter: 'blur(8px)' }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{ display: 'flex', justifyContent: 'center' }}
            >
              <Box sx={{ position: 'relative', width: '100%', height: '100vh' }}>
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                  <Box sx={{ textAlign: 'center', px: 2 }}>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={() => !loading && inputRef.current?.click()}
                      sx={{
                        background: 'linear-gradient(135deg, #7f5404 0%, #b7791f 100%)',
                        color: '#fff8e1',
                        fontWeight: 800,
                        px: 5,
                        py: 1.4,
                        borderRadius: 999,
                        boxShadow: '0 14px 30px rgba(127,84,22,0.22)',
                        '&:hover': { background: 'linear-gradient(135deg, #6b4300 0%, #a16207 100%)' },
                      }}
                    >
                      Browse Resume
                    </Button>
                    {error && (
                      <Typography sx={{ color: '#9a3412', mt: 2.5, fontWeight: 600 }}>{error}</Typography>
                    )}
                  </Box>
                </Box>

                <input
                  ref={inputRef} type="file" accept=".pdf,.doc,.docx"
                  style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files[0])}
                />
              </Box>
            </motion.div>
          )}

          {/* ── Step 2: Experience picker ── */}
          {step === 'experience' && (
            <motion.div
              key="experience"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              transition={{ type: 'spring', damping: 18, stiffness: 90 }}
              style={{ display: 'flex', justifyContent: 'center' }}
            >
              <Box sx={{ textAlign: 'center', color: 'white', maxWidth: 680, width: '100%', px: 2 }}>

                <motion.div
                  initial={{ opacity: 0, y: -25 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, type: 'spring', damping: 12 }}
                >
                  <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
                    What's your experience level?
                  </Typography>
                  <Typography sx={{ opacity: 0.6, mb: 3, fontSize: 15 }}>
                    We'll tailor the job results to match your stage
                    {parsedData?.domain && (
                      <span>
                        {' · '}
                        <strong style={{ color: '#60a5fa' }}>
                          {parsedData.domain.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </strong>
                        {' detected'}
                      </span>
                    )}
                  </Typography>
                </motion.div>

                <Box sx={{ display: 'flex', gap: 2.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {LEVELS.map(({ key, emoji, title, sub, desc, color, glow, border, bg }, index) => (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 60, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', damping: 13, stiffness: 80, delay: 0.25 + index * 0.13 }}
                      whileHover={{ y: -10, scale: 1.05, boxShadow: `0 20px 50px ${glow}`, borderColor: border, backgroundColor: bg }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => handleSelectLevel(key)}
                      style={{
                        width: 190, padding: '22px 18px', borderRadius: 18, cursor: 'pointer',
                        background: 'rgba(10,14,24,0.75)',
                        border: '2px solid rgba(255,255,255,0.1)',
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      <motion.div
                        animate={{ rotate: [0, 6, -6, 0] }}
                        transition={{ duration: 5, repeat: Infinity, delay: index * 1.5, ease: 'easeInOut' }}
                      >
                        <Typography sx={{ fontSize: 38, mb: 1, lineHeight: 1 }}>{emoji}</Typography>
                      </motion.div>
                      <Typography sx={{ fontWeight: 700, fontSize: 16, color, mb: 0.3 }}>{title}</Typography>
                      <Typography sx={{ fontWeight: 600, fontSize: 12, color, mb: 1, opacity: 0.85 }}>{sub}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.45 }}>{desc}</Typography>
                    </motion.div>
                  ))}
                </Box>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}>
                  <Button
                    onClick={() => setStep('upload')}
                    sx={{
                      mt: 3.5, color: 'rgba(255,255,255,0.35)', fontSize: 13, textTransform: 'none',
                      '&:hover': { color: 'rgba(255,255,255,0.8)', bgcolor: 'transparent' },
                    }}
                  >
                    ← Upload a different resume
                  </Button>
                </motion.div>
              </Box>
            </motion.div>
          )}

        </AnimatePresence>
      </Box>
    </Box>
  );
};

export default ResumeUpload;
