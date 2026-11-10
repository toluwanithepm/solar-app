// The payment-provider seam: Paystack (launch default) and Bachs implement the same interface.
// Choose with the PAYMENT_PROVIDER secret; each payment remembers its provider so it is always checked with the right one.

export type ProviderName = 'paystack' | 'bachs';

export type StartParams = {
  /** Our reference (sfs_…), unique per payment */
  reference: string;
  /** Amount in naira, already worked out by the database */
  amountNaira: number;
  description: string;
  /** Where the customer returns; ?reference=<our reference> is always present on return */
  returnUrl: string;
  customerName: string;
  customerPhone: string;
  metadata: Record<string, string>;
};

export type Started = { authorizationUrl: string; providerRef: string };

/** A charge as the provider reports it, normalised for svc_record_gateway_payment. */
export type Charge = {
  status: 'success' | 'pending' | 'failed';
  /** What the customer paid towards the payment, in kobo, excluding any fee the customer carried */
  amountKobo: number;
  /** card, bank_transfer, ussd, … (mapped to a payment method by the database) */
  channel: string;
  paidAt: string | null;
};

export type PaymentProvider = {
  name: ProviderName;
  start(p: StartParams): Promise<Started>;
  /** Look up a payment by our reference and the provider's own id for it. */
  check(reference: string, providerRef: string | null): Promise<Charge>;
};

export const toKobo = (naira: number | string) => Math.round(Number(naira) * 100);
