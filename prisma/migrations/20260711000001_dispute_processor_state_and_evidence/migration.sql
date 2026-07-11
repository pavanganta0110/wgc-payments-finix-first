-- AlterTable
ALTER TABLE "FinixDispute" ADD COLUMN     "displayStatus" TEXT,
ADD COLUMN     "processorState" TEXT;

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "churchId" TEXT,
    "uploadedByEmail" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "finixFileId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeEvidence_churchId_idx" ON "DisputeEvidence"("churchId");

-- CreateIndex
CREATE INDEX "FinixDispute_churchId_idx" ON "FinixDispute"("churchId");

-- CreateIndex
CREATE INDEX "FinixDispute_displayStatus_idx" ON "FinixDispute"("displayStatus");

-- CreateIndex
CREATE INDEX "FinixDispute_evidenceDueAt_idx" ON "FinixDispute"("evidenceDueAt");

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "FinixDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (matches convention on other Finix* tables)
ALTER TABLE "DisputeEvidence" ENABLE ROW LEVEL SECURITY;
