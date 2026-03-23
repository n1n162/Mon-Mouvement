const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());

// ⚠️ Le webhook Stripe DOIT être avant express.json
app.use("/api/webhook/stripe", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static("public"));

// ─────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Clerk = require("@clerk/clerk-sdk-node");

const clerkClient = Clerk.createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const ACCESS_DURATION_DAYS = 365;

// ─────────────────────────────────────────────
// MIDDLEWARE : vérification session Clerk
// ─────────────────────────────────────────────
async function requireAccess(req, res, next) {
  const sessionToken = req.headers["authorization"]?.split(" ")[1];

  if (!sessionToken) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const payload = await clerkClient.verifyToken(sessionToken);
    const userId = payload.sub;
    const user = await clerkClient.users.getUser(userId);
    const accessUntil = user.publicMetadata?.accessUntil;

    if (!accessUntil || new Date(accessUntil) < new Date()) {
      return res.status(403).json({ error: "Accès expiré ou non payé" });
    }

    req.userId = userId;
    req.user = user;
    next();
  } catch (err) {
    console.error("❌ Erreur auth Clerk :", err.message);
    return res.status(401).json({ error: "Token invalide" });
  }
}

// ─────────────────────────────────────────────
// CLERK : vérifier le statut d'accès
// ─────────────────────────────────────────────
app.get("/api/check-access", async (req, res) => {
  const sessionToken = req.headers["authorization"]?.split(" ")[1];

  if (!sessionToken) return res.json({ hasAccess: false, reason: "not_authenticated" });

  try {
    const payload = await clerkClient.verifyToken(sessionToken);
    const user = await clerkClient.users.getUser(payload.sub);
    const accessUntil = user.publicMetadata?.accessUntil;

    if (!accessUntil || new Date(accessUntil) < new Date()) {
      return res.json({ hasAccess: false, reason: "not_paid" });
    }

    return res.json({ hasAccess: true, accessUntil });
  } catch (err) {
    return res.json({ hasAccess: false, reason: "invalid_token" });
  }
});

// ─────────────────────────────────────────────
// STRIPE : créer une session de paiement
// ─────────────────────────────────────────────
app.get("/api/create-checkout", async (req, res) => {
  const sessionToken = req.headers["authorization"]?.split(" ")[1];
  let userId = null;
  let userEmail = null;

  if (sessionToken) {
    try {
      const payload = await clerkClient.verifyToken(sessionToken);
      userId = payload.sub;
      const user = await clerkClient.users.getUser(userId);
      userEmail = user.emailAddresses?.[0]?.emailAddress;
    } catch (e) {}
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "payment",
      customer_email: userEmail || undefined,
      metadata: { clerk_user_id: userId || "" },
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
    const userId = session.metadata?.clerk_user_id;

    if (userId) {
      const accessUntil = new Date(
        Date.now() + ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata: { accessUntil },
      });

      console.log(`✅ Accès activé pour ${userId} jusqu'au ${accessUntil}`);
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────
// ADMIN : donner un accès gratuit
// POST /api/admin/grant-access { password, email }
// ─────────────────────────────────────────────
app.post("/api/admin/grant-access", async (req, res) => {
  const { password, email } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe admin incorrect" });
  }

  if (!email) return res.status(400).json({ error: "Email requis" });

  try {
    const users = await clerkClient.users.getUserList({ emailAddress: [email] });

    if (!users.data || users.data.length === 0) {
      return res.status(404).json({
        error: `Aucun compte trouvé pour ${email}. L'utilisateur doit d'abord se connecter sur l'app.`,
      });
    }

    const user = users.data[0];
    const accessUntil = new Date(
      Date.now() + ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    await clerkClient.users.updateUserMetadata(user.id, {
      publicMetadata: { accessUntil },
    });

    res.json({ success: true, email, accessUntil });
  } catch (err) {
    console.error("❌ Erreur admin :", err);
    res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
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
  if (avoid_highways) requestBody.options = { avoid_features: ["tollways"] };

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: { Authorization: process.env.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!orsRes.ok) throw new Error(`ORS Matrix ${orsRes.status}: ${await orsRes.text()}`);
    res.json(await orsRes.json());
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
  if (avoid_highways) requestBody.options = { avoid_features: ["tollways"] };

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { Authorization: process.env.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!orsRes.ok) throw new Error(`ORS Directions ${orsRes.status}: ${await orsRes.text()}`);
    res.json(await orsRes.json());
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
