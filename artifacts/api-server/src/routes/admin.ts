import { clerkClient } from "@clerk/express";
import { asc, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetAdminAccessResponse,
  GetAdminOverviewResponse,
  ListAdminJobsResponse,
  ListAdminProviderKeysResponse,
  ListAdminUsersResponse,
  UpdateAdminUserBody,
  UpdateAdminUserParams,
  UpdateAdminUserResponse,
} from "@workspace/api-zod";
import {
  db,
  projectsTable,
  providerKeysTable,
  scenesTable,
  studioJobsTable,
} from "@workspace/db";
import { requireAdmin, bootstrapApprovedAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();
type ClerkUser = Awaited<ReturnType<typeof clerkClient.users.getUser>>;

async function listClerkUsers() {
  return clerkClient.users.getUserList({ limit: 500 });
}

async function userCounts() {
  const [projects, jobs, providerKeys] = await Promise.all([
    db.select({ userId: projectsTable.userId, value: count() })
      .from(projectsTable)
      .groupBy(projectsTable.userId),
    db.select({ userId: studioJobsTable.userId, value: count() })
      .from(studioJobsTable)
      .groupBy(studioJobsTable.userId),
    db.select({ userId: providerKeysTable.userId, value: count() })
      .from(providerKeysTable)
      .groupBy(providerKeysTable.userId),
  ]);
  return {
    projects: new Map(projects.map((row) => [row.userId, Number(row.value)])),
    jobs: new Map(jobs.map((row) => [row.userId, Number(row.value)])),
    providerKeys: new Map(providerKeys.map((row) => [row.userId, Number(row.value)])),
  };
}

function adminUserDto(
  user: ClerkUser,
  counts: Awaited<ReturnType<typeof userCounts>>,
) {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    id: user.id,
    email: user.primaryEmailAddress?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null,
    displayName: displayName || null,
    role: user.publicMetadata.role === "admin" ? "admin" : "member",
    banned: user.banned,
    createdAt: new Date(user.createdAt),
    lastSignInAt: user.lastSignInAt === null ? null : new Date(user.lastSignInAt),
    projectCount: counts.projects.get(user.id) ?? 0,
    jobCount: counts.jobs.get(user.id) ?? 0,
    providerKeyCount: counts.providerKeys.get(user.id) ?? 0,
  };
}

function emailByUserId(users: ClerkUser[]) {
  return new Map(users.map((user) => [
    user.id,
    user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null,
  ]));
}

router.get("/admin/access", async (req, res): Promise<void> => {
  const userId = String(res.locals.userId);
  try {
    const isAdmin = await bootstrapApprovedAdmin(userId);
    const data = GetAdminAccessResponse.parse({
      isAdmin,
      role: isAdmin ? "admin" : "member",
    });
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve administrator access");
    res.status(503).json({ error: "Administrator access could not be checked. Try again shortly." });
  }
});

router.get("/admin/overview", requireAdmin, async (_req, res): Promise<void> => {
  const [users, projectCount, sceneCount, jobStatuses, enabledKeys, keyStatuses] = await Promise.all([
    clerkClient.users.getUserList({ limit: 1 }),
    db.select({ value: count() }).from(projectsTable),
    db.select({ value: count() }).from(scenesTable),
    db.select({ status: studioJobsTable.status, value: count() })
      .from(studioJobsTable)
      .groupBy(studioJobsTable.status),
    db.select({ value: count() }).from(providerKeysTable)
      .where(eq(providerKeysTable.enabled, true)),
    db.select({ status: providerKeysTable.status, value: count() })
      .from(providerKeysTable)
      .groupBy(providerKeysTable.status),
  ]);
  const jobs = new Map(jobStatuses.map((row) => [row.status, Number(row.value)]));
  const keys = new Map(keyStatuses.map((row) => [row.status, Number(row.value)]));
  res.json(GetAdminOverviewResponse.parse({
    userCount: users.totalCount,
    projectCount: Number(projectCount[0]?.value ?? 0),
    sceneCount: Number(sceneCount[0]?.value ?? 0),
    jobCount: Array.from(jobs.values()).reduce((sum, value) => sum + value, 0),
    queuedJobs: (jobs.get("queued") ?? 0) + (jobs.get("running") ?? 0),
    failedJobs: jobs.get("failed") ?? 0,
    enabledProviderKeys: Number(enabledKeys[0]?.value ?? 0),
    rateLimitedKeys: keys.get("rate_limited") ?? 0,
    quotaLimitedKeys: keys.get("quota_limited") ?? 0,
  }));
});

router.get("/admin/users", requireAdmin, async (_req, res): Promise<void> => {
  const [userResult, counts] = await Promise.all([listClerkUsers(), userCounts()]);
  res.json(ListAdminUsersResponse.parse(
    userResult.data.map((user) => adminUserDto(user, counts)),
  ));
});

router.patch("/admin/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse(req.params);
  const parsed = UpdateAdminUserBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const update = parsed.data;
  if ((update.role === undefined) === (update.banned === undefined)) {
    res.status(400).json({ error: "Update one account setting at a time." });
    return;
  }
  if (params.data.userId === String(res.locals.adminUserId)) {
    res.status(409).json({ error: "You cannot change your own administrator access or sign-in status." });
    return;
  }

  let target: ClerkUser;
  let userResult: Awaited<ReturnType<typeof listClerkUsers>>;
  try {
    [target, userResult] = await Promise.all([
      clerkClient.users.getUser(params.data.userId),
      listClerkUsers(),
    ]);
  } catch {
    res.status(404).json({ error: "User account not found." });
    return;
  }

  const activeAdmins = userResult.data.filter(
    (user) => user.publicMetadata.role === "admin" && !user.banned,
  );
  const wouldRemoveLastAdmin =
    target.publicMetadata.role === "admin"
    && !target.banned
    && (update.role === "member" || update.banned === true)
    && activeAdmins.length <= 1;
  if (wouldRemoveLastAdmin) {
    res.status(409).json({ error: "Keep at least one active administrator." });
    return;
  }

  try {
    if (update.role !== undefined) {
      await clerkClient.users.updateUserMetadata(target.id, {
        publicMetadata: { role: update.role },
      });
    } else if (update.banned) {
      await clerkClient.users.banUser(target.id);
    } else {
      await clerkClient.users.unbanUser(target.id);
    }
    const [freshUser, counts] = await Promise.all([
      clerkClient.users.getUser(target.id),
      userCounts(),
    ]);
    res.json(UpdateAdminUserResponse.parse(adminUserDto(freshUser, counts)));
  } catch (error) {
    req.log.error({ err: error, targetUserId: target.id }, "Could not update administrator-managed account");
    res.status(502).json({ error: "The account change could not be completed. Refresh and try again." });
  }
});

router.get("/admin/jobs", requireAdmin, async (_req, res): Promise<void> => {
  const [rows, userResult] = await Promise.all([
    db.select({
      job: studioJobsTable,
      projectTitle: projectsTable.title,
    })
      .from(studioJobsTable)
      .innerJoin(projectsTable, eq(studioJobsTable.projectId, projectsTable.id))
      .orderBy(desc(studioJobsTable.createdAt))
      .limit(100),
    listClerkUsers(),
  ]);
  const emailMap = emailByUserId(userResult.data);
  res.json(ListAdminJobsResponse.parse(rows.map(({ job, projectTitle }) => ({
    id: job.id,
    userId: job.userId,
    userEmail: emailMap.get(job.userId) ?? null,
    projectId: job.projectId,
    projectTitle,
    jobType: job.jobType,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }))));
});

router.get("/admin/provider-keys", requireAdmin, async (_req, res): Promise<void> => {
  const [rows, userResult] = await Promise.all([
    db.select().from(providerKeysTable)
      .orderBy(asc(providerKeysTable.priority), desc(providerKeysTable.createdAt))
      .limit(500),
    listClerkUsers(),
  ]);
  const emailMap = emailByUserId(userResult.data);
  res.json(ListAdminProviderKeysResponse.parse(rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userEmail: emailMap.get(row.userId) ?? null,
    provider: row.provider,
    label: row.label,
    serviceType: row.serviceType,
    enabled: row.enabled,
    priority: row.priority,
    status: row.status,
    lastTestAt: row.lastTestAt,
    usedCount: row.usedCount,
    cooldownUntil: row.cooldownUntil,
    createdAt: row.createdAt,
  }))));
});

export default router;
