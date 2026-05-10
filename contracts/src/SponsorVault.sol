// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ISponsorshipRegistry} from "./ISponsorshipRegistry.sol";

/// @title SponsorVault
/// @notice Holds native token treasury and executes authorized sponsorship transfers.
/// @dev Uses an owner/operator access control pattern. The owner manages configuration,
///      while the operator (typically a relay worker) executes sponsorship transfers.
contract SponsorVault {
    // ─── Custom Errors ───────────────────────────────────────────────────────────

    /// @notice Thrown when a caller is not authorized for the requested action
    error Unauthorized();

    /// @notice Thrown when the requested amount exceeds the per-transaction limit
    /// @param requested The amount requested
    /// @param limit The configured per-transaction limit
    error ExceedsLimit(uint256 requested, uint256 limit);

    /// @notice Thrown when the vault balance is insufficient for the transfer
    /// @param requested The amount requested
    /// @param available The current vault balance
    error InsufficientBalance(uint256 requested, uint256 available);

    /// @notice Thrown when the recipient has already been sponsored
    /// @param recipient The address that was already sponsored
    error AlreadySponsored(address recipient);

    /// @notice Thrown when an invalid recipient address is provided
    error InvalidRecipient();

    /// @notice Thrown when an invalid amount is provided
    error InvalidAmount();

    // ─── Events ──────────────────────────────────────────────────────────────────

    /// @notice Emitted when a sponsorship transfer is executed
    /// @param recipient The address that received the sponsorship
    /// @param amount The amount of native tokens transferred
    event SponsorshipExecuted(address indexed recipient, uint256 amount);

    /// @notice Emitted when the operator address is updated
    /// @param previousOperator The previous operator address
    /// @param newOperator The new operator address
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);

    /// @notice Emitted when the per-transaction limit is updated
    /// @param previousLimit The previous limit
    /// @param newLimit The new limit
    event PerTransactionLimitUpdated(uint256 previousLimit, uint256 newLimit);

    /// @notice Emitted when an emergency withdrawal is executed
    /// @param to The address that received the withdrawn funds
    /// @param amount The amount withdrawn
    event EmergencyWithdrawal(address indexed to, uint256 amount);

    // ─── State Variables ─────────────────────────────────────────────────────────

    /// @notice The contract owner (deployer)
    address public owner;

    /// @notice The authorized operator that can execute sponsorship transfers
    address public operator;

    /// @notice The SponsorshipRegistry contract for on-chain accounting
    ISponsorshipRegistry public registry;

    /// @notice Maximum amount allowed per sponsorship transfer
    uint256 public perTransactionLimit;

    // ─── Constructor ─────────────────────────────────────────────────────────────

    /// @notice Deploys the SponsorVault
    /// @param _registry Address of the SponsorshipRegistry contract
    /// @param _operator Initial operator address
    /// @param _perTransactionLimit Initial per-transaction limit in wei
    constructor(address _registry, address _operator, uint256 _perTransactionLimit) {
        if (_registry == address(0)) revert InvalidRecipient();
        if (_operator == address(0)) revert InvalidRecipient();
        if (_perTransactionLimit == 0) revert InvalidAmount();

        owner = msg.sender;
        registry = ISponsorshipRegistry(_registry);
        operator = _operator;
        perTransactionLimit = _perTransactionLimit;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    /// @notice Restricts function access to the contract owner
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Restricts function access to the authorized operator
    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    // ─── Operator Functions ──────────────────────────────────────────────────────

    /// @notice Executes a sponsorship transfer to a recipient
    /// @dev Checks: caller == operator, amount <= perTransactionLimit,
    ///      balance >= amount, registry.sponsorshipCount(recipient) == 0.
    ///      Calls registry.recordSponsorship BEFORE transferring funds.
    /// @param recipient The address to receive the sponsorship
    /// @param amount The amount of native tokens to transfer
    function sponsorTransfer(address recipient, uint256 amount) external onlyOperator {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (amount > perTransactionLimit) revert ExceedsLimit(amount, perTransactionLimit);
        if (address(this).balance < amount) revert InsufficientBalance(amount, address(this).balance);
        if (registry.sponsorshipCount(recipient) != 0) revert AlreadySponsored(recipient);

        // Record sponsorship in registry BEFORE transferring funds (checks-effects-interactions)
        registry.recordSponsorship(recipient, amount);

        // Transfer native tokens to recipient
        (bool success,) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit SponsorshipExecuted(recipient, amount);
    }

    // ─── Owner Functions ─────────────────────────────────────────────────────────

    /// @notice Updates the authorized operator address
    /// @param newOperator The new operator address
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidRecipient();

        address previousOperator = operator;
        operator = newOperator;

        emit OperatorUpdated(previousOperator, newOperator);
    }

    /// @notice Updates the per-transaction limit
    /// @param limit The new per-transaction limit in wei
    function setPerTransactionLimit(uint256 limit) external onlyOwner {
        if (limit == 0) revert InvalidAmount();

        uint256 previousLimit = perTransactionLimit;
        perTransactionLimit = limit;

        emit PerTransactionLimitUpdated(previousLimit, limit);
    }

    /// @notice Emergency withdrawal of funds to a specified address
    /// @param to The address to receive the withdrawn funds
    /// @param amount The amount to withdraw
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (address(this).balance < amount) revert InsufficientBalance(amount, address(this).balance);

        (bool success,) = to.call{value: amount}("");
        require(success, "Transfer failed");

        emit EmergencyWithdrawal(to, amount);
    }

    // ─── Receive ─────────────────────────────────────────────────────────────────

    /// @notice Allows the contract to receive native tokens for funding
    receive() external payable {}
}
