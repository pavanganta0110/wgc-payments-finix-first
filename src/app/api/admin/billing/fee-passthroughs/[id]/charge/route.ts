import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth/session";
import { resolveWgcAdminBillingPermissions } from "@/lib/auth/billingAdminPermissions";
import { chargeFeePassthrough, FeePassthroughError } from "@/lib/billing/merchantFeePassthrough";

/**
 * The only place in the codebase that actually moves money for a Finix
 * operational-fee pass-through (chargeback, ACH return) — requires an
 * authenticated WGC billing admin with canManageBilling AND explicit
 * confirmation in the request body. There is no automatic/cron path that
 * reaches this; flagging never auto-charges.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { permissionsJson: true } });
  const perms = resolveWgcAdminBillingPermissions(session.role, user?.permissionsJson);
  if (!perms.canManageBilling) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Confirmation is required to charge a real payment method." }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result = await chargeFeePassthrough(id, { userId: session.userId, email: session.email, role: session.role });
    return NextResponse.json({ success: true, charge: result });
  } catch (err) {
    if (err instanceof FeePassthroughError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Fee passthrough charge failed:", err);
    return NextResponse.json({ error: "Something went wrong processing this charge." }, { status: 500 });
  }
}
