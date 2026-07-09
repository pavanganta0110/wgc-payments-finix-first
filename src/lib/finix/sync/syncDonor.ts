import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";

/**
 * Upserts a Donor from a Finix identity (the buyer identity attached to a
 * payment instrument/transfer). Finix identities expose contact info under
 * `entity`: first_name/last_name, email, phone. Deduped by finixIdentityId
 * (unique), which is stable per Finix buyer identity.
 */
export async function upsertDonorFromIdentity(
  finixIdentityId: string,
  churchId: string
): Promise<string | null> {
  if (!finixIdentityId || !churchId) return null;

  const existing = await prisma.donor.findUnique({ where: { finixIdentityId } });

  let identity: any;
  try {
    identity = await finixClient.getIdentity(finixIdentityId);
  } catch (err) {
    console.error("Failed to fetch Finix identity for donor sync:", err);
    return existing?.id ?? null;
  }

  const entity = identity?.entity ?? {};
  const name =
    entity.first_name || entity.last_name
      ? `${entity.first_name ?? ""} ${entity.last_name ?? ""}`.trim()
      : entity.business_name ?? null;
  const email = entity.email ?? null;
  const phone = entity.phone ?? null;

  const donor = await prisma.donor.upsert({
    where: { finixIdentityId },
    create: {
      churchId,
      finixIdentityId,
      name,
      email,
      phone,
    },
    update: {
      name: name ?? undefined,
      email: email ?? undefined,
      phone: phone ?? undefined,
    },
  });

  return donor.id;
}
