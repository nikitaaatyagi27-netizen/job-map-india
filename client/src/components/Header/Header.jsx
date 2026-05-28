import React from 'react';
import { AppBar, Toolbar, Typography, Box } from '@mui/material';
import WorkIcon from '@mui/icons-material/Work';

const Header = () => {
  return (
    <AppBar position="static" style={{ backgroundColor: '#2C3E50' }}>
      <Toolbar style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Box display="flex" alignItems="center">
           <WorkIcon sx={{ mr: 2 }} />
           <Typography variant="h5">Job Locator India</Typography>
        </Box>
        <Box>
           <Typography variant="h6">Find your next role</Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;