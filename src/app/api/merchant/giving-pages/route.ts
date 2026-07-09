import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pages = await prisma.givingPage.findMany({
    where: { churchId: session.churchId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ pages });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const church = await prisma.church.findUnique({ where: { id: session.churchId } });
  const baseSlug = slugify(`${church?.slug || "give"}-${name}`);
  let slug = baseSlug;
  let n = 1;
  while (await prisma.givingPage.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const existingCount = await prisma.givingPage.count({ where: { churchId: session.churchId } });

  const page = await prisma.givingPage.create({
    data: {
      churchId: session.churchId,
      slug,
      name,
      isDefault: existingCount === 0,
      logoUrl: body.logoUrl || null,
      headline: body.headline || null,
      description: body.description || null,
      primaryColorHex: body.primaryColorHex || "#eab308",
      suggestedAmountsJson: Array.isArray(body.suggestedAmountsCents) ? body.suggestedAmountsCents : undefined,
      allowRecurring: body.allowRecurring ?? true,
      allowFeeCoverage: body.allowFeeCoverage ?? true,
    },
  });

  return NextResponse.json({ page });
}
