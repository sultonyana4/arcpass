// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title ISponsorshipRegistry
/// @notice Interface for the SponsorshipRegistry contract used by SponsorVault
interface ISponsorshipRegistry {
    /// @notice Returns the number of sponsorships recorded for a wallet
    /// @param wallet The wallet address to query
    /// @return The sponsorship count for the wallet
    function sponsorshipCount(address wallet) external view returns (uint256);

    /// @notice Records a sponsorship for a recipient
    /// @param recipient The wallet that received sponsorship
    /// @param amount The amount of native tokens sponsored
    function recordSponsorship(address recipient, uint256 amount) external;
}
