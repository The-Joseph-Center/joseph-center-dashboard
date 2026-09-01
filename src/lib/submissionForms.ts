import type { FormId } from '@/lib/capabilities';

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
  /** Shown as a confidentiality note above the table. */
  sensitive?: string;
  /**
   * The statuses this form's rows can be moved through, in order. Naming them
   * turns on follow-up tracking in the inbox — no migration needed, because
   * submission_followups is keyed by (form, row) rather than living on each
   * table. Omit for a form nobody needs to chase.
   */
  followUp?: readonly string[];
  /**
   * A form that no longer receives submissions. Grouped separately in the
   * inbox so an archive of a retired form is not mistaken for a live queue
   * nobody is answering.
   */
  archived?: boolean;
  /**
   * Whether a CSV can be downloaded. Defaults to the opposite of `sensitive`,
   * but the two are separate questions: letter requests carry addresses AND
   * need to be exported, because writing the letters is the job and copying
   * addresses off a screen one at a time is worse for everyone without making
   * the data any less exposed.
   */
  exportable?: boolean;
  columns: Column[];
}

const t = (key: string, label: string, primary = false, type: Column['type'] = 'text'): Column =>
  ({ key, label, primary, type });

export const FORMS: FormDef[] = [
  {
    id: 'contact',
    label: 'Contact messages',
    description: 'Messages sent from the contact form, including the archive imported from the previous site (back to September 2022).',
    table: 'contact_messages',
    timeColumn: 'submitted_at',
    searchColumns: ['name', 'email', 'phone', 'message', 'program'],
    columns: [
      t('name', 'Name', true), t('email', 'Email', true), t('phone', 'Phone'),
      t('program', 'About', true), t('message', 'Message', true),
      // Only ever set on the imported archive: the old form asked, this one
      // does not. Recorded because it was given, not acted on — see
      // scripts/import-legacy-contact-messages.ts.
      t('sms_consent', 'Agreed to texts', false, 'bool'),
      t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'volunteers',
    label: 'Volunteers',
    description: 'People offering to help, and where they want to be.',
    table: 'volunteer_submissions',
    timeColumn: 'submitted_at',
    searchColumns: ['name', 'email', 'phone', 'departments'],
    columns: [
      t('name', 'Name', true), t('email', 'Email', true), t('phone', 'Phone', true),
      t('departments', 'Interested in', true, 'json'), t('availability', 'Availability', false, 'json'),
      t('additional_info', 'Everything else', false, 'json'), t('submitted_at', 'Received', true, 'date'),
    ],
  },
  {
    id: 'volunteers-past',
    label: 'Volunteers (previous form)',
    description: 'Applications from the form on the previous site, November 2022 to August 2026. It asked for a good deal more than the current one — the extra answers are in each row.',
    archived: true,
    table: 'legacy_volunteer_applications',
    timeColumn: 'submitted_at',
    searchColumns: ['name', 'email', 'phone', 'locations', 'reason', 'qualifications', 'employment'],
    columns: [
      t('name', 'Name', true), t('email', 'Email', true), t('phone', 'Phone', true),
      t('locations', 'Interested in', true, 'json'),
      t('availability', 'Availability', false, 'json'),
      t('reason', 'Why they applied'),
      t('benefit', 'What they hope to gain'),
      t('qualifications', 'Qualifications'),
      t('employment', 'Employment summary'),
      t('work_history', 'Work history', false, 'json'),
      t('additional', 'Anything else'),
      t('submitted_at', 'Received', true, 'date'),
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
    sensitive: 'These are home addresses — handle the export accordingly.',
    exportable: true,
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
    // `email` is the address the application came from; `contact_email` is only
    // filled in when the applicant wants to be reached somewhere else. Showing
    // the latter in the Email column meant most rows read "—" beside a person
    // who had in fact given an address.
    sensitive:
      'These applications ask about legal matters and difficult subjects. Treat them as confidential.',
    // Booking a guest runs: reach out → agree a time → record it. "Declined"
    // covers both the guest saying no and us deciding not to schedule, which
    // the form itself warns can happen where there are legal matters.
    followUp: ['Contacted', 'Scheduled', 'Recorded', 'Declined'],
    columns: [
      t('full_name', 'Name', true), t('email', 'Email', true),
      t('contact_email', 'Prefers to be emailed at'), t('phone', 'Phone', true),
      t('connection', 'Connection', true), t('is_18_plus', 'Over 18', false, 'bool'),
      t('impact_statement', 'Their story'),
      // These four are stored as JSON arrays and were typed as plain text, so
      // the inbox would have shown ["Events & Outreach"] rather than the answer.
      t('programs_involved', 'Programs', false, 'json'),
      t('has_legal_matters', 'Legal matters', false, 'bool'),
      t('sensitive_topics', 'Sensitive topics'),
      t('comfortable_recorded', 'Happy to be recorded', false, 'bool'),
      t('name_display', 'Name shown as'), t('accommodations', 'Accommodations'),
      t('media_release_granted', 'Media release', false, 'bool'),
      t('expectations_confirmed', 'Expectations confirmed', false, 'bool'),
      t('best_days', 'Best days', false, 'json'), t('best_times', 'Best times', false, 'json'),
      t('contact_methods', 'Contact by', false, 'json'), t('additional_info', 'Anything else'),
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
