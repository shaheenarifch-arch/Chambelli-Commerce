import { db } from "@chambelli/database";
export class WebsiteRepository {
  findBySlug(slug: string) {
    return db.website.findUnique({ where: { slug } });
  }
  listActive() {
    return db.website.findMany({ where: { active: true } });
  }
  create(data: {
    name: string;
    slug: string;
    domain: string;
    category: string;
    market: string;
    currency?: string;
  }) {
    return db.website.create({ data });
  }
}
