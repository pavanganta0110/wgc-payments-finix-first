import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const q = searchParams.get("q")?.trim();
  const sort = searchParams.get("sort") === "oldest" ? "asc" : "desc";

  const where: any = {};
  if (status && status !== "ALL") where.status = status;
  if (type && type !== "ALL") where.type = type;
  if (q) {
    where.OR = [
      { to: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }

  const [logs, types] = await Promise.all([
    prisma.emailLog.findMany({ where, orderBy: { createdAt: sort }, take: 200 }),
    prisma.emailLog.findMany({ distinct: ["type"], select: { type: true }, orderBy: { type: "asc" } }),
  ]);

  return NextResponse.json({ logs, types: types.map((t) => t.type) });
}
