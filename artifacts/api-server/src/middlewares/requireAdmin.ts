import { clerkClient } from "@clerk/express";
import type { RequestHandler } from "express";

export async function bootstrapApprovedAdmin(userId: string): Promise<boolean> {
  const approvedEmail = process.env.STUDIO_INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const user = await clerkClient.users.getUser(userId);

  if (!approvedEmail || user.publicMetadata.studioAdminBootstrapComplete === true) {
    return user.publicMetadata.role === "admin";
  }

  const hasVerifiedApprovedEmail = user.emailAddresses.some(
    (address) =>
      address.emailAddress.trim().toLowerCase() === approvedEmail
      && address.verification?.status === "verified",
  );
  if (!hasVerifiedApprovedEmail) {
    return user.publicMetadata.role === "admin";
  }

  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      role: "admin",
      studioAdminBootstrapComplete: true,
    },
  });
  return true;
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const userId = String(res.locals.userId ?? "");
  if (!userId) {
    res.status(401).json({ error: "Sign in to access administrator tools." });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    if (user.publicMetadata.role !== "admin") {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }
    res.locals.adminUserId = userId;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Could not verify administrator access");
    res.status(503).json({ error: "Administrator access could not be verified. Try again shortly." });
  }
};
