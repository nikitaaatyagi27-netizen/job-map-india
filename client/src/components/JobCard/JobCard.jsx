import React from 'react';
import { Box, Button, Chip, IconButton, Typography } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SkillGapBar from '../SkillGapBar/SkillGapBar';
import { SOURCE_LABELS, daysAgo, jobAgeDays } from '../../utils/jobUtils';

const JobCard = React.memo(function JobCard({ job, companyName, companyId, saved, applied, reported, skillGap, onSave, onApply, onReportClosed }) {
  const ageDays   = jobAgeDays(job.postedDate);
  const isSuspect = ageDays !== null && ageDays >= 21;

  return (
    <Box sx={{
      mb: 1.5, p: 1.5, bgcolor: '#1e293b', borderRadius: 2,
      border: reported  ? '1px solid #ef4444'
            : applied   ? '1px solid #22c55e'
            : isSuspect ? '1px solid #78350f'
            : '1px solid #334155',
      position: 'relative',
      opacity: reported ? 0.55 : 1
    }}>
      <IconButton
        size="small"
        onClick={() => onSave(job, companyName, companyId)}
        sx={{ position: 'absolute', top: 6, right: 6, color: saved ? '#f59e0b' : '#475569', p: 0.5 }}
      >
        {saved ? <BookmarkIcon sx={{ fontSize: 18 }} /> : <BookmarkBorderIcon sx={{ fontSize: 18 }} />}
      </IconButton>

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: reported ? '#ef4444' : 'white', pr: 3 }}>
        {job.title}
      </Typography>

      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.75 }}>
        {job.location}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
        {job.source && (
          <Chip
            label={SOURCE_LABELS[job.source] || job.source}
            size="small"
            sx={{ bgcolor: '#0f172a', color: '#60a5fa', border: '1px solid #1e40af', fontSize: 10, height: 20 }}
          />
        )}
        {job.postedDate && (
          <Chip
            label={`Posted ${daysAgo(job.postedDate)}`}
            size="small"
            sx={{
              bgcolor: isSuspect ? '#451a03' : '#0f172a',
              color:   isSuspect ? '#fb923c' : '#64748b',
              fontSize: 10, height: 20
            }}
          />
        )}
        {isSuspect && !reported && (
          <Chip label="May be closed" size="small"
            sx={{ bgcolor: '#451a03', color: '#fb923c', fontSize: 10, height: 20, fontWeight: 600 }} />
        )}
        {applied && (
          <Chip label="Applied" size="small"
            sx={{ bgcolor: '#14532d', color: '#4ade80', fontSize: 10, height: 20 }} />
        )}
        {reported && (
          <Chip label="Reported closed" size="small"
            sx={{ bgcolor: '#450a0a', color: '#fca5a5', fontSize: 10, height: 20 }} />
        )}
        {job.yearsMin != null && (
          <Chip
            label={job.yearsMax != null
              ? `${job.yearsMin}–${job.yearsMax} yrs`
              : `${job.yearsMin}+ yrs`}
            size="small"
            sx={{ bgcolor: '#0f172a', color: '#94a3b8', border: '1px solid #334155', fontSize: 10, height: 20 }}
          />
        )}
        {job.yearsMin == null && job.experienceLevel && (
          <Chip
            label={job.experienceLevel === 'fresher' ? 'Fresher' : job.experienceLevel === 'mid' ? 'Mid-level' : 'Senior'}
            size="small"
            sx={{
              bgcolor: job.experienceLevel === 'fresher' ? '#052e16' : job.experienceLevel === 'senior' ? '#1e1b4b' : '#0c1a2e',
              color:   job.experienceLevel === 'fresher' ? '#4ade80' : job.experienceLevel === 'senior' ? '#a5b4fc' : '#60a5fa',
              fontSize: 10, height: 20
            }}
          />
        )}
        {job.relevanceScore >= 150 && (
          <Chip label="Top Match" size="small"
            sx={{ bgcolor: '#1e1b4b', color: '#a5b4fc', fontSize: 10, height: 20 }} />
        )}
      </Box>

      <SkillGapBar gap={skillGap} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
        {!reported && (
          <Button
            variant="contained"
            size="small"
            href={job.applyLink}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNewIcon sx={{ fontSize: 12 }} />}
            onClick={() => onApply(job, companyName)}
            sx={{
              bgcolor: applied ? '#15803d' : '#2563eb',
              '&:hover': { bgcolor: applied ? '#166534' : '#1d4ed8' },
              borderRadius: 1.5, textTransform: 'none', fontSize: 12
            }}
          >
            {applied ? 'Applied' : 'Apply'}
          </Button>
        )}
        {!reported && (
          <Button
            variant="text"
            size="small"
            onClick={() => onReportClosed(job)}
            sx={{ color: '#475569', fontSize: 11, textTransform: 'none', px: 1, '&:hover': { color: '#ef4444', bgcolor: 'transparent' } }}
          >
            Job closed?
          </Button>
        )}
      </Box>
    </Box>
  );
});

export default JobCard;
