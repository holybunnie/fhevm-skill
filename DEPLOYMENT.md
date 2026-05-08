# Deployment Guide — Confidential Lending on Sepolia

## Prerequisites

- Node.js 18+
- Sepolia ETH for gas (get from a faucet)
- Etherscan API key (for contract verification)

## Environment Setup

Create `.env` in `examples/confidential-lending-app/`:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY
```

## Deploy

```bash
cd examples/confidential-lending-app
npx hardhat run scripts/deploy.ts --network sepolia
```

This deploys MockCUSDT and ConfidentialLending, saves addresses to `deployments/sepolia.json`.

## Verify on Etherscan

```bash
npx hardhat run scripts/verify.ts --network sepolia
```

## Deployed Contracts (Sepolia)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| MockCUSDT | 0x8D6ADb0C749bf59252709B3edd5772780e1C3Ec0 | https://sepolia.etherscan.io/address/0x8D6ADb0C749bf59252709B3edd5772780e1C3Ec0#code |
| ConfidentialLending | 0xAA836099a011e5a15e46898B2C7A1999a2aec3Bd | https://sepolia.etherscan.io/address/0xAA836099a011e5a15e46898B2C7A1999a2aec3Bd#code |

Deployed 2026-05-08 by 0xc7187B343b5Ab40203Aa5cf98aB2C1EB3C8B2c7f (redeployed with `withdraw` function).

## Local Development

```bash
# Terminal 1: Start Hardhat node
npx hardhat node

# Terminal 2: Deploy locally
npx hardhat run scripts/deploy.ts --network hardhat

# Terminal 3: Start frontend
cd frontend
cp .env.example .env  # edit with local addresses
npm run dev
```

## Frontend Configuration

After deployment, update `frontend/.env`:

```env
VITE_NETWORK=sepolia
VITE_LENDING_CONTRACT_ADDRESS=<from deployments/sepolia.json>
VITE_CUSDT_CONTRACT_ADDRESS=<from deployments/sepolia.json>
VITE_RELAYER_URL=https://relayer.testnet.zama.org
```
