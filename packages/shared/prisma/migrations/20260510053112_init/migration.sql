-- CreateEnum
CREATE TYPE "SponsorshipRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'relayed', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RelayTransactionStatus" AS ENUM ('queued', 'submitted', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "RateLimitIdentifierType" AS ENUM ('ip', 'wallet', 'user_agent');

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "walletAddress" VARCHAR(255) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sponsorshipCount" INTEGER NOT NULL DEFAULT 0,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" VARCHAR(500),

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsorship_requests" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" "SponsorshipRequestStatus" NOT NULL DEFAULT 'pending',
    "eligibilityReason" VARCHAR(500),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(1024),

    CONSTRAINT "sponsorship_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_transactions" (
    "id" TEXT NOT NULL,
    "sponsorshipRequestId" TEXT NOT NULL,
    "transactionHash" VARCHAR(255),
    "status" "RelayTransactionStatus" NOT NULL DEFAULT 'queued',
    "relayAttempt" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(1000),

    CONSTRAINT "relay_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "identifierType" "RateLimitIdentifierType" NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_walletAddress_key" ON "wallets"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "relay_transactions_transactionHash_key" ON "relay_transactions"("transactionHash");

-- CreateIndex
CREATE INDEX "rate_limits_identifier_identifierType_idx" ON "rate_limits"("identifier", "identifierType");

-- AddForeignKey
ALTER TABLE "sponsorship_requests" ADD CONSTRAINT "sponsorship_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_transactions" ADD CONSTRAINT "relay_transactions_sponsorshipRequestId_fkey" FOREIGN KEY ("sponsorshipRequestId") REFERENCES "sponsorship_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
