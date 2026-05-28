import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import BoltIcon from '@mui/icons-material/Bolt';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';

const EXPERIENCE_OPTIONS = [
  { value: 'all',    label: 'All' },
  { value: 'fresher', label: 'Fresher' },
  { value: 'mid',    label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

export default function SearchSummary({ resumeData, jobs, searchDuration, fromCache, onNewSearch, experienceFilter = 'all', onExperienceFilterChange }) {
  const totalJobs    = jobs.reduce((n, c) => n + (c.roles?.length || 0), 0);
  const activeCount  = jobs.filter(c => (c.hiringVelocity?.last7Days || 0) >= 3).length;
  const atsCount     = jobs.filter(c => c.atsProvider).length;
  const domainLabel  = resumeData?.domain
    ? resumeData.domain.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Jobs';

  return (
    <Box sx={{
      position: 'fixed',
      top: 14,
      left: 14,
      zIndex: 1200,
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 1,
      bgcolor: 'rgba(15,23,42,0.88)',
      backdropFilter: 'blur(8px)',
      borderRadius: '14px',
      px: 2,
      py: 1,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
      maxWidth: 'calc(100vw - 28px)',
    }}>

      {/* Domain label */}
      <Typography variant="body2" sx={{ color: 'white', fontWeight: 700, fontSize: 13 }}>
        {domainLabel}
      </Typography>

      <Separator />

      {/* Company count */}
      <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: 13 }}>
        <span style={{ color: 'white', fontWeight: 700 }}>{jobs.length}</span> companies
      </Typography>

      <Separator />

      {/* Roles count */}
      <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: 13 }}>
        <span style={{ color: 'white', fontWeight: 700 }}>{totalJobs}</span> roles
      </Typography>

      {/* Experience filter chips */}
      {onExperienceFilterChange && (
        <>
          <Separator />
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {EXPERIENCE_OPTIONS.map(opt => {
              const active = experienceFilter === opt.value;
              return (
                <Box
                  key={opt.value}
                  onClick={() => onExperienceFilterChange(opt.value)}
                  sx={{
                    px: 1.2, py: 0.3, borderRadius: '8px', cursor: 'pointer',
                    fontSize: 11, fontWeight: active ? 700 : 400,
                    color: active ? '#0f172a' : '#94a3b8',
                    bgcolor: active ? '#60a5fa' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${active ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                    transition: 'all 0.15s',
                    '&:hover': { bgcolor: active ? '#60a5fa' : 'rgba(255,255,255,0.12)' },
                    userSelect: 'none',
                  }}
                >
                  {opt.label}
                </Box>
              );
            })}
          </Box>
        </>
      )}

      {/* Actively hiring badge */}
      {activeCount > 0 && (
        <>
          <Separator />
          <Tooltip title="Companies that posted 3+ new jobs in the last 7 days">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'help' }}>
              <LocalFireDepartmentIcon sx={{ fontSize: 14, color: '#22c55e' }} />
              <Typography variant="body2" sx={{ color: '#22c55e', fontWeight: 700, fontSize: 13 }}>
                {activeCount} hiring
              </Typography>
            </Box>
          </Tooltip>
        </>
      )}

      {/* ATS direct count */}
      {atsCount > 0 && (
        <>
          <Separator />
          <Tooltip title="Companies with direct ATS integration — apply without going through a job board">
            <Typography variant="body2" sx={{ color: '#60a5fa', fontWeight: 600, fontSize: 12, cursor: 'help' }}>
              {atsCount} direct ATS
            </Typography>
          </Tooltip>
        </>
      )}

      {/* Cache / live indicator */}
      {searchDuration && (
        <>
          <Separator />
          <Tooltip title={fromCache ? 'Result served from cache — instant response' : `Live search completed in ${searchDuration}s`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, cursor: 'help' }}>
              {fromCache && <BoltIcon sx={{ fontSize: 13, color: '#f59e0b' }} />}
              <Typography variant="body2" sx={{ color: fromCache ? '#f59e0b' : '#64748b', fontSize: 12, fontWeight: fromCache ? 700 : 400 }}>
                {fromCache ? 'cached' : `${searchDuration}s`}
              </Typography>
            </Box>
          </Tooltip>
        </>
      )}

      {/* New search */}
      <Tooltip title="Upload new resume">
        <IconButton
          size="small"
          onClick={onNewSearch}
          sx={{ color: '#64748b', p: 0.5, ml: 0.5, '&:hover': { color: 'white' } }}
        >
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function Separator() {
  return <Box sx={{ width: '1px', height: 14, bgcolor: 'rgba(255,255,255,0.12)' }} />;
}
