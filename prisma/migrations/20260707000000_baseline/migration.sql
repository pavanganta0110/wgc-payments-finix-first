-- CreateTable
CREATE TABLE "OnboardingApplication" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationType" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL,
    "finixIdentityId" TEXT,
    "finixMerchantId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "updateRequestedAt" TIMESTAMP(3),
    "updateReason" TEXT,
    "finixOnboardingFormId" TEXT,
    "onboardingStatus" TEXT,
    "verificationState" TEXT,
    "lastFinixEventId" TEXT,
    "lastFinixEventType" TEXT,
    "lastStatusChangedAt" TIMESTAMP(3),
    "updateRequestedReason" TEXT,
    "updateRequestedItems" TEXT,
    "updateRequestedCodes" JSONB,
    "rejectionReasonInternal" TEXT,
    "lastWebhookPayloadSummary" JSONB,
    "updateTokenHash" TEXT,
    "updateTokenExpiresAt" TIMESTAMP(3),
    "lastUpdateSubmittedAt" TIMESTAMP(3),
    "processingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "settlementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "achMaxTransactionAmountCents" INTEGER,
    "annualAchVolumeCents" INTEGER,
    "annualCardVolumeCents" INTEGER,
    "averageAchTransferAmountCents" INTEGER,
    "averageCardTransferAmountCents" INTEGER,
    "bankAccountType" TEXT,
    "bankCountry" TEXT,
    "bankCurrency" TEXT,
    "bankInstrumentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bankInstrumentId" TEXT,
    "bankLast4" TEXT,
    "bankName" TEXT,
    "businessAddressLine1" TEXT,
    "businessAddressLine2" TEXT,
    "businessCity" TEXT,
    "businessCountry" TEXT,
    "businessDescription" TEXT,
    "businessPhone" TEXT,
    "businessPostalCode" TEXT,
    "businessState" TEXT,
    "businessTaxIdProvided" BOOLEAN NOT NULL DEFAULT false,
    "businessToBusinessPercentage" INTEGER,
    "businessToConsumerPercentage" INTEGER,
    "businessType" TEXT,
    "cardPresentPercentage" INTEGER,
    "defaultStatementDescriptor" TEXT,
    "doingBusinessAs" TEXT,
    "ecommercePercentage" INTEGER,
    "finixApplicationId" TEXT,
    "finixPaymentInstrumentId" TEXT,
    "finixProcessor" TEXT,
    "finixVerificationId" TEXT,
    "hasAcceptedCreditCardsPreviously" BOOLEAN NOT NULL DEFAULT false,
    "incorporationDay" INTEGER,
    "incorporationMonth" INTEGER,
    "incorporationYear" INTEGER,
    "legalBusinessName" TEXT,
    "mailOrderTelephoneOrderPercentage" INTEGER,
    "maxTransactionAmountCents" INTEGER,
    "mcc" TEXT,
    "onboardingState" TEXT,
    "otherVolumePercentage" INTEGER,
    "ownershipType" TEXT,
    "principalAddressLine1" TEXT,
    "principalAddressLine2" TEXT,
    "principalCity" TEXT,
    "principalCountry" TEXT,
    "principalDobDay" INTEGER,
    "principalDobMonth" INTEGER,
    "principalDobYear" INTEGER,
    "principalEmail" TEXT,
    "principalFirstName" TEXT,
    "principalLastName" TEXT,
    "principalOwnershipPercentage" INTEGER,
    "principalPhone" TEXT,
    "principalPostalCode" TEXT,
    "principalState" TEXT,
    "principalTaxIdProvided" BOOLEAN NOT NULL DEFAULT false,
    "principalTitle" TEXT,
    "refundPolicy" TEXT,
    "terminationStatus" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,

    CONSTRAINT "OnboardingApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssociatedOwner" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT NOT NULL,
    "finixAssociatedIdentityId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "dobYear" INTEGER,
    "dobMonth" INTEGER,
    "dobDay" INTEGER,
    "ownershipPercentage" INTEGER,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "taxIdProvided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssociatedOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT NOT NULL,
    "acceptedWgcTermsAt" TIMESTAMP(3),
    "acceptedWgcFeesAt" TIMESTAMP(3),
    "acceptedWgcPrivacyAt" TIMESTAMP(3),
    "acceptedFinixTermsAt" TIMESTAMP(3),
    "acceptedFinixPrivacyAt" TIMESTAMP(3),
    "accepterName" TEXT NOT NULL,
    "accepterEmail" TEXT NOT NULL,
    "accepterIpAddress" TEXT,
    "accepterUserAgent" TEXT,
    "wgcTermsVersion" TEXT NOT NULL,
    "wgcFeesVersion" TEXT NOT NULL,
    "wgcPrivacyVersion" TEXT NOT NULL,
    "finixTermsUrl" TEXT NOT NULL,
    "finixPrivacyUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixWebhookEvent" (
    "id" TEXT NOT NULL,
    "finixEventId" TEXT NOT NULL,
    "entity" TEXT,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "merchantId" TEXT,
    "identityId" TEXT,
    "verificationId" TEXT,
    "onboardingState" TEXT,
    "verificationState" TEXT,
    "rawPayloadJson" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinixWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantDocument" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadStatus" TEXT NOT NULL,
    "finixFileId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT,
    "type" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT,
    "action" TEXT NOT NULL,
    "actorEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Church" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "primaryContactEmail" TEXT NOT NULL,
    "onboardingApplicationId" TEXT,
    "finixMerchantId" TEXT,
    "finixIdentityId" TEXT,
    "finixApplicationId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Church_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donor" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "finixIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "donorId" TEXT,
    "givingPageId" TEXT,
    "finixTransferId" TEXT,
    "finixBuyerIdentityId" TEXT,
    "finixPaymentInstrumentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "donationAmountCents" INTEGER,
    "feeCoveredCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentMethodType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failedAt" TIMESTAMP(3),
    "idempotencyId" TEXT,
    "fraudSessionId" TEXT,
    "receiptStatus" TEXT,
    "receiptSentAt" TIMESTAMP(3),
    "achAuthorizationAccepted" BOOLEAN NOT NULL DEFAULT false,
    "achAuthorizationAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billingInterval" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchSubscription" (
    "id" TEXT NOT NULL,
    "onboardingApplicationId" TEXT,
    "churchId" TEXT,
    "subscriptionPlanId" TEXT NOT NULL,
    "finixSubscriptionId" TEXT,
    "finixBuyerIdentityId" TEXT,
    "finixPaymentInstrumentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billingInterval" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "subscriptionPhase" TEXT,
    "firstChargeAt" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "paymentMethodType" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "bankLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ChurchSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "churchSubscriptionId" TEXT NOT NULL,
    "finixTransferId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixMerchantSnapshot" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixIdentityId" TEXT,
    "finixMerchantId" TEXT NOT NULL,
    "finixApplicationId" TEXT,
    "finixProcessor" TEXT,
    "onboardingState" TEXT,
    "merchantState" TEXT,
    "processingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "settlementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "verificationState" TEXT,
    "riskState" TEXT,
    "payoutProfileId" TEXT,
    "merchantProfileId" TEXT,
    "feeProfileId" TEXT,
    "terminationStatus" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "rawStateRedacted" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinixMerchantSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixTransfer" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "paymentId" TEXT,
    "finixTransferId" TEXT NOT NULL,
    "finixMerchantId" TEXT,
    "finixBuyerIdentityId" TEXT,
    "finixPaymentInstrumentId" TEXT,
    "finixSettlementId" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "state" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "feeCents" INTEGER,
    "applicationFeeCents" INTEGER,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "traceId" TEXT,
    "statementDescriptor" TEXT,
    "source" TEXT,
    "tagsJson" JSONB,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixRefundOrReversal" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "refundRequestId" TEXT,
    "originalPaymentId" TEXT,
    "finixReversalId" TEXT NOT NULL,
    "finixOriginalTransferId" TEXT,
    "finixMerchantId" TEXT,
    "finixSettlementId" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "state" TEXT,
    "reason" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "source" TEXT,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixRefundOrReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixFee" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixFeeId" TEXT,
    "linkedToId" TEXT,
    "linkedToType" TEXT,
    "feeType" TEXT,
    "amountCents" DOUBLE PRECISION,
    "currency" TEXT,
    "state" TEXT,
    "description" TEXT,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinixFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixSettlement" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixSettlementId" TEXT NOT NULL,
    "finixMerchantId" TEXT,
    "state" TEXT,
    "totalAmountCents" INTEGER,
    "netAmountCents" INTEGER,
    "feeAmountCents" INTEGER,
    "refundAmountCents" INTEGER,
    "disputeAmountCents" INTEGER,
    "currency" TEXT,
    "accruedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "rawJsonRedacted" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixFundingTransferAttempt" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixFundingTransferAttemptId" TEXT NOT NULL,
    "finixSettlementId" TEXT,
    "finixMerchantId" TEXT,
    "state" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "bankAccountLast4" TEXT,
    "bankAccountType" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "estimatedArrivalDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixFundingTransferAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixDispute" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixDisputeId" TEXT NOT NULL,
    "finixTransferId" TEXT,
    "paymentId" TEXT,
    "finixMerchantId" TEXT,
    "state" TEXT,
    "reason" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "evidenceDueAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixPaymentInstrumentSnapshot" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "donorId" TEXT,
    "finixPaymentInstrumentId" TEXT NOT NULL,
    "finixIdentityId" TEXT,
    "instrumentType" TEXT,
    "paymentMethodType" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "cardExpirationMonth" INTEGER,
    "cardExpirationYear" INTEGER,
    "bankLast4" TEXT,
    "bankAccountType" TEXT,
    "accountHolderName" TEXT,
    "state" TEXT,
    "enabled" BOOLEAN,
    "disabledCode" TEXT,
    "disabledMessage" TEXT,
    "securityCodeVerification" TEXT,
    "addressVerification" TEXT,
    "issuerCountry" TEXT,
    "addressCountry" TEXT,
    "instrumentUse" TEXT,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixPaymentInstrumentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixSubscription" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "churchSubscriptionId" TEXT,
    "finixSubscriptionId" TEXT NOT NULL,
    "finixMerchantId" TEXT,
    "finixBuyerIdentityId" TEXT,
    "finixPaymentInstrumentId" TEXT,
    "state" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "billingInterval" TEXT,
    "collectionMethod" TEXT,
    "nextBillingDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixSyncJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "churchId" TEXT,
    "finixMerchantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinixSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixRawEventArchive" (
    "id" TEXT NOT NULL,
    "finixEventId" TEXT,
    "entity" TEXT,
    "eventType" TEXT,
    "resourceId" TEXT,
    "churchId" TEXT,
    "finixMerchantId" TEXT,
    "payloadRedactedJson" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinixRawEventArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantStatusHistory" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "source" TEXT,
    "finixEventId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailTriggered" BOOLEAN NOT NULL DEFAULT false,
    "emailLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "reportType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossVolumeCents" INTEGER,
    "netVolumeCents" INTEGER,
    "refundAmountCents" INTEGER,
    "feeAmountCents" INTEGER,
    "disputeAmountCents" INTEGER,
    "payoutAmountCents" INTEGER,
    "donorCount" INTEGER,
    "transactionCount" INTEGER,
    "failedTransactionCount" INTEGER,
    "payloadJson" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "originalPaymentId" TEXT,
    "requestedByEmail" TEXT,
    "amountCents" INTEGER,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchPricing" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "pricingPlanName" TEXT,
    "cardPercentageFee" DOUBLE PRECISION,
    "cardFixedFeeCents" INTEGER,
    "achFixedFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChurchPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixFeeProfile" (
    "id" TEXT NOT NULL,
    "finixFeeProfileId" TEXT NOT NULL,
    "basisPoints" INTEGER,
    "fixedFeeCents" INTEGER,
    "achBasisPoints" INTEGER,
    "achFixedFeeCents" INTEGER,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixFeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixMerchantProfile" (
    "id" TEXT NOT NULL,
    "finixMerchantProfileId" TEXT NOT NULL,
    "finixFeeProfileId" TEXT,
    "finixPayoutProfileId" TEXT,
    "finixRiskProfileId" TEXT,
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixMerchantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL,
    "churchId" TEXT,
    "setPasswordTokenHash" TEXT,
    "setPasswordTokenExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinixAuthorization" (
    "id" TEXT NOT NULL,
    "churchId" TEXT,
    "finixAuthorizationId" TEXT NOT NULL,
    "finixMerchantId" TEXT,
    "finixTransferId" TEXT,
    "state" TEXT,
    "amountCents" INTEGER,
    "amountRequestedCents" INTEGER,
    "currency" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "isVoid" BOOLEAN,
    "voidState" TEXT,
    "expiresAt" TIMESTAMP(3),
    "rawJsonRedacted" JSONB,
    "createdAtFinix" TIMESTAMP(3),
    "updatedAtFinix" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FinixAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GivingPage" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "headline" TEXT,
    "description" TEXT,
    "primaryColorHex" TEXT NOT NULL DEFAULT '#eab308',
    "suggestedAmountsJson" JSONB,
    "allowRecurring" BOOLEAN NOT NULL DEFAULT true,
    "allowFeeCoverage" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GivingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinixWebhookEvent_finixEventId_key" ON "FinixWebhookEvent"("finixEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Church_slug_key" ON "Church"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Donor_finixIdentityId_key" ON "Donor"("finixIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixMerchantSnapshot_finixMerchantId_key" ON "FinixMerchantSnapshot"("finixMerchantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixTransfer_finixTransferId_key" ON "FinixTransfer"("finixTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixRefundOrReversal_finixReversalId_key" ON "FinixRefundOrReversal"("finixReversalId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixFee_finixFeeId_key" ON "FinixFee"("finixFeeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixSettlement_finixSettlementId_key" ON "FinixSettlement"("finixSettlementId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixFundingTransferAttempt_finixFundingTransferAttemptId_key" ON "FinixFundingTransferAttempt"("finixFundingTransferAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixDispute_finixDisputeId_key" ON "FinixDispute"("finixDisputeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixPaymentInstrumentSnapshot_finixPaymentInstrumentId_key" ON "FinixPaymentInstrumentSnapshot"("finixPaymentInstrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixSubscription_finixSubscriptionId_key" ON "FinixSubscription"("finixSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixRawEventArchive_finixEventId_key" ON "FinixRawEventArchive"("finixEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ChurchPricing_churchId_key" ON "ChurchPricing"("churchId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixFeeProfile_finixFeeProfileId_key" ON "FinixFeeProfile"("finixFeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "FinixMerchantProfile_finixMerchantProfileId_key" ON "FinixMerchantProfile"("finixMerchantProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FinixAuthorization_finixAuthorizationId_key" ON "FinixAuthorization"("finixAuthorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GivingPage_slug_key" ON "GivingPage"("slug");

-- AddForeignKey
ALTER TABLE "AssociatedOwner" ADD CONSTRAINT "AssociatedOwner_onboardingApplicationId_fkey" FOREIGN KEY ("onboardingApplicationId") REFERENCES "OnboardingApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantDocument" ADD CONSTRAINT "MerchantDocument_onboardingApplicationId_fkey" FOREIGN KEY ("onboardingApplicationId") REFERENCES "OnboardingApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

┌─────────────────────────────────────────────────────────┐
│  Update available 5.16.1 -> 7.8.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
