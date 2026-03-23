const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use("/api/webhook/stripe", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static("public"));

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const ACCESS_DURATION_DAYS = 365;

// ─────────────────────────────────────────────
// Auth0 JWT verification
// ─────────────────────────────────────────────
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyAuth0Token(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience: process.env.AUTH0_CLIENT_ID,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

// In-memory store pour les accès (remplacé par un fichier JSON simple)
const fs = require("fs");
const ACCESS_FILE = "/tmp/access.json";

function loadAccess() {
  try {
    if (fs.existsSync(ACCESS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8"));
    }
  } catch (e) {}
  return {};
}

function saveAccess(data) {
  try {
    fs.writeFileSync(ACCESS_FILE, JSON.stringify(data), "utf8");
  } catch (e) {}
}

// ─────────────────────────────────────────────
// MIDDLEWARE : vérification Auth0 token
// ─────────────────────────────────────────────
async function requireAccess(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Non authentifié" });

  try {
    const decoded = await verifyAuth0Token(token);
    const userId = decoded.sub;
    const access = loadAccess();
    const userAccess = access[userId];

    if (!userAccess || new Date(userAccess.accessUntil) < new Date()) {
      return res.status(403).json({ error: "Accès expiré ou non payé" });
    }

    req.userId = userId;
    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// ─────────────────────────────────────────────
// CHECK ACCESS
// ─────────────────────────────────────────────
app.get("/api/check-access", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.json({ hasAccess: false, reason: "not_authenticated" });

  try {
    const decoded = await verifyAuth0Token(token);
    const userId = decoded.sub;
    const access = loadAccess();
    const userAccess = access[userId];

    if (!userAccess || new Date(userAccess.accessUntil) < new Date()) {
      return res.json({ hasAccess: false, reason: "not_paid" });
    }

    return res.json({ hasAccess: true, accessUntil: userAccess.accessUntil });
  } catch (err) {
    return res.json({ hasAccess: false, reason: "invalid_token" });
  }
});

// ─────────────────────────────────────────────
// STRIPE : créer une session de paiement
// ─────────────────────────────────────────────
app.get("/api/create-checkout", async (req, res) => {
  const token = req.query.token;
  let userId = null;
  let userEmail = null;

  if (token) {
    try {
      const decoded = await verifyAuth0Token(token);
      userId = decoded.sub;
      userEmail = decoded.email;
    } catch (e) {}
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "payment",
      customer_email: userEmail || undefined,
      metadata: { auth0_user_id: userId || "" },
      success_url: `${process.env.APP_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/pricing.html`,
    });
    res.redirect(303, session.url);
  } catch (err) {
    console.error("❌ Erreur Stripe :", err);
    res.status(500).json({ error: "Erreur paiement" });
  }
});

// ─────────────────────────────────────────────
// STRIPE : webhook
// ─────────────────────────────────────────────
app.post("/api/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.auth0_user_id;

    if (userId) {
      const accessUntil = new Date(
        Date.now() + ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const access = loadAccess();
      access[userId] = { accessUntil, email: session.customer_details?.email };
      saveAccess(access);

      console.log(`✅ Accès activé pour ${userId} jusqu'au ${accessUntil}`);
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────
// STRIPE : confirmer paiement
// ─────────────────────────────────────────────
app.get("/api/confirm-payment", async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "session_id manquant" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Paiement non confirmé" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────
// ADMIN : accès gratuit
// POST /api/admin/grant-access { password, auth0_user_id, email }
// ─────────────────────────────────────────────
app.post("/api/admin/grant-access", (req, res) => {
  const { password, auth0_user_id, email } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe admin incorrect" });
  }
  if (!auth0_user_id) return res.status(400).json({ error: "auth0_user_id requis" });

  const accessUntil = new Date(
    Date.now() + ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const access = loadAccess();
  access[auth0_user_id] = { accessUntil, email: email || "" };
  saveAccess(access);

  res.json({ success: true, auth0_user_id, accessUntil });
});

// ─────────────────────────────────────────────
// ORS (protégées)
// ─────────────────────────────────────────────
app.post("/api/matrix/ors", requireAccess, async (req, res) => {
  const { coordinates, avoid_highways } = req.body;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(400).json({ error: "Requête incomplète" });
  }
  const requestBody = {
    locations: coordinates,
    sources: [0],
    destinations: coordinates.slice(1).map((_, i) => i + 1),
    metrics: ["distance", "duration"],
  };
  if (avoid_highways) requestBody.options = { avoid_features: ["tollways"] };

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: { Authorization: process.env.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!orsRes.ok) throw new Error(await orsRes.text());
    res.json(await orsRes.json());
  } catch (err) {
    res.status(500).json({ error: "Erreur ORS Matrix", details: err.message });
  }
});

app.post("/api/route/ors", requireAccess, async (req, res) => {
  const { source, destination, avoid_highways } = req.body;
  if (!source || !destination) return res.status(400).json({ error: "Source et destination requises" });

  const requestBody = { coordinates: [source, destination] };
  if (avoid_highways) requestBody.options = { avoid_features: ["tollways"] };

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { Authorization: process.env.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!orsRes.ok) throw new Error(await orsRes.text());
    res.json(await orsRes.json());
  } catch (err) {
    res.status(500).json({ error: "Erreur ORS Directions", details: err.message });
  }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Serveur sur http://localhost:${PORT}`));
}
module.exports = app;
