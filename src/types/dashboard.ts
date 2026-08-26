export type WidgetType =
  | 'siteAnalytics'
  | 'tutorials'
  | 'links'
;

export interface TutorialVideo {
  title: string;
  url: string;
  category?: string;
  description?: string;
}

/**
 * Unified dashboard link. Without a description renders as a compact pill
 * (the former Quick Action). With a description renders as a resource card
 * (the former Helpful Link).
 */
export interface DashboardLink {
  /** Optional capability gate. Omitted means every signed-in staff member. */
  capability?: string;
  label: string;
  url: string;
  emoji?: string;
  description?: string;
}

export interface BillingConfig {
  stripeCustomerId: string;
  showPendingCharges: boolean;
  showOfflineInvoices: boolean;
}

export interface AnalyticsConfig {
  provider: 'simple-analytics' | 'ga4';
  /** Simple Analytics: client domain (e.g. "acmeplumbing.com") */
  simpleAnalyticsId?: string;
  /** GA4: measurement ID (e.g. "G-XXXXXXXXXX") */
  analyticsId?: string;
  /** Dashboard routes filtered from public traffic view */
  internalRoutes?: string[];
  /** Goal page slug for visitor journey funnel (default: '/contact') */
  conversionPage?: string;
}

export interface DashboardConfig {
  clientId: string;
  clientName: string;
  clientDomain: string;
  clientEmail: string;
  enabledWidgets: string[];
  tutorialVideos: TutorialVideo[];
  links: DashboardLink[];
  billing?: BillingConfig;
  analytics?: AnalyticsConfig;
}
