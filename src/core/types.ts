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

/** One weekly recurring window — e.g. {days:[1,2,3,4,5,6], start:"09:00", end:"19:00"} for
 * "Seg a sáb, 9h às 19h". `days` uses JS's own 0=domingo..6=sábado numbering. An array of these
 * (not just one) leaves room for split schedules (e.g. a lunch break) without forcing that
 * complexity on businesses that don't need it. */
export interface BusinessHoursRange {
  days: number[];
  start: string;
  end: string;
}

export interface BusinessInput {
  name: string;
  /** Tone/personality, free text, written by the business admin — not a fixed persona. */
  persona?: string;
  /** Human-readable display line only (e.g. "Seg a sáb, 9h às 19h") — shown as context text, but
   * NEVER what validity decisions are based on. See `businessHours` for the structured version
   * the caller (Convitta Chat backend) uses to compute `horarioValido` deterministically. */
  hours?: string;
  businessHours?: BusinessHoursRange[];
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
  /** Whether the customer's most recently requested pickup/delivery time falls within
   * `businessHours`, computed deterministically by the backend — undefined/null means no specific
   * time was detected yet in this message, not "valid". The model must never decide this itself,
   * only relay what's here (see systemPrompt.ts's non-negotiable rule). */
  horarioValido?: boolean | null;
  /** The real neighborhood for the customer's last-known address, resolved via a geocoding
   * lookup by the backend — null/undefined means not resolved yet. The model must never infer a
   * neighborhood from a street name using its own world knowledge. */
  neighborhoodConfirmed?: string | null;
  /** Human-readable summary of this customer's last confirmed order, already formatted (fields +
   * "feito há N dias") and freshness-filtered by the backend — undefined means either no past
   * order or one too old to be worth surfacing. Never built or parsed by this service itself. */
  lastOrderSummary?: string;
}

/** What the model may hand back alongside its reply, parsed out of the `<extracao>` block. */
export interface ExtractedData {
  fields?: Record<string, string>;
  objective?: string | null;
  newFacts?: string[];
  /** Raw address text as stated by the customer, verbatim — never geocoded by the model itself. */
  address?: string;
  /** Snapshot of a just-confirmed order, only set when the customer explicitly closed a real
   * order this turn — keys/values are whatever the model judges relevant for this business (item,
   * size, delivery type, etc.), never a fixed domain-specific shape. The backend persists this
   * verbatim as the customer's new "last order" memory. */
  confirmedOrder?: Record<string, string>;
  /** Which outgoing flow edge to take next, echoed verbatim from one of `FlowStepInput.routingOptions[].label`
   * — only present when the caller sent routing options and the model judged one of them a clear
   * match for what the customer just said. Undefined (not one of the valid labels, or omitted
   * entirely) means "stay put, ask again" to the caller — see backend's flow-interpreter.service.ts. */
  nextNode?: string;
}

/** One label the flow interpreter is willing to route to from the current node — description is
 * an optional hint for the model about when this option applies, never shown to the customer. */
export interface FlowRoutingOption {
  label: string;
  description?: string;
}

/**
 * Per-turn "what step of the flow are we at" input — entirely optional, and `ia` itself has no
 * concept of nodes/flows/graphs beyond this shape. `instructions` arrives already wrapped with the
 * caller's own non-negotiable guardrail text (see backend's flow-node-prompt.util.ts) — `ia` just
 * places it in the prompt, it never needs to (and structurally cannot) know or care that a
 * guardrail was prepended.
 */
export interface FlowStepInput {
  instructions?: string;
  routingOptions?: FlowRoutingOption[];
}
