export class ChambelliClient {
  constructor(private baseUrl: string) {}
  async addToCart(input: {
    sessionId: string;
    websiteId: string;
    currency: string;
    variantId: string;
    quantity: number;
  }) {
    const r = await fetch(`${this.baseUrl}/v1/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error(`CART_HTTP_${r.status}`);
    return r.json();
  }
  async checkout(input: Record<string, unknown>) {
    const r = await fetch(`${this.baseUrl}/v1/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error(`CHECKOUT_HTTP_${r.status}`);
    return r.json();
  }
}
