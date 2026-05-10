// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title SponsorshipRegistry
/// @notice On-chain accounting and verification of sponsorships.
/// @dev Only the configured vault address can record sponsorships.
contract SponsorshipRegistry {
    // ─── Errors ──────────────────────────────────────────────────────────────────

    /// @notice Thrown when a caller other than the vault attempts to record a sponsorship.
    error Unauthorized();

    // ─── Events ──────────────────────────────────────────────────────────────────

    /// @notice Emitted when a sponsorship is recorded for a recipient.
    /// @param recipient The wallet that received the sponsorship.
    /// @param amount The amount of native tokens sponsored.
    /// @param timestamp The block timestamp when the sponsorship was recorded.
    event SponsorshipGranted(address indexed recipient, uint256 amount, uint256 timestamp);

    // ─── State ───────────────────────────────────────────────────────────────────

    /// @notice The vault address authorized to record sponsorships.
    address public immutable vault;

    /// @notice Mapping of wallet addresses to their sponsorship count.
    mapping(address => uint256) public sponsorshipCount;

    // ─── Constructor ─────────────────────────────────────────────────────────────

    /// @param _vault The address of the SponsorVault contract authorized to call recordSponsorship.
    constructor(address _vault) {
        vault = _vault;
    }

    // ─── External Functions ──────────────────────────────────────────────────────

    /// @notice Records a sponsorship for the given recipient. Restricted to the vault.
    /// @param recipient The wallet address that received the sponsorship.
    /// @param amount The amount of native tokens sponsored.
    function recordSponsorship(address recipient, uint256 amount) external {
        if (msg.sender != vault) {
            revert Unauthorized();
        }

        sponsorshipCount[recipient] += 1;

        emit SponsorshipGranted(recipient, amount, block.timestamp);
    }

    /// @notice Returns whether a wallet has been sponsored at least once.
    /// @param wallet The wallet address to check.
    /// @return True if the wallet has a sponsorship count greater than zero.
    function isSponsored(address wallet) external view returns (bool) {
        return sponsorshipCount[wallet] > 0;
    }
}
