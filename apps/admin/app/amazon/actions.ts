"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiPost } from "../../lib/api";

/** Every action returns to the same view with a short message shown at the top. */
function back(form: FormData, msg: string, ok: boolean): never {
  const q = new URLSearchParams({
    m: String(form.get("m") ?? "US"),
    tab: String(form.get("tab") ?? "listings"),
    [ok ? "ok" : "err"]: msg,
  });
  revalidatePath("/amazon");
  redirect(`/amazon?${q}`);
}

async function fileText(form: FormData, field: string): Promise<string | null> {
  const f = form.get(field);
  if (f instanceof File && f.size > 0) return f.text();
  const pasted = form.get(`${field}_text`);
  return typeof pasted === "string" && pasted.trim() ? pasted : null;
}

export async function importListings(form: FormData) {
  const text = await fileText(form, "report");
  if (!text) back(form, "Choose the All Listings report file first.", false);
  const r = await apiPost<{ imported: number; created: number }>(
    `/v1/admin/amazon/${form.get("m")}/listings/import`,
    { text },
  );
  if (r.error) back(form, r.error, false);
  back(form, `Imported ${r.data!.imported} listings (${r.data!.created} new).`, true);
}

export async function checkListings(form: FormData) {
  const r = await apiPost<{ started: boolean }>(`/v1/admin/amazon/${form.get("m")}/listings/check`);
  if (r.error) back(form, r.error, false);
  back(
    form,
    r.data!.started
      ? "CJ check started. It takes about 2 seconds per listing; refresh to see results."
      : "A CJ check is already running.",
    true,
  );
}

export async function saveCjSku(form: FormData) {
  const sku = String(form.get("cjSku") ?? "").trim();
  const r = await apiPost(`/v1/admin/amazon/listings/${form.get("id")}`, { cjSku: sku || null });
  if (r.error) back(form, r.error, false);
  back(form, "CJ SKU saved. Run the CJ check to refresh stock and price.", true);
}

export async function propose(form: FormData) {
  const cjSkus = String(form.get("cjSkus") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);
  if (!cjSkus.length) back(form, "Enter at least one CJ SKU.", false);
  const r = await apiPost<Array<{ cjSku: string; ok: boolean; reason?: string }>>(
    `/v1/admin/amazon/${form.get("m")}/proposals`,
    { cjSkus },
  );
  if (r.error) back(form, r.error, false);
  const ok = r.data!.filter((x) => x.ok).length;
  const skipped = r.data!.filter((x) => !x.ok).map((x) => `${x.cjSku} (${x.reason})`);
  back(
    form,
    `${ok} drafted for approval.${skipped.length ? ` Skipped: ${skipped.join(", ")}` : ""}`,
    ok > 0,
  );
}

export async function setProposal(form: FormData) {
  const state = String(form.get("state"));
  const r = await apiPost(`/v1/admin/amazon/listings/${form.get("id")}/state`, { state });
  if (r.error) back(form, r.error, false);
  back(
    form,
    state === "APPROVED"
      ? "Approved."
      : state === "REJECTED"
        ? "Rejected."
        : "Moved back to review.",
    true,
  );
}

export async function editProposal(form: FormData) {
  const bullets = [1, 2, 3, 4, 5]
    .map((i) => String(form.get(`bullet${i}`) ?? "").trim())
    .filter(Boolean);
  const priceRaw = String(form.get("price") ?? "").trim();
  const r = await apiPost(`/v1/admin/amazon/listings/${form.get("id")}`, {
    title: String(form.get("title") ?? "").trim(),
    bullets,
    price: priceRaw ? Number(priceRaw) : null,
  });
  if (r.error)
    back(
      form,
      r.error === "PRICE_BELOW_MARGIN" ? "That price is below the 30% margin floor." : r.error,
      false,
    );
  back(form, "Saved.", true);
}

export async function importOrders(form: FormData) {
  const text = await fileText(form, "report");
  if (!text) back(form, "Choose the Unshipped Orders report file first.", false);
  const r = await apiPost<{ imported: number; created: number }>(
    `/v1/admin/amazon/${form.get("m")}/orders/import`,
    { text },
  );
  if (r.error) back(form, r.error, false);
  back(form, `Imported ${r.data!.imported} orders (${r.data!.created} new).`, true);
}

export async function orderFromCj(form: FormData) {
  const force = form.get("force") === "on";
  const r = await apiPost(`/v1/admin/amazon/orders/${form.get("id")}/cj`, { force });
  if (r.error) {
    const help: Record<string, string> = {
      ALREADY_SENT_TO_CJ: "Already sent to CJ. Tick “Yes, order again” to reorder.",
      CJ_LOGISTIC_NOT_SET: "Set the CJ shipping method for this country first (see Settings help).",
      CJ_SKU_MISSING: "An item has no CJ SKU. Fix it on the Listings tab, then try again.",
      ADDRESS_INCOMPLETE: "The shipping address is incomplete. Re-import the order report.",
      CJ_NOT_CONFIGURED: "CJ is not connected on the server (CJ_ACCESS_TOKEN).",
      CJ_ORDER_FAILED: "CJ refused the order. The reason is shown on the order.",
    };
    back(form, help[r.error] ?? r.error, false);
  }
  back(
    form,
    force
      ? "Reordered from CJ. Pay it in your CJ dashboard."
      : "Ordered from CJ. Pay it in your CJ dashboard.",
    true,
  );
}

export async function setOrderStatus(form: FormData) {
  const status = String(form.get("status"));
  const tracking = form.get("tracking");
  const r = await apiPost(`/v1/admin/amazon/orders/${form.get("id")}/status`, {
    status,
    ...(typeof tracking === "string" ? { tracking } : {}),
  });
  if (r.error) back(form, r.error, false);
  back(
    form,
    status === "SHIPPED" ? "Marked shipped." : status === "CANCELLED" ? "Cancelled." : "Reopened.",
    true,
  );
}
