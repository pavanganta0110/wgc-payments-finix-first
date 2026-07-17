import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ applications: [] });

  const applications = await prisma.onboardingApplication.findMany({
    where: {
      OR: [
        { organizationName: { contains: q, mode: "insensitive" } },
        { contactName: { contains: q, mode: "insensitive" } },
        { contactEmail: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, organizationName: true, contactName: true, contactEmail: true, status: true },
    orderBy: { organizationName: "asc" },
    take: 10,
  });

  return NextResponse.json({ applications });
}
