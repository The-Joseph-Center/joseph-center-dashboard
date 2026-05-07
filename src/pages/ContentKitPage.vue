<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  Building2,
  ShoppingBag,
  BookOpen,
  Users,
  Palette,
  MapPin,
  Target,
  ChevronDown,
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-vue-next';
import config from '@/config/dashboard';
import { useContentKit } from '@/composables/useContentKit';

const {
  formState,
  completedSections,
  completionPct,
  loading,
  saving,
  error,
  loadContentKit,
  saveSection,
} = useContentKit();

const contentKit = config.contentKit;
const sections = computed(() => contentKit?.sections?.filter((s) => s.enabled) || []);

const SECTION_ICONS: Record<string, unknown> = {
  your_business: Building2,
  services_products: ShoppingBag,
  your_story: BookOpen,
  your_customers: Users,
  brand_style: Palette,
  practical_details: MapPin,
  your_goals: Target,
};

const expandedSection = ref<string | null>(null);

function toggleSection(id: string) {
  expandedSection.value = expandedSection.value === id ? null : id;
}

async function markComplete(id: string) {
  await saveSection(id);
  // Advance to next incomplete section
  const idx = sections.value.findIndex((s) => s.id === id);
  const next = sections.value.slice(idx + 1).find((s) => !completedSections.value.has(s.id));
  expandedSection.value = next?.id || null;
}

onMounted(loadContentKit);
</script>

<template>
  <DashboardLayout page-title="Content Kit">
    <!-- Not configured -->
    <div v-if="!contentKit?.enabled" class="content-kit-placeholder">
      <Target :size="48" class="content-kit-placeholder__icon" />
      <h2>Content Kit Not Configured</h2>
      <p>The content kit has not been set up for this dashboard yet. Contact your web administrator for assistance.</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="content-kit-loading">
      <Loader2 :size="32" class="content-kit-loading__spinner" />
      <p>Loading your content kit...</p>
    </div>

    <!-- Main content -->
    <div v-else class="content-kit">
      <!-- Error banner -->
      <div v-if="error" class="content-kit__error">
        <AlertCircle :size="16" />
        <span>{{ error }}</span>
        <button class="content-kit__error-retry" @click="loadContentKit">
          <RefreshCw :size="14" /> Retry
        </button>
      </div>

      <!-- Header -->
      <div class="content-kit__header">
        <h2 class="content-kit__title">Your Content Kit</h2>
        <p class="content-kit__subtitle">
          {{ contentKit?.welcomeMessage || 'Help us build the perfect website by filling in each section below. Take your time — you can save and come back anytime.' }}
        </p>

        <!-- Progress bar -->
        <div class="content-kit__progress">
          <div class="content-kit__progress-bar">
            <div class="content-kit__progress-fill" :style="{ width: `${completionPct}%` }" />
          </div>
          <span class="content-kit__progress-label">{{ completionPct }}% complete</span>
        </div>
      </div>

      <!-- Sections -->
      <div class="content-kit__sections">
        <div
          v-for="section in sections"
          :key="section.id"
          class="content-kit__section"
          :class="{
            'content-kit__section--expanded': expandedSection === section.id,
            'content-kit__section--completed': completedSections.has(section.id),
          }"
        >
          <!-- Section header -->
          <button class="content-kit__section-header" @click="toggleSection(section.id)">
            <div class="content-kit__section-icon">
              <component :is="SECTION_ICONS[section.id] || Target" :size="20" />
            </div>
            <div class="content-kit__section-info">
              <h3 class="content-kit__section-title">
                {{ section.label }}
                <span v-if="section.required" class="content-kit__required">Required</span>
              </h3>
              <p class="content-kit__section-desc">{{ section.description }}</p>
            </div>
            <div class="content-kit__section-status">
              <CheckCircle v-if="completedSections.has(section.id)" :size="20" class="content-kit__check" />
              <Circle v-else :size="20" class="content-kit__circle" />
            </div>
            <ChevronDown :size="18" class="content-kit__chevron" :class="{ 'content-kit__chevron--open': expandedSection === section.id }" />
          </button>

          <!-- Section content (expanded) -->
          <div v-if="expandedSection === section.id" class="content-kit__section-body">
            <p class="content-kit__section-prompt">
              Fill in the details below for <strong>{{ section.label }}</strong>. All fields are helpful but only those marked with * are required.
            </p>

            <!-- YOUR BUSINESS -->
            <div v-if="section.id === 'your_business'" class="content-kit__fields">
              <label class="content-kit__label">Business Name *<input v-model="formState.your_business.businessName" type="text" class="content-kit__input" /></label>
              <label class="content-kit__label">Tagline / Slogan<input v-model="formState.your_business.tagline" type="text" class="content-kit__input" placeholder="A short phrase that captures what you do" /></label>
              <label class="content-kit__label">Industry / Sector *<input v-model="formState.your_business.industry" type="text" class="content-kit__input" placeholder="e.g. Web Design, Plumbing, Church" /></label>
              <label class="content-kit__label">Location<input v-model="formState.your_business.location" type="text" class="content-kit__input" placeholder="City, State" /></label>
              <label class="content-kit__label">Years in Business<input v-model="formState.your_business.yearsInBusiness" type="text" class="content-kit__input" placeholder="e.g. 5" /></label>
            </div>

            <!-- SERVICES / PRODUCTS -->
            <div v-else-if="section.id === 'services_products'" class="content-kit__fields">
              <label class="content-kit__label">What do you offer? *<textarea v-model="formState.services_products.offerings" class="content-kit__textarea" rows="4" placeholder="List your main services or products, one per line"></textarea></label>
              <label class="content-kit__label">Price Range (optional)<input v-model="formState.services_products.priceRange" type="text" class="content-kit__input" placeholder="e.g. $500-$5,000 per project" /></label>
              <label class="content-kit__label">What makes you different?<textarea v-model="formState.services_products.differentiator" class="content-kit__textarea" rows="3" placeholder="Your unique value proposition - why should someone choose you?"></textarea></label>
            </div>

            <!-- YOUR STORY -->
            <div v-else-if="section.id === 'your_story'" class="content-kit__fields">
              <label class="content-kit__label">How did your business start?<textarea v-model="formState.your_story.originStory" class="content-kit__textarea" rows="4" placeholder="Share your origin story - what inspired you to start?"></textarea></label>
              <label class="content-kit__label">Mission Statement<textarea v-model="formState.your_story.missionStatement" class="content-kit__textarea" rows="2" placeholder="Your purpose in one or two sentences"></textarea></label>
              <label class="content-kit__label">Core Values<textarea v-model="formState.your_story.coreValues" class="content-kit__textarea" rows="3" placeholder="What principles guide your work? List 3-5 values"></textarea></label>
            </div>

            <!-- YOUR CUSTOMERS -->
            <div v-else-if="section.id === 'your_customers'" class="content-kit__fields">
              <label class="content-kit__label">Who are your ideal customers?<textarea v-model="formState.your_customers.idealCustomers" class="content-kit__textarea" rows="3" placeholder="Describe the people or organizations you serve best"></textarea></label>
              <label class="content-kit__label">Testimonials<textarea v-model="formState.your_customers.testimonials" class="content-kit__textarea" rows="4" placeholder="Paste any quotes from happy clients - include their name and role if possible"></textarea></label>
              <label class="content-kit__label">Notable Clients or Partners<input v-model="formState.your_customers.notableClients" type="text" class="content-kit__input" placeholder="Names of companies or organizations you've worked with" /></label>
            </div>

            <!-- BRAND & STYLE -->
            <div v-else-if="section.id === 'brand_style'" class="content-kit__fields">
              <label class="content-kit__label">Brand Personality<textarea v-model="formState.brand_style.brandPersonality" class="content-kit__textarea" rows="3" placeholder="How should your brand feel? e.g. Professional but approachable, Bold and modern, Warm and trustworthy"></textarea></label>
              <label class="content-kit__label">Websites You Admire<textarea v-model="formState.brand_style.websitesAdmired" class="content-kit__textarea" rows="2" placeholder="Paste URLs of sites whose look or feel inspires you"></textarea></label>
              <label class="content-kit__label">Anything to Avoid?<textarea v-model="formState.brand_style.thingsToAvoid" class="content-kit__textarea" rows="2" placeholder="Colors, styles, or vibes that don't fit your brand"></textarea></label>
            </div>

            <!-- PRACTICAL DETAILS -->
            <div v-else-if="section.id === 'practical_details'" class="content-kit__fields">
              <label class="content-kit__label">Phone Number<input v-model="formState.practical_details.phone" type="tel" class="content-kit__input" placeholder="+1 (555) 000-0000" /></label>
              <label class="content-kit__label">Email Address *<input v-model="formState.practical_details.email" type="email" class="content-kit__input" /></label>
              <label class="content-kit__label">Physical Address<textarea v-model="formState.practical_details.address" class="content-kit__textarea" rows="2" placeholder="Street address, city, state, zip"></textarea></label>
              <label class="content-kit__label">Business Hours<input v-model="formState.practical_details.businessHours" type="text" class="content-kit__input" placeholder="e.g. Mon-Fri, 9am-5pm" /></label>
              <label class="content-kit__label">Social Media Links<textarea v-model="formState.practical_details.socialLinks" class="content-kit__textarea" rows="3" placeholder="Paste your profile URLs, one per line"></textarea></label>
            </div>

            <!-- YOUR GOALS -->
            <div v-else-if="section.id === 'your_goals'" class="content-kit__fields">
              <label class="content-kit__label">Primary Website Goal *<input v-model="formState.your_goals.primaryGoal" type="text" class="content-kit__input" placeholder="e.g. Generate leads, Sell products, Build credibility" /></label>
              <label class="content-kit__label">Secondary Goals<textarea v-model="formState.your_goals.secondaryGoals" class="content-kit__textarea" rows="2" placeholder="Any other things the website should accomplish"></textarea></label>
              <label class="content-kit__label">Target Audience<textarea v-model="formState.your_goals.targetAudience" class="content-kit__textarea" rows="3" placeholder="Who are you trying to reach with this website?"></textarea></label>
            </div>

            <!-- Generic fallback -->
            <div v-else class="content-kit__fields">
              <label class="content-kit__label">{{ section.label }}<textarea class="content-kit__textarea" rows="5" :placeholder="`Add your ${section.label.toLowerCase()} details here`"></textarea></label>
            </div>

            <div class="content-kit__actions">
              <button
                class="content-kit__save"
                :disabled="!!saving"
                @click="markComplete(section.id)"
              >
                <Loader2 v-if="saving === section.id" :size="16" class="content-kit__spinner" />
                {{ saving === section.id ? 'Saving...' : completedSections.has(section.id) ? 'Update' : 'Save & Continue' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.content-kit {
  max-width: 720px;
}

.content-kit__header {
  margin-bottom: 2rem;
}

.content-kit__title {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.content-kit__subtitle {
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.9375rem;
  line-height: 1.6;
  margin-bottom: 1.25rem;
}

.content-kit__progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.content-kit__progress-bar {
  flex: 1;
  height: 6px;
  background-color: var(--color-border);
  border-radius: 3px;
  overflow: hidden;
}

.content-kit__progress-fill {
  height: 100%;
  background-color: var(--color-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.content-kit__progress-label {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, var(--color-text));
  white-space: nowrap;
}

.content-kit__sections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.content-kit__section {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  background-color: var(--color-surface);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.content-kit__section--expanded {
  border-color: var(--color-primary);
}

.content-kit__section--completed {
  opacity: 0.75;
}

.content-kit__section--completed .content-kit__section-header {
  background-color: color-mix(in srgb, var(--color-primary) 5%, transparent);
}

.content-kit__section-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease;
}

.content-kit__section-header:hover {
  background-color: color-mix(in srgb, var(--color-primary) 3%, transparent);
}

.content-kit__section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  flex-shrink: 0;
}

.content-kit__section-info {
  flex: 1;
  min-width: 0;
}

.content-kit__section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.content-kit__required {
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.content-kit__section-desc {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, var(--color-text));
  margin-top: 0.125rem;
}

.content-kit__section-status {
  flex-shrink: 0;
}

.content-kit__check {
  color: var(--color-primary);
}

.content-kit__circle {
  color: var(--color-border);
}

.content-kit__chevron {
  flex-shrink: 0;
  color: var(--color-text-secondary, var(--color-text));
  transition: transform 0.2s ease;
}

.content-kit__chevron--open {
  transform: rotate(180deg);
}

.content-kit__section-body {
  padding: 0 1.25rem 1.25rem;
  border-top: 1px solid var(--color-border);
}

.content-kit__section-prompt {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, var(--color-text));
  margin: 1rem 0;
  line-height: 1.5;
}

.content-kit__fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.content-kit__label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text);
}

.content-kit__input,
.content-kit__textarea {
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: var(--font-body);
  transition: border-color 0.15s ease;
}

.content-kit__input:focus,
.content-kit__textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.content-kit__textarea {
  resize: vertical;
  min-height: 4rem;
}

.content-kit__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.25rem;
}

.content-kit__save {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: 0.875rem;
  font-weight: 600;
  border: none;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.content-kit__save:hover {
  opacity: 0.9;
}

.content-kit__save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ─── States ─────────────────────────────────────────────────────────────── */

.content-kit-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.content-kit-placeholder__icon {
  opacity: 0.3;
}

.content-kit-placeholder h2 {
  font-family: var(--font-heading);
  color: var(--color-text);
  margin: 0;
}

.content-kit-placeholder p {
  max-width: 400px;
  line-height: 1.5;
}

.content-kit-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  color: var(--color-text-secondary);
}

.content-kit-loading__spinner {
  animation: spin 1s linear infinite;
}

.content-kit__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.content-kit__error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1.25rem;
  border-radius: var(--border-radius);
  background-color: rgba(239, 68, 68, 0.08);
  color: #dc2626;
  font-size: 0.875rem;
}

.content-kit__error-retry {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
  padding: 0.25rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: var(--border-radius);
  background: none;
  color: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}
</style>