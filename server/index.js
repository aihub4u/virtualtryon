// index.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const tryonRoute = require('./routes/tryon');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: process.env.TRYON_PROVIDER || 'p-image-try-on' });
});

app.use('/api/tryon', tryonRoute);

// Serve the frontend (single-service deploy, same pattern as the RedTag tracker)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Virtual try-on server running on port ${PORT}`);
  console.log(`Provider: ${process.env.TRYON_PROVIDER || 'p-image-try-on'}`);
});
