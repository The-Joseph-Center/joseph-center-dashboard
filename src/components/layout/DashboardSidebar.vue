<!-- CANONICAL SOURCE — matches Build Tools dashboard preview
     To update: edit this file AND the corresponding section in
     build-tools/src/views/PreviewDashboardView.vue
     Do not edit the copy in pws-dashboard-template — it will be overwritten at scaffold time -->
<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAuth0 } from '@auth0/auth0-vue';
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  MessageSquare,
  CreditCard,
  UserCircle,
  LogOut,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-vue-next';
import config from '@/config/dashboard';

defineProps<{ mobileOpen: boolean }>();
const emit = defineEmits<{ (e: 'toggle-mobile'): void }>();

const route = useRoute();
const { user, logout } = useAuth0();
const collapsed = ref(false);
const darkMode = ref(false);

function doLogout() {
  logout({ logoutParams: { returnTo: window.location.origin } });
}

function toggleDarkMode() {
  darkMode.value = !darkMode.value;
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light');
}

interface NavItem { to: string; label: string; icon: unknown }

const navItems: NavItem[] = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/content-kit', label: 'Content Kit', icon: ClipboardList },
  { to: '/support', label: 'Contact & Support', icon: MessageSquare },
  { to: '/billing', label: 'Billing', icon: CreditCard },
];
</script>

<template>
  <aside
    class="sidebar"
    :class="{
      'sidebar--collapsed': collapsed,
      'sidebar--mobile-open': mobileOpen,
    }"
  >
    <!-- Brand header -->
    <div class="sidebar__brand" :class="collapsed ? 'sidebar__brand--collapsed' : ''">
      <div
        class="sidebar__avatar"
        :style="{ backgroundColor: 'var(--color-sidebar-active, var(--color-primary))' }"
      >{{ config.clientName.charAt(0) }}</div>
      <div v-if="!collapsed" class="sidebar__brand-text">
        <p class="sidebar__client-name">{{ config.clientName }}</p>
        <p class="sidebar__label">Dashboard</p>
      </div>
    </div>

    <!-- Nav items -->
    <nav class="sidebar__nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="sidebar__link"
        :class="{
          'sidebar__link--collapsed': collapsed,
          'sidebar__link--active': route.path === item.to,
        }"
        :title="collapsed ? item.label : undefined"
        @click="emit('toggle-mobile')"
      >
        <component :is="item.icon" class="sidebar__link-icon" />
        <span v-if="!collapsed" class="sidebar__link-label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- Footer: user, dark mode, logout, collapse -->
    <div class="sidebar__footer">
      <!-- User info -->
      <div class="sidebar__user" :class="collapsed ? 'sidebar__user--collapsed' : ''">
        <div class="sidebar__user-avatar">
          <UserCircle :size="20" />
        </div>
        <div v-if="!collapsed" class="sidebar__user-info">
          <p class="sidebar__user-name">{{ user?.name || 'User' }}</p>
          <p class="sidebar__user-sub">{{ config.clientName }}</p>
        </div>
      </div>

      <!-- Dark mode toggle -->
      <button
        class="sidebar__action"
        :class="collapsed ? 'sidebar__action--collapsed' : ''"
        @click="toggleDarkMode"
        :title="collapsed ? (darkMode ? 'Light mode' : 'Dark mode') : undefined"
      >
        <Sun v-if="darkMode" :size="16" />
        <Moon v-else :size="16" />
        <span v-if="!collapsed">{{ darkMode ? 'Light mode' : 'Dark mode' }}</span>
      </button>

      <!-- Logout -->
      <button
        class="sidebar__action"
        :class="collapsed ? 'sidebar__action--collapsed' : ''"
        @click="doLogout()"
        :title="collapsed ? 'Log out' : undefined"
      >
        <LogOut :size="16" />
        <span v-if="!collapsed">Log out</span>
      </button>

      <!-- Collapse toggle (desktop only) -->
      <button
        class="sidebar__collapse-toggle"
        @click="collapsed = !collapsed"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      >
        <ChevronLeft v-if="!collapsed" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset-block: 0;
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 208px;
  background-color: var(--color-sidebar-bg, #111827);
  flex-shrink: 0;
  transition: all 0.2s ease;
  transform: translateX(-100%);
}

@media (min-width: 640px) {
  .sidebar {
    position: relative;
    transform: translateX(0);
  }
}

.sidebar--mobile-open {
  transform: translateX(0);
}

.sidebar--collapsed {
  width: 56px;
}

/* ─── Brand ─── */
.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 15%, transparent);
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar__brand--collapsed {
  padding: 1rem 0.5rem;
  justify-content: center;
}

.sidebar__avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.sidebar__brand-text {
  min-width: 0;
}

.sidebar__client-name {
  color: white;
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__label {
  color: color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 70%, transparent);
  font-size: 0.75rem;
}

/* ─── Nav ─── */
.sidebar__nav {
  flex: 1;
  padding: 1rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  color: var(--color-sidebar-text, #9ca3af);
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s ease;
  text-decoration: none;
}

.sidebar__link:hover {
  color: white;
  background-color: var(--color-sidebar-hover, rgba(255, 255, 255, 0.05));
}

.sidebar__link--active {
  color: white;
  background-color: var(--color-sidebar-active, var(--color-primary));
}

.sidebar__link--active:hover {
  background-color: var(--color-sidebar-active, var(--color-primary));
}

.sidebar__link--collapsed {
  justify-content: center;
  padding: 0.625rem 0.5rem;
}

.sidebar__link-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.sidebar__link-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Footer ─── */
.sidebar__footer {
  border-top: 1px solid color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 15%, transparent);
  flex-shrink: 0;
}

.sidebar__user {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
}

.sidebar__user--collapsed {
  justify-content: center;
}

.sidebar__user-avatar {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 15%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  flex-shrink: 0;
}

.sidebar__user-info {
  flex: 1;
  min-width: 0;
}

.sidebar__user-name {
  color: white;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__user-sub {
  color: color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 70%, transparent);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__action {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  color: color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 70%, transparent);
  font-size: 0.75rem;
  font-weight: 500;
  transition: all 0.15s ease;
}

.sidebar__action:hover {
  color: white;
  background-color: var(--color-sidebar-hover, rgba(255, 255, 255, 0.05));
}

.sidebar__action--collapsed {
  justify-content: center;
  padding: 0.625rem 0.5rem;
}

.sidebar__collapse-toggle {
  display: none;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding: 0.625rem;
  background: none;
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 15%, transparent);
  cursor: pointer;
  color: color-mix(in srgb, var(--color-sidebar-text, #9ca3af) 70%, transparent);
  transition: color 0.15s ease;
}

.sidebar__collapse-toggle:hover {
  color: white;
  background-color: var(--color-sidebar-hover, rgba(255, 255, 255, 0.05));
}

@media (min-width: 640px) {
  .sidebar__collapse-toggle {
    display: flex;
  }
}
</style>
