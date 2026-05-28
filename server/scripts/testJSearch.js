require('dotenv').config();
const axios = require('axios');

axios.get('https://jsearch.p.rapidapi.com/search', {
  headers: {
    'X-RapidAPI-Key': process.env.RAPID_API_KEY,
    'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
  },
  params: { query: 'software engineer India', num_pages: 1, page: 1 }
}).then(r => {
  console.log('Status:', r.status);
  console.log('Results:', r.data?.data?.length);
}).catch(e => {
  console.log('Error status:', e.response?.status);
  console.log('Error message:', e.response?.data?.message || e.message);
});
