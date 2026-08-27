import type { FormId } from '/Volumes/WD_BLACK/Codebase/joseph-center/dashboard/src/lib/capabilities.ts';

/**
 * The shape of each form's stored submissions.
 *
 * Imported by the SPA (to render the table) and by list-submissions (to build
 * the query), so the column a header names and the column that gets selected
 * cannot drift apart. Table and column names are also the ONLY source of those
 * identifiers in the query — nothing from the request is ever interpolated,
 * which is what keeps a caller from naming its own table.
 */
export interface Column {
  key: string;
  label: string;
  /** Shown in the table; everything else appears when a row is opened. */
  primary?: boolean;
  type?: 'date' | 'bool' | 'json' | 'text';
}

export interface FormDef {
  id: FormId;
  label: string;
  description: string;
  table: string;
  timeColumn: string;
  /** Free-text search runs across these. */
  searchColumns: string[];
  /** Splits one table into several forms — dynamic forms share form_submissions. */
  groupColumn?: string;
  sensitive?: string;
  columns: Column[];
}

const t = (key: string, label: string, primary = false, type: Column['type'] = 'text'): Column =>
  ({ key, label, primary, type });

export const FORMS: FormDef[] = [
  {
    id: 'volunteers',
    label: 'Volunteers',
    description: 'People offering to help, and where they want to be.',
    table: 'volunteer_submissions',
    timeColumn: 'submitted_at',
    searchColumns: ['name', 'email', 'phone', 'departments'],
    columns: [
      t('name', 'Name', true), t('email', 'Email', true), t('phone', 'Phone', true),
      t('departments', 'Interested in', true), t('availability', 'Availability'),
      t('additional_info', 'Notes'), t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'events',
    label: 'Event registrations',
    description: 'RSVPs, by event.',
    table: 'event_registrations',
    timeColumn: 'submitted_at',
    searchColumns: ['first_name', 'last_name', 'email', 'phone', 'event_slug'],
    groupColumn: 'event_slug',
    columns: [
      t('event_slug', 'Event', true), t('first_name', 'First name', true),
      t('last_name', 'Last name', true), t('email', 'Email', true), t('phone', 'Phone'),
      t('party_size', 'Party size', true), t('notes', 'Notes'),
      t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'letters',
    label: 'Personal letter requests',
    description: 'Requests for a handwritten note from Mona.',
    table: 'letter_requests',
    timeColumn: 'submitted_at',
    searchColumns: ['first_name', 'last_name', 'email', 'city'],
    sensitive: 'These are home addresses. Please do not export or forward them.',
    columns: [
      t('first_name', 'First name', true), t('last_name', 'Last name', true),
      t('email', 'Email', true), t('street', 'Street'), t('city', 'City', true),
      t('state', 'State'), t('zip', 'ZIP'), t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'coffee-chat',
    label: 'Coffee Chat guests',
    description: 'Applications to appear on an episode.',
    table: 'coffee_chat_applications',
    timeColumn: 'submitted_at',
    searchColumns: ['full_name', 'email', 'contact_email', 'phone', 'connection'],
    sensitive:
      'These applications ask about legal matters and difficult subjects. Treat them as confidential.',
    columns: [
      t('full_name', 'Name', true), t('contact_email', 'Email', true), t('phone', 'Phone', true),
      t('connection', 'Connection', true), t('is_18_plus', 'Over 18', false, 'bool'),
      t('impact_statement', 'Their story'), t('programs_involved', 'Programs'),
      t('has_legal_matters', 'Legal matters', false, 'bool'),
      t('sensitive_topics', 'Sensitive topics'),
      t('comfortable_recorded', 'Happy to be recorded', false, 'bool'),
      t('name_display', 'Name shown as'), t('accommodations', 'Accommodations'),
      t('media_release_granted', 'Media release', false, 'bool'),
      t('expectations_confirmed', 'Expectations confirmed', false, 'bool'),
      t('best_days', 'Best days'), t('best_times', 'Best times'),
      t('contact_methods', 'Contact by'), t('additional_info', 'Anything else'),
      t('signature', 'Signature'), t('signature_date', 'Signed'),
      t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'seasonal',
    label: 'Seasonal & request forms',
    description: 'Angel Tree, Easter baskets, and anything else built in Studio.',
    table: 'form_submissions',
    timeColumn: 'submitted_at',
    searchColumns: ['email', 'data'],
    groupColumn: 'form_slug',
    columns: [
      t('form_slug', 'Form', true), t('email', 'Email', true),
      t('data', 'Answers', true, 'json'), t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'subscribers',
    label: 'Newsletter & SMS sign-ups',
    description: 'Who opted in, to what, and from where.',
    table: 'sms_subscribers',
    timeColumn: 'subscribed_at',
    searchColumns: ['first_name', 'last_name', 'email', 'phone_number', 'source'],
    columns: [
      t('first_name', 'First name', true), t('last_name', 'Last name', true),
      t('email', 'Email', true), t('email_consent', 'Newsletter', true, 'bool'),
      t('phone_number', 'Phone', true), t('sms_consent', 'SMS', true, 'bool'),
      t('list', 'List'), t('source', 'Source', true),
      t('subscribed_at', 'Signed up', true, 'date'),
    ],
  },
];

export const formById = (id: string): FormDef | undefined => FORMS.find((f) => f.id === id);
