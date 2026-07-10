import { relations } from "drizzle-orm";
import { customers } from "./customers.schema";
import { properties } from "./properties.schema";
import { subscriptions } from "./subscriptions.schema";
import { checklistFiles } from "./checklistFiles.schema";
import { jobs, jobsToCleaners } from "./jobs.schema"; // Import jobsToCleaners
import { evidencePackets } from "./evidencePackets.schema";
import { payouts } from "./payouts.schema";
import { cleaners } from "./cleaners.schema";
import { availability } from "./availability.schema";
import { users } from "./users.schema";
import { onboardingDocuments } from "./onboardingDocuments.schema";
import { capabilityFlags } from "./capabilityFlags.schema";
import { gpsTrackingLogs } from "./gpsTrackingLogs.schema";
import { reliabilityEvents } from "./reliabilityEvents.schema";
import { reliabilityChecks } from "./reliabilityChecks.schema";
import { cleanerBadges } from "./cleanerBadges.schema";
import { jobStats } from "./jobStats.schema";
import { swapRequests } from "./swapRequests.schema";
import { notifications } from "./notifications.schema";
import { badges } from "./badges.schema";
import { userPreferences } from "./userPreferences.schema";
import { disputes } from "./disputes.schema";

// --- No changes needed for customer, property, checklist, or subscription relations ---
export const customerRelations = relations(customers, ({ many }) => ({
  properties: many(properties),
  subscriptions: many(subscriptions),
}));

export const propertyRelations = relations(properties, ({ one, many }) => ({
  customer: one(customers, {
    fields: [properties.customerId],
    references: [customers.id],
  }),
  checklistFiles: many(checklistFiles),
  subscriptions: many(subscriptions),
}));

export const checklistFileRelations = relations(checklistFiles, ({ one }) => ({
  property: one(properties, {
    fields: [checklistFiles.propertyId],
    references: [properties.id],
  }),
}));

export const subscriptionRelations = relations(
  subscriptions,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [subscriptions.customerId],
      references: [customers.id],
    }),
    property: one(properties, {
      fields: [subscriptions.propertyId],
      references: [properties.id],
    }),
    jobs: many(jobs),
  })
);

export const jobRelations = relations(jobs, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [jobs.subscriptionId],
    references: [subscriptions.id],
  }),
  property: one(properties, {
    fields: [jobs.propertyId],
    references: [properties.id],
  }),
  evidencePacket: one(evidencePackets, {
    fields: [jobs.id],
    references: [evidencePackets.jobId],
  }),
  payouts: many(payouts),
  cleaners: many(jobsToCleaners),
  swapRequests: many(swapRequests),
  gpsTrackingLogs: many(gpsTrackingLogs),
  reliabilityChecks: many(reliabilityChecks),
  reliabilityEvents: many(reliabilityEvents),
  jobStats: many(jobStats),
}));

export const cleanerRelations = relations(cleaners, ({ one, many }) => ({
  availabilities: many(availability),
  payouts: many(payouts),
  jobs: many(jobsToCleaners),
  user: one(users, { fields: [cleaners.userId], references: [users.id] }),
  onboardingDocuments: many(onboardingDocuments),
  capabilityFlags: one(capabilityFlags),
  gpsTrackingLogs: many(gpsTrackingLogs),
  reliabilityEvents: many(reliabilityEvents),
  reliabilityChecks: many(reliabilityChecks),
  cleanerBadges: many(cleanerBadges),
  jobStats: many(jobStats),
  swapRequestsOriginal: many(swapRequests, { relationName: "originalCleaner" }),
  swapRequestsReplacement: many(swapRequests, {
    relationName: "replacementCleaner",
  }),
  disputes: many(disputes),
  userPreferences: one(userPreferences), // Add this line
}));

// New relation definition for the join table
export const jobsToCleanersRelations = relations(jobsToCleaners, ({ one }) => ({
  job: one(jobs, { fields: [jobsToCleaners.jobId], references: [jobs.id] }),
  cleaner: one(cleaners, {
    fields: [jobsToCleaners.cleanerId],
    references: [cleaners.id],
  }),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [availability.cleanerId],
    references: [cleaners.id],
  }),
}));

export const evidencePacketRelations = relations(
  evidencePackets,
  ({ one }) => ({
    job: one(jobs, { fields: [evidencePackets.jobId], references: [jobs.id] }),
  })
);

export const payoutRelations = relations(payouts, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [payouts.cleanerId],
    references: [cleaners.id],
  }),
  job: one(jobs, { fields: [payouts.jobId], references: [jobs.id] }),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  cleaner: one(cleaners, { fields: [users.id], references: [cleaners.userId] }),
  notifications: many(notifications),
}));

export const swapRequestRelations = relations(swapRequests, ({ one }) => ({
  job: one(jobs, { fields: [swapRequests.jobId], references: [jobs.id] }),
  originalCleaner: one(cleaners, {
    fields: [swapRequests.originalCleanerId],
    references: [cleaners.id],
    relationName: "originalCleaner",
  }),
  replacementCleaner: one(cleaners, {
    fields: [swapRequests.replacementCleanerId],
    references: [cleaners.id],
    relationName: "replacementCleaner",
  }),
}));

export const onboardingDocumentRelations = relations(
  onboardingDocuments,
  ({ one }) => ({
    cleaner: one(cleaners, {
      fields: [onboardingDocuments.cleanerId],
      references: [cleaners.id],
    }),
  })
);

export const capabilityFlagsRelations = relations(
  capabilityFlags,
  ({ one }) => ({
    cleaner: one(cleaners, {
      fields: [capabilityFlags.cleanerId],
      references: [cleaners.id],
    }),
  })
);

export const gpsTrackingLogRelations = relations(
  gpsTrackingLogs,
  ({ one }) => ({
    job: one(jobs, { fields: [gpsTrackingLogs.jobId], references: [jobs.id] }),
    cleaner: one(cleaners, {
      fields: [gpsTrackingLogs.cleanerId],
      references: [cleaners.id],
    }),
  })
);

export const notificationRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  job: one(jobs, { fields: [notifications.jobId], references: [jobs.id] }),
}));

export const reliabilityEventRelations = relations(
  reliabilityEvents,
  ({ one }) => ({
    cleaner: one(cleaners, {
      fields: [reliabilityEvents.cleanerId],
      references: [cleaners.id],
    }),
    job: one(jobs, {
      fields: [reliabilityEvents.jobId],
      references: [jobs.id],
    }),
  })
);

export const reliabilityCheckRelations = relations(
  reliabilityChecks,
  ({ one }) => ({
    job: one(jobs, {
      fields: [reliabilityChecks.jobId],
      references: [jobs.id],
    }),
    cleaner: one(cleaners, {
      fields: [reliabilityChecks.cleanerId],
      references: [cleaners.id],
    }),
  })
);

export const badgeRelations = relations(badges, ({ many }) => ({
  cleanerBadges: many(cleanerBadges),
}));

export const cleanerBadgeRelations = relations(cleanerBadges, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [cleanerBadges.cleanerId],
    references: [cleaners.id],
  }),
  badge: one(badges, {
    fields: [cleanerBadges.badgeId],
    references: [badges.id],
  }),
}));

export const jobStatsRelations = relations(jobStats, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [jobStats.cleanerId],
    references: [cleaners.id],
  }),
  job: one(jobs, { fields: [jobStats.jobId], references: [jobs.id] }),
}));



// Add this new relation at the end of the file
export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [userPreferences.cleanerId],
    references: [cleaners.id],
  }),
}));

export const disputeRelations = relations(disputes, ({ one }) => ({
  cleaner: one(cleaners, {
    fields: [disputes.cleanerId],
    references: [cleaners.id],
  }),
}));