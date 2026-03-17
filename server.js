const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 🚗 ORS : Matrice de distance — appelé par /api/matrix/ors dans script.js
app.post("/api/matrix/ors", async (req, res) => {
  const { coordinates, avoid_highways } = req.body;
  // ... votre code inchangé
});

// 🚗 ORS : Itinéraire complet — appelé par /api/route/ors dans script.js
app.post('/api/route/ors', async (req, res) => {
  const { source, destination, avoid_highways } = req.body;
  // ... votre code inchangé
});

// ✅ UNE SEULE LIGNE À LA FIN
module.exports = app;
