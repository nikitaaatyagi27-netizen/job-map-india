require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
console.log('Connecting to:', uri);

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 15000,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true
});

client.connect()
  .then(() => {
    console.log('SUCCESS - MongoDB connected!');
    return client.close();
  })
  .catch(e => {
    console.log('FAILED:', e.message);
    process.exit(1);
  });
