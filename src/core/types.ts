/**
 * Shapes shared across the whole service — deliberately domain-agnostic. Nothing here assumes a
 * restaurant, a shop, or any particular kind of business: every piece of "what this business is"
 * comes from the caller (the Convitta Chat backend, populated from the admin's own settings), not
 * from a hardcoded example.
 */

export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  available: boolean;
}

export interface BusinessInput {
  name: string;
  /** Tone/personality, free text, written by the business admin — not a fixed persona. */
  persona?: string;
  hours?: string;
  serviceAreas?: string[];
  paymentMethods?: string[];
  minOrderCents?: number;
  policies?: string[];
  /** Extra business rules the admin wants enforced — never security rules, those stay in code. */
  extraRules?: string;
  /** What to say when a message is blocked/refused — safe to customize, it's just wording. */
  fallbackMessage?: string;
  catalog: CatalogItem[];
}

export interface CustomerField {
  key: string;
  value: string | null;
}

export interface CustomerInput {
  fields?: CustomerField[];
  objective?: string | null;
  longTermMemory?: string | null;
}

/** What the model may hand back alongside its reply, parsed out of the `<extracao>` block. */
export interface ExtractedData {
  fields?: Record<string, string>;
  objective?: string | null;
  newFacts?: string[];
}
