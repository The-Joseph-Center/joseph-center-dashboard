import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createHead } from '@unhead/vue';
import OktaVue from '@okta/okta-vue';
import App from './App.vue';
import router from './router';
import { oktaAuth } from '@/lib/okta';
import './assets/styles/main.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(createHead());
app.use(OktaVue, {
  oktaAuth,
  // Anything that needs auth funnels through here rather than each guard
  // deciding for itself how to start a login.
  onAuthRequired: () => {
    router.push('/login');
  },
});

app.mount('#app');
