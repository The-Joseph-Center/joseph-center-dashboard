import { watch } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { useAuth0 } from '@auth0/auth0-vue';

const DashboardHome = () => import('@/pages/DashboardHome.vue');
const AnalyticsPage = () => import('@/pages/AnalyticsPage.vue');
const ContentKitPage = () => import('@/pages/ContentKitPage.vue');
const SupportPage = () => import('@/pages/SupportPage.vue');
const BillingPage = () => import('@/pages/BillingPage.vue');
const NotFound = () => import('@/pages/NotFound.vue');

const routes = [
  { path: '/', name: 'Dashboard', component: DashboardHome },
  { path: '/analytics', name: 'Analytics', component: AnalyticsPage },
  { path: '/content-kit', name: 'ContentKit', component: ContentKitPage },
  { path: '/support', name: 'Support', component: SupportPage },
  { path: '/billing', name: 'Billing', component: BillingPage },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  if (isLoading.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(isLoading, (loading) => {
        if (!loading) {
          stop();
          resolve();
        }
      });
    });
  }

  if (!isAuthenticated.value && to.name !== 'NotFound') {
    await loginWithRedirect({
      appState: { targetUrl: to.fullPath },
    });
    return false;
  }
});

export default router;
