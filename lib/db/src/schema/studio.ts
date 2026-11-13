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

export type StudioBrandKit = {
  primaryColor: string;
  accentColor: string;
  fontFamily: "sans" | "serif" | "mono";
  watermarkText: string;
  watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

export const defaultBrandKit: StudioBrandKit = {
  primaryColor: "#F4F0E8",
  accentColor: "#C96B4B",
  fontFamily: "sans",
  watermarkText: "",
  watermarkPosition: "bottom-right",
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
  brandKit: jsonb("brand_kit").$type<StudioBrandKit>().notNull().default(defaultBrandKit),
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

export const dialogueLinesTable = pgTable("studio_dialogue_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  characterId: text("character_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  text: text("text").notNull().default(""),
  startSeconds: doublePrecision("start_seconds").notNull().default(0),
  endSeconds: doublePrecision("end_seconds"),
  voiceId: text("voice_id"),
  voiceUrl: text("voice_url"),
  voiceVolume: integer("voice_volume").notNull().default(100),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("studio_dialogue_scene_order_idx").on(table.sceneId, table.sortOrder),
  index("studio_dialogue_project_user_idx").on(table.projectId, table.userId),
]);

export const storyboardVersionsTable = pgTable("studio_storyboard_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default("Untitled storyboard"),
  source: text("source").notNull().default("free-template"),
  status: text("status").notNull().default("draft"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  versionNumber: integer("version_number").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("studio_storyboard_project_version_idx").on(table.projectId, table.versionNumber)]);

export const wizardProgressTable = pgTable("studio_wizard_progress", {
  projectId: uuid("project_id").primaryKey().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  currentStep: integer("current_step").notNull().default(1),
  completedSteps: jsonb("completed_steps").$type<number[]>().notNull().default([]),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const storageAssetsTable = pgTable("studio_storage_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  sceneId: uuid("scene_id").references(() => scenesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url"),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  backend: text("backend").notNull().default("local-test"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("studio_storage_project_idx").on(table.projectId, table.createdAt),
  uniqueIndex("studio_storage_backend_key_idx").on(table.backend, table.storageKey),
]);

export const providerPricingTable = pgTable("studio_provider_pricing", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  serviceType: text("service_type").notNull(),
  unit: text("unit").notNull(),
  unitPriceUsd: doublePrecision("unit_price_usd").notNull().default(0),
  isEstimate: boolean("is_estimate").notNull().default(true),
  sourceUrl: text("source_url"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("studio_provider_pricing_model_idx").on(table.provider, table.model, table.serviceType, table.unit)]);
