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
  "contentEditors": [],
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
      "/content-kit",
      "/support"
    ],
    "conversionPage": "/donate"
  },
  "contentKit": {
    "enabled": true,
    "sections": [
      {
        "id": "your_business",
        "label": "Your Business",
        "description": "Business name, tagline, industry, location, years in business",
        "enabled": true,
        "required": true
      },
      {
        "id": "services_products",
        "label": "Services / Products",
        "description": "What you offer — repeatable entries with name, description, price range",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_story",
        "label": "Your Story",
        "description": "Origin story, mission statement, values, team members",
        "enabled": true,
        "required": false
      },
      {
        "id": "your_customers",
        "label": "Your Customers",
        "description": "Testimonials, client logos, case studies",
        "enabled": true,
        "required": false
      },
      {
        "id": "brand_style",
        "label": "Brand & Style",
        "description": "Logo upload, brand personality, inspiration photos",
        "enabled": true,
        "required": true
      },
      {
        "id": "practical_details",
        "label": "Practical Details",
        "description": "Phone, email, address, hours, social links",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_goals",
        "label": "Your Goals",
        "description": "Primary website goal, secondary goals, target audience",
        "enabled": true,
        "required": true
      }
    ],
    "maxPersonalityPicks": 4,
    "welcomeMessage": "",
    "completionEmailNotify": true
  }
};

export default config;
