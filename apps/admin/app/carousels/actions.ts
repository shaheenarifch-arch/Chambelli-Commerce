"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiPost } from "../../lib/api";

function back(form: FormData, msg: string, ok: boolean): never {
  const q = new URLSearchParams({ site: String(form.get("site") ?? ""), [ok ? "ok" : "err"]: msg });
  revalidatePath("/carousels");
  redirect(`/carousels?${q}`);
}

const HELP: Record<string, string> = {
  SITE_SHIPPING_COST_NOT_SET:
    "Set SITE_US_SHIPPING_COST on the server first (CJ US shipping per unit).",
  UK_PRICING_NOT_SET:
    "UK site: set USD_TO_GBP_RATE and UK_SHIPPING_ESTIMATE_GBP on the server first (see docs/UK.md).",
  DE_PRICING_NOT_SET:
    "Germany site: set USD_TO_EUR_RATE and DE_SHIPPING_ESTIMATE_EUR on the server first (see docs/DE.md).",
  CJ_NOT_CONFIGURED: "CJ is not connected on the server (CJ_ACCESS_TOKEN).",
};

/** Approve the ticked products, or every waiting product when none are ticked. */
export async function approve(form: FormData) {
  const ids = form.getAll("productId").map(String).filter(Boolean);
  const r = await apiPost<{ started: boolean; count?: number }>(
    `/v1/admin/sites/${form.get("site")}/approve`,
    ids.length ? { productIds: ids } : {},
  );
  if (r.error) back(form, HELP[r.error] ?? r.error, false);
  if (!r.data!.started) back(form, "Approval is already running for this site.", true);
  back(
    form,
    `Approving ${r.data!.count} products: pricing at 30% margin and checking CJ ${{ UK: "UK", DE: "Germany" }[String(form.get("market"))] ?? "US"} warehouse stock (about 1 second each). Refresh to see them go live.`,
    true,
  );
}

export async function setActive(form: FormData) {
  const ids = form.getAll("productId").map(String).filter(Boolean);
  const active = form.get("active") === "true";
  if (!ids.length) back(form, "Tick at least one product first.", false);
  const r = await apiPost<{ updated: number }>(`/v1/admin/sites/${form.get("site")}/assignments`, {
    productIds: ids,
    active,
  });
  if (r.error) back(form, r.error, false);
  back(form, `${r.data!.updated} ${active ? "put back on" : "removed from"} the carousel.`, true);
}
