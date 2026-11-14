/** @type {import('next').NextConfig} */
export default {
  // Seller Central reports are uploaded through server actions; allow up to 10 MB.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
