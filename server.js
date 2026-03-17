module.exports = (req, res) => {
  res.json({ 
    success: true, 
    message: '✅ server.js fonctionne parfaitement !',
    method: req.method,
    path: req.path,
    url: req.url
  });
};
