<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

/**
 * One finished month, written to be read by someone who does not work on the
 * website.
 *
 * A report is a snapshot: it is not recalculated when opened, because "how did
 * September go" should have one answer that survives being printed, forwarded
 * and come back to a fortnight later. The figures were settled when the report
 * was built.
 *
 * Capped narrow and printable on purpose — this is a document, and the thing
 * it is for is being taken into a meeting.
 */
interface Report {
  month: string;
  monthName: string;
  builtAt: number;
  summary: string[];
  visits?: {
    visits: number; previousVisits: number | null; pageviews: number;
    secondsPerVisit: number | null;
    days: { date: string; visits: number }[];
    topPages: { page: string; visits: number }[];
    sources: { source: string; visits: number }[];
  };
  submissions?: {
    byForm: { id: string; label: string; count: number; previous: number; unanswered: number }[];
    total: number;
  };
  speed?: { checkedAt: number; devices: { device: string; scores: Record<string, number> }[] };
  giving?: { total: number; gifts: number; donors: number; previousTotal: number | null };
  newsletter?: { month: string; tag: string; status: string; sentAt: number | null };
}

const months = ref<string[]>([]);
const month = ref('');
const report = ref<Report | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/reports${month.value ? `?month=${month.value}` : ''}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    months.value = d.months ?? [];
    report.value = d.report;
    if (!month.value && report.value) month.value = report.value.month;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the reports.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(month, (v, old) => { if (old && v !== old) load(); });

const label = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y!, mm! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const when = (seconds: number) => new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const bars = computed(() => {
  const days = report.value?.visits?.days ?? [];
  const peak = Math.max(1, ...days.map((d) => d.visits));
  return days.map((d) => ({ ...d, height: Math.max(2, Math.round((d.visits / peak) * 100)) }));
});

const timePerVisit = computed(() => {
  const s = report.value?.visits?.secondsPerVisit;
  if (!s) return null;
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
});

/** Google's own bands, so a score here means what it means in their report. */
/** The browser's own print dialog; the stylesheet does the rest. */
function printReport() {
  window.print();
}

const band = (score: number) => (score >= 90 ? 'good' : score >= 50 ? 'fair' : 'poor');
const SCORE_LABELS: Record<string, string> = {
  performance: 'Speed',
  accessibility: 'Access',
  bestPractices: 'Practices',
  seo: 'Search',
};
</script>

<template>
  <DashboardLayout page-title="Monthly reports">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <p v-else-if="!months.length" class="widget state">
      No reports yet. A report for each month is written early the following month and kept here.
    </p>

    <template v-else>
      <div class="widget bar no-print">
        <label class="bar__f">
          <span>Month</span>
          <select v-model="month">
            <option v-for="m in months" :key="m" :value="m">{{ label(m) }}</option>
          </select>
        </label>
        <span class="bar__spacer"></span>
        <button type="button" class="btn btn--sm" @click="printReport">Print or save as PDF</button>
      </div>

      <article v-if="report" class="report">
        <header class="report__head">
          <p class="report__kicker">The Joseph Center · monthly website report</p>
          <h2 class="report__month">{{ report.monthName }}</h2>
          <p class="report__built">Prepared {{ when(report.builtAt) }}</p>
        </header>

        <section v-if="report.summary.length" class="report__brief">
          <h3 class="report__h">The month in brief</h3>
          <p v-for="(line, i) in report.summary" :key="i" class="report__sentence">{{ line }}</p>
        </section>

        <section v-if="report.visits" class="report__section">
          <h3 class="report__h">Visits</h3>
          <p class="report__big">{{ report.visits.visits.toLocaleString() }} <span>visits</span></p>
          <p class="report__note">
            {{ report.visits.pageviews.toLocaleString() }} pages looked at<span v-if="timePerVisit">, {{ timePerVisit }} per visit</span>.
          </p>
          <div v-if="bars.length" class="report__chart" aria-hidden="true">
            <span v-for="d in bars" :key="d.date" class="report__bar" :style="{ height: `${d.height}%` }" />
          </div>
          <p v-if="bars.length" class="sr-only">Daily visits across {{ report.monthName }}.</p>

          <div class="report__cols">
            <div v-if="report.visits.topPages.length">
              <h4 class="report__h4">Pages people looked at</h4>
              <ul class="report__list">
                <li v-for="p in report.visits.topPages" :key="p.page">
                  <span>{{ p.page }}</span><span>{{ p.visits.toLocaleString() }}</span>
                </li>
              </ul>
            </div>
            <div v-if="report.visits.sources.length">
              <h4 class="report__h4">How people found us</h4>
              <ul class="report__list">
                <li v-for="s in report.visits.sources" :key="s.source">
                  <span>{{ s.source }}</span><span>{{ s.visits.toLocaleString() }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section v-if="report.submissions" class="report__section">
          <h3 class="report__h">People getting in touch</h3>
          <ul class="report__list">
            <li v-for="f in report.submissions.byForm" :key="f.id">
              <span>{{ f.label }}</span>
              <span>
                {{ f.count }}
                <em v-if="f.previous">(was {{ f.previous }})</em>
                <em v-if="f.unanswered" class="report__open">{{ f.unanswered }} with no reply recorded</em>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="report.giving" class="report__section">
          <h3 class="report__h">Giving through the website</h3>
          <p class="report__big">{{ money(report.giving.total) }}</p>
          <p class="report__note">
            {{ report.giving.gifts }} {{ report.giving.gifts === 1 ? 'gift' : 'gifts' }} from
            {{ report.giving.donors }} {{ report.giving.donors === 1 ? 'person' : 'people' }}<span
              v-if="report.giving.previousTotal !== null">, against {{ money(report.giving.previousTotal) }} the month before</span>.
          </p>
        </section>

        <section v-if="report.speed" class="report__section">
          <h3 class="report__h">Speed and quality</h3>
          <p class="report__note">Google's test of the home page, {{ when(report.speed.checkedAt) }}.</p>
          <div class="report__devices">
            <div v-for="d in report.speed.devices" :key="d.device" class="report__device">
              <p class="report__h4">{{ d.device === 'phone' ? 'On a phone' : 'On a computer' }}</p>
              <ul class="report__scores">
                <li v-for="(value, key) in d.scores" :key="key" :class="`score score--${band(value)}`">
                  <strong>{{ value }}</strong><span>{{ SCORE_LABELS[key] ?? key }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section v-if="report.newsletter" class="report__section">
          <h3 class="report__h">Newsletter</h3>
          <p class="report__note">
            <template v-if="report.newsletter.status === 'sent'">
              Sent{{ report.newsletter.sentAt ? ` ${when(report.newsletter.sentAt)}` : '' }}<span
                v-if="report.newsletter.tag"> under the tag {{ report.newsletter.tag }}</span>.
            </template>
            <template v-else>Not sent for this month.</template>
          </p>
        </section>
      </article>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.bar__f { display: flex; align-items: center; gap: .4rem; font-size: .75rem; color: var(--color-text-secondary); }
.bar__spacer { flex: 1; }
.state { color: var(--color-text-secondary); }
.state--err { color: #8a1f1f; }
.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .4rem .9rem; font-size: .8125rem; }
select { padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }

/* A document, not a dashboard: capped narrow so lines stay readable. */
.report { max-width: 1100px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 2rem; }
.report__head { border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; margin-bottom: 1.5rem; }
.report__kicker { margin: 0; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-secondary); }
.report__month { font-family: var(--font-heading); font-size: 2rem; margin: .2rem 0 0; }
.report__built { margin: .2rem 0 0; font-size: .8125rem; color: var(--color-text-secondary); }

.report__h { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .6rem; }
.report__h4 { font-size: .8125rem; font-weight: 700; margin: 0 0 .4rem; }
.report__section { margin-bottom: 2rem; }
.report__brief { margin-bottom: 2rem; }
.report__sentence { margin: 0 0 .4rem; font-size: 1rem; line-height: 1.6; }
.report__big { font-family: var(--font-heading); font-size: 2rem; margin: 0; line-height: 1.1; }
.report__big span { font-size: .9rem; font-weight: 400; color: var(--color-text-secondary); }
.report__note { margin: .25rem 0 .8rem; font-size: .8125rem; color: var(--color-text-secondary); }

.report__chart { display: flex; align-items: flex-end; gap: 2px; height: 70px; margin: 1rem 0; }
.report__bar { flex: 1; min-width: 2px; background: var(--color-primary); border-radius: 1px; opacity: .85; }

.report__cols { display: grid; gap: 1.5rem; margin-top: 1.2rem; }
@media (min-width: 760px) { .report__cols { grid-template-columns: 1fr 1fr; } }

.report__list { list-style: none; margin: 0; padding: 0; font-size: .875rem; }
.report__list li { display: flex; justify-content: space-between; gap: 1rem; padding: .3rem 0; border-bottom: 1px solid var(--color-border); }
.report__list em { display: block; font-style: normal; font-size: .75rem; color: var(--color-text-secondary); text-align: right; }
.report__open { color: #8a5a1f; }

.report__devices { display: grid; gap: 1rem; }
@media (min-width: 760px) { .report__devices { grid-template-columns: 1fr 1fr; } }
.report__scores { list-style: none; margin: 0; padding: 0; display: flex; gap: .75rem; flex-wrap: wrap; }
.score { display: flex; flex-direction: column; align-items: center; min-width: 3.4rem; padding: .45rem; border-radius: var(--border-radius); border: 1px solid var(--color-border); }
.score strong { font-size: 1.1rem; }
.score span { font-size: .7rem; color: var(--color-text-secondary); }
.score--good strong { color: #14532d; }
.score--fair strong { color: #8a5a1f; }
.score--poor strong { color: #8a1f1f; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Printed, this is the only thing on the page: no sidebar, no picker, white. */
@media print {
  .no-print { display: none !important; }
  .report { border: 0; padding: 0; max-width: none; background: #fff; color: #000; }
  .report__bar { background: #555; }
  .score { border-color: #999; }
}
</style>
