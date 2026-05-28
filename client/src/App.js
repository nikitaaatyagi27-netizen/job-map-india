import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CssBaseline, Box, Button, CircularProgress, Typography,
  IconButton, Badge, Tooltip, Snackbar, Alert
} from '@mui/material';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import MapIcon from '@mui/icons-material/Map';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

import API_BASE from './api';
import Map from './components/Map/Map';
import JobList from './components/JobList/JobList';
import ResumeUpload from './components/ResumeUpload/ResumeUpload';
import SearchSummary from './components/SearchSummary/SearchSummary';
import CompanyDrawer from './components/CompanyDrawer/CompanyDrawer';
import SavedJobsDrawer from './components/SavedJobsDrawer/SavedJobsDrawer';
import AuthModal from './components/AuthModal/AuthModal';
import SearchLoader from './components/SearchLoader/SearchLoader';
import { useAuth } from './context/AuthContext';
import { getRoleLevel } from './utils/jobUtils';
import {
  getSessionId,
  loadSession,
  saveJobToSession,
  unsaveJobFromSession,
  trackApplyClick
} from './utils/session';

// India center — static, never changes
const MAP_CENTER = { lat: 28.6139, lng: 77.2090 };

const App = () => {
  const { user, loading: authLoading, logout, saveResume } = useAuth();
  const sessionId = useRef(getSessionId());
  const requestedSkillGaps = useRef(new Set());

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [resumeData, setResumeData] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDuration, setSearchDuration] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [view, setView] = useState('map');

  const [childClicked, setChildClicked] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);

  const [savedJobs, setSavedJobs] = useState([]);
  const [appliedLinks, setAppliedLinks] = useState(new Set());
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const [skillGaps, setSkillGaps] = useState({});
  const [reportedJobs, setReportedJobs] = useState(new Set());
  const [experienceFilter, setExperienceFilter] = useState('all');

  const autoRunFired = useRef(false);

  const filteredJobs = useMemo(() => {
    if (experienceFilter === 'all') return jobs;
    return jobs
      .map(c => ({
        ...c,
        roles: c.roles.filter(r => {
          const level = getRoleLevel(r);
          if (experienceFilter === 'fresher') return level === 'fresher';
          if (experienceFilter === 'mid') return level === 'mid' || level === null;
          if (experienceFilter === 'senior') return level === 'senior' || level === null;
          return true;
        })
      }))
      .filter(c => c.roles.length > 0);
  }, [jobs, experienceFilter]);

  // Stable search function — setters from useState are guaranteed stable by React
  const runSearch = useCallback(async (data) => {
    setSearchLoading(true);
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_BASE}/api/jobs/search-by-skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills:         data.skills,
          roles:          data.roles,
          primarySkills:  data.primarySkills || [],
          secondarySkills: data.secondarySkills || [],
          domain:         data.domain || 'other',
          sessionId:      sessionId.current
        }),
      });
      if (!res.ok) throw new Error('Search failed');
      const result = await res.json();
      if (result?.jobs) {
        setJobs(result.jobs.filter(c => c.roles?.length > 0));
        setSearchDuration(((Date.now() - t0) / 1000).toFixed(1));
        setFromCache(result.fromCache === true);  // use the flag returned by the API
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearchLoading(false);
    }
  }, []); // no deps — only uses stable setState refs and module-level API_BASE

  // Restore session on mount — replay last search if one exists
  useEffect(() => {
    loadSession(sessionId.current).then(data => {
      if (data?.savedJobs?.length) setSavedJobs(data.savedJobs);
      if (data?.appliedJobs?.length) {
        setAppliedLinks(new Set(data.appliedJobs.map(j => j.applyLink)));
      }
      if (data?.lastSearch?.primarySkills?.length) {
        const ls = data.lastSearch;
        const restored = {
          domain:          ls.domain,
          primarySkills:   ls.primarySkills,
          secondarySkills: ls.secondarySkills || [],
          roles:           ls.roles,
          skills:          ls.primarySkills,
          _restored:       true
        };
        setResumeData(restored);
        if (!autoRunFired.current) {
          autoRunFired.current = true;
          runSearch(restored);
        }
      }
    });
  }, [runSearch]);

  // When user logs in and has a saved resume, restore it automatically
  useEffect(() => {
    if (!user?.resumeData || resumeData || autoRunFired.current) return;
    const rd = { ...user.resumeData, _restored: true };
    setResumeData(rd);
    autoRunFired.current = true;
    runSearch(rd);
  }, [user, resumeData, runSearch]);

  const handleSkillsExtracted = async (data) => {
    setResumeData(data);
    if (data.experienceLevel && data.experienceLevel !== 'all') {
      setExperienceFilter(data.experienceLevel);
    }
    // Persist to account so user never re-uploads
    if (user) saveResume(data).catch(() => {});
    await runSearch(data);
  };

  const handleReset = useCallback(() => {
    setResumeData(null);
    setJobs([]);
    setSearchDuration(null);
    setFromCache(false);
    setView('map');
    setSelectedCompany(null);
    setChildClicked(null);
    setSkillGaps({});
    setReportedJobs(new Set());
    setExperienceFilter('all');
  }, []);

  useEffect(() => {
    if (childClicked) setSelectedCompany(childClicked);
  }, [childClicked]);

  useEffect(() => {
    if (!selectedCompany) return;

    const visibleCompany = filteredJobs.find(c =>
      (selectedCompany.companyId && c.companyId === selectedCompany.companyId) ||
      c.employer_name === selectedCompany.employer_name
    );

    setSelectedCompany(visibleCompany || null);
  }, [filteredJobs, selectedCompany]);

  // Fetch skill gaps for all visible jobs when a company drawer opens.
  // requestedSkillGaps ref (not state) tracks already-requested links so this
  // effect never re-fires just because skillGaps state updated.
  useEffect(() => {
    if (!selectedCompany || !resumeData?.primarySkills?.length) return;

    const primarySkills   = resumeData.primarySkills || [];
    const secondarySkills = resumeData.secondarySkills || [];
    const controller = new AbortController();

    const unfetched = (selectedCompany.roles || []).filter(
      job => job.applyLink && !requestedSkillGaps.current.has(job.applyLink)
    );

    for (const job of unfetched) requestedSkillGaps.current.add(job.applyLink);

    Promise.all(
      unfetched.map(async (job) => {
        try {
          const res = await fetch(`${API_BASE}/api/jobs/skill-gap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primarySkills, secondarySkills, jobTitle: job.title, jobId: job.jobId || null }),
            signal: controller.signal
          });
          if (!res.ok) return;
          const data = await res.json();
          if (data.hasAnalysis) {
            setSkillGaps(prev => ({ ...prev, [job.applyLink]: data }));
          }
        } catch (err) {
          if (err.name !== 'AbortError') console.error('Skill gap fetch failed:', err.message);
        }
      })
    );

    return () => controller.abort();
  }, [selectedCompany, resumeData]); // skillGaps intentionally excluded — ref tracks requests

  const showSnack = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  const toggleSave = async (job, companyName, companyId) => {
    const already = savedJobs.some(j => j.applyLink === job.applyLink);
    if (already) {
      setSavedJobs(prev => prev.filter(j => j.applyLink !== job.applyLink));
      await unsaveJobFromSession(sessionId.current, job.applyLink);
      showSnack('Job removed from saved', 'info');
    } else {
      const jobData = {
        title: job.title, company: companyName, companyId,
        applyLink: job.applyLink, location: job.location, source: job.source
      };
      setSavedJobs(prev => [...prev, { ...jobData, savedAt: new Date().toISOString() }]);
      await saveJobToSession(sessionId.current, jobData);
      showSnack('Job saved! Find it in your bookmarks.', 'success');
    }
  };

  const handleApply = async (job, companyName) => {
    setAppliedLinks(prev => new Set([...prev, job.applyLink]));
    await trackApplyClick(sessionId.current, {
      title: job.title, company: companyName,
      applyLink: job.applyLink, jobId: job.jobId || null
    });
  };

  const handleReportClosed = async (job) => {
    setReportedJobs(prev => new Set([...prev, job.applyLink]));
    showSnack('Thanks for the report — job marked as closed.', 'info');
    try {
      await fetch(`${API_BASE}/api/jobs/report-closed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyLink: job.applyLink, jobId: job.jobId || null })
      });
    } catch {}
  };

  // ── Early returns ────────────────────────────────────────────────────────────

  // Wait for auth check before deciding what to show
  if (authLoading) {
    return (
      <Box sx={{
        height: '100vh', width: '100vw', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#060b18 0%,#0b1535 50%,#080f20 100%)'
      }}>
        <CircularProgress sx={{ color: '#3b82f6' }} />
      </Box>
    );
  }

  if (!resumeData) {
    return (
      <>
        <ResumeUpload onSkillsExtracted={handleSkillsExtracted} />
        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={(u) => {
            setAuthModalOpen(false);
            if (u.resumeData && !resumeData && !autoRunFired.current) {
              const rd = { ...u.resumeData, _restored: true };
              setResumeData(rd);
              autoRunFired.current = true;
              runSearch(rd);
            }
          }}
        />
        {/* Auth button on upload screen */}
        <Box sx={{ position: 'fixed', top: 16, right: 16, zIndex: 9999 }}>
          {user ? (
            <Tooltip title={user.email}>
              <Button
                size="small"
                startIcon={<AccountCircleIcon />}
                onClick={logout}
                sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none', fontSize: 12 }}
              >
                Sign out
              </Button>
            </Tooltip>
          ) : (
            <Button
              size="small"
              startIcon={<AccountCircleIcon />}
              onClick={() => setAuthModalOpen(true)}
              sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none', fontSize: 12 }}
            >
              Sign in
            </Button>
          )}
        </Box>
      </>
    );
  }

  if (searchLoading) {
    return <SearchLoader resumeData={resumeData} />;
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <Box sx={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden', bgcolor: '#0f172a' }}>
      <CssBaseline />

      {/* Map view */}
      <Box sx={{ height: '100vh', width: '100vw', zIndex: 1, display: view === 'map' ? 'block' : 'none', position: 'relative' }}>
        <Map coords={MAP_CENTER} jobs={filteredJobs} setChildClicked={setChildClicked} highlightedNames={null} />
        {filteredJobs.length === 0 && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <Box sx={{
              bgcolor: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3,
              px: 5, py: 4, textAlign: 'center', pointerEvents: 'auto',
            }}>
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 700, mb: 1 }}>
                No jobs found
              </Typography>
              <Typography sx={{ color: '#94a3b8', fontSize: 14, mb: 2.5 }}>
                No companies are currently hiring for these skills in India.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={handleReset}
                sx={{ color: '#60a5fa', borderColor: '#60a5fa', '&:hover': { borderColor: 'white', color: 'white' } }}
              >
                Try a new search
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      {/* List view */}
      {view === 'list' && (
        <Box sx={{ height: '100vh', width: '100vw', zIndex: 1, pt: '56px' }}>
          <JobList
            jobs={filteredJobs}
            savedJobs={savedJobs}
            onSaveJob={toggleSave}
            onCompanyClick={(company) => { setSelectedCompany(company); setView('map'); }}
          />
        </Box>
      )}

      {/* Map / List toggle */}
      {jobs.length > 0 && (
        <Box sx={{
          position: 'fixed', top: 14, right: 80, zIndex: 1200,
          display: 'flex', bgcolor: 'rgba(15,23,42,0.88)',
          backdropFilter: 'blur(8px)', borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden'
        }}>
          {[{ val: 'map', Icon: MapIcon }, { val: 'list', Icon: ViewListIcon }].map(({ val, Icon }) => (
            <IconButton
              key={val}
              size="small"
              onClick={() => setView(val)}
              sx={{
                borderRadius: 0, px: 1.5, py: 0.75,
                color: view === val ? 'white' : '#475569',
                bgcolor: view === val ? '#1e40af' : 'transparent',
                '&:hover': { bgcolor: view === val ? '#1e40af' : '#1e293b' }
              }}
            >
              <Icon sx={{ fontSize: 18 }} />
            </IconButton>
          ))}
        </Box>
      )}

      {/* Saved jobs FAB */}
      <Tooltip title="Saved Jobs" placement="left">
        <IconButton
          onClick={() => setSavedDrawerOpen(true)}
          sx={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1200,
            bgcolor: '#1e293b', color: 'white', width: 56, height: 56,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            '&:hover': { bgcolor: '#334155' }
          }}
        >
          <Badge badgeContent={savedJobs.length} color="primary">
            <BookmarksIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      {/* Search summary */}
      {jobs.length > 0 && (
        <SearchSummary
          resumeData={resumeData}
          jobs={filteredJobs}
          searchDuration={searchDuration}
          fromCache={fromCache}
          onNewSearch={handleReset}
          experienceFilter={experienceFilter}
          onExperienceFilterChange={setExperienceFilter}
        />
      )}

      {/* Company detail drawer */}
      <CompanyDrawer
        company={selectedCompany}
        skillGaps={skillGaps}
        savedJobs={savedJobs}
        appliedLinks={appliedLinks}
        reportedJobs={reportedJobs}
        onClose={() => setSelectedCompany(null)}
        onToggleSave={toggleSave}
        onApply={handleApply}
        onReportClosed={handleReportClosed}
      />

      {/* Saved jobs drawer */}
      <SavedJobsDrawer
        open={savedDrawerOpen}
        onClose={() => setSavedDrawerOpen(false)}
        savedJobs={savedJobs}
        appliedLinks={appliedLinks}
        resumeData={resumeData}
        onToggleSave={toggleSave}
        onApply={handleApply}
      />

      {/* Auth button */}
      <Box sx={{ position: 'fixed', top: 14, left: 16, zIndex: 1200 }}>
        {user ? (
          <Tooltip title={`Signed in as ${user.email}`}>
            <Button
              size="small"
              startIcon={<AccountCircleIcon sx={{ fontSize: 16 }} />}
              onClick={logout}
              sx={{
                color: 'rgba(255,255,255,0.5)', textTransform: 'none', fontSize: 11,
                bgcolor: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', px: 1.5,
                '&:hover': { color: 'white', bgcolor: 'rgba(30,41,59,0.9)' }
              }}
            >
              Sign out
            </Button>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<AccountCircleIcon sx={{ fontSize: 16 }} />}
            onClick={() => setAuthModalOpen(true)}
            sx={{
              color: 'rgba(255,255,255,0.5)', textTransform: 'none', fontSize: 11,
              bgcolor: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', px: 1.5,
              '&:hover': { color: 'white', bgcolor: 'rgba(30,41,59,0.9)' }
            }}
          >
            Sign in
          </Button>
        )}
      </Box>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(u) => {
          setAuthModalOpen(false);
          // If they just logged in and have a saved resume but haven't searched yet, restore it
          if (u.resumeData && !jobs.length) {
            const rd = { ...u.resumeData, _restored: true };
            setResumeData(rd);
            runSearch(rd);
          }
          // If they logged in after uploading, save current resume to their account
          if (!u.resumeData && resumeData) saveResume(resumeData).catch(() => {});
        }}
      />

      {/* Toast notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          sx={{ bgcolor: '#1e293b', color: 'white', border: '1px solid #334155' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default App;
