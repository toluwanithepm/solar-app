// Contract between the customer-facing pages and the `public` Edge Function (Phase 3).
// Customers are never signed in: every request carries a link token, and the function decides what they may see or do.
// Requests: POST {SUPABASE_URL}/functions/v1/public with a JSON body below and headers `apikey` + `Authorization: Bearer <anon key>`
// (pay-subscription sends the signed-in owner's access token instead). Errors come back as { error } with a 4xx status.

/** Link tokens are 64 hex characters; record ids are UUIDs with dashes. */
export const TOKEN_RE = /^[0-9a-f]{64}$/;

export type LinkKind = 'quote' | 'invoice' | 'handover' | 'fault_report';

/** URL path segment for each kind of customer link: /q/<token>, /pay/<token>, /handover/<token>, /report/<token>. */
export const LINK_PATH: Record<LinkKind, string> = { quote: 'q', invoice: 'pay', handover: 'handover', fault_report: 'report' };

export type Row = Record<string, unknown>;

export type PublicRequest =
  /** Everything a customer page needs for one link. */
  | { action: 'view'; token: string }
  /** Branding for the public enquiry form (/enquire/<firmToken>). */
  | { action: 'firm'; firmToken: string }
  /** Start a Paystack payment: a quote deposit (optionId required) or an invoice balance. The server works out the amount. */
  | { action: 'pay'; token: string; optionId?: string }
  /** Check a payment after Paystack redirects back with ?reference=… (also recorded by the webhook; safe to repeat). */
  | { action: 'verify'; reference: string }
  /** E2-3 public enquiry form. */
  | { action: 'enquire'; firmToken: string; name: string; phone: string; location: string; propertyType: string; whatsappConsent: boolean; notes?: string }
  /** E8-3 fault report from an installation's link. */
  | { action: 'report'; token: string; description: string }
  /** One photo for a ticket just reported from the same link (JPEG data URL, ≤ 300 KB, max 3 per ticket). */
  | { action: 'report-photo'; token: string; ticketId: string; dataUrl: string; takenAt: string; lat?: number; lng?: number }
  /** E11-2 subscription payment by the signed-in owner (Authorization: Bearer <user access token>). */
  | { action: 'pay-subscription' };

export type ViewResponse = {
  kind: LinkKind;
  /** Id of the quote, invoice, job (handover) or installation (fault_report) the token points to. */
  targetId: string;
  /**
   * Database rows in the same shape the office app loads (snake_case columns), limited to what the customer may see:
   * firms (no subscription fields), leads (this customer only), staff (id, name only), and the records for this link.
   * Quote links: quotes, quote_options, quote_lines (no costs), price_items used by the lines, plans, invoices and payments for the quote.
   * Invoice links: invoices (this one), payments, quotes/quote_options for context.
   * Handover links: jobs (this one), job_assignees, job_serials, photos, installations, installation_items, plans, checklist inside jobs.
   * Fault-report links: installations, installation_items, tickets (+ ticket_updates) for this installation.
   */
  tables: Record<string, Row[]>;
  /** Signed URLs for storage paths in the rows (photos, signatures, logo), keyed by `${bucket}/${path}`. */
  files: Record<string, string>;
  /** Tokens for related customer links, keyed `${kind}:${targetId}`, e.g. the balance invoice's pay link or the fault-report link. */
  links: Record<string, string>;
  /** Gateway that takes payments right now, so the page can name it (USSD is Paystack only). */
  paymentProvider: 'paystack' | 'bachs';
};

export type FirmResponse = { tables: { firms: Row[] }; files: Record<string, string> };
export type PayResponse = { authorizationUrl: string; reference: string };
export type VerifyResponse = { status: 'success' | 'pending' | 'failed'; kind: 'quote' | 'invoice' | 'subscription'; targetId: string };
export type EnquireResponse = { ok: true; firmName: string };
export type ReportResponse = { ticketId: string; number: string };
export type ErrorResponse = { error: string };

/**
 * Staff share links: RPC `share_link(p_kind link_kind, p_target uuid) → text` (signed in, own firm) returns a token;
 * the URL is `${origin}/${LINK_PATH[kind]}/${token}`. The firm's enquiry link is `${origin}/enquire/${firms.enquiry_token}`.
 * Links inside WhatsApp/SMS messages are converted to tokens by the database when the message is queued.
 */
export type ShareLinkRpc = { p_kind: LinkKind; p_target: string };
