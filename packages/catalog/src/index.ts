import { db, ProductStatus, SupplierType } from "@chambelli/database";
export class ProductRepository {
  find(id: string) {
    return db.product.findUnique({
      where: { id },
      include: { variants: true, supplierProducts: true },
    });
  }
  list() {
    return db.product.findMany({ include: { variants: true }, orderBy: { updatedAt: "desc" } });
  }
  upsert(data: {
    sku: string;
    slug: string;
    title: string;
    description?: string;
    imageUrl?: string;
    category: string;
    supplierType: SupplierType;
    status?: ProductStatus;
  }) {
    return db.product.upsert({
      where: { sku: data.sku },
      create: { ...data, tags: [] },
      update: data,
    });
  }
}
export class AssignmentService {
  assign(productId: string, websiteId: string, placement = "article-footer", priority = 50) {
    return db.productAssignment.upsert({
      where: { productId_websiteId_placement: { productId, websiteId, placement } },
      create: { productId, websiteId, placement, priority },
      update: { priority, active: true },
    });
  }
}
