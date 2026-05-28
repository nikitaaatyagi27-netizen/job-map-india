import React, { useState, useEffect, createRef } from 'react';
import { CircularProgress, Grid, Typography, Box } from '@mui/material';
import JobDetails from '../JobDetails/JobDetails';

const List = ({ jobs, childClicked, isLoading }) => {
  const [elRefs, setElRefs] = useState([]);

  useEffect(() => {
    setElRefs((refs) => Array(jobs?.length).fill().map((_, i) => refs[i] || createRef()));
  }, [jobs]);

  return (
    <Box sx={{ p: '20px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h5" sx={{ fontWeight: '800', mb: 2, color: '#1a1a1a' }}>
        Top Companies Nearby
      </Typography>
      
      {isLoading ? (
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <CircularProgress size="4rem" thickness={4} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto', pr: 1 }}>
          <Grid container spacing={2}>
            {jobs?.map((company, i) => (
              <Grid ref={elRefs[i]} key={i} item xs={12}>
                <JobDetails 
                  company={company} 
                  selected={Number(childClicked) === i} 
                  refProp={elRefs[i]} 
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
};

export default List;