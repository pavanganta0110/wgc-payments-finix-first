-- AlterTable
ALTER TABLE "FinixFee" ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "FinixSettlement" ADD COLUMN     "tagsJson" JSONB;

-- AlterTable
ALTER TABLE "FinixFundingTransferAttempt" ADD COLUMN     "linkConfidence" TEXT DEFAULT 'inferred',
ADD COLUMN     "tagsJson" JSONB;

-- CreateIndex
CREATE INDEX "FinixFee_settlementId_idx" ON "FinixFee"("settlementId");

-- CreateIndex
CREATE INDEX "FinixSettlement_churchId_idx" ON "FinixSettlement"("churchId");

-- CreateIndex
CREATE INDEX "FinixSettlement_state_idx" ON "FinixSettlement"("state");

-- CreateIndex
CREATE INDEX "FinixFundingTransferAttempt_churchId_idx" ON "FinixFundingTransferAttempt"("churchId");

-- CreateIndex
CREATE INDEX "FinixFundingTransferAttempt_finixSettlementId_idx" ON "FinixFundingTransferAttempt"("finixSettlementId");

-- CreateIndex
CREATE INDEX "FinixFundingTransferAttempt_state_idx" ON "FinixFundingTransferAttempt"("state");

-- AddForeignKey
ALTER TABLE "FinixFee" ADD CONSTRAINT "FinixFee_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "FinixSettlement"("finixSettlementId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinixFundingTransferAttempt" ADD CONSTRAINT "FinixFundingTransferAttempt_finixSettlementId_fkey" FOREIGN KEY ("finixSettlementId") REFERENCES "FinixSettlement"("finixSettlementId") ON DELETE SET NULL ON UPDATE CASCADE;
