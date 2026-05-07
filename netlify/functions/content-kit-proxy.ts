/**
 * Content Kit — reads/writes directly to Turso DB.
 * Table: content_kits (individual columns per field, not a JSON blob)
 *
 * GET  ?clientId=xxx  → fetch all content kit fields
 * PUT  { clientId, section, data: { fieldName: value, ... } }
 *      → update specific columns for that section
 *
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */
import { createClient } from '@libsql/client';

/** Map section IDs to their DB column names */
const SECTION_COLUMNS: Record<string, string[]> = {
  your_business: ['business_summary', 'years_in_business', 'differentiator', 'problem_solved'],
  services_products: ['services_products'],
  your_story: ['origin_story', 'client_facing_message', 'credentials', 'team_members'],
  your_customers: ['ideal_customer', 'testimonials', 'partner_logos', 'case_studies'],
  brand_style: ['logo_url', 'brand_colors', 'brand_guide_url', 'photos', 'style_references', 'brand_personality'],
  practical_details: ['phone', 'contact_email', 'address', 'service_area', 'business_hours', 'social_links', 'additional_info'],
  your_goals: ['primary_goal', 'do_not_want', 'additional_pages', 'anything_else'],
};

/** Map form field names from the dashboard to DB column names */
const FIELD_TO_COLUMN: Record<string, string> = {
  // your_business
  businessName: 'business_summary',
  tagline: 'business_summary',
  industry: 'business_summary',
  location: 'address',
  yearsInBusiness: 'years_in_business',
  // services_products
  offerings: 'services_products',
  priceRange: 'services_products',
  differentiator: 'differentiator',
  // your_story
  originStory: 'origin_story',
  missionStatement: 'client_facing_message',
  coreValues: 'credentials',
  // your_customers
  idealCustomers: 'ideal_customer',
  testimonials: 'testimonials',
  notableClients: 'partner_logos',
  // brand_style
  brandPersonality: 'brand_personality',
  websitesAdmired: 'style_references',
  thingsToAvoid: 'do_not_want',
  // practical_details
  phone: 'phone',
  email: 'contact_email',
  address: 'address',
  businessHours: 'business_hours',
  socialLinks: 'social_links',
  // your_goals
  primaryGoal: 'primary_goal',
  secondaryGoals: 'additional_pages',
  targetAudience: 'ideal_customer',
};

/** All readable columns for GET */
const ALL_COLUMNS = [
  'status', 'completion_pct', 'last_updated_section', 'updated_at',
  'business_summary', 'ideal_customer', 'problem_solved', 'differentiator',
  'years_in_business', 'services_products', 'origin_story', 'client_facing_message',
  'credentials', 'team_members', 'testimonials', 'partner_logos', 'case_studies',
  'logo_url', 'brand_colors', 'brand_guide_url', 'photos', 'style_references',
  'brand_personality', 'phone', 'contact_email', 'address', 'service_area',
  'business_hours', 'social_links', 'additional_info', 'primary_goal',
  'do_not_want', 'additional_pages', 'anything_else',
];

const SECTION_IDS = Object.keys(SECTION_COLUMNS);

function calculateCompletionPct(row: Record<string, unknown>): number {
  let sectionsWithContent = 0;
  for (const [_sectionId, columns] of Object.entries(SECTION_COLUMNS)) {
    const hasContent = columns.some((col) => {
      const val = row[col];
      if (!val) return false;
      if (typeof val === 'string') {
        if (val === '[]') return false;
        return val.trim().length > 0;
      }
      return true;
    });
    if (hasContent) sectionsWithContent++;
  }
  return Math.round((sectionsWithContent / SECTION_IDS.length) * 100);
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
}) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const dbUrl = process.env.TURSO_DATABASE_URL;
  const dbToken = process.env.TURSO_AUTH_TOKEN;
  if (!dbUrl || !dbToken) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Database not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.' }),
    };
  }

  const db = createClient({ url: dbUrl, authToken: dbToken });

  try {
    if (event.httpMethod === 'GET') {
      const clientId = event.queryStringParameters?.clientId;
      if (!clientId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing clientId' }) };
      }

      const result = await db.execute({
        sql: `SELECT ${ALL_COLUMNS.join(', ')} FROM content_kits WHERE client_id = ? LIMIT 1`,
        args: [clientId],
      });

      const row = result.rows[0];
      if (!row) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ success: true, contentKit: null, status: 'not_started', completionPct: 0 }),
        };
      }

      // Reconstruct section data from flat columns for the dashboard form
      const sections: Record<string, Record<string, unknown>> = {};
      sections.your_business = {
        businessName: row.business_summary || '',
        yearsInBusiness: row.years_in_business || '',
      };
      sections.services_products = {
        offerings: row.services_products || '[]',
        differentiator: row.differentiator || '',
      };
      sections.your_story = {
        originStory: row.origin_story || '',
        missionStatement: row.client_facing_message || '',
        coreValues: row.credentials || '',
      };
      sections.your_customers = {
        idealCustomers: row.ideal_customer || '',
        testimonials: row.testimonials || '[]',
        notableClients: row.partner_logos || '[]',
      };
      sections.brand_style = {
        brandPersonality: row.brand_personality || '[]',
        websitesAdmired: row.style_references || '[]',
        thingsToAvoid: row.do_not_want || '',
      };
      sections.practical_details = {
        phone: row.phone || '',
        email: row.contact_email || '',
        address: row.address || '',
        businessHours: row.business_hours || '',
        socialLinks: row.social_links || '[]',
      };
      sections.your_goals = {
        primaryGoal: row.primary_goal || '',
        secondaryGoals: row.additional_pages || '',
        targetAudience: row.ideal_customer || '',
      };

      // Figure out which sections are complete
      const completedSections: string[] = [];
      for (const [sectionId, columns] of Object.entries(SECTION_COLUMNS)) {
        const hasContent = columns.some((col) => {
          const val = row[col];
          if (!val || val === '[]') return false;
          if (typeof val === 'string') return val.trim().length > 0;
          return true;
        });
        if (hasContent) completedSections.push(sectionId);
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          contentKit: sections,
          completedSections,
          status: row.status ?? 'not_started',
          completionPct: row.completion_pct ?? 0,
          updatedAt: row.updated_at ?? null,
        }),
      };
    }

    // PUT — save a section
    if (event.httpMethod !== 'PUT') {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let body: {
      clientId?: string;
      section?: string;
      data?: Record<string, unknown>;
    };
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { clientId, section, data: sectionData } = body;
    if (!clientId || !section || !sectionData) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing clientId, section, or data' }) };
    }

    // Build column updates from the section data
    const updates: { col: string; val: string }[] = [];
    for (const [fieldName, value] of Object.entries(sectionData)) {
      const col = FIELD_TO_COLUMN[fieldName];
      if (col) {
        const strVal = typeof value === 'string' ? value : JSON.stringify(value);
        updates.push({ col, val: strVal });
      }
    }

    if (updates.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No valid fields to update' }) };
    }

    const now = new Date().toISOString();

    // Check if row exists
    const existing = await db.execute({
      sql: 'SELECT id FROM content_kits WHERE client_id = ? LIMIT 1',
      args: [clientId],
    });

    if (existing.rows[0]) {
      // UPDATE
      const setClauses = updates.map((u) => `${u.col} = ?`).join(', ');
      const args = [...updates.map((u) => u.val), section, now, clientId];
      await db.execute({
        sql: `UPDATE content_kits SET ${setClauses}, last_updated_section = ?, updated_at = ? WHERE client_id = ?`,
        args,
      });

      // Recalculate completion
      const updated = await db.execute({
        sql: `SELECT ${ALL_COLUMNS.join(', ')} FROM content_kits WHERE client_id = ? LIMIT 1`,
        args: [clientId],
      });
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      const pct = row ? calculateCompletionPct(row) : 0;
      const status = pct >= 100 ? 'complete' : 'in_progress';

      await db.execute({
        sql: 'UPDATE content_kits SET status = ?, completion_pct = ? WHERE client_id = ?',
        args: [status, pct, clientId],
      });

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, completionPct: pct, status }) };
    } else {
      // INSERT — build column list dynamically
      const colNames = ['id', 'client_id', 'last_updated_section', ...updates.map((u) => u.col)];
      const placeholders = colNames.map(() => '?').join(', ');
      const args = [crypto.randomUUID(), clientId, section, ...updates.map((u) => u.val)];

      await db.execute({
        sql: `INSERT INTO content_kits (${colNames.join(', ')}) VALUES (${placeholders})`,
        args,
      });

      return { statusCode: 201, headers: corsHeaders, body: JSON.stringify({ success: true, completionPct: 14, status: 'in_progress' }) };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error';
    console.error('content-kit error:', message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: message }) };
  }
}
