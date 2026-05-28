import React, { useMemo } from 'react';
import {
  Box, Chip, Divider, Drawer, IconButton, Tooltip, Typography
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { getCompanyInitials } from '../../utils/companyLogoFallback';
import { ATS_COLORS, TREND_ICON } from '../../utils/jobUtils';
import JobCard from '../JobCard/JobCard';

export default function CompanyDrawer({ company, skillGaps, savedJobs, appliedLinks, reportedJobs, onClose, onToggleSave, onApply, onReportClosed }) {
  const savedSet = useMemo(() => new Set(savedJobs.map(j => j.applyLink)), [savedJobs]);
  const isSaved = (applyLink) => savedSet.has(applyLink);

  return (
    <Drawer
      anchor="right"
      open={Boolean(company)}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: '#0f172a', color: 'white' } }}
    >
      <Box sx={{ width: 360, p: 2.5, overflowY: 'auto' }}>
        {company && (
          <>
            {/* Logo */}
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              {company.employer_logo ? (
                <img
                  src={company.employer_logo}
                  alt={company.employer_name}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fb = e.currentTarget.nextElementSibling;
                    if (fb) fb.style.display = 'flex';
                  }}
                  style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 12, background: 'white', padding: 6 }}
                />
              ) : null}
              <Box sx={{
                width: 72, height: 72, borderRadius: '12px',
                display: company.employer_logo ? 'none' : 'flex',
                alignItems: 'center', justifyContent: 'center',
                bgcolor: '#1e293b', color: '#60a5fa', fontWeight: 'bold', fontSize: 26,
              }}>
                {getCompanyInitials(company.employer_name)}
              </Box>
            </Box>

            <Typography variant="h6" sx={{ mb: 0.5, color: 'white', fontWeight: 700, textAlign: 'center' }}>
              {company.employer_name}
            </Typography>

            <Typography variant="body2" sx={{ mb: 1.5, color: '#94a3b8', textAlign: 'center' }}>
              {company.roles?.[0]?.location || 'India'}
            </Typography>

            {/* ATS provider badge */}
            {company.atsProvider && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                <Tooltip title={company.atsMeta?.hint || 'ATS platform'} placement="top">
                  <Chip
                    label={`Hires via ${company.atsMeta?.label || company.atsProvider}`}
                    size="small"
                    sx={{
                      bgcolor: ATS_COLORS[company.atsProvider]?.bg || '#1e293b',
                      color:   ATS_COLORS[company.atsProvider]?.color || '#60a5fa',
                      fontWeight: 600, fontSize: 11, cursor: 'help'
                    }}
                  />
                </Tooltip>
              </Box>
            )}

            {/* Hiring velocity */}
            {company.hiringVelocity?.last7Days > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 1.5 }}>
                <TrendingUpIcon sx={{ fontSize: 16, color: '#34d399' }} />
                <Typography variant="caption" sx={{ color: '#34d399', fontWeight: 600 }}>
                  {company.hiringVelocity.last7Days} new jobs this week
                  {' '}{TREND_ICON[company.hiringVelocity.trend] || ''}
                </Typography>
              </Box>
            )}

            <Divider sx={{ mb: 2, borderColor: '#1e293b' }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, fontSize: 11 }}>
              Open Roles ({company.roles?.length || 0})
            </Typography>

            {company.roles?.map((job, index) => (
              <JobCard
                key={job.applyLink || index}
                job={job}
                companyName={company.employer_name}
                companyId={company.companyId}
                saved={isSaved(job.applyLink)}
                applied={appliedLinks.has(job.applyLink)}
                reported={reportedJobs.has(job.applyLink)}
                skillGap={skillGaps[job.applyLink]}
                onSave={onToggleSave}
                onApply={onApply}
                onReportClosed={onReportClosed}
              />
            ))}
          </>
        )}
      </Box>
    </Drawer>
  );
}
