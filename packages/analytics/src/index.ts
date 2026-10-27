import { db, EventType, Prisma } from "@chambelli/database";
export class AnalyticsService {
  track(data: {
    websiteId: string;
    productId?: string;
    eventType: EventType;
    sessionId?: string;
    placement?: string;
    position?: number;
    metadata?: Record<string, unknown>;
  }) {
    const { metadata, ...rest } = data;
    return db.analyticsEvent.create({
      data: { ...rest, metadata: metadata as Prisma.InputJsonValue | undefined },
    });
  }
  summary(websiteId: string) {
    return db.analyticsEvent.groupBy({ by: ["eventType"], where: { websiteId }, _count: true });
  }
}
