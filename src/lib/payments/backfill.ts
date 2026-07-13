import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { normalizeCardBrand, CARD_FEE_CONFIG } from "@/lib/giving/feeCalculator";

export async function reconcilePaymentFees(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return null;

  // If already calculated, do not overwrite unless calculation version is empty
  if (payment.feeCalculationVersion) {
    return payment;
  }

  try {
    const transfer = await finixClient.getTransfer(payment.finixTransferId);
    if (!transfer?.id) return payment;

    const supplementalFeeCents = transfer.supplemental_fee || 0;
    const totalChargedCents = transfer.amount || payment.amountCents;
    const brand = normalizeCardBrand(transfer.card?.brand);

    // Solve donorCoversFee safely:
    // If total charge is greater than the base donation amount, the donor covers it.
    // If total charge is exactly equal to the base donation amount, the organization covers it.
    let donorCoversFee: boolean | null = null;
    if (totalChargedCents > payment.donationAmountCents) {
      donorCoversFee = true;
    } else if (totalChargedCents === payment.donationAmountCents) {
      donorCoversFee = false;
    }

    const config = CARD_FEE_CONFIG[brand as keyof typeof CARD_FEE_CONFIG] || CARD_FEE_CONFIG.DEFAULT;
    const percentageBps = config.percentageBps;
    const fixedFeeCents = config.fixedFeeCents;

    let merchantExpectedNetCents = payment.donationAmountCents;
    if (donorCoversFee === false) {
      merchantExpectedNetCents = payment.donationAmountCents - supplementalFeeCents;
    } else if (donorCoversFee === null) {
      merchantExpectedNetCents = totalChargedCents - supplementalFeeCents;
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        donorCoversFee,
        cardBrand: brand,
        percentageBps,
        fixedFeeCents,
        feeCalculationVersion: "historical_backfilled",
        merchantExpectedNetCents,
        feeCoveredCents: supplementalFeeCents,
      },
    });

    return updated;
  } catch (err) {
    console.error(`Failed to backfill payment fees for payment ${paymentId}:`, err);
    return payment;
  }
}
