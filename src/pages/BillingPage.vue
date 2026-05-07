<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth0 } from '@auth0/auth0-vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  CreditCard,
  Clock,
  Receipt,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-vue-next';
import config from '@/config/dashboard';

const { getAccessTokenSilently } = useAuth0();

const billing = config.billing;
const loading = ref(true);
const error = ref<string | null>(null);

interface Subscription {
  id: string;
  status: string;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
  nextBillingDate: number | null;
  cancelAtPeriodEnd: boolean;
}

interface Invoice {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  description: string | null;
  created: number;
  dueDate?: number | null;
  paidAt?: number | null;
  hostedInvoiceUrl: string | null;
  invoicePdf?: string | null;
}

interface PaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

const subscription = ref<Subscription | null>(null);
const pendingCharges = ref<Invoice[]>([]);
const recentPayments = ref<Invoice[]>([]);
const paymentMethod = ref<PaymentMethod | null>(null);
const portalLoading = ref(false);

function formatCurrency(amount: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchBillingSummary() {
  if (!billing?.stripeCustomerId) return;

  loading.value = true;
  error.value = null;

  try {
    const token = await getAccessTokenSilently();
    const res = await fetch(
      `/.netlify/functions/stripe-get-billing-summary?customerId=${billing.stripeCustomerId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) throw new Error('Failed to load billing data');

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    subscription.value = data.subscription;
    pendingCharges.value = data.pendingCharges || [];
    recentPayments.value = data.recentPayments || [];
    paymentMethod.value = data.paymentMethod;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load billing data';
  } finally {
    loading.value = false;
  }
}

async function openPortal() {
  if (!billing?.stripeCustomerId) return;

  portalLoading.value = true;
  try {
    const token = await getAccessTokenSilently();
    const res = await fetch('/.netlify/functions/stripe-create-portal-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: billing.stripeCustomerId,
        returnUrl: window.location.href,
      }),
    });

    const data = await res.json();
    if (data.success && data.url) {
      window.open(data.url, '_blank');
    } else {
      throw new Error(data.error || 'Could not create portal session');
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to open billing portal';
  } finally {
    portalLoading.value = false;
  }
}

onMounted(fetchBillingSummary);
</script>

<template>
  <DashboardLayout page-title="Billing">
    <!-- Not configured -->
    <div v-if="!billing?.stripeCustomerId" class="billing-placeholder">
      <CreditCard :size="48" class="billing-placeholder__icon" />
      <h2>Billing Not Configured</h2>
      <p>Billing has not been set up for this dashboard yet. Contact your web administrator for assistance.</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="billing-loading">
      <Loader2 :size="32" class="billing-loading__spinner" />
      <p>Loading billing information...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="billing-error">
      <AlertCircle :size="20" />
      <span>{{ error }}</span>
      <button class="billing-btn billing-btn--secondary" @click="fetchBillingSummary">
        <RefreshCw :size="16" />
        Retry
      </button>
    </div>

    <!-- Billing Content -->
    <div v-else class="billing-grid">
      <!-- Subscription Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <CreditCard :size="20" />
          <h3>Subscription</h3>
        </div>

        <div v-if="subscription" class="billing-card__body">
          <div class="billing-detail">
            <span class="billing-detail__label">Plan</span>
            <span class="billing-detail__value">{{ subscription.planName }}</span>
          </div>
          <div class="billing-detail">
            <span class="billing-detail__label">Status</span>
            <span class="billing-badge" :class="`billing-badge--${subscription.status}`">
              <CheckCircle v-if="subscription.status === 'active'" :size="14" />
              <AlertCircle v-else-if="subscription.status === 'past_due'" :size="14" />
              <XCircle v-else-if="subscription.status === 'canceled'" :size="14" />
              {{ capitalizeFirst(subscription.status.replace('_', ' ')) }}
            </span>
          </div>
          <div class="billing-detail">
            <span class="billing-detail__label">Amount</span>
            <span class="billing-detail__value">
              {{ formatCurrency(subscription.amount, subscription.currency) }}/{{ subscription.interval }}
            </span>
          </div>
          <div v-if="subscription.nextBillingDate" class="billing-detail">
            <span class="billing-detail__label">Next Billing</span>
            <span class="billing-detail__value">{{ formatDate(subscription.nextBillingDate) }}</span>
          </div>
          <div v-if="subscription.cancelAtPeriodEnd" class="billing-notice billing-notice--warning">
            Subscription will cancel at end of current period
          </div>

          <button class="billing-btn billing-btn--primary" :disabled="portalLoading" @click="openPortal">
            <Loader2 v-if="portalLoading" :size="16" class="billing-loading__spinner" />
            <ExternalLink v-else :size="16" />
            Manage Subscription
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No active subscription</p>
        </div>
      </div>

      <!-- Pending Charges Card -->
      <div v-if="billing.showPendingCharges" class="billing-card">
        <div class="billing-card__header">
          <Clock :size="20" />
          <h3>Pending Charges</h3>
        </div>

        <div v-if="pendingCharges.length > 0" class="billing-card__body">
          <div v-for="charge in pendingCharges" :key="charge.id" class="billing-invoice-row">
            <div class="billing-invoice-row__info">
              <span class="billing-invoice-row__amount">{{ formatCurrency(charge.amount, charge.currency) }}</span>
              <span class="billing-invoice-row__desc">{{ charge.description || charge.number || 'Invoice' }}</span>
              <span class="billing-invoice-row__date">
                {{ charge.dueDate ? `Due ${formatDate(charge.dueDate)}` : formatDate(charge.created) }}
              </span>
            </div>
            <a
              v-if="charge.hostedInvoiceUrl"
              :href="charge.hostedInvoiceUrl"
              target="_blank"
              rel="noopener"
              class="billing-btn billing-btn--primary billing-btn--sm"
            >
              Pay Now
              <ExternalLink :size="14" />
            </a>
          </div>
        </div>

        <div v-else class="billing-card__empty">
          <p>No pending charges</p>
        </div>
      </div>

      <!-- Recent Payments Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <Receipt :size="20" />
          <h3>Recent Payments</h3>
        </div>

        <div v-if="recentPayments.length > 0" class="billing-card__body">
          <div v-for="payment in recentPayments" :key="payment.id" class="billing-invoice-row">
            <div class="billing-invoice-row__info">
              <span class="billing-invoice-row__amount">{{ formatCurrency(payment.amount, payment.currency) }}</span>
              <span class="billing-invoice-row__desc">{{ payment.description || payment.number || 'Payment' }}</span>
              <span class="billing-invoice-row__date">
                {{ payment.paidAt ? formatDate(payment.paidAt) : formatDate(payment.created) }}
              </span>
            </div>
            <div class="billing-invoice-row__actions">
              <span class="billing-badge billing-badge--active">Paid</span>
              <a
                v-if="payment.invoicePdf"
                :href="payment.invoicePdf"
                target="_blank"
                rel="noopener"
                class="billing-icon-btn"
                title="Download PDF"
              >
                <Receipt :size="16" />
              </a>
            </div>
          </div>

          <button class="billing-btn billing-btn--secondary billing-btn--full" @click="openPortal">
            <ExternalLink :size="16" />
            View All Invoices
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No payments yet</p>
        </div>
      </div>

      <!-- Payment Method Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <CreditCard :size="20" />
          <h3>Payment Method</h3>
        </div>

        <div v-if="paymentMethod" class="billing-card__body">
          <div class="billing-payment-method">
            <div class="billing-payment-method__card">
              <CreditCard :size="24" />
              <div>
                <span class="billing-payment-method__brand">{{ capitalizeFirst(paymentMethod.brand) }}</span>
                <span class="billing-payment-method__number">&bull;&bull;&bull;&bull; {{ paymentMethod.last4 }}</span>
              </div>
            </div>
            <span class="billing-payment-method__exp">
              Expires {{ String(paymentMethod.expMonth).padStart(2, '0') }}/{{ paymentMethod.expYear }}
            </span>
          </div>

          <button class="billing-btn billing-btn--secondary" @click="openPortal">
            <ExternalLink :size="16" />
            Update Payment Method
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No payment method on file</p>
          <button class="billing-btn billing-btn--primary" @click="openPortal">
            <CreditCard :size="16" />
            Add Payment Method
          </button>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.billing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1.25rem;
}

.billing-card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.billing-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.billing-card__header h3 {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.billing-card__body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.billing-card__empty {
  padding: 2rem 1.25rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.billing-card__empty p {
  margin: 0;
}

/* Details */
.billing-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.billing-detail__label {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
}

.billing-detail__value {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

/* Badges */
.billing-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
}

.billing-badge--active {
  background-color: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.billing-badge--past_due {
  background-color: rgba(245, 158, 11, 0.12);
  color: #d97706;
}

.billing-badge--canceled,
.billing-badge--incomplete_expired {
  background-color: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.billing-badge--trialing {
  background-color: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
}

/* Invoice rows */
.billing-invoice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
}

.billing-invoice-row__info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.billing-invoice-row__amount {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-text);
}

.billing-invoice-row__desc {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.billing-invoice-row__date {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.billing-invoice-row__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Payment method */
.billing-payment-method {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
}

.billing-payment-method__card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text);
}

.billing-payment-method__card > div {
  display: flex;
  flex-direction: column;
}

.billing-payment-method__brand {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.billing-payment-method__number {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  letter-spacing: 0.05em;
}

.billing-payment-method__exp {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Buttons */
.billing-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
  text-decoration: none;
}

.billing-btn:hover {
  opacity: 0.85;
}

.billing-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.billing-btn--primary {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.billing-btn--secondary {
  background-color: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.billing-btn--sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
}

.billing-btn--full {
  width: 100%;
}

.billing-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border-radius: var(--border-radius);
  color: var(--color-text-secondary);
  transition: background-color 0.15s ease;
}

.billing-icon-btn:hover {
  background-color: var(--color-border);
}

/* Notice */
.billing-notice {
  font-size: 0.8125rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--border-radius);
}

.billing-notice--warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

/* States */
.billing-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.billing-placeholder__icon {
  opacity: 0.3;
}

.billing-placeholder h2 {
  font-family: var(--font-heading);
  color: var(--color-text);
  margin: 0;
}

.billing-placeholder p {
  max-width: 400px;
  line-height: 1.5;
}

.billing-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  color: var(--color-text-secondary);
}

.billing-loading__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.billing-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: var(--border-radius);
  background-color: rgba(239, 68, 68, 0.08);
  color: #dc2626;
  font-size: 0.875rem;
}
</style>
