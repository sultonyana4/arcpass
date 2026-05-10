// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SponsorVault.sol";
import "../src/SponsorshipRegistry.sol";

/// @title Deploy
/// @notice Deterministic two-phase deployment of ArcPass contracts to Arc testnet.
/// @dev Deployment flow:
///      1. Deploy SponsorVault (without registry)
///      2. Deploy SponsorshipRegistry (with vault address)
///      3. Initialize registry in SponsorVault (one-time)
///      4. Validate deployment integrity
contract Deploy is Script {
    function run() external {
        // ─── Configuration ───────────────────────────────────────────────────────
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Operator defaults to deployer if not set (can be updated post-deploy)
        address operator = vm.envOr("OPERATOR_ADDRESS", deployer);

        // Default per-transaction limit: 0.001 ETH (1e15 wei)
        uint256 perTxLimit = vm.envOr("PER_TRANSACTION_LIMIT_WEI", uint256(1000000000000000));

        // ─── Validation ──────────────────────────────────────────────────────────
        require(deployer != address(0), "Deploy: invalid deployer address");
        require(operator != address(0), "Deploy: invalid operator address");
        require(perTxLimit > 0, "Deploy: per-transaction limit must be > 0");

        console2.log("=== ArcPass Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Operator:", operator);
        console2.log("Per-Tx Limit (wei):", perTxLimit);
        console2.log("");

        // ─── Phase 1: Deploy SponsorVault ────────────────────────────────────────
        vm.startBroadcast(deployerPrivateKey);

        SponsorVault vault = new SponsorVault(operator, perTxLimit);
        console2.log("Phase 1: SponsorVault deployed at:", address(vault));

        // ─── Phase 2: Deploy SponsorshipRegistry ─────────────────────────────────
        SponsorshipRegistry registry = new SponsorshipRegistry(address(vault));
        console2.log("Phase 2: SponsorshipRegistry deployed at:", address(registry));

        // ─── Phase 3: Initialize Registry in Vault ───────────────────────────────
        vault.initializeRegistry(address(registry));
        console2.log("Phase 3: Registry initialized in SponsorVault");

        vm.stopBroadcast();

        // ─── Phase 4: Validate Deployment ────────────────────────────────────────
        console2.log("");
        console2.log("=== Deployment Validation ===");

        // Validate ownership
        require(vault.owner() == deployer, "Deploy: vault owner mismatch");
        console2.log("[OK] Vault owner:", vault.owner());

        // Validate operator
        require(vault.operator() == operator, "Deploy: vault operator mismatch");
        console2.log("[OK] Vault operator:", vault.operator());

        // Validate registry linkage
        require(address(vault.registry()) == address(registry), "Deploy: registry linkage mismatch");
        console2.log("[OK] Vault registry:", address(vault.registry()));

        // Validate vault linkage in registry
        require(registry.vault() == address(vault), "Deploy: vault address mismatch in registry");
        console2.log("[OK] Registry vault:", registry.vault());

        // Validate per-transaction limit
        require(vault.perTransactionLimit() == perTxLimit, "Deploy: per-tx limit mismatch");
        console2.log("[OK] Per-tx limit:", vault.perTransactionLimit());

        // Validate non-zero addresses
        require(address(vault) != address(0), "Deploy: vault is zero address");
        require(address(registry) != address(0), "Deploy: registry is zero address");
        console2.log("[OK] All addresses non-zero");

        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("SPONSOR_VAULT_ADDRESS=", address(vault));
        console2.log("SPONSORSHIP_REGISTRY_ADDRESS=", address(registry));
    }
}
