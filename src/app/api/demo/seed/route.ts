import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const churchId = "demo_church_123"

    // Cleanup first
    await prisma.finixTransfer.deleteMany({ where: { churchId } })
    await prisma.refund.deleteMany({ where: { charge: { transfer: { churchId } } } })
    await prisma.charge.deleteMany({ where: { transfer: { churchId } } })
    await prisma.payment.deleteMany({ where: { churchId } })
    await prisma.invoice.deleteMany({ where: { churchId } })
    await prisma.client.deleteMany({ where: { churchId } })
    await prisma.churchPricing.deleteMany({ where: { churchId } })
    await prisma.externalDonation.deleteMany({ where: { churchId } })
    await prisma.donor.deleteMany({ where: { id: { startsWith: 'demo_' } } })
    await prisma.user.deleteMany({ where: { email: "admin@gracecommunity.org" } })
    await prisma.church.deleteMany({ where: { id: churchId } })
    await prisma.onboardingApplication.deleteMany({ where: { id: `demo_onboarding_${churchId}` } })

    const onboarding = await prisma.onboardingApplication.create({
      data: {
        id: `demo_onboarding_${churchId}`,
        organizationName: "Grace Community Church",
        organizationType: "NON_PROFIT",
        contactName: "Admin User",
        contactEmail: "admin@gracecommunity.org",
        status: "APPROVED",
        processingEnabled: true,
        hasAcceptedCreditCardsPreviously: true,
        finixMerchantId: "MU_test_123",
        finixIdentityId: "ID_test_123"
      }
    })

    const church = await prisma.church.create({
      data: {
        id: churchId,
        name: "Grace Community Church",
        slug: "grace-community",
        primaryContactEmail: "admin@gracecommunity.org",
        status: "ACTIVE",
        finixMerchantId: "MU_test_123",
        onboardingApplicationId: onboarding.id
      }
    })

    await prisma.churchPricing.create({
      data: {
        churchId,
        platformFeeCents: 0,
        platformFeePercent: 0,
        cardProcessingFeePercent: 2.9,
        cardProcessingFeeCents: 30,
        achProcessingFeePercent: 1.0,
        achProcessingFeeCents: 0,
        achProcessingFeeMaxCents: 500,
        disputeFeeCents: 1500,
        refundFeeCents: 0,
        effectiveDate: new Date(),
        status: "ACTIVE"
      }
    })

    await prisma.user.create({
      data: {
        id: "demo_user_123",
        email: "admin@gracecommunity.org",
        name: "Admin User",
        role: "owner",
        churchId: church.id,
        disabledAt: null,
      }
    })

    return NextResponse.json({ success: true, message: "Seeded demo successfully!" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
