export default function handler(req, res) {
  // Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // TEST QUI MARCHE À COUP SÛR
  res.status(200).json({ 
    success: true,
    message: '✅ API serverless native fonctionne ! 🚀',
    method: req.method,
    path: req.path || req.url,
    timestamp: new Date().toISOString()
  });
}
const express = require('express');
const app = express();

// Middlewares
app.use(express.json());

// Route de test
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: '✅ Express + Vercel OK !',
    path: req.path 
  });
});

// Catch-all pour debug
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée', 
    path: req.path 
  });
});

// ✅ EXPORT SANS app.listen() - CRUCIAL
module.exports = (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  res.status(200).json({ 
    success: true,
    message: '✅ API VERCEL FONCTIONNE !',
    path: req.url,
    method: req.method
  });
};

module.exports = app;
