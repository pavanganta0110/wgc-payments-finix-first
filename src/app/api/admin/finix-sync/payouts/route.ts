import { NextResponse } from "next/server";

/**
 * Stub — payout sync is not implemented yet. See TODO in
 * src/lib/finix/sync/syncPayouts.ts (FinixClient has no funding transfer
 * attempt methods, and the exact Finix payout API shape is unconfirmed).
 */
export async function POST() {
  return NextResponse.json(
    { error: "Payout sync not implemented yet — see src/lib/finix/sync/syncPayouts.ts" },
    { status: 501 }
  );
}
