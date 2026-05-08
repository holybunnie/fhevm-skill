# fhevm-skill

**fhevm-skill** is a comprehensive AI agent skill for writing correct FHEVM smart contracts on Zama Protocol. Built as a [Zama Developer Program Mainnet Season 2](https://docs.zama.org) bounty submission, it is optimized for Claude Code, Cursor, and Windsurf.

Unlike a standalone linter, fhevm-skill provides a **closed feedback loop**: write contracts with SKILL.md guidance, statically analyze them with `fhevm-trace`, generate and run exploit tests with `fhevm-attack`, patch, and deploy. Every step is automated and machine-checkable.

## Core Components

| Component | Description |
|-----------|-------------|
| **[SKILL.md](SKILL.md)** | Primary deliverable — 1200+ line skill document covering mental model, encrypted types, ACL system, 13 anti-patterns, HCU budgets, testing, and decryption flows |
| **[frontend/SKILL.md](frontend/SKILL.md)** | Frontend sub-skill — 800+ lines on client-side encryption, `@zama-fhe/relayer-sdk`, EIP-712 `userDecrypt`, React+viem patterns |
| **[fhevm-trace](tools/fhevm-trace/)** | Static ACL flow analyzer — AST-based (`@solidity-parser/parser`) + regex fallback, outputs `trace.json` + Mermaid ACL graphs |
| **[fhevm-attack](tools/fhevm-attack/)** | Trace-directed dynamic attack generator — reads trace findings, instantiates exploit templates, runs them as Hardhat tests |
| **[Reference templates](templates/)** | Three hardened contract skeletons: ConfidentialAuction, ConfidentialLending, ConfidentialVote |
| **[Reference docs](references/)** | Anti-patterns, ACL rules, HCU cost tables, cheatsheet |
| **[Example app](examples/confidential-lending-app/)** | Full e2e confidential lending demo with frontend, Sepolia deployment, and broken variant for closed-loop testing |

## The Closed Loop

```mermaid
graph LR
    A[Write Contract] --> B[fhevm-trace]
    B -->|findings| C[fhevm-attack]
    C -->|exploits| D[Patch Contract]
    D --> B
    B -->|0 findings| E[Ship]
    E --> F[Deploy to Sepolia]
```

1. **Write** — Author a contract using `SKILL.md` guidance and reference templates
2. **Trace** — Run `fhevm-trace` to statically detect anti-patterns via AST + regex analysis
3. **Attack** — Run `fhevm-attack` to generate exploit tests from trace findings
4. **Patch** — Fix flagged issues, re-trace until 0 findings
5. **Ship** — Compile, run happy-path tests, verify all attacks blocked
6. **Deploy** — Push to Sepolia with Etherscan verification

## Getting Started

```bash
git clone <repo-url> && cd fhevm-skill
npm install
```

### Run the closed-loop demo

```bash
cd examples/confidential-lending-app

# 1. Compile contracts
npx hardhat compile

# 2. Trace the broken contract (expect 2 findings: AP-009, AP-011)
node ../../tools/fhevm-trace/src/index.js contracts/broken/ConfidentialLending.broken.sol

# 3. Generate and run attacks against broken contract
node ../../tools/fhevm-attack/src/index.js .

# 4. Trace the patched contract (expect 0 findings)
node ../../tools/fhevm-trace/src/index.js contracts/ConfidentialLending.sol

# 5. Run happy-path tests
npx hardhat test test/happy-path.test.ts
```

## Key Coverage Areas

- **Encrypted types**: `ebool`, `euint8/16/32/64/128/256`, `eaddress`, `externalEuint*` — with `euint64` as default for balances
- **FHE operations**: Arithmetic, bitwise, comparison, selection, casting, randomness — all via `FHE.*` namespace (v0.9+)
- **Access control (ACL)**: `FHE.allow`, `FHE.allowThis`, `FHE.allowTransient`, `FHE.makePubliclyDecryptable`, `FHE.isSenderAllowed`
- **Encrypted inputs**: `externalEuint64` + `FHE.fromExternal(input, proof)` with proof binding to `msg.sender`
- **Decryption**: Self-relaying v0.9 model — `makePubliclyDecryptable` / `publicDecrypt` / `userDecrypt` / `checkSignatures`
- **13 anti-patterns** (AP-001 through AP-013): Each with rule statement, wrong/right code, and detection method
- **HCU budget awareness**: Cost tables per operation, loop danger zones, per-tx limits
- **Testing patterns**: `hre.fhevm.createEncryptedInput` + `assertCoprocessorInitialized` + encrypt/call/decrypt/assert cycle

## fhevm-trace — Static Analyzer

Parses Solidity files using `@solidity-parser/parser` and detects:

| Rule | Detection |
|------|-----------|
| AP-006 | Persistent ACL grant to external address (not `msg.sender`/`address(this)`) |
| AP-006-EXT | Cross-contract ACL leak — follows imports one level deep to detect the OpenZeppelin guide's flagship vulnerability |
| AP-009 | External call return value ignored in FHE comparison (silent failure) |
| AP-010 | Callback without `delete` before external call (replay vulnerability) |
| AP-011 | `makePubliclyDecryptable` in same function as timestamp check (premature disclosure) |

Outputs `trace.json` (machine-readable, consumed by `fhevm-attack`) and `trace.md` (Mermaid ACL flow graphs + findings).

## fhevm-attack — Attack Generator

Reads `trace.json` and instantiates exploit templates for each finding:

| Template | Exploit |
|----------|---------|
| `silent-failure-bid` | Submits encrypted bid with zero balance, asserts attacker becomes highest bidder |
| `acl-leak-via-proxy` | Deploys malicious proxy to extract ACL access through persistent allowance |
| `callback-replay` | Replays relayer callback calldata for double-drain |
| `reorg-disclosure` | Uses `evm_snapshot`/`evm_revert` to retain disclosed secrets across reorg |
| `hcu-budget` | Measures gas with increasing input sizes to detect HCU boundary failures |

**Dual mode**: Default asserts exploits succeed (confirms bugs). `EXPECT_BLOCKED=1` asserts exploits are blocked (confirms patches).

## Example: Confidential Lending App

A complete lending protocol demonstrating all FHEVM patterns:

- **MockCUSDT**: Confidential ERC20 with encrypted balances; transfer silently zeros on insufficient balance
- **ConfidentialLending**: Deposit collateral, borrow up to 50% LTV, repay — all with `FHE.select` (no branching on encrypted), proper ACL grants, overflow guards
- **Broken variant**: Same contract with 2 surgical bugs (AP-009 + AP-011) for demonstrating the closed loop
- **Frontend**: Vite + React + Tailwind + viem + `@zama-fhe/relayer-sdk` — wallet connect, mint, deposit, withdraw, borrow, repay, encrypted balance decryption via EIP-712 `userDecrypt`

## Sepolia Deployment

Both contracts are deployed and verified on Sepolia. See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

| Contract | Address | Etherscan |
|----------|---------|-----------|
| MockCUSDT | `0x8D6ADb0C749bf59252709B3edd5772780e1C3Ec0` | [View](https://sepolia.etherscan.io/address/0x8D6ADb0C749bf59252709B3edd5772780e1C3Ec0#code) |
| ConfidentialLending | `0xAA836099a011e5a15e46898B2C7A1999a2aec3Bd` | [View](https://sepolia.etherscan.io/address/0xAA836099a011e5a15e46898B2C7A1999a2aec3Bd#code) |

## Technical Details

- Uses `FHE.*` namespace (v0.9+) exclusively — not the deprecated `TFHE.*`
- Inherits `ZamaEthereumConfig` — not the removed `SepoliaConfig`
- Self-relaying decryption only — no v0.8 oracle callbacks
- `@fhevm/solidity` v0.9+, `@fhevm/hardhat-plugin` v0.3.0-1+, `@zama-fhe/relayer-sdk` v0.3.0-5+
- Solidity `^0.8.24`, ethers v6, Hardhat v2

## Project Structure

```
fhevm-skill/
  SKILL.md                              # Core skill (1233 lines)
  frontend/SKILL.md                     # Frontend sub-skill (818 lines)
  references/
    anti-patterns.md                    # 13 anti-patterns with detection
    acl-rules.md                        # ACL primitives reference
    hcu-costs.md                        # HCU cost tables
    cheatsheet.md                       # Quick reference
  tools/
    fhevm-trace/                        # Static ACL flow analyzer
      src/parser.js                     # AST walker (@solidity-parser/parser)
      src/rules.js                      # Rule detectors (AST + regex + cross-contract)
      src/graph.js                      # Mermaid graph emitter
      src/report.js                     # trace.json + trace.md builder
    fhevm-attack/                       # Trace-directed attack generator
      src/selector.js                   # Maps findings to templates
      src/instantiate.js                # Template substitution
      src/runner.js                     # Hardhat test executor
      templates/                        # 5 attack templates
  templates/                            # 3 hardened reference contracts
  examples/
    confidential-lending-app/
      contracts/                        # MockCUSDT + ConfidentialLending
      contracts/broken/                 # Intentionally buggy variant
      test/                             # Happy-path + attack tests
      frontend/                         # Vite + React + Tailwind + viem
      scripts/                          # Deploy + verify scripts
  DEPLOYMENT.md                         # Sepolia addresses + Etherscan links
  SUBMISSION.md                         # Community post
```
