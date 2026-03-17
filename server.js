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

  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(400).json({ error: "Requête incomplète" });
  }

  const source = coordinates[0];
  const destinations = coordinates.slice(1);

  const requestBody = {
    locations: [source, ...destinations],
    sources: [0],
    destinations: destinations.map((_, i) => i + 1),
    metrics: ["distance", "duration"]
  };

  if (avoid_highways) {
    requestBody.options = {
      avoid_features: ["tollways"]  // ORS Matrix supporte tollways, pas highways
    };
  }

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!orsRes.ok) {
      const errorText = await orsRes.text();
      throw new Error(`Erreur ORS Matrix : ${orsRes.status} - ${errorText}`);
    }

    const data = await orsRes.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Erreur Matrix :", err);
    res.status(500).json({ error: "Erreur serveur ORS Matrix", details: err.message });
  }
});

// 🚗 ORS : Itinéraire complet — appelé par /api/route/ors dans script.js
app.post('/api/route/ors', async (req, res) => {
  const { source, destination, avoid_highways } = req.body;

  if (!source || !destination) {
    return res.status(400).json({ error: "Source et destination requises" });
  }

  const requestBody = {
    coordinates: [source, destination]
  };

  if (avoid_highways) {
    requestBody.options = { avoid_features: ["tollways"] };
  }

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!orsRes.ok) {
      const errorText = await orsRes.text();
      throw new Error(`Erreur ORS Directions : ${orsRes.status} - ${errorText}`);
    }

    const data = await orsRes.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Erreur Route :", err);
    res.status(500).json({ error: "Erreur serveur ORS Directions", details: err.message });
  }
});
// ✅ TEST GET TEMPORAIRE
app.get('/api/matrix/ors', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Route POST /api/matrix/ors prête ! Utilisez POST avec {coordinates: [[lon1,lat1],[lon2,lat2]]}'
  });
});


module.exports = app;
