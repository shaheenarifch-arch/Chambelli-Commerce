import { z } from "zod";
const CJItem = z.object({
  pid: z.string(),
  productSku: z.string().optional(),
  productNameEn: z.string().optional(),
  productImage: z.string().optional(),
  sellPrice: z.union([z.string(), z.number()]).optional(),
});
export type CJItem = z.infer<typeof CJItem>;
export class CJConnector {
  constructor(
    private token: string,
    private baseUrl: string,
  ) {
    if (!baseUrl) throw new Error("CJ_API_BASE_URL_REQUIRED");
  }
  async listProducts(pageNum = 1, pageSize = 100) {
    const r = await fetch(`${this.baseUrl}/product/list?pageNum=${pageNum}&pageSize=${pageSize}`, {
      headers: { CJ_ACCESS_TOKEN: this.token },
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body: any = await r.json();
    const raw = body?.data?.list ?? body?.data ?? [];
    return z.array(CJItem).parse(raw);
  }
}
