import { NextResponse } from "next/server";

/**
 * Stub — fee sync is not implemented yet. See TODO in
 * src/lib/finix/sync/syncFees.ts (FinixClient has no listFees() method,
 * and the exact Finix fee API shape is unconfirmed).
 */
export async function POST() {
  return NextResponse.json(
    { error: "Fee sync not implemented yet — see src/lib/finix/sync/syncFees.ts" },
    { status: 501 }
  );
}
