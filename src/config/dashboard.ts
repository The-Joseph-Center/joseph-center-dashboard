import type { DashboardConfig } from '@/types/dashboard';

const config: DashboardConfig = {
  "clientId": "joseph-center",
  "clientName": "Joseph Center",
  "clientDomain": "josephcentergj.com",
  "clientEmail": "mhighline@josephcentergj.com",
  "enabledWidgets": [
    "links",
    "siteAnalytics",
    "submissions",
    "eventRegistrations",
    "subscribers",
    "coffeeChat",
    "annualReports"
  ],
  "tutorialVideos": [],
  "links": [
    {
      "label": "Live Site",
      "url": "https://josephcentergj.com",
      "emoji": "🌐"
    },
    {
      "label": "Sanity Studio",
      "url": "https://studio.josephcentergj.com",
      "emoji": "✏️",
      "description": "Edit your content"
    }
  ],
  "billing": {
    "stripeCustomerId": "cus_M7oEO1tIoeUqPs",
    "showPendingCharges": true,
    "showOfflineInvoices": true
  },
  "analytics": {
    "provider": "simple-analytics",
    "simpleAnalyticsId": "sa.josephcentergj.com",
    "internalRoutes": [
      "/analytics",
      "/billing",
      "/support"
    ],
    "conversionPage": "/donate"
  }
};

export default config;
