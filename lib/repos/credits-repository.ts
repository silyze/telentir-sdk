import { HttpClient } from "./http-client";

/** Stripe credit balance summary returned by `/api/credits`. */
export interface CreditBalance {
  amount: number;
  currency: string;
}

/** Optional parameters for creating a credit top-up session. */
export interface CreditCheckoutOptions {
  returnTo?: string;
}

/**
 * Wrapper around credit-balance lookup and top-up session creation.
 */
export class CreditsRepository {
  constructor(private readonly http: HttpClient) {}

  /** Reads the cached or live credit balance for the authenticated user. */
  async getBalance(): Promise<CreditBalance> {
    return await this.http.request<CreditBalance>("/credits");
  }

  /**
   * Creates a Stripe checkout session for purchasing credits.
   *
   * @param options - Optional return URL appended as `returnTo`.
   * @returns Checkout URL.
   */
  async createTopUpSession(options?: CreditCheckoutOptions): Promise<string> {
    const response = await this.http.request<{ url: string }>("/credits/add", {
      method: "POST",
      query: options?.returnTo ? { returnTo: options.returnTo } : undefined,
    });
    return response.url;
  }
}
