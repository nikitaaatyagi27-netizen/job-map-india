import React from 'react';
import {
  Box, Button, Chip, Divider, Drawer, IconButton, Typography
} from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export default function SavedJobsDrawer({ open, onClose, savedJobs, appliedLinks, resumeData, onToggleSave, onApply }) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: '#0f172a', color: 'white' } }}
    >
      <Box sx={{ width: 360, p: 2.5, overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
            Saved Jobs ({savedJobs.length})
          </Typography>
          <IconButton size="small" onClick={onClose} sx={{ color: '#64748b' }}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 2, borderColor: '#1e293b' }} />

        {savedJobs.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 4, color: '#475569' }}>
            <BookmarkBorderIcon sx={{ fontSize: 48, mb: 1, opacity: 0.4 }} />
            <Typography variant="body2">
              No saved jobs yet. Click the bookmark icon on any job to save it.
            </Typography>
          </Box>
        ) : (
          savedJobs.map((job, i) => {
            const applied = appliedLinks.has(job.applyLink);
            return (
              <Box key={i} sx={{
                mb: 1.5, p: 1.5, bgcolor: '#1e293b', borderRadius: 2,
                border: applied ? '1px solid #22c55e' : '1px solid #334155'
              }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1, pr: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'white', mb: 0.25 }}>
                      {job.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#60a5fa', display: 'block', mb: 0.25 }}>
                      {job.company}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                      {job.location}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => onToggleSave(job, job.company, job.companyId)}
                    sx={{ color: '#f59e0b', p: 0.5 }}
                  >
                    <BookmarkIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                  <Button
                    variant="contained"
                    size="small"
                    href={job.applyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<OpenInNewIcon sx={{ fontSize: 12 }} />}
                    onClick={() => onApply(job, job.company)}
                    sx={{
                      bgcolor: applied ? '#15803d' : '#2563eb',
                      '&:hover': { bgcolor: applied ? '#166534' : '#1d4ed8' },
                      borderRadius: 1.5, textTransform: 'none', fontSize: 12
                    }}
                  >
                    {applied ? 'Applied' : 'Apply'}
                  </Button>
                  {applied && (
                    <Chip label="Applied" size="small"
                      sx={{ bgcolor: '#14532d', color: '#4ade80', fontSize: 10, height: 20 }} />
                  )}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Drawer>
  );
}
