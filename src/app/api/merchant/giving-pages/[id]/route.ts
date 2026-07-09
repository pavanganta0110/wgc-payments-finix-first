import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const page = await prisma.givingPage.findFirst({ where: { id, churchId: session.churchId } });
  if (!page) {
    return NextResponse.json({ error: "Giving page not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.logoUrl === "string") data.logoUrl = body.logoUrl || null;
  if (typeof body.headline === "string") data.headline = body.headline || null;
  if (typeof body.description === "string") data.description = body.description || null;
  if (typeof body.primaryColorHex === "string") data.primaryColorHex = body.primaryColorHex;
  if (Array.isArray(body.suggestedAmountsCents)) data.suggestedAmountsJson = body.suggestedAmountsCents;
  if (typeof body.allowRecurring === "boolean") data.allowRecurring = body.allowRecurring;
  if (typeof body.allowFeeCoverage === "boolean") data.allowFeeCoverage = body.allowFeeCoverage;

  const updated = await prisma.givingPage.update({ where: { id }, data });
  return NextResponse.json({ page: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const page = await prisma.givingPage.findFirst({ where: { id, churchId: session.churchId } });
  if (!page) {
    return NextResponse.json({ error: "Giving page not found" }, { status: 404 });
  }
  if (page.isDefault) {
    return NextResponse.json({ error: "Disable your default giving page instead of deleting it" }, { status: 400 });
  }

  await prisma.givingPage.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
