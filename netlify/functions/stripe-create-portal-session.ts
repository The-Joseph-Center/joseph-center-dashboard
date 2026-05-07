import Stripe from 'stripe';

interface RequestBody {
  customerId: string;
  returnUrl: string;
}

export async function handler(event: { body: string | null; headers: Record<string, string> }) {
  // Auth check — require Authorization header
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (event.body === null) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  const stripeConfig = process.env.STRIPE_CONFIG;
  if (!stripeConfig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(stripeConfig);
    const stripe = new Stripe(secretKey);
    const { customerId, returnUrl } = JSON.parse(event.body) as RequestBody;

    if (!customerId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing customerId' }) };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || process.env.URL || 'https://localhost:8888/billing',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, url: session.url }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Portal session error:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
