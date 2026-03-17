const express = require('express');
const app = express();

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: '✅ Express fonctionne !' });
});

module.exports = app;
