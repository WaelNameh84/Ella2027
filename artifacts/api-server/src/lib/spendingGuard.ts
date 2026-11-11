import { eq } from "drizzle-orm";
import { db, providerSettingsTable } from "@workspace/db";

export const ZERO_SPEND_ERROR = "Free mode is enabled. Turn it off in Provider Settings before using an external provider.";

export async function isZeroSpendMode(userId: string): Promise<boolean> {
  try {
    const [settings] = await db.select({ freeMode: providerSettingsTable.freeMode })
      .from(providerSettingsTable)
      .where(eq(providerSettingsTable.userId, userId))
      .limit(1);
    return settings?.freeMode ?? true;
  } catch {
    // Fail closed if the new database field has not yet been applied.
    return true;
  }
}
