// api/stripe/create-checkout.js
// Crée une session Stripe Checkout et redirige l'utilisateur

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId requis' });
  }

  // Ton lien de paiement Stripe avec client_reference_id pour identifier l'utilisateur
  const stripePaymentLink = 'https://buy.stripe.com/cNiaEX8YL6OvcngeY3grS0e';
  const redirectUrl = `${stripePaymentLink}?client_reference_id=${encodeURIComponent(userId)}`;

  return res.redirect(302, redirectUrl);
}
