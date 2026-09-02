<script setup lang="ts">
/**
 * Candidate interview slots for one Coffee Chat applicant.
 *
 * Takes the days and times the guest said they could do, projects them forward
 * a few weeks, and checks each window against the configured calendars. The
 * point is to stop the two failure modes that happen by hand: proposing a slot
 * the guest never offered — 9/8 was a Tuesday when the guest had asked for
 * Wednesdays — and proposing one that is already booked.
 *
 * It proposes; it does not book. Nobody is emailed from here.
 */
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/api';

const props = defineProps<{ days: unknown; times: unknown; weeks?: number }>();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Afternoon (11a-2p)" -> { from: 11, to: 14 }. The label carries the hours. */
function parseWindow(label: string): { from: number; to: number } | null {
  const m = label.match(/\((\d{1,2})(?::(\d{2}))?\s*([ap])?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?/i);
  if (!m) return null;
  const hour = (h: string | undefined, mer?: string, fallback?: string) => {
    if (!h) return NaN;
    let v = Number(h);
    const suffix = (mer || fallback || '').toLowerCase();
    if (suffix === 'p' && v < 12) v += 12;
    if (suffix === 'a' && v === 12) v = 0;
    return v;
  };
  // "9-11a" gives no meridiem on the first number; it inherits the second's.
  const to = hour(m[4], m[6]);
  const from = hour(m[1], m[3], m[6]);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
  }
  return typeof v === 'string' && v.trim() ? [v] : [];
};

const dayList = computed(() => asList(props.days));
const timeList = computed(() => asList(props.times));
interface Window { label: string; win: { from: number; to: number } }
const windows = computed<Window[]>(() =>
  timeList.value
    .map((t) => ({ label: t, win: parseWindow(t) }))
    .filter((w): w is Window => w.win !== null)
);

interface Slot { startsAt: Date; endsAt: Date; label: string; state: 'free' | 'busy' | 'unknown'; }
const slots = ref<Slot[]>([]);
const loading = ref(false);
const error = ref('');
const unreadable = ref<string[]>([]);
const checked = ref(false);

/** The next few dates matching the guest's chosen weekdays. */
function candidateDates(): Date[] {
  const wanted = new Set(dayList.value.map((d) => DAYS.indexOf(d)).filter((i) => i >= 0));
  if (!wanted.size) return [];
  const out: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);          // never propose today
  const limit = (props.weeks ?? 4) * 7;
  for (let i = 0; i < limit && out.length < 8; i++) {
    if (wanted.has(cursor.getDay())) out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

async function check() {
  loading.value = true; error.value = ''; checked.value = true; unreadable.value = [];
  try {
    const dates = candidateDates();
    if (!dates.length || !windows.value.length) { slots.value = []; return; }

    const proposed: Slot[] = [];
    for (const d of dates) {
      for (const { label, win } of windows.value) {
        const startsAt = new Date(d); startsAt.setHours(win.from, 0, 0, 0);
        const endsAt = new Date(d); endsAt.setHours(win.to, 0, 0, 0);
        proposed.push({ startsAt, endsAt, label, state: 'unknown' });
      }
    }
    proposed.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const first = proposed[0];
    const last = proposed[proposed.length - 1];
    if (!first || !last) { slots.value = []; return; }
    const from = first.startsAt;
    const to = last.endsAt;
    const res = await apiFetch(
      `/.netlify/functions/calendar-availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));

    if (d.configured === false) { error.value = d.reason || 'No calendars configured.'; slots.value = proposed; return; }
    unreadable.value = d.unreadable ?? [];

    const busy: [number, number][] = (d.busy ?? []).map(
      (b: { start: string; end: string }) => [Date.parse(b.start), Date.parse(b.end)]
    );

    for (const slot of proposed) {
      const a = slot.startsAt.getTime(), z = slot.endsAt.getTime();
      // Overlap, not containment: a meeting from 11:30 to 12:00 makes an
      // 11:00-14:00 window unusable as a whole.
      slot.state = busy.some(([bs, be]) => bs < z && be > a) ? 'busy' : 'free';
    }
    slots.value = proposed;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not check availability.';
  } finally {
    loading.value = false;
  }
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'numeric', day: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const freeCount = computed(() => slots.value.filter((s) => s.state === 'free').length);
</script>

<template>
  <div class="sched">
    <h3 class="sched__title">Finding a time</h3>

    <p v-if="!dayList.length || !windows.length" class="sched__note">
      This applicant didn’t give both a day and a time, so there’s nothing to check against.
    </p>

    <template v-else>
      <p class="sched__note">
        They asked for <strong>{{ dayList.join(', ') }}</strong>, {{ timeList.join(' or ') }}.
      </p>

      <button type="button" class="btn btn--sm" :disabled="loading" @click="check">
        {{ loading ? 'Checking…' : checked ? 'Check again' : 'Check the calendars' }}
      </button>

      <p v-if="error" class="sched__err" role="alert">{{ error }}</p>

      <p v-if="unreadable.length" class="sched__err">
        Could not read {{ unreadable.join(', ') }} — those are not counted, so a slot shown as open
        may not be.
      </p>

      <template v-if="slots.length">
        <p class="sched__note">
          {{ freeCount }} of {{ slots.length }} windows they offered are clear.
        </p>
        <ul class="slots">
          <li v-for="s in slots" :key="s.startsAt.toISOString()" :class="`slot slot--${s.state}`">
            <span class="slot__when">{{ fmtDay(s.startsAt) }}</span>
            <span class="slot__time">{{ fmtTime(s.startsAt) }}–{{ fmtTime(s.endsAt) }}</span>
            <span class="slot__state">{{ s.state === 'free' ? 'clear' : s.state === 'busy' ? 'busy' : '—' }}</span>
          </li>
        </ul>
        <p class="sched__note sched__note--quiet">
          Free/busy only — no titles or attendees. Proposing a time is still a conversation with the
          guest and with Mona; nothing here books or emails anyone.
        </p>
      </template>
      <p v-else-if="checked && !loading && !error" class="sched__note">
        No dates in the next {{ props.weeks ?? 4 }} weeks match what they offered.
      </p>
    </template>
  </div>
</template>

<style scoped>
.sched { margin-top: 1rem; padding-top: .85rem; border-top: 1px solid var(--color-border); }
.sched__title { font-family: var(--font-heading); font-size: .7rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin: 0 0 .4rem; }
.sched__note { font-size: .8125rem; color: var(--color-text); margin: 0 0 .6rem; }
.sched__note--quiet { color: var(--color-text-secondary); font-size: .75rem; margin-top: .6rem; }
.sched__err { font-size: .8125rem; color: #8a1f1f; margin: .5rem 0 0; }
.slots { list-style: none; margin: .7rem 0 0; padding: 0; display: grid; gap: .25rem; max-width: 32rem; }
.slot { display: flex; gap: .6rem; align-items: baseline; font-size: .8125rem; padding: .3rem .5rem; border-radius: var(--border-radius); border: 1px solid var(--color-border); }
.slot__when { flex: 1 1 auto; }
.slot__time { color: var(--color-text-secondary); font-size: .75rem; }
.slot__state { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; }
.slot--free { border-color: color-mix(in srgb, #1f6b3a 45%, transparent); }
.slot--free .slot__state { color: #1f6b3a; }
.slot--busy { opacity: .6; }
.slot--busy .slot__state { color: #8a1f1f; }
</style>
