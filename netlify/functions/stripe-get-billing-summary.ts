import Stripe from 'stripe';
import { requireCapability, denial } from './_lib/verify-okta';

interface BillingSummary {
  subscription: {
    id: string;
    status: string;
    planName: string;
    amount: number;
    currency: string;
    interval: string;
    nextBillingDate: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  // How the client is actually billed when there is no card subscription.
  arrangement: {
    amount: number; currency: string; interval: string;
    method: string; lastInvoiced: number | null; lastPaidAt: number | null;
  } | null;

  pendingCharges: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    dueDate: number | null;
    hostedInvoiceUrl: string | null;
  }>;
  recentPayments: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    paidAt: number | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

export async function handler(event: { queryStringParameters: Record<string, string> | null; headers: Record<string, string> }) {
  const auth = await requireCapability(event.headers, 'billing');
  if (!auth.ok) return denial(auth);

  const customerId = event.queryStringParameters?.customerId;
  if (!customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customerId' }) };
  }

  const stripeConfig = process.env.STRIPE_CONFIG;
  if (!stripeConfig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(stripeConfig);
    const stripe = new Stripe(secretKey);

    // Fetch customer with default payment method expanded
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });

    if (customer.deleted) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    }

    // Only genuinely current subscriptions. Listing status:'all' and taking
    // data[0] surfaced a subscription cancelled in 2022 as though it were the
    // live arrangement — this client is billed by invoice, not by card.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
      expand: ['data.default_payment_method'],
    });
    const current = subscriptions.data.filter((s) =>
      ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)
    );

    let subscription: BillingSummary['subscription'] = null;
    if (current.length > 0) {
      const sub = current[0];
      const item = sub.items.data[0];
      // Fetch product name separately to avoid deep expand
      let productName = 'Subscription';
      if (item?.price?.product) {
        const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
        try {
          const product = await stripe.products.retrieve(productId);
          productName = product.name;
        } catch { /* fallback to default */ }
      }

      subscription = {
        id: sub.id,
        status: sub.status,
        planName: productName,
        amount: item?.price?.unit_amount || 0,
        currency: item?.price?.currency || 'usd',
        interval: item?.price?.recurring?.interval || 'month',
        nextBillingDate: (sub as any).current_period_end ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    }

    // Fetch open invoices (pending charges)
    const openInvoices = await stripe.invoices.list({
      customer: customerId,
      status: 'open',
      limit: 10,
    });

    const pendingCharges: BillingSummary['pendingCharges'] = openInvoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_due,
      currency: inv.currency,
      description: inv.description,
      created: inv.created,
      dueDate: inv.due_date,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    }));

    // Fetch recent paid invoices
    const paidInvoices = await stripe.invoices.list({
      customer: customerId,
      status: 'paid',
      limit: 10,
    });

    const recentPayments: BillingSummary['recentPayments'] = paidInvoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_paid,
      currency: inv.currency,
      description: inv.description,
      created: inv.created,
      paidAt: inv.status_transitions?.paid_at ?? null,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));

    // ── Invoice-based arrangement ──
    // Some clients are invoiced and pay by cheque rather than carrying a card
    // subscription. Where that is the case there is no Stripe subscription to
    // report, but there IS a real recurring arrangement — derive it from the
    // paid invoice history so the page reflects how the client is actually
    // billed instead of showing nothing.
    let arrangement: {
      amount: number; currency: string; interval: string;
      method: string; lastInvoiced: number | null; lastPaidAt: number | null;
    } | null = null;

    // Anchored on the Price the client is actually on, not inferred from
    // invoice history. Older accounts accumulate one-off and abandoned invoices,
    // and guessing a cadence from them is how a stale figure ends up on a page
    // presented as current.
    const BILLING_PRICE_ID = process.env.BILLING_PRICE_ID;
    if (!subscription && BILLING_PRICE_ID) {
      try {
        const price = await stripe.prices.retrieve(BILLING_PRICE_ID);
        // Invoices generated from this price tell us when it was last billed.
        const fromPrice = paidInvoices.data.find((inv) =>
          inv.lines?.data?.some((l) => (l as { price?: { id?: string } }).price?.id === BILLING_PRICE_ID)
        );
        arrangement = {
          amount: price.unit_amount ?? 0,
          currency: price.currency,
          interval: price.recurring?.interval ?? 'month',
          method: 'invoice',
          lastInvoiced: fromPrice?.created ?? paidInvoices.data[0]?.created ?? null,
          lastPaidAt: fromPrice?.status_transitions?.paid_at ?? paidInvoices.data[0]?.status_transitions?.paid_at ?? null,
        };
      } catch (err) {
        console.warn('billing: BILLING_PRICE_ID could not be read:', err);
      }
    }


    // Default payment method
    let paymentMethod: BillingSummary['paymentMethod'] = null;
    const defaultPM = customer.invoice_settings?.default_payment_method;
    if (defaultPM && typeof defaultPM === 'object' && 'card' in defaultPM && defaultPM.card) {
      paymentMethod = {
        brand: defaultPM.card.brand || 'unknown',
        last4: defaultPM.card.last4 || '****',
        expMonth: defaultPM.card.exp_month || 0,
        expYear: defaultPM.card.exp_year || 0,
      };
    }

    const summary: BillingSummary = {
      subscription,
      arrangement,
      pendingCharges,
      recentPayments,
      paymentMethod,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, ...summary }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Billing summary error:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
