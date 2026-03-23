const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ Le webhook Stripe DOIT être avant express.static et express.json pour certaines versions
// On utilise express.raw uniquement pour la route webhook
app.use("/api/webhook/stripe", express.raw({ type: "application/json" }));

app.use(express.static("public"));

// ─────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_DURATION_DAYS = 365; // 1 an

// ─────────────────────────────────────────────
// MIDDLEWARE : vérification du token JWT
// ─────────────────────────────────────────────
function requireAccess(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: "Accès refusé : token manquant" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return res.status(401).json({ error: "Accès expiré" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// ─────────────────────────────────────────────
// STRIPE : créer une session de paiement
// ─────────────────────────────────────────────
app.get("/api/create-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.APP_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/pricing.html`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error("❌ Erreur Stripe checkout :", err);
    res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});

// ─────────────────────────────────────────────
// STRIPE : webhook — paiement confirmé
// ─────────────────────────────────────────────
app.post("/api/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature invalide :", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.customer_details?.email || "inconnu";

    // Générer un token JWT valide 1 an
    const token = jwt.sign(
      { email, source: "stripe", session_id: session.id },
      JWT_SECRET,
      { expiresIn: `${ACCESS_DURATION_DAYS}d` }
    );

    console.log(`✅ Paiement reçu pour ${email} — token généré`);

    // Stripe ne peut pas recevoir le token directement,
    // on le stocke dans les métadonnées de la session pour que /api/get-token puisse le récupérer
    await stripe.checkout.sessions.update(session.id, {
      metadata: { access_token: token },
    });
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────
// STRIPE : récupérer le token après paiement
// Appelé depuis merci.html avec ?session_id=...
// ─────────────────────────────────────────────
app.get("/api/get-token", async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: "session_id manquant" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Paiement non confirmé" });
    }

    const token = session.metadata?.access_token;
    if (!token) {
      return res.status(404).json({ error: "Token non trouvé" });
    }

    res.json({ token });
  } catch (err) {
    console.error("❌ Erreur get-token :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────
// ADMIN : générer un token gratuit
// POST /api/admin/generate-token
// Body: { password: "...", email: "...", label: "..." }
// ─────────────────────────────────────────────
app.post("/api/admin/generate-token", (req, res) => {
  const { password, email, label } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe admin incorrect" });
  }

  if (!email) {
    return res.status(400).json({ error: "Email requis" });
  }

  const token = jwt.sign(
    { email, source: "admin", label: label || "accès gratuit" },
    JWT_SECRET,
    { expiresIn: `${ACCESS_DURATION_DAYS}d` }
  );

  const accessUrl = `${process.env.APP_URL}/merci.html?token=${token}`;

  console.log(`🎁 Accès gratuit généré pour ${email}`);

  res.json({
    token,
    access_url: accessUrl,
    expires_in: `${ACCESS_DURATION_DAYS} jours`,
    email,
  });
});

// ─────────────────────────────────────────────
// ORS : Matrice de distance (protégée)
// ─────────────────────────────────────────────
app.post("/api/matrix/ors", requireAccess, async (req, res) => {
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
    metrics: ["distance", "duration"],
  };
  if (avoid_highways) {
    requestBody.options = { avoid_features: ["tollways"] };
  }
  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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

// ─────────────────────────────────────────────
// ORS : Itinéraire complet (protégé)
// ─────────────────────────────────────────────
app.post("/api/route/ors", requireAccess, async (req, res) => {
  const { source, destination, avoid_highways } = req.body;
  if (!source || !destination) {
    return res.status(400).json({ error: "Source et destination requises" });
  }
  const requestBody = { coordinates: [source, destination] };
  if (avoid_highways) {
    requestBody.options = { avoid_features: ["tollways"] };
  }
  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  });
}
module.exports = app;
