import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth/session";
import { resolveWgcAdminBillingPermissions } from "@/lib/auth/billingAdminPermissions";
import { waiveFeePassthrough, FeePassthroughError } from "@/lib/billing/merchantFeePassthrough";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { permissionsJson: true } });
  const perms = resolveWgcAdminBillingPermissions(session.role, user?.permissionsJson);
  if (!perms.canManageBilling) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required to waive a fee." }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result = await waiveFeePassthrough(id, { userId: session.userId, email: session.email, role: session.role }, reason);
    return NextResponse.json({ success: true, charge: result });
  } catch (err) {
    if (err instanceof FeePassthroughError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Fee passthrough waive failed:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
