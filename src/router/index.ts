import { createRouter, createWebHistory } from 'vue-router';
import { LoginCallback } from '@okta/okta-vue';
import { oktaAuth, groupsFromClaims } from '@/lib/okta';
import { hasCapability, type Capability } from '@/lib/capabilities';

const DashboardHome = () => import('@/pages/DashboardHome.vue');
const AnalyticsPage = () => import('@/pages/AnalyticsPage.vue');
const SupportPage = () => import('@/pages/SupportPage.vue');
const BillingPage = () => import('@/pages/BillingPage.vue');
const LoginPage = () => import('@/pages/LoginPage.vue');
const ForbiddenPage = () => import('@/pages/ForbiddenPage.vue');
const NotFound = () => import('@/pages/NotFound.vue');

const routes = [
  { path: '/', name: 'Dashboard', component: DashboardHome },
  { path: '/analytics', name: 'Analytics', component: AnalyticsPage, meta: { capability: 'analytics' } },
  { path: '/support', name: 'Support', component: SupportPage },
  // Admin-only. The guard below hides it; the billing Functions verify the same
  // group server-side, which is what actually protects it.
  { path: '/billing', name: 'Billing', component: BillingPage, meta: { capability: 'billing' } },

  // Public — no auth required.
  { path: '/login', name: 'Login', component: LoginPage, meta: { public: true } },
  { path: '/login/callback', component: LoginCallback, meta: { public: true } },
  { path: '/forbidden', name: 'Forbidden', component: ForbiddenPage, meta: { public: true } },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound, meta: { public: true } },
];

// Development-only identity view. Token Preview is unavailable on this Okta
// tenant, so this is how the groups claim gets verified at first login. Tree
// shaken out of the production bundle by the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  routes.splice(routes.length - 1, 0, {
    path: '/whoami',
    name: 'WhoAmI',
    component: () => import('@/pages/WhoAmIPage.vue'),
  } as (typeof routes)[number]);
}

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  if (!(await oktaAuth.isAuthenticated())) {
    // Remember where they were headed so the callback can return them there.
    sessionStorage.setItem('postLoginUri', to.fullPath);
    return { path: '/login' };
  }

  const needed = to.meta.capability as Capability | undefined;
  if (needed) {
    const claims = await oktaAuth.getUser().catch(() => undefined);
    const groups = groupsFromClaims(claims as Record<string, unknown> | undefined);
    if (!hasCapability(groups, needed)) return { path: '/forbidden' };
  }

  return true;
});

export default router;
