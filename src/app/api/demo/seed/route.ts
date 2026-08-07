import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const churchId = "demo_church_123"

    // Cleanup first
    await prisma.finixTransfer.deleteMany({ where: { churchId } })
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
        cardPercentageFee: 2.9,
        cardFixedFeeCents: 30,
        achFixedFeeCents: 0,
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

    const transfers: any[] = []
    const refunds: any[] = []
    const disputes: any[] = []

    const now = new Date()
    
    // Generate 30 successful transfers over the last 30 days
    for (let i = 0; i < 30; i++) {
      const d = new Date()
      d.setDate(now.getDate() - i)
      const amountCents = Math.floor(Math.random() * 50000) + 1000 // $10 to $510
      
      transfers.push({
        churchId,
        finixTransferId: `TR_demo_${i}`,
        state: "SUCCEEDED",
        amountCents,
        createdAtFinix: d,
      })
      
      // Make 2 of them have refunds
      if (i === 5 || i === 15) {
        refunds.push({
          churchId,
          finixReversalId: `REV_demo_${i}`,
          finixOriginalTransferId: `TR_demo_${i}`,
          state: "SUCCEEDED",
          amountCents: Math.floor(amountCents / 2),
          createdAtFinix: d,
        })
      }

      // Make 1 of them have a dispute
      if (i === 10) {
        disputes.push({
          churchId,
          finixDisputeId: `DISP_demo_${i}`,
          finixTransferId: `TR_demo_${i}`,
          state: "PENDING",
          amountCents,
          createdAtFinix: d,
        })
      }
    }

    // Cleanup previous dummy transactions just in case (though we did it above)
    await prisma.finixDispute.deleteMany({ where: { churchId } })
    await prisma.finixRefundOrReversal.deleteMany({ where: { churchId } })

    // Insert new data
    await prisma.finixTransfer.createMany({ data: transfers })
    await prisma.finixRefundOrReversal.createMany({ data: refunds })
    await prisma.finixDispute.createMany({ data: disputes })

    return NextResponse.json({ success: true, message: "Seeded demo successfully!" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
