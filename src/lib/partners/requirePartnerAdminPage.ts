import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partners/partnerSession";

/** For the pages a reports-only person must not open: sends them back to Organizations. */
export async function requirePartnerAdminPage(): Promise<void> {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "ADMIN") redirect("/partner/organizations");
}
