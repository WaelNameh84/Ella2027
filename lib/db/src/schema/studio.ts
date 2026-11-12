import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type StudioCharacter = {
  id: string;
  name: string;
  description: string;
  costume: string;
  voiceDescription: string;
  referenceImageUrl: string | null;
};

export type SceneAssetVersion = {
  id: string;
  url: string;
  type: "image" | "video";
  prompt: string;
  createdAt: string;
};

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
  characters: jsonb("characters").$type<StudioCharacter[]>().notNull().default([]),
  musicUrl: text("music_url"),
  musicVolume: integer("music_volume").notNull().default(20),
  soundEffectsUrl: text("sound_effects_url"),
  soundEffectsVolume: integer("sound_effects_volume").notNull().default(35),
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
  subtitleText: text("subtitle_text"),
  subtitleStartSeconds: doublePrecision("subtitle_start_seconds").notNull().default(0),
  subtitleEndSeconds: doublePrecision("subtitle_end_seconds"),
  durationSeconds: integer("duration_seconds").notNull().default(5),
  assetUrl: text("asset_url"),
  assetType: text("asset_type"),
  shotType: text("shot_type").notNull().default("wide"),
  cameraMovement: text("camera_movement").notNull().default("static"),
  location: text("location").notNull().default(""),
  lighting: text("lighting").notNull().default(""),
  characterIds: jsonb("character_ids").$type<string[]>().notNull().default([]),
  voiceUrl: text("voice_url"),
  voiceVolume: integer("voice_volume").notNull().default(100),
  clipStartSeconds: integer("clip_start_seconds").notNull().default(0),
  clipEndSeconds: integer("clip_end_seconds"),
  playbackSpeed: doublePrecision("playback_speed").notNull().default(1),
  transition: text("transition").notNull().default("cut"),
  assetHistory: jsonb("asset_history").$type<SceneAssetVersion[]>().notNull().default([]),
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
  freeMode: boolean("free_mode").notNull().default(true),
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

export const studioJobsTable = pgTable("studio_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  message: text("message").notNull().default("Waiting in the queue."),
  error: text("error"),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  attempts: integer("attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("studio_jobs_queue_idx").on(table.status, table.createdAt),
  index("studio_jobs_user_created_idx").on(table.userId, table.createdAt),
]);

export const favoriteMediaTable = pgTable("studio_favorite_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  mediaId: text("media_id").notNull(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  mediaType: text("media_type").notNull(),
  license: text("license").notNull(),
  licenseUrl: text("license_url"),
  creator: text("creator"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("studio_favorite_media_user_item_idx").on(
    table.userId,
    table.source,
    table.mediaId,
  ),
]);
