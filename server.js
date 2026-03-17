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
module.exports = app;
const express = require('express');
const app = express();

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: '✅ Express fonctionne !' });
});

module.exports = app;
