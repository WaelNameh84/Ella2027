import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const projectsTable = pgTable("studio_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  idea: text("idea").notNull(),
  videoType: text("video_type").notNull(),
  language: text("language").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  audience: text("audience").notNull(),
  visualStyle: text("visual_style").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  status: text("status").notNull().default("draft"),
  progress: integer("progress").notNull().default(0),
  exportUrl: text("export_url"),
  exportPath: text("export_path"),
  exportContentType: text("export_content_type"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const scenesTable = pgTable("studio_scenes", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  imagePrompt: text("image_prompt").notNull().default(""),
  narration: text("narration").notNull().default(""),
  durationSeconds: integer("duration_seconds").notNull().default(5),
  assetUrl: text("asset_url"),
  assetType: text("asset_type"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const providerKeysTable = pgTable("studio_provider_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  serviceType: text("service_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("untested"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  testMessage: text("test_message"),
  usedCount: integer("used_count").notNull().default(0),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const providerSettingsTable = pgTable("studio_provider_settings", {
  userId: text("user_id").primaryKey(),
  autoRotate: boolean("auto_rotate").notNull().default(true),
  rotateOnQuota: boolean("rotate_on_quota").notNull().default(true),
  rotateOnRateLimit: boolean("rotate_on_rate_limit").notNull().default(true),
  rotateOnConnectionFailure: boolean("rotate_on_connection_failure")
    .notNull()
    .default(true),
  maxAttempts: integer("max_attempts").notNull().default(3),
  retryDelaySeconds: integer("retry_delay_seconds").notNull().default(2),
  fallbackProvider: text("fallback_provider"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const toolMetadataTable = pgTable("studio_tool_metadata", {
  name: text("name").primaryKey(),
  category: text("category").notNull(),
  access: text("access").notNull(),
  pricingNote: text("pricing_note").notNull(),
  officialUrl: text("official_url").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});
