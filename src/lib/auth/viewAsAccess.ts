import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession, type MerchantAuthContext } from "./requireMerchantSession";
import { resolveViewScope } from "./viewScope";
import { normalizeMerchantRole } from "./roles";
import { getSettlementPermissions } from "@/lib/finix/settlementPermissions";

/**
 * While someone with "view as" is looking at the dashboard as a teammate, what they see
 * (the menu, and the organization-level pages) should be what that teammate would see, not what
 * the viewer's own role allows. This returns a copy of the viewer's context that carries the
 * teammate's role and permission overrides, or the same context when nobody is being viewed as.
 *
 * It is for display only: every write is still checked against the viewer's own real context, and
 * view-as already blocks sensitive writes (see requireFullOrganizationContext). A teammate who is
 * disabled, deleted or in another organization falls back to the viewer's own context, because
 * resolveViewScope already rejects those targets.
 */
export async function resolveViewAsAuth(auth: MerchantAuthContext): Promise<MerchantAuthContext> {
  const { effective, isViewingAsOther } = await resolveViewScope(auth);
  if (!isViewingAsOther || effective.kind !== "user") return auth;

  const target = await prisma.user.findFirst({
    where: { id: effective.userId, churchId: auth.churchId },
    select: { role: true, permissionsJson: true },
  });
  if (!target) return auth;

  return {
    ...auth,
    rawRole: target.role as MerchantAuthContext["rawRole"],
    role: normalizeMerchantRole(target.role),
    permissionsJson: target.permissionsJson,
    isWgcAdmin: false,
    impersonation: undefined,
  };
}

/**
 * For Deposits and Settlements pages: when viewing as a teammate who could not open them,
 * send the viewer to the dashboard, exactly where that teammate would be sent.
 */
export async function redirectIfViewAsLacksSettlementAccess(): Promise<void> {
  const auth = await requireMerchantSession(true);
  const viewAuth = await resolveViewAsAuth(auth);
  if (viewAuth !== auth && !getSettlementPermissions(viewAuth.role).canView) {
    redirect("/merchant/dashboard");
  }
}
