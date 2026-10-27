export interface CheckoutAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface CheckoutInput {
  cartId: string;
  websiteId: string;
  customerEmail: string;
  customerName?: string;
  address: CheckoutAddress;
  promotionCode?: string;
  paymentProvider: "STRIPE" | "PAYPAL";
  /** A unique value per checkout attempt; reuse it when retrying the same attempt. */
  idempotencyKey: string;
}

export class ChambelliApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${code} (HTTP ${status})`);
  }
}

/** Small browser/server client for the Chambelli Commerce API. */
export class ChambelliClient {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      // Only declare JSON when there is a body: an empty JSON body is rejected by the API.
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new ChambelliApiError(r.status, body.error ?? "REQUEST_FAILED");
    }
    return (await r.json()) as T;
  }

  addToCart(input: {
    sessionId: string;
    websiteId: string;
    currency: string;
    variantId: string;
    quantity: number;
  }) {
    return this.request("/v1/cart/items", { method: "POST", body: JSON.stringify(input) });
  }

  getCart(cartId: string) {
    return this.request(`/v1/cart/${encodeURIComponent(cartId)}`);
  }

  checkout(input: CheckoutInput) {
    return this.request<{
      orderId: string;
      orderNumber: string;
      total: number;
      currency: string;
      provider: "stripe" | "paypal";
      paymentId: string;
      clientSecret?: string | null;
      approveUrl?: string;
    }>("/v1/checkout", { method: "POST", body: JSON.stringify(input) });
  }

  capturePayPal(paypalOrderId: string) {
    return this.request<{ orderId: string; status: string }>(
      `/v1/payments/paypal/${encodeURIComponent(paypalOrderId)}/capture`,
      { method: "POST" },
    );
  }

  requestReturn(input: {
    orderId: string;
    email: string;
    reason: string;
    items: Array<{ orderItemId: string; quantity: number }>;
  }) {
    return this.request<{ id: string; status: string }>("/v1/returns", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}
