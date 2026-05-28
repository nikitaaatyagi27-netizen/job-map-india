import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Chip, Button, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Tooltip, IconButton
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { getCompanyInitials } from '../../utils/companyLogoFallback';

const CITIES = ['All India', 'Bangalore', 'Mumbai', 'Hyderabad', 'Pune', 'Chennai', 'Noida', 'Gurgaon', 'Delhi', 'Remote'];

const ATS_COLORS = {
  greenhouse:      { bg: '#14532d', color: '#4ade80' },
  lever:           { bg: '#1e3a5f', color: '#60a5fa' },
  ashby:           { bg: '#3b0764', color: '#c084fc' },
  smartrecruiters: { bg: '#431407', color: '#fb923c' },
  workday:         { bg: '#500724', color: '#f9a8d4' },
};

const TREND_COLOR = {
  accelerating: '#22c55e',
  stable:       '#f59e0b',
  slowing:      '#64748b',
};

const CompanyLogo = React.memo(function CompanyLogo({ company }) {
  const [failed, setFailed] = useState(false);
  if (company.employer_logo && !failed) {
    return (
      <img
        src={company.employer_logo}
        alt={company.employer_name}
        onError={() => setFailed(true)}
        style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 8, background: 'white', padding: 3 }}
      />
    );
  }
  return (
    <Box sx={{
      width: 36, height: 36, borderRadius: '8px', bgcolor: '#1e293b',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#60a5fa', fontWeight: 'bold', fontSize: 13
    }}>
      {getCompanyInitials(company.employer_name)}
    </Box>
  );
});

export default function JobList({ jobs, savedJobs, onSaveJob, onCompanyClick }) {
  const [sortBy, setSortBy]       = useState('relevance');
  const [sortDir, setSortDir]     = useState('desc');
  const [cityFilter, setCityFilter] = useState('All India');
  const [search, setSearch]       = useState('');

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const savedLinks = useMemo(() => new Set(savedJobs?.map(j => j.applyLink) || []), [savedJobs]);

  const filtered = useMemo(() => {
    let list = [...jobs];

    // City filter
    if (cityFilter !== 'All India') {
      const city = cityFilter.toLowerCase();
      list = list.filter(c =>
        c.roles?.some(r =>
          (r.location || '').toLowerCase().includes(city) ||
          (city === 'remote' && (r.location || '').toLowerCase().includes('remote'))
        )
      );
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        c.employer_name?.toLowerCase().includes(q) ||
        c.roles?.some(r => r.title?.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'relevance':
          av = a.roles?.[0]?.relevanceScore || 0;
          bv = b.roles?.[0]?.relevanceScore || 0;
          break;
        case 'jobs':
          av = a.roles?.length || 0;
          bv = b.roles?.length || 0;
          break;
        case 'velocity':
          av = a.hiringVelocity?.last7Days || 0;
          bv = b.hiringVelocity?.last7Days || 0;
          break;
        case 'name':
          av = a.employer_name?.toLowerCase() || '';
          bv = b.employer_name?.toLowerCase() || '';
          return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        default:
          av = 0; bv = 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [jobs, cityFilter, search, sortBy, sortDir]);

  const totalRoles = filtered.reduce((n, c) => n + (c.roles?.length || 0), 0);
  const activeCount = filtered.filter(c => (c.hiringVelocity?.last7Days || 0) >= 3).length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#0f172a' }}>

      {/* City filter chips */}
      <Box sx={{ px: 2, pt: 2, pb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
        {CITIES.map(city => (
          <Chip
            key={city}
            label={city}
            size="small"
            onClick={() => setCityFilter(city)}
            sx={{
              cursor: 'pointer',
              bgcolor: cityFilter === city ? '#2563eb' : '#1e293b',
              color: cityFilter === city ? 'white' : '#94a3b8',
              fontWeight: cityFilter === city ? 700 : 400,
              fontSize: 12,
              border: cityFilter === city ? '1px solid #3b82f6' : '1px solid #334155',
              '&:hover': { bgcolor: cityFilter === city ? '#1d4ed8' : '#334155' }
            }}
          />
        ))}
      </Box>

      {/* Search + stats bar */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid #1e293b' }}>
        <TextField
          size="small"
          placeholder="Search companies or roles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: '#475569', fontSize: 18 }} /></InputAdornment>,
            sx: { bgcolor: '#1e293b', color: 'white', borderRadius: 1.5, fontSize: 13,
              '& fieldset': { borderColor: '#334155' },
              '&:hover fieldset': { borderColor: '#475569' },
              '& input': { color: 'white' }
            }
          }}
          sx={{ width: 280 }}
        />
        <Typography variant="caption" sx={{ color: '#64748b', ml: 'auto', fontSize: 12 }}>
          <span style={{ color: 'white', fontWeight: 700 }}>{filtered.length}</span> companies ·{' '}
          <span style={{ color: 'white', fontWeight: 700 }}>{totalRoles}</span> roles
          {activeCount > 0 && (
            <> · <span style={{ color: '#22c55e', fontWeight: 700 }}>🔥 {activeCount} actively hiring</span></>
          )}
        </Typography>
      </Box>

      {/* Table */}
      <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow sx={{ '& th': { bgcolor: '#0f172a', borderBottom: '1px solid #1e293b', color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 } }}>
              <TableCell sx={{ width: 52 }} />
              <TableCell>
                <TableSortLabel
                  active={sortBy === 'name'} direction={sortBy === 'name' ? sortDir : 'asc'}
                  onClick={() => handleSort('name')}
                  sx={{ color: '#64748b !important', '&.Mui-active': { color: 'white !important' }, '& .MuiTableSortLabel-icon': { color: '#64748b !important' } }}
                >
                  Company
                </TableSortLabel>
              </TableCell>
              <TableCell>ATS</TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortBy === 'velocity'} direction={sortBy === 'velocity' ? sortDir : 'desc'}
                  onClick={() => handleSort('velocity')}
                  sx={{ color: '#64748b !important', '&.Mui-active': { color: 'white !important' }, '& .MuiTableSortLabel-icon': { color: '#64748b !important' } }}
                >
                  This Week
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortBy === 'jobs'} direction={sortBy === 'jobs' ? sortDir : 'desc'}
                  onClick={() => handleSort('jobs')}
                  sx={{ color: '#64748b !important', '&.Mui-active': { color: 'white !important' }, '& .MuiTableSortLabel-icon': { color: '#64748b !important' } }}
                >
                  Open Roles
                </TableSortLabel>
              </TableCell>
              <TableCell>Top Role</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((company, i) => {
              const topRole  = company.roles?.[0];
              const vel7     = company.hiringVelocity?.last7Days || 0;
              const trend    = company.hiringVelocity?.trend || 'stable';
              const trendColor = TREND_COLOR[trend] || '#64748b';
              const atsKey   = company.atsProvider;
              const atsStyle = atsKey ? (ATS_COLORS[atsKey] || { bg: '#1e293b', color: '#94a3b8' }) : null;
              const isSaved  = topRole && savedLinks.has(topRole.applyLink);

              return (
                <TableRow
                  key={company.employer_name || i}
                  hover
                  onClick={() => onCompanyClick(company)}
                  sx={{
                    cursor: 'pointer',
                    '& td': { borderBottom: '1px solid #1e293b', color: 'white', py: 1.25 },
                    '&:hover': { bgcolor: '#1e293b' }
                  }}
                >
                  <TableCell>
                    <CompanyLogo company={company} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'white', fontSize: 13 }}>
                      {company.employer_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {atsStyle && (
                      <Chip
                        label={atsKey}
                        size="small"
                        sx={{ bgcolor: atsStyle.bg, color: atsStyle.color, fontSize: 10, height: 20, fontWeight: 600 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {vel7 > 0 ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <TrendingUpIcon sx={{ fontSize: 14, color: trendColor }} />
                        <Typography variant="caption" sx={{ color: trendColor, fontWeight: 700 }}>
                          {vel7}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" sx={{ color: '#334155' }}>—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#60a5fa' }}>
                      {company.roles?.length || 0}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: 12 }}>
                      {topRole?.title || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ color: '#64748b', fontSize: 11 }}>
                      {topRole?.location || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {topRole?.applyLink && (
                        <>
                          <Tooltip title="Apply">
                            <IconButton
                              size="small"
                              component="a"
                              href={topRole.applyLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ color: '#3b82f6', p: 0.5 }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={isSaved ? 'Saved' : 'Save job'}>
                            <IconButton
                              size="small"
                              onClick={() => onSaveJob(topRole, company.employer_name, company.companyId)}
                              sx={{ color: isSaved ? '#f59e0b' : '#334155', p: 0.5 }}
                            >
                              {isSaved ? <BookmarkIcon sx={{ fontSize: 16 }} /> : <BookmarkBorderIcon sx={{ fontSize: 16 }} />}
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
