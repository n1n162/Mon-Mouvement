// api/stripe/webhook.js
// Webhook Stripe → met à jour Clerk quand paiement réussi

import Stripe from 'stripe';
import { createClerkClient } from '@clerk/backend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature invalide:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Paiement réussi
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Récupérer l'ID Clerk passé en client_reference_id
    const clerkUserId = session.client_reference_id;
    if (!clerkUserId) {
      console.error('Pas de client_reference_id dans la session');
      return res.status(200).json({ received: true });
    }

    // Calculer la date d'expiration (1 an)
    const premiumUntil = new Date();
    premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);

    try {
      // Mettre à jour les métadonnées Clerk
      await clerk.users.updateUserMetadata(clerkUserId, {
        publicMetadata: {
          isPremium: true,
          premiumUntil: premiumUntil.toISOString(),
          stripeSessionId: session.id,
          paidAt: new Date().toISOString(),
        }
      });
      console.log(`Utilisateur ${clerkUserId} mis en premium jusqu'au ${premiumUntil.toISOString()}`);
    } catch (err) {
      console.error('Erreur mise à jour Clerk:', err.message);
      return res.status(500).json({ error: 'Erreur mise à jour utilisateur' });
    }
  }

  return res.status(200).json({ received: true });
}
