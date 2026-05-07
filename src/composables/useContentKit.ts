import { ref, reactive } from 'vue';
import { useAuth0 } from '@auth0/auth0-vue';
import config from '@/config/dashboard';

// ─── Section form shapes ────────────────────────────────────────────────────

export interface YourBusinessData {
  businessName: string;
  tagline: string;
  industry: string;
  location: string;
  yearsInBusiness: string;
}

export interface ServicesProductsData {
  offerings: string;
  priceRange: string;
  differentiator: string;
}

export interface YourStoryData {
  originStory: string;
  missionStatement: string;
  coreValues: string;
}

export interface YourCustomersData {
  idealCustomers: string;
  testimonials: string;
  notableClients: string;
}

export interface BrandStyleData {
  brandPersonality: string;
  websitesAdmired: string;
  thingsToAvoid: string;
}

export interface PracticalDetailsData {
  phone: string;
  email: string;
  address: string;
  businessHours: string;
  socialLinks: string;
}

export interface YourGoalsData {
  primaryGoal: string;
  secondaryGoals: string;
  targetAudience: string;
}

export interface ContentKitFormState {
  your_business: YourBusinessData;
  services_products: ServicesProductsData;
  your_story: YourStoryData;
  your_customers: YourCustomersData;
  brand_style: BrandStyleData;
  practical_details: PracticalDetailsData;
  your_goals: YourGoalsData;
}

type SectionId = keyof ContentKitFormState;

const SECTION_IDS: SectionId[] = [
  'your_business', 'services_products', 'your_story',
  'your_customers', 'brand_style', 'practical_details', 'your_goals',
];

function isSectionId(id: string): id is SectionId {
  return SECTION_IDS.includes(id as SectionId);
}

// ─── Composable ─────────────────────────────────────────────────────────────

const PROXY_URL = '/.netlify/functions/content-kit-proxy';

function createEmptyFormState(): ContentKitFormState {
  return {
    your_business: { businessName: config.clientName || '', tagline: '', industry: '', location: '', yearsInBusiness: '' },
    services_products: { offerings: '', priceRange: '', differentiator: '' },
    your_story: { originStory: '', missionStatement: '', coreValues: '' },
    your_customers: { idealCustomers: '', testimonials: '', notableClients: '' },
    brand_style: { brandPersonality: '', websitesAdmired: '', thingsToAvoid: '' },
    practical_details: { phone: '', email: config.clientEmail || '', address: '', businessHours: '', socialLinks: '' },
    your_goals: { primaryGoal: '', secondaryGoals: '', targetAudience: '' },
  };
}

export function useContentKit() {
  const { getAccessTokenSilently } = useAuth0();

  const formState = reactive<ContentKitFormState>(createEmptyFormState());
  const completedSections = ref<Set<string>>(new Set());
  const completionPct = ref(0);
  const loading = ref(false);
  const saving = ref<string | null>(null);
  const error = ref<string | null>(null);

  const contentKit = config.contentKit;
  const enabledSections = contentKit?.sections?.filter(s => s.enabled) ?? [];
  const requiredSectionIds = enabledSections.map(s => s.id);

  async function loadContentKit() {
    loading.value = true;
    error.value = null;

    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(
        `${PROXY_URL}?clientId=${encodeURIComponent(config.clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) throw new Error('Failed to load content kit');

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      completionPct.value = data.completionPct ?? 0;

      // Merge DB data into form state — only overwrite fields that have actual content
      if (data.contentKit && typeof data.contentKit === 'object') {
        const kit = data.contentKit as Record<string, Record<string, string>>;
        for (const sectionId of Object.keys(kit)) {
          if (!isSectionId(sectionId)) continue;
          const sectionData = kit[sectionId];
          if (!sectionData || typeof sectionData !== 'object') continue;

          const target = formState[sectionId] as Record<string, string>;
          let hasContent = false;
          for (const [field, value] of Object.entries(sectionData)) {
            if (typeof value === 'string' && value.trim()) {
              target[field] = value;
              hasContent = true;
            }
          }
          if (hasContent) {
            completedSections.value.add(sectionId);
          }
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load content kit';
    } finally {
      loading.value = false;
    }
  }

  async function saveSection(sectionId: string) {
    if (!isSectionId(sectionId)) return;

    saving.value = sectionId;
    error.value = null;

    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(PROXY_URL, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: config.clientId,
          section: sectionId,
          data: formState[sectionId],
          requiredSections: requiredSectionIds,
          completionEmailNotify: contentKit?.completionEmailNotify ?? false,
          clientName: config.clientName,
        }),
      });

      if (!res.ok) throw new Error('Failed to save section');

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      completionPct.value = data.completionPct ?? completionPct.value;
      completedSections.value.add(sectionId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save section';
    } finally {
      saving.value = null;
    }
  }

  return {
    formState,
    completedSections,
    completionPct,
    loading,
    saving,
    error,
    loadContentKit,
    saveSection,
  };
}