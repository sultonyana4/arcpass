# ArcPass Contracts

Smart contracts for the ArcPass sponsorship relay infrastructure on Arc Network.

## Architecture

```
SponsorVault (holds treasury, executes transfers)
    │
    ├── owner: manages config, sets operator, emergency withdraw
    ├── operator: executes sponsorTransfer()
    └── registry ──► SponsorshipRegistry (on-chain accounting)
                         └── vault (immutable, authorizes recordSponsorship calls)
```

**Two-phase initialization** breaks the circular constructor dependency:
1. `SponsorVault` deploys without a registry reference
2. `SponsorshipRegistry` deploys with the vault address (immutable)
3. `vault.initializeRegistry(registry)` links them (one-time, owner-only)

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- Arc testnet RPC access
- Funded deployer wallet on Arc testnet

## Build

```bash
cd contracts
forge build
```

## Test

```bash
forge test
```

## Deploy to Arc Testnet

### 1. Configure environment

Copy the root `.env.example` and fill in deployment values:

```bash
cp .env.example .env
```

Required variables:
| Variable | Description |
|----------|-------------|
| `ARC_RPC_URL` | Arc testnet RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Private key of the deployer wallet (never commit) |

Optional variables:
| Variable | Default | Description |
|----------|---------|-------------|
| `OPERATOR_ADDRESS` | deployer address | Relay worker authorized to call `sponsorTransfer` |
| `PER_TRANSACTION_LIMIT_WEI` | `1000000000000000` (0.001 ETH) | Max sponsorship per tx |

### 2. Run deployment

```bash
source .env

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

### 3. Expected deployment flow

```
Phase 1: Deploy SponsorVault (operator, perTxLimit)
Phase 2: Deploy SponsorshipRegistry (vault address)
Phase 3: Initialize registry in vault (one-time call)
Phase 4: Validate deployment integrity
```

The script outputs deployed addresses:
```
SPONSOR_VAULT_ADDRESS=0x...
SPONSORSHIP_REGISTRY_ADDRESS=0x...
```

Update your `.env` with these addresses for the API and worker services.

### 4. Verify contracts (if block explorer available)

```bash
forge verify-contract <VAULT_ADDRESS> SponsorVault \
  --rpc-url $ARC_RPC_URL \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" $OPERATOR_ADDRESS $PER_TRANSACTION_LIMIT_WEI)

forge verify-contract <REGISTRY_ADDRESS> SponsorshipRegistry \
  --rpc-url $ARC_RPC_URL \
  --constructor-args $(cast abi-encode "constructor(address)" $SPONSOR_VAULT_ADDRESS)
```

## Contract Details

### SponsorVault

- Holds native token treasury
- Owner/operator access control
- `initializeRegistry()` — one-time registry linkage (owner-only)
- `sponsorTransfer()` — executes sponsorship (operator-only)
- `emergencyWithdraw()` — safety valve (owner-only)

### SponsorshipRegistry

- On-chain sponsorship accounting
- `vault` is immutable (set at construction)
- `recordSponsorship()` — restricted to vault address
- `isSponsored()` / `sponsorshipCount()` — public view functions

## Security Notes

- Never commit private keys or `.env` files
- The `initializeRegistry()` function can only be called once
- `sponsorTransfer()` reverts if registry is not initialized
- Checks-effects-interactions pattern prevents reentrancy
- Per-transaction limit caps individual sponsorship amounts
