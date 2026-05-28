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

const ROW_CONFIGS = [
  { offset: 0,  count: 18, duration: 40 },
  { offset: 7,  count: 18, duration: 55 },
  { offset: 14, count: 18, duration: 32 },
  { offset: 21, count: 18, duration: 50 },
  { offset: 4,  count: 18, duration: 38 },
  { offset: 11, count: 18, duration: 45 },
];

function getSlice(offset, count) {
  const result = [];
  for (let i = 0; i < count; i++) result.push(COMPANIES[(offset + i) % COMPANIES.length]);
  return result;
}

// ── Logo chip ─────────────────────────────────────────────────────────────────

const LogoChip = React.memo(function LogoChip({ company }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1,
      mx: 1.5, px: 2, py: 0.9, borderRadius: '10px', flexShrink: 0,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.09)',
    }}>
      <img
        src={`https://logo.clearbit.com/${company.domain}`}
        alt={company.name}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          const fb = e.currentTarget.nextSibling;
          if (fb) fb.style.display = 'flex';
        }}
        style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }}
      />
      <span style={{
        display: 'none', width: 20, height: 20, borderRadius: 3,
        backgroundColor: company.color, alignItems: 'center', justifyContent: 'center',
        fontSize: 8, fontWeight: 800, color: 'white', flexShrink: 0,
      }}>
        {company.initials}
      </span>
      <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {company.name}
      </Typography>
    </Box>
  );
});

const MarqueeRow = React.memo(function MarqueeRow({ offset, count, duration }) {
  const doubled = [...getSlice(offset, count), ...getSlice(offset, count)];
  const animKey = `scroll-right-${duration}`;
  return (
    <Box sx={{ overflow: 'hidden', width: '100%', py: 0.5 }}>
      <Box sx={{
        display: 'flex', width: 'max-content',
        [`@keyframes ${animKey}`]: {
          '0%':   { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0%)' },
        },
        animation: `${animKey} ${duration}s linear infinite`,
      }}>
        {doubled.map((company, i) => (
          <LogoChip key={`${company.domain}-${i}`} company={company} />
        ))}
      </Box>
    </Box>
  );
});

function CompanyMarquee() {
  return (
    <Box sx={{
      position: 'absolute', inset: 0, zIndex: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly',
      opacity: 0.28, pointerEvents: 'none',
    }}>
      {ROW_CONFIGS.map((cfg, i) => (
        <MarqueeRow key={i} offset={cfg.offset} count={cfg.count} duration={cfg.duration} />
      ))}
    </Box>
  );
}

// ── Color orbs ────────────────────────────────────────────────────────────────

function Orbs() {
  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'hidden', pointerEvents: 'none' }}>
      <motion.div
        animate={{ x: [0, 60, -30, 0], y: [0, -80, 40, 0], scale: [1, 1.2, 0.85, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <motion.div
        animate={{ x: [0, -70, 40, 0], y: [0, 60, -50, 0], scale: [1, 0.8, 1.2, 1] }}
        transition={{ duration: 21, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', bottom: '-20%', right: '-10%',
          width: 700, height: 700, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14,165,233,0.42) 0%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />
      <motion.div
        animate={{ x: [0, 90, -50, 0], y: [0, -50, 80, 0], scale: [1, 1.35, 0.7, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', top: '30%', left: '38%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168,85,247,0.3) 0%, transparent 70%)',
          filter: 'blur(70px)',
        }}
      />
    </Box>
  );
}

// ── Animated upload icon (replaces 📄 emoji) ──────────────────────────────────

function UploadIcon({ dragging }) {
  return (
    <Box sx={{ position: 'relative', width: 88, height: 88, mx: 'auto', mb: 3 }}>
      {/* Slow outer rotating dashed ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: `2px dashed ${dragging ? 'rgba(96,165,250,0.9)' : 'rgba(96,165,250,0.4)'}`,
        }}
      />
      {/* Fast inner counter-rotating ring */}
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        style={{
          position: 'absolute', inset: 10, borderRadius: '50%',
          border: '1.5px dashed rgba(167,139,250,0.35)',
        }}
      />
      {/* Pulsing glow fill */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.45, 0.2] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', inset: 14, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(96,165,250,0.35) 0%, transparent 80%)',
        }}
      />
      {/* Bouncing arrow */}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <motion.path
              d="M12 15V4"
              stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round"
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            <path d="M8 8L12 4L16 8" stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </motion.div>
      </Box>
    </Box>
  );
}

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
  const [dragging, setDragging]     = useState(false);
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

  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };

  return (
    <Box sx={{
      height: '100vh', width: '100vw',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #060b18 0%, #0b1535 50%, #080f20 100%)',
      position: 'relative', overflow: 'hidden',
    }}>
      <CompanyMarquee />
      <Orbs />

      {/* Dark radial vignette — dims edges, keeps center readable */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 55% 65% at 50% 50%, transparent 20%, rgba(6,11,24,0.88) 100%)',
      }} />

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
              <Box sx={{ textAlign: 'center', color: 'white', px: 2, maxWidth: 560 }}>

                {/* Title: "No human is limited." */}
                <motion.div
                  variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
                  initial="hidden"
                  animate="visible"
                  style={{ marginBottom: 14 }}
                >
                  {[
                    { word: 'No',       plain: true  },
                    { word: 'human',    plain: true  },
                    { word: 'is',       plain: true  },
                    { word: 'limited.', plain: false },
                  ].map(({ word, plain }, i) => (
                    <motion.span
                      key={i}
                      variants={{
                        hidden: { opacity: 0, y: 50, rotateX: -40 },
                        visible: {
                          opacity: 1, y: 0, rotateX: 0,
                          transition: { type: 'spring', damping: 10, stiffness: 90 },
                        },
                      }}
                      style={{
                        display: 'inline-block',
                        fontSize: 52, fontWeight: 800,
                        marginRight: '0.3em',
                        background: plain ? undefined : 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6)',
                        WebkitBackgroundClip: plain ? undefined : 'text',
                        WebkitTextFillColor: plain ? undefined : 'transparent',
                        backgroundClip: plain ? undefined : 'text',
                        color: plain ? 'white' : undefined,
                      }}
                    >
                      {word}
                    </motion.span>
                  ))}
                </motion.div>

                {/* Subtitle */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.72, duration: 0.6 }}
                >
                  <Typography variant="h6" sx={{ mb: 5, opacity: 0.65, fontWeight: 300, lineHeight: 1.5 }}>
                    Upload your resume — see every company hiring for your skills across India
                  </Typography>
                </motion.div>

                {/* Upload area — no box, content floats directly */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.05, type: 'spring', damping: 14 }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => !loading && inputRef.current?.click()}
                  style={{ cursor: loading ? 'default' : 'pointer' }}
                >
                  {loading ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                        style={{
                          width: 56, height: 56,
                          border: '3px solid rgba(255,255,255,0.1)',
                          borderTopColor: '#60a5fa',
                          borderRadius: '50%',
                        }}
                      />
                      <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.6, repeat: Infinity }}
                      >
                        <Typography sx={{ color: 'white', fontWeight: 500, fontSize: 16 }}>
                          Analyzing your resume...
                        </Typography>
                      </motion.div>
                    </Box>
                  ) : (
                    <Box>
                      <UploadIcon dragging={dragging} />
                      <Typography variant="h6" sx={{ color: 'white', fontWeight: 600, mb: 0.75 }}>
                        Drop your resume here
                      </Typography>
                      <Typography sx={{ color: 'rgba(255,255,255,0.45)', mb: 3.5, fontSize: 14 }}>
                        PDF or Word document
                      </Typography>
                      <motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }} style={{ display: 'inline-block' }}>
                        <Button
                          variant="contained"
                          size="large"
                          sx={{
                            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                            color: 'white', fontWeight: 700, px: 5, borderRadius: 3,
                            boxShadow: '0 4px 24px rgba(59,130,246,0.45)',
                            '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' },
                          }}
                        >
                          Browse File
                        </Button>
                      </motion.div>
                    </Box>
                  )}
                </motion.div>

                {error && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Typography sx={{ color: '#ff8a80', mt: 2.5, fontWeight: 500 }}>{error}</Typography>
                  </motion.div>
                )}

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
