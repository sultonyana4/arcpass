-- AlterTable: Add blockchain event data fields to relay_transactions
ALTER TABLE "relay_transactions" ADD COLUMN "blockNumber" BIGINT;
ALTER TABLE "relay_transactions" ADD COLUMN "eventName" VARCHAR(100);
ALTER TABLE "relay_transactions" ADD COLUMN "eventData" JSONB;

-- CreateIndex: Partial unique index to enforce one non-terminal sponsorship request per wallet
CREATE UNIQUE INDEX "sponsorship_requests_wallet_non_terminal"
ON "sponsorship_requests" ("walletId")
WHERE status IN ('pending', 'approved', 'relayed');
