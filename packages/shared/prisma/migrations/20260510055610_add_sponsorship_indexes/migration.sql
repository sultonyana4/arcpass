-- CreateIndex
CREATE INDEX "relay_transactions_sponsorshipRequestId_idx" ON "relay_transactions"("sponsorshipRequestId");

-- CreateIndex
CREATE INDEX "sponsorship_requests_walletId_status_idx" ON "sponsorship_requests"("walletId", "status");

-- CreateIndex
CREATE INDEX "sponsorship_requests_walletId_idx" ON "sponsorship_requests"("walletId");
