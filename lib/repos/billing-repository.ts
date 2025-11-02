import { HttpClient } from "./http-client";

/** Identifiers for the hosted Telentir billing plans. */
export type PlanKey = "starter" | "pro" | "growth" | "agency";

/** Pricing and limit characteristics for a plan. */
export interface BillingPlanDetails {
  name: string;
  monthlyPriceUsd: number;
  includedMinutes: number;
  overageUsdPerMinute?: number;
  includedLeads: number;
  includedOutboundCalls: number;
  includedInboundCalls: number;
  outboundFixedUsd: number;
  inboundFixedUsd: number;
  leadOverageUsdPerLead: number;
}

export interface BillingPlan extends BillingPlanDetails {
  key: PlanKey;
}

/** Usage counters reported by `/api/billing/state`. */
export interface BillingUsageSummary {
  seconds_inbound: number;
  seconds_outbound: number;
  calls_inbound: number;
  calls_outbound: number;
  leads: number;
}

export interface BillingState {
  plan: BillingPlan | null;
  usage: BillingUsageSummary;
  hasCard: boolean;
  balance: {
    currency: string;
    amount: number;
  };
}

/** Additional options when generating a plan checkout session. */
export interface PlanCheckoutOptions {
  mode?: "upgrade";
  returnTo?: string;
}

/** Options when requesting the Stripe billing portal URL. */
export interface PortalOptions {
  returnTo?: string;
}

/**
 * Client for billing-related operations (plan selection, portal access).
 */
export class BillingRepository {
  constructor(private readonly http: HttpClient) {}

  /** Fetches the current billing plan, usage and balance state. */
  async getState(): Promise<BillingState> {
    return await this.http.request<BillingState>("/billing/state");
  }

  /**
   * Produces a Stripe customer-portal URL.
   *
   * @param options - Optional return URL appended as `returnTo`.
   */
  async openPortal(options?: PortalOptions): Promise<string> {
    const response = await this.http.request<{ url: string }>(
      "/billing/portal",
      {
        query: options?.returnTo ? { returnTo: options.returnTo } : undefined,
      }
    );
    return response.url;
  }

  async createPlanCheckout(
    plan: PlanKey,
    options?: PlanCheckoutOptions
  ): Promise<string> {
    const body: Record<string, unknown> = { plan };
    if (options?.mode) {
      body.mode = options.mode;
    }

    const response = await this.http.request<{ url: string }>("/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      query: options?.returnTo
        ? {
            returnTo: options.returnTo,
          }
        : undefined,
    });

    return response.url;
  }
}
