const dns = require('dns');
dns.resolveSrv('_mongodb._tcp.cluster0.oqngujy.mongodb.net', (err, a) => {
  if (err) console.log('SRV FAILED:', err.message);
  else console.log('SRV OK:', JSON.stringify(a[0]));
});
