import React from 'react';
import { Box, Typography, Button, Card, CardMedia, CardContent, Chip, Divider } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import { getCompanyInitials } from '../../utils/companyLogoFallback';

const JobDetails = ({ company, selected, refProp }) => {
  if (selected) refProp?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <Card elevation={6} sx={{ borderRadius: '12px', border: selected ? '2px solid #1976d2' : 'none' }}>
      <CardContent>
        {/* --- Company Header --- */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box display="flex" alignItems="center">
            {company.employer_logo ? (
              <img 
                src={company.employer_logo} 
                alt={company.employer_name}
                onError={(e) => {
                  const logoEl = e.currentTarget;
                  const fallback = logoEl.nextElementSibling;

                  if (!logoEl.dataset.faviconTried && company.domain) {
                    logoEl.dataset.faviconTried = '1';
                    logoEl.src = `https://www.google.com/s2/favicons?domain=${company.domain}&sz=128`;
                    return;
                  }

                  logoEl.style.display = 'none';
                  if (fallback) fallback.style.display = 'flex';
                }}
                style={{ width: '50px', height: '50px', borderRadius: '8px', marginRight: '15px', objectFit: 'contain' }}
              />
            ) : null}
            <Box
              sx={{
                width: '50px',
                height: '50px',
                borderRadius: '8px',
                marginRight: '15px',
                display: company.employer_logo ? 'none' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#e3f2fd',
                color: '#1976d2',
                fontWeight: 'bold'
              }}
            >
              {getCompanyInitials(company.employer_name)}
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{company.employer_name}</Typography>
          </Box>
          <Chip icon={<BusinessIcon />} label={`${company.roles.length} Roles`} color="primary" variant="outlined" />
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* --- Roles List --- */}
        <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1, fontWeight: 'bold' }}>
          AVAILABLE OPENINGS:
        </Typography>
        
        {company.roles.map((role, index) => (
          <Box 
            key={role.job_id} 
            sx={{ 
              p: 1.5, 
              mb: 1, 
              bgcolor: '#f8f9fa', 
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: '1px solid #eee'
            }}
          >
            <Box>
              <Typography variant="body1" sx={{ fontWeight: '500' }}>{role.job_title}</Typography>
              <Typography variant="caption" color="textSecondary">
                {role.job_city || 'On-site'} • {role.job_employment_type}
              </Typography>
            </Box>
            <Button 
              size="small" 
              variant="contained" 
              color="primary" 
              onClick={() => window.open(role.job_apply_link, '_blank')}
              sx={{ textTransform: 'none', borderRadius: '20px' }}
            >
              Apply
            </Button>
          </Box>
        ))}
      </CardContent>
    </Card>
  );
};

export default JobDetails;
