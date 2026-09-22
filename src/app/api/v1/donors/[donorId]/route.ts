import { prisma } from "@/lib/prisma";
import { withApiAuth } from "@/lib/api/withApiAuth";
import { apiSuccess, apiError } from "@/lib/api/response";

export const GET = withApiAuth<{ params: Promise<{ donorId: string }> }>("donors:read", async (req, auth, requestId, { params }) => {
  const { donorId } = await params;

  const donor = await prisma.donor.findFirst({ where: { id: donorId, churchId: auth.churchId } });
  if (!donor) return apiError("not_found_error", "Donor not found.", requestId);

  return apiSuccess(
    {
      id: donor.id,
      name: donor.name,
      email: donor.email,
      phone: donor.phone,
      anonymousPreference: donor.anonymousPreference,
      createdAt: donor.createdAt,
      updatedAt: donor.updatedAt,
    },
    requestId
  );
});
