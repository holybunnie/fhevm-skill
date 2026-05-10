# FHEVM Skill

This skill teaches AI coding agents how to write correct smart contracts for the Zama Protocol using Fully Homomorphic Encryption over the EVM (FHEVM). It covers the FHE type system, the ACL permission model, encrypted input handling, the async decryption flow, and the 13 most dangerous anti-patterns. It ships with two companion tools — `fhevm-trace` (static ACL flow analyzer) and `fhevm-attack` (trace-directed dynamic attack generator) — that close the loop between writing and verifying FHEVM contracts.

## When to use this skill

- Writing a new smart contract that stores or operates on encrypted data (balances, bids, votes, health factors)
- Reviewing an existing FHEVM contract for correctness
- Migrating a contract from the old pre-v0.9 library to the current FHE.sol API
- Designing a confidential token, auction, lending, or governance protocol
- Building a frontend that encrypts user input and decrypts results from an FHEVM contract
- Debugging "handle not allowed" or "decryption failed" errors
- Estimating whether a function will exceed the per-transaction HCU budget

## The mental model

Encrypted values in FHEVM are **handles** — opaque `uint256` references to ciphertexts stored in the coprocessor. When your contract calls `FHE.add(a, b)`, it does not compute the sum on the EVM. It emits a symbolic instruction that the coprocessor evaluates asynchronously. The EVM only sees the resulting handle. This means the return value of every FHE operation is another handle, not a cleartext.

The EVM cannot see the plaintext behind any handle. It cannot branch on an encrypted comparison (`ebool`), it cannot `require()` that an encrypted balance is positive, and it cannot revert based on an encrypted condition. The only way to "branch" is `FHE.select(condition, ifTrue, ifFalse)`, which evaluates both paths and picks one — without revealing which. Every `if`, `require`, or `assert` that touches an encrypted value is a bug.

Access control in FHEVM is **per-handle**, not per-storage-slot. Storing an encrypted value does not mean the contract can use it next transaction — you must explicitly call `FHE.allowThis(handle)`. Allowing a user to decrypt a value requires `FHE.allow(handle, userAddress)`. Forgetting an `allow*` call is the single most common FHEVM bug. The ACL is the gatekeeper for every operation: the coprocessor rejects any instruction where the caller lacks permission on an input handle.

## Setup

### Package dependencies

```json
{
  "dependencies": {
    "@fhevm/solidity": "^0.11.1",
    "@fhevm/mock-utils": "^0.4.2",
    "encrypted-types": "^0.0.4"
  },
  "devDependencies": {
    "@fhevm/hardhat-plugin": "^0.4.2",
    "@zama-fhe/relayer-sdk": "^0.4.1",
    "@nomicfoundation/hardhat-chai-matchers": "^2.0.0",
    "@nomicfoundation/hardhat-ethers": "^3.0.0",
    "@nomicfoundation/hardhat-verify": "^2.0.0",
    "@typechain/hardhat": "^9.0.0",
    "@typechain/ethers-v6": "^0.5.0",
    "ethers": "^6.16.0",
    "hardhat": "^2.28.6",
    "hardhat-deploy": "^0.14.0",
    "ts-node": "^10.9.0",
    "typechain": "^8.3.0",
    "typescript": "^5.5.0"
  }
}
```

### Hardhat config

```typescript
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  networks: {
    hardhat: {
      accounts: { mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk" },
      chainId: 31337,
    },
    sepolia: {
      accounts: { mnemonic: process.env.MNEMONIC || "" },
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || "",
    },
  },
  typechain: { outDir: "types", target: "ethers-v6" },
};

export default config;
```

### Contract boilerplate

```solidity
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyContract is ZamaEthereumConfig {
    // ZamaEthereumConfig auto-configures the coprocessor addresses.
    // No manual FHE.setCoprocessor() call needed.
}
```

## Encrypted types

| Type | Bit width | Arithmetic | Comparison | Bitwise | Select | Rand | Notes |
|------|-----------|-----------|------------|---------|--------|------|-------|
| `ebool` | 2 | No | `eq`, `ne` | `and`, `or`, `xor`, `not` | Yes | Yes | Use for encrypted conditions |
| `euint8` | 8 | Full | Full | Full | Yes | Yes | |
| `euint16` | 16 | Full | Full | Full | Yes | Yes | |
| `euint32` | 32 | Full | Full | Full | Yes | Yes | Good for counters, small amounts |
| `euint64` | 64 | Full | Full | Full | Yes | Yes | **Default for token balances** |
| `euint128` | 128 | Full | Full | Full | Yes | Yes | Large amounts, timestamps |
| `euint256` | 256 | **None** | `eq`, `ne` only | Full | Yes | Yes | No add/sub/mul/div. 4x costlier. Rarely justified. |
| `eaddress` | 160 | No | `eq`, `ne` only | No | Yes | No | Encrypted address comparison |
| `ebytes64` | 64B | No | `eq`, `ne` | No | Yes | Yes | Encrypted byte arrays |
| `ebytes128` | 128B | No | `eq`, `ne` | No | Yes | Yes | |
| `ebytes256` | 256B | No | `eq`, `ne` | No | Yes | Yes | |

**External input types** — used as function parameters when accepting encrypted input from clients:

| External type | Internal type | Conversion |
|--------------|---------------|------------|
| `externalEbool` | `ebool` | `FHE.fromExternal(input, proof)` |
| `externalEuint8` | `euint8` | `FHE.fromExternal(input, proof)` |
| `externalEuint16` | `euint16` | `FHE.fromExternal(input, proof)` |
| `externalEuint32` | `euint32` | `FHE.fromExternal(input, proof)` |
| `externalEuint64` | `euint64` | `FHE.fromExternal(input, proof)` |
| `externalEuint128` | `euint128` | `FHE.fromExternal(input, proof)` |
| `externalEuint256` | `euint256` | `FHE.fromExternal(input, proof)` |
| `externalEaddress` | `eaddress` | `FHE.fromExternal(input, proof)` |

`euint64` is the default for token balances. `euint256` has no arithmetic and is 4x more expensive — use only when you genuinely need 256-bit encrypted storage (rare).

### Initialization check

```solidity
if (!FHE.isInitialized(myEncryptedValue)) {
    // handle is zero / unset
}
```

Use `FHE.isInitialized(handle)` to check whether an encrypted variable has been assigned. Uninitialized handles are `bytes32(0)`.

## FHE operations

All operations use the `FHE.` namespace. Import from `@fhevm/solidity/lib/FHE.sol`.

### Arithmetic

Supported on `euint8` through `euint128`. **Not supported on `euint256` or `eaddress`.**

| Operation | Signature | Notes |
|-----------|-----------|-------|
| Addition | `FHE.add(T a, T b) returns (T)` | Both encrypted, or `FHE.add(T a, uint b)` for scalar |
| Subtraction | `FHE.sub(T a, T b) returns (T)` | Wraps on underflow (silent, AP-012) |
| Multiplication | `FHE.mul(T a, T b) returns (T)` | Expensive (596K HCU for euint64) |
| Division | `FHE.div(T a, uint b) returns (T)` | **Plaintext divisor only**. No encrypted divisor. |
| Remainder | `FHE.rem(T a, uint b) returns (T)` | **Plaintext divisor only**. Very expensive. |
| Negation | `FHE.neg(T a) returns (T)` | Two's complement negation |
| Minimum | `FHE.min(T a, T b) returns (T)` | |
| Maximum | `FHE.max(T a, T b) returns (T)` | |

Every arithmetic operation can also take a plaintext scalar as the second argument (e.g., `FHE.add(balance, 100)`). Scalar operations are cheaper than encrypted-encrypted operations.

### Bitwise

Supported on all `euint*` types and `ebool` (for `and`, `or`, `xor`, `not`).

| Operation | Signature | Notes |
|-----------|-----------|-------|
| AND | `FHE.and(T a, T b) returns (T)` | |
| OR | `FHE.or(T a, T b) returns (T)` | |
| XOR | `FHE.xor(T a, T b) returns (T)` | |
| NOT | `FHE.not(T a) returns (T)` | |
| Shift left | `FHE.shl(T a, T/uint8 b) returns (T)` | Shift amount modulo bit width |
| Shift right | `FHE.shr(T a, T/uint8 b) returns (T)` | |
| Rotate left | `FHE.rotl(T a, T/uint8 b) returns (T)` | |
| Rotate right | `FHE.rotr(T a, T/uint8 b) returns (T)` | |

### Comparison

All return `ebool`. Supported on `euint8` through `euint128` for full comparisons. `euint256` and `eaddress` support only `eq` and `ne`.

| Operation | Signature |
|-----------|-----------|
| Equal | `FHE.eq(T a, T b) returns (ebool)` |
| Not equal | `FHE.ne(T a, T b) returns (ebool)` |
| Greater or equal | `FHE.ge(T a, T b) returns (ebool)` |
| Greater than | `FHE.gt(T a, T b) returns (ebool)` |
| Less or equal | `FHE.le(T a, T b) returns (ebool)` |
| Less than | `FHE.lt(T a, T b) returns (ebool)` |

Comparisons can also take a plaintext scalar: `FHE.gt(amount, 0)`.

**Critical**: the result is `ebool`, not `bool`. You cannot use it in `if` or `require`. Use `FHE.select`.

### Selection (encrypted ternary)

```solidity
FHE.select(ebool condition, T ifTrue, T ifFalse) returns (T)
```

This is the **only** way to branch on encrypted values. Both branches are always evaluated. The coprocessor picks the result without revealing which was chosen.

Works with all encrypted types including `euint256`, `eaddress`, `ebytes*`.

### Casting and trivial encryption

```solidity
// Plaintext to encrypted (trivial encryption)
FHE.asEuint8(uint value) returns (euint8)
FHE.asEuint16(uint value) returns (euint16)
FHE.asEuint32(uint value) returns (euint32)
FHE.asEuint64(uint value) returns (euint64)
FHE.asEuint128(uint value) returns (euint128)
FHE.asEuint256(uint value) returns (euint256)
FHE.asEbool(bool value) returns (ebool)
FHE.asEaddress(address value) returns (eaddress)

// Cross-type casting (encrypted to encrypted)
FHE.asEuint64(euint32 value) returns (euint64)   // zero-extends
FHE.asEuint32(euint64 value) returns (euint32)   // truncates
FHE.asEbool(euint8 value) returns (ebool)        // non-zero = true
```

**Warning**: casting from larger to smaller type truncates silently. Guard with a range check if needed.

Trivial encryption costs only 32 HCU regardless of type. Use it to create encrypted constants for comparisons and select guards.

### Random number generation

```solidity
FHE.randEbool() returns (ebool)
FHE.randEuint8() returns (euint8)
FHE.randEuint16() returns (euint16)
FHE.randEuint32() returns (euint32)
FHE.randEuint64() returns (euint64)
FHE.randEuint128() returns (euint128)
FHE.randEuint256() returns (euint256)
```

Bounded variants (upper bound must be power of 2): `FHE.randEuint8(16)` returns `[0, 15]`.

**Must be called in a transaction**, not a view/pure function or `eth_call`. Current implementation uses a PRNG mockup — not production-grade randomness.

### Common operation patterns

#### Encrypted conditional assignment (replacing if/else)

```solidity
// "If amount > threshold, set fee to 5%, else set fee to 1%"
ebool isAbove = FHE.gt(amount, threshold);
euint64 highFee = FHE.div(FHE.mul(amount, 5), 100);
euint64 lowFee = FHE.div(amount, 100);
euint64 fee = FHE.select(isAbove, highFee, lowFee);
```

#### Encrypted min/max clamping

```solidity
// Clamp value to [minVal, maxVal] range
euint64 clamped = FHE.max(value, minVal);
clamped = FHE.min(clamped, maxVal);
```

#### Encrypted boolean accumulation (counting votes)

```solidity
// Convert ebool vote (true=yes) to euint64 and accumulate
euint64 voteAsUint = FHE.select(vote, FHE.asEuint64(1), FHE.asEuint64(0));
yesCount = FHE.add(yesCount, voteAsUint);
FHE.allowThis(yesCount);
```

#### Safe subtraction (prevent underflow wrapping)

```solidity
// AP-012: subtract only if a >= b, else result is zero
ebool canSub = FHE.ge(a, b);
euint64 diff = FHE.sub(a, b);
euint64 safeDiff = FHE.select(canSub, diff, FHE.asEuint64(0));
```

#### Encrypted equality check with plaintext (password/PIN verify)

```solidity
// Check if encrypted input matches a stored encrypted secret
ebool matches = FHE.eq(inputSecret, storedSecret);
// matches is ebool — cannot be used in require, only in select
```

## Access control (the ACL)

The ACL is the permission layer between contracts and the coprocessor. Every FHE operation checks that the caller has permission on all input handles. Every decryption checks that the requester has permission on the handle. Forgetting an `allow*` call is the single most common FHEVM bug.

### The four primitives

#### `FHE.allow(handle, address)`

Grants **permanent** permission for `address` to use or decrypt `handle`. Persists across transactions, stored in contract storage.

```solidity
// AP-004: grant user permission to decrypt their balance
euint64 newBalance = FHE.add(balances[msg.sender], depositAmount);
balances[msg.sender] = newBalance;
FHE.allow(newBalance, msg.sender);
```

#### `FHE.allowThis(handle)`

Shorthand for `FHE.allow(handle, address(this))`. Grants the **contract itself** permission to use `handle` in future transactions.

```solidity
// AP-003: grant contract permission to use stored value next tx
balances[msg.sender] = newBalance;
FHE.allowThis(newBalance);
```

**Every encrypted value written to storage needs `allowThis`**. Without it, the contract cannot read or operate on the value in the next transaction.

#### `FHE.allowTransient(handle, address)`

Grants permission for **the current transaction only**. Uses EIP-1153 transient storage — cheaper gas, automatically cleared at end of tx.

```solidity
// AP-006: use transient for inter-contract calls
euint64 result = FHE.add(a, b);
FHE.allowTransient(result, address(helperContract));
helperContract.process(result);
```

**Prefer `allowTransient` over `allow` when passing handles to external contracts in helper calls.** Persistent allowances escape contract boundaries and become disclosure vectors (AP-006).

#### `FHE.makePubliclyDecryptable(handle)`

Grants **permanent, global** decryption permission. Anyone can decrypt this value off-chain. Used for public reveals (auction results, vote tallies).

```solidity
// Make the final vote tally publicly visible
FHE.makePubliclyDecryptable(totalVotes);
```

**Cannot be revoked.** Only use for values that should genuinely be public forever.

### `FHE.isSenderAllowed(handle)` — the input gate

```solidity
function isSenderAllowed(T handle) internal view returns (bool)
```

Returns `true` if `msg.sender` has ACL permission on `handle`. Use at the top of any function that receives an encrypted handle from another contract.

```solidity
// AP-007: validate caller permission on received handle
function processExternal(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "Caller not allowed on handle");
    // safe to use amount
}
```

### Method chaining

The ACL functions support chaining:

```solidity
FHE.allowThis(newBalance);
FHE.allow(newBalance, msg.sender);
// or equivalently with chaining:
newBalance.allowThis().allow(msg.sender);
```

### Worked example: deposit and balance check

```solidity
function deposit(externalEuint64 encAmount, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(encAmount, proof);

    euint64 oldBalance = balances[msg.sender];
    euint64 newBalance;

    if (FHE.isInitialized(oldBalance)) {
        newBalance = FHE.add(oldBalance, amount);
    } else {
        newBalance = amount;
    }

    balances[msg.sender] = newBalance;
    FHE.allowThis(newBalance);     // AP-003: contract can use it next tx
    FHE.allow(newBalance, msg.sender); // AP-004: user can decrypt it
}
```

Note: `FHE.isInitialized` returns a plain `bool` (it checks if the handle is zero), so it is safe to use in an `if` statement. Only encrypted booleans (`ebool`) are forbidden in control flow.

### ACL decision tree

1. **Storing an encrypted value?** → `FHE.allowThis(handle)` (always)
2. **User needs to decrypt?** → `FHE.allow(handle, userAddress)`
3. **Passing to another contract within this tx?** → `FHE.allowTransient(handle, targetContract)` (prefer over `allow`)
4. **Public reveal (auction result, vote tally)?** → `FHE.makePubliclyDecryptable(handle)`
5. **Receiving a handle from an external caller?** → `require(FHE.isSenderAllowed(handle))` at function entry

## Encrypted inputs from clients

When a user sends an encrypted value to a contract, the value arrives as an `externalEuint*` type accompanied by a ZK proof (`bytes calldata inputProof`). The proof is a Zero-Knowledge Proof of Knowledge (ZKPoK) that binds the ciphertext to the sender.

### Contract side

```solidity
function bid(externalEuint64 encBid, bytes calldata inputProof) external {
    euint64 bidAmount = FHE.fromExternal(encBid, inputProof);
    // bidAmount is now a valid internal handle
    FHE.allowThis(bidAmount);
    FHE.allow(bidAmount, msg.sender);
}
```

`FHE.fromExternal` validates the ZKPoK and converts the external type to its internal counterpart. If the proof is invalid (wrong sender, tampered ciphertext), the transaction reverts.

### Client side (test or frontend)

```typescript
import { fhevm } from "hardhat";

const input = fhevm.createEncryptedInput(contractAddress, signerAddress);
input.add64(1000); // encrypt the value 1000 as euint64
const encrypted = await input.encrypt();

await contract.connect(signer).bid(
    encrypted.handles[0],    // externalEuint64
    encrypted.inputProof     // ZKPoK proof
);
```

### Input builder methods

| Method | External type produced |
|--------|----------------------|
| `addBool(value)` | `externalEbool` |
| `add8(value)` | `externalEuint8` |
| `add16(value)` | `externalEuint16` |
| `add32(value)` | `externalEuint32` |
| `add64(value)` | `externalEuint64` |
| `add128(value)` | `externalEuint128` |
| `add256(value)` | `externalEuint256` |
| `addAddress(value)` | `externalEaddress` |

### Proof binding to msg.sender

The encrypted input proof is cryptographically bound to the `(contractAddress, signerAddress)` pair passed to `createEncryptedInput`. This has critical implications:

- **Third-party callers**: if contract A encrypts input for contract B, but a proxy contract C calls B on behalf of A, the proof verification will fail because `msg.sender` at B is C, not A. The proof was bound to A.
- **Account Abstraction**: if the user's AA wallet has a different address than the signer, the proof must be bound to the AA wallet address (the one that will be `msg.sender` at the target contract).
- **Meta-transactions / relayers**: the relayer's address becomes `msg.sender`. You must either bind the proof to the relayer address (security risk — relayer can replay) or use a pattern where the user calls the contract directly.

## Decryption (the v0.9 self-relaying model)

Decryption in FHEVM v0.9+ is **asynchronous and client-driven**. There is no on-chain callback. The contract never receives cleartext via a callback function.

The model is called "self-relaying" because the client fetches the cleartext from the KMS and relays it back to the contract with a cryptographic proof.

### Two decryption paths

#### Path 1: Public decryption (anyone can read)

For values the contract has marked with `FHE.makePubliclyDecryptable(handle)`.

**Step 1 — On-chain: mark as publicly decryptable**

```solidity
function finalizeAuction() external {
    require(block.timestamp > auctionEnd, "Auction not ended");
    FHE.makePubliclyDecryptable(winningBid);
}
```

**Step 2 — Off-chain: decrypt via relayer SDK**

```typescript
// In frontend code, use the web bundle:
import { getFhevmInstance } from "../lib/fhevm";  // see frontend/SKILL.md

const fhevm = await getFhevmInstance();
const cleartext = await fhevm.publicDecrypt(handle);
// For on-chain verification, use publicDecryptWithProof:
// const { value, signatures } = await fhevm.publicDecryptWithProof(handle);
```

**Step 3 — On-chain: verify and use cleartext**

```solidity
function claimWinnings(
    bytes32[] calldata handles,
    bytes calldata clearValues,
    bytes calldata decryptionProof
) external {
    FHE.checkSignatures(handles, clearValues, decryptionProof);
    // proof verified — clearValues are authentic
    uint64 winAmount = abi.decode(clearValues, (uint64));
    payable(winner).transfer(winAmount);
}
```

`FHE.checkSignatures` reverts if the proof is invalid. The proof is bound to the exact handle order — reordering `handles` invalidates it.

#### Path 2: User decryption (private, off-chain only)

For values the contract has allowed to a specific user via `FHE.allow(handle, userAddress)`.

**On-chain requirement**: the handle must have both `FHE.allowThis(handle)` (contract can serve it) and `FHE.allow(handle, userAddress)`.

**Off-chain (test)**:

```typescript
import { FhevmType } from "@fhevm/hardhat-plugin";
import { fhevm } from "hardhat";

const clearBalance = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    encryptedBalance,   // the handle from contract storage
    contractAddress,
    signer              // the ethers Signer with ACL permission
);
```

**Off-chain (frontend with relayer SDK)**:

```typescript
import { getFhevmInstance } from "../lib/fhevm";  // see frontend/SKILL.md

const fhevm = await getFhevmInstance();
const keypair = fhevm.generateKeypair();
const contractAddresses = [contractAddress];
const startTimeStamp = Math.floor(Date.now() / 1000);
const durationDays = 10;
const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

// User signs the EIP-712 message proving ACL access
const signer = await new BrowserProvider(window.ethereum).getSigner();
const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message
);

const results = await fhevm.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays
);
const clearValue = results[0];
```

The EIP-712 signature proves to the KMS that the requester owns the address that was granted ACL access. Without this signature, anyone could request decryption of any handle they know about.

### What NOT to do (deprecated v0.8 patterns)

The following patterns were removed in v0.9. Do not use them:

```solidity
// ❌ WRONG — v0.8 async callback pattern, removed in v0.9 (deprecated)
// The old async decryption-request function does not exist in v0.9+.

// ❌ WRONG — synchronous decryption never existed in any version (deprecated/fabricated)
// uint64 clear = TFHE.decrypt(encryptedValue); // ❌ WRONG — TFHE namespace removed
// The TFHE namespace is removed. Synchronous decrypt was never real.

// ❌ WRONG — v0.8 handle loading, removed (deprecated)
// FHE.loadRequestedHandles();
// This function does not exist in v0.9+.
```

### Decryption decision tree

1. **Public reveal (auction winner, vote tally)?** → `makePubliclyDecryptable` + `publicDecrypt` + `checkSignatures`
2. **Private balance check for a specific user?** → `allow(handle, user)` + `userDecrypt` (off-chain only, no on-chain callback)
3. **Need cleartext on-chain for logic (e.g., pay out ETH)?** → `makePubliclyDecryptable` + client relays cleartext + `checkSignatures` on-chain

## Anti-patterns AP-001 through AP-013

### AP-001 — Never branch on encrypted values

**Rule**: Never use `if`, `else`, ternary (`? :`), or any control flow that depends on an encrypted value. Use `FHE.select(condition, ifTrue, ifFalse)`.

**Why**: The EVM cannot evaluate encrypted booleans. An `if (encryptedBool)` will always take the same branch (comparing a handle/uint256 to zero), leaking information and producing wrong results.

**Detection**: `fhevm-trace` flags any `if` statement whose condition references an encrypted variable.

```solidity
// ❌ WRONG — branches on encrypted condition
ebool isHigher = FHE.gt(newBid, highestBid);
if (isHigher) {
    highestBid = newBid;
}

// ✅ RIGHT — uses FHE.select
ebool isHigher = FHE.gt(newBid, highestBid);
highestBid = FHE.select(isHigher, newBid, highestBid);
FHE.allowThis(highestBid);
```

### AP-002 — Never require on encrypted comparisons

**Rule**: Never use `require()`, `assert()`, or `revert` with a condition derived from an FHE comparison.

**Why**: `require(ebool)` interprets the handle as a uint256. Since handles are non-zero, `require` always passes (or always fails for zero handles). The encrypted bit is invisible to the EVM.

**Detection**: `fhevm-trace` flags `require` calls where the argument traces back to an FHE comparison.

```solidity
// ❌ WRONG — require cannot see the encrypted bit
ebool hasEnough = FHE.ge(balance, amount);
require(hasEnough, "Insufficient balance");

// ✅ RIGHT — use select to enforce conditionally
ebool hasEnough = FHE.ge(balance, amount);
euint64 actualAmount = FHE.select(hasEnough, amount, FHE.asEuint64(0));
// Proceed with actualAmount; if insufficient, amount is zeroed out
```

### AP-003 — Always allowThis for stored encrypted values

**Rule**: Every encrypted value written to storage must have `FHE.allowThis(handle)` called on it. Without this, the contract cannot operate on the value in subsequent transactions.

**Why**: The coprocessor checks ACL permissions on every operation. A stored handle without `allowThis` will cause any future FHE operation involving it to revert with an ACL error.

**Detection**: `fhevm-trace` flags storage writes to encrypted types where no `allowThis` follows in the same function.

```solidity
// ❌ WRONG — stored but not allowed to contract
balances[msg.sender] = FHE.add(balances[msg.sender], amount);

// ✅ RIGHT — allowThis so contract can use it next tx
euint64 newBal = FHE.add(balances[msg.sender], amount);
balances[msg.sender] = newBal;
FHE.allowThis(newBal);
```

### AP-004 — Always allow users who need to decrypt

**Rule**: Every encrypted value a user needs to see off-chain must have `FHE.allow(handle, userAddress)`.

**Why**: The KMS will refuse `userDecrypt` requests from addresses without ACL permission. The user sees an opaque handle but cannot read the plaintext.

**Detection**: `fhevm-trace` flags functions that write to a per-user mapping but never call `FHE.allow(handle, ...)` with the user's address.

```solidity
// ❌ WRONG — user can't decrypt their own balance
balances[msg.sender] = newBalance;
FHE.allowThis(newBalance);

// ✅ RIGHT — user can decrypt
balances[msg.sender] = newBalance;
FHE.allowThis(newBalance);
FHE.allow(newBalance, msg.sender);
```

### AP-005 — Synchronous decryption does not exist

**Rule**: There is no `FHE.decrypt()`. There is no synchronous decryption anywhere in the FHEVM. Use the async self-relaying decryption flow.

**Why**: FHE decryption requires the KMS cluster and is inherently asynchronous. Any function signature suggesting synchronous decryption is fabricated.

**Detection**: `fhevm-trace` flags any call matching `FHE.decrypt` or the removed v0.8 async decryption functions.

```solidity
// ❌ WRONG — does not exist (fabricated)
uint64 clearBalance = FHE.decrypt(encBalance);

// ❌ WRONG — v0.8 async callback pattern, removed in v0.9 (deprecated)
// The old async decryption-request function does not exist in v0.9+.

// ✅ RIGHT — mark for async decryption, verify on-chain when client relays
FHE.makePubliclyDecryptable(encBalance);
// ... client calls publicDecrypt off-chain, relays cleartext + proof ...
function onDecrypted(bytes32[] calldata handles, bytes calldata clear, bytes calldata proof) external {
    FHE.checkSignatures(handles, clear, proof);
    uint64 balance = abi.decode(clear, (uint64));
}
```

### AP-006 — Prefer allowTransient for inter-contract handle passing

**Rule**: When passing an encrypted handle to an external contract within the same transaction, use `FHE.allowTransient(handle, targetAddress)` instead of `FHE.allow(handle, targetAddress)`.

**Why**: Persistent allowances (`FHE.allow`) survive the transaction. If the target contract is compromised, upgraded, or called by an attacker later, the persistent allowance lets them access the handle forever. Transient allowances auto-expire at tx end.

**Detection**: `fhevm-trace` flags `FHE.allow(handle, externalAddress)` where `externalAddress` is not `msg.sender` or `address(this)`.

```solidity
// ❌ WRONG — persistent allowance to external contract
FHE.allow(amount, address(feeHandler));
feeHandler.processFee(amount);

// ✅ RIGHT — transient, expires at end of tx
FHE.allowTransient(amount, address(feeHandler));
feeHandler.processFee(amount);
```

### AP-007 — Validate sender permission on received handles

**Rule**: At the start of any function that receives an encrypted handle from another contract (not from `FHE.fromExternal`), call `require(FHE.isSenderAllowed(handle))`.

**Why**: Without this check, any contract can pass a random handle value. The receiving contract would operate on a handle it has no ACL access to, causing silent failures or operating on wrong data.

**Detection**: `fhevm-trace` flags external/public functions with `euint*`/`ebool` parameters that lack an `isSenderAllowed` check.

```solidity
// ❌ WRONG — no permission check on incoming handle
function processPayment(euint64 amount) external {
    totalReceived = FHE.add(totalReceived, amount);
}

// ✅ RIGHT — validate caller has permission
function processPayment(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "Sender not allowed on handle");
    totalReceived = FHE.add(totalReceived, amount);
    FHE.allowThis(totalReceived);
}
```

### AP-008 — Use euint64 for balances, not euint256

**Rule**: Default to `euint64` for token balances, collateral amounts, and bid values. Only use `euint256` when the range genuinely requires it.

**Why**: `euint256` has no arithmetic operations (`add`, `sub`, `mul`, `div`, `rem`, `min`, `max` are all unsupported). You cannot add two `euint256` values. It also costs 4x more HCU for the operations it does support. `euint64` covers up to 18.4 quintillion — more than enough for any token with 18 decimals.

**Detection**: `fhevm-trace` flags state variables of type `euint256` used in contexts where arithmetic is expected.

```solidity
// ❌ WRONG — euint256 has no arithmetic
euint256 balance;
balance = FHE.add(balance, amount); // compile error: no such overload

// ✅ RIGHT — euint64 supports full arithmetic
euint64 balance;
balance = FHE.add(balance, amount);
```

### AP-009 — Use the transferred amount, not the requested amount

**Rule**: When integrating with confidential tokens that silently zero-out on insufficient balance, always use the **returned** `transferred` amount in subsequent comparisons, not the amount the caller requested.

**Why**: Confidential ERC20 `transfer` functions return the actual transferred amount as an encrypted value. If the sender has insufficient balance, the token silently returns zero (it cannot revert because the balance check is encrypted). Using the requested amount instead of the actual amount creates a logic gap — the contract thinks funds arrived when they didn't.

**Detection**: `fhevm-trace` flags functions where an external call's return value is ignored and the original argument is used in subsequent FHE operations.

```solidity
// ❌ WRONG — uses requestedAmount, ignoring that transfer may have zeroed out
token.transfer(address(this), requestedAmount);
bids[msg.sender] = requestedAmount;

// ✅ RIGHT — uses the actual transferred amount returned by the token
euint64 actualTransferred = token.transfer(address(this), requestedAmount);
bids[msg.sender] = actualTransferred;
FHE.allowThis(actualTransferred);
FHE.allow(actualTransferred, msg.sender);
```

### AP-010 — Delete pending-request mapping before external calls in callbacks

**Rule**: In any function that processes a decryption callback or relayed cleartext, `delete` the pending-request mapping entry **before** making external calls or value transfers.

**Why**: Without deletion, the callback calldata can be replayed. An attacker (or compromised relayer) submits the same cleartext+proof again, and the contract processes it twice — double-paying, double-revealing, etc. This is the classic reentrancy pattern adapted for FHE decryption callbacks. Checks-Effects-Interactions applies here.

**Detection**: `fhevm-trace` flags callback-like functions that have mapping reads without corresponding `delete` before external calls.

```solidity
// ❌ WRONG — mapping not deleted before transfer
function onDecrypted(bytes32[] calldata handles, bytes calldata clear, bytes calldata proof) external {
    FHE.checkSignatures(handles, clear, proof);
    uint64 amount = abi.decode(clear, (uint64));
    uint256 requestId = uint256(handles[0]);
    address recipient = pendingWithdrawals[requestId];
    payable(recipient).transfer(amount); // can be replayed
    delete pendingWithdrawals[requestId]; // too late
}

// ✅ RIGHT — delete before external call (Checks-Effects-Interactions)
function onDecrypted(bytes32[] calldata handles, bytes calldata clear, bytes calldata proof) external {
    FHE.checkSignatures(handles, clear, proof);
    uint64 amount = abi.decode(clear, (uint64));
    uint256 requestId = uint256(handles[0]);
    address recipient = pendingWithdrawals[requestId];
    require(recipient != address(0), "Already processed");
    delete pendingWithdrawals[requestId]; // AP-010: delete BEFORE external call
    payable(recipient).transfer(amount);
}
```

### AP-011 — Schedule disclosure with finality delay

**Rule**: When the value being sold is **information** (auction reveals, sealed-bid winners, game outcomes), do not grant decryption rights in the same block/transaction as the state-changing check. Schedule disclosure with a finality delay.

**Why**: In the same block, a reorg could replace the winning bidder. If the previous winner already received decryption rights (or the value was made publicly decryptable), they retain the secret even though the reorg removed their win. This is especially dangerous for sealed-bid auctions where the "product" is the information itself.

**Detection**: `fhevm-trace` flags `FHE.makePubliclyDecryptable` calls in the same function as `block.timestamp` or `block.number` comparisons.

```solidity
// ❌ WRONG — discloses in same tx as finalization
function finalizeAuction() external {
    require(block.timestamp > auctionEnd, "Not ended");
    FHE.makePubliclyDecryptable(winningBid);
    FHE.makePubliclyDecryptable(winnerAddress);
}

// ✅ RIGHT — two-phase: finalize, then disclose after delay
function finalizeAuction() external {
    require(block.timestamp > auctionEnd, "Not ended");
    finalized = true;
    finalizedAt = block.number;
}

function discloseResults() external {
    require(finalized, "Not finalized");
    require(block.number >= finalizedAt + DISCLOSURE_DELAY, "Too soon");
    FHE.makePubliclyDecryptable(winningBid);
    FHE.makePubliclyDecryptable(winnerAddress);
}
```

### AP-012 — Guard against silent arithmetic overflow

**Rule**: Encrypted arithmetic wraps silently (no revert on overflow/underflow). Guard sensitive operations with `FHE.gt(input, MAX_SAFE)` + `FHE.select` to clamp.

**Why**: Unlike Solidity 0.8's checked arithmetic for plaintext, FHE operations wrap modulo 2^bitwidth without any indication. A deposit of `2^64 - 1` followed by adding `1` wraps to `0`, silently losing all funds.

**Detection**: `fhevm-trace` flags FHE arithmetic operations on user-supplied inputs without preceding range checks.

```solidity
// ❌ WRONG — amount could wrap balance to zero
balances[msg.sender] = FHE.add(balances[msg.sender], amount);

// ✅ RIGHT — clamp to prevent overflow
euint64 maxSafe = FHE.asEuint64(type(uint64).max / 2);
ebool tooLarge = FHE.gt(amount, maxSafe);
euint64 safeAmount = FHE.select(tooLarge, FHE.asEuint64(0), amount);
balances[msg.sender] = FHE.add(balances[msg.sender], safeAmount);
FHE.allowThis(balances[msg.sender]);
FHE.allow(balances[msg.sender], msg.sender);
```

### AP-013 — Never grant ACL from arbitrary execute functions

**Rule**: Never allow an `execute(address target, bytes data)` style function to call ACL grant functions. A generic executor that can call `FHE.allow(handle, attacker)` turns the contract into a data-leak vector.

**Why**: If the contract holds encrypted data and has an arbitrary execution function (common in proxy patterns, multisigs, and governance modules), an attacker can craft calldata that grants themselves ACL access to any handle the contract owns. They then decrypt everything off-chain.

**Detection**: `fhevm-trace` flags functions containing low-level `.call(data)` or `.delegatecall(data)` where the target or data comes from a function parameter.

```solidity
// ❌ WRONG — arbitrary execute can grant ACL to attacker
function execute(address target, bytes calldata data) external onlyOwner {
    (bool ok, ) = target.call(data);
    require(ok);
    // attacker crafts data = abi.encodeCall(FHE.allow, (handle, attackerAddr))
}

// ✅ RIGHT — whitelist allowed targets, never allow ACL contract
function execute(address target, bytes calldata data) external onlyOwner {
    require(target != address(FHE_ACL), "Cannot call ACL contract");
    require(allowedTargets[target], "Target not whitelisted");
    (bool ok, ) = target.call(data);
    require(ok);
}
```

## HCU budget awareness

Every FHE operation consumes Homomorphic Complexity Units (HCUs). There are two per-transaction limits:

- **Global HCU limit**: 20,000,000 HCU
- **Sequential depth limit**: 5,000,000 HCU

Exceeding either limit reverts the transaction.

### Cost table (HCU per operation, non-scalar)

| Operation | euint8 | euint32 | euint64 | euint128 | euint256 |
|-----------|--------|---------|---------|----------|----------|
| `add` | 88K | 125K | 162K | 259K | N/A |
| `sub` | 91K | 125K | 162K | 260K | N/A |
| `mul` | 150K | 328K | 596K | 1,686K | N/A |
| `div` (scalar) | 210K | 438K | 715K | 1,225K | N/A |
| `rem` (scalar) | 440K | 792K | 1,153K | 1,943K | N/A |
| `eq` | 55K | 86K | 120K | 122K | 122K |
| `ne` | 55K | 86K | 120K | 122K | 122K |
| `ge/gt/le/lt` | 55K | 86K | 120K | 122K | N/A |
| `select` | 55K | 55K | 55K | 57K | 57K |
| `min/max` | 162K | 199K | 236K | 333K | N/A |
| `neg` | 91K | 125K | 162K | 260K | N/A |
| `not` | 9 | 32 | 63 | 130 | 256 |
| `and/or/xor` | 9 | 32 | 63 | 130 | 256 |
| `shl/shr` | 116K | 150K | 186K | 282K | 370K |
| `rotl/rotr` | 116K | 150K | 186K | 282K | 370K |
| `rand` | 23K | 24K | 24K | 25K | 25K |
| `cast` | 32 | 32 | 32 | 32 | 32 |
| `trivialEncrypt` | 32 | 32 | 32 | 32 | 32 |

### Relative cost ordering

```
not/and/or/xor << cast/trivialEncrypt << rand << select < eq/ne < add/sub < ge/gt/le/lt < shl/shr < min/max < mul << div << rem
```

### Loop danger zone

A loop with 10 iterations doing `FHE.add(euint64, euint64)` costs 10 x 162K = 1,620,000 HCU — fine. But 10 iterations of `FHE.mul(euint64, euint64)` costs 10 x 596K = 5,960,000 HCU — exceeds the sequential depth limit and reverts.

**Rules of thumb**:
- Keep loop body HCU under 500K per iteration for the sequential limit
- Total iterations x body cost must stay under 20M for the global limit
- Prefer scalar variants (cheaper) when one operand is public
- Use smaller types when possible — `euint8` operations cost 30-60% less than `euint64`
- Pre-compute encrypted constants outside loops with `FHE.asEuint64(value)`

### Estimating before coding

Before writing a loop or complex function, sketch the HCU budget:

```
// Example: confidential lending health check
// Per-user: 1 mul (collateral x price) + 1 mul (debt x price) + 1 div + 1 ge + 1 select
// euint64: 596K + 596K + 715K + 120K + 55K = 2,082K per user
// Max users per tx at 20M global limit: ~9 users
// Max users per tx at 5M sequential limit: ~2 users (sequential)
```

## Testing patterns

### Setup

Import the hardhat plugin — it provides `fhevm` as a global:

```typescript
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "hardhat";
```

### Encrypt, Call, Decrypt, Assert (the mandatory test shape)

Every FHEVM test must:
1. Encrypt at least one input
2. Call the contract with the encrypted input
3. Decrypt the result
4. Assert on the cleartext value

```typescript
it("should deposit and update encrypted balance", async function () {
    const [, alice] = await ethers.getSigners();
    const contractAddr = await lending.getAddress();

    // 1. Encrypt
    const enc = await fhevm
        .createEncryptedInput(contractAddr, alice.address)
        .add64(1000)
        .encrypt();

    // 2. Call
    const tx = await lending.connect(alice).deposit(enc.handles[0], enc.inputProof);
    await tx.wait();

    // 3. Decrypt
    const encBal = await lending.getBalance(alice.address);
    const clearBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encBal,
        contractAddr,
        alice
    );

    // 4. Assert
    expect(clearBal).to.eq(1000);
});
```

### Decrypt helper functions

| Function | Use for |
|----------|---------|
| `fhevm.userDecryptEuint(FhevmType.euintXX, handle, contractAddr, signer)` | Decrypting unsigned integers |
| `fhevm.userDecryptEbool(handle, contractAddr, signer)` | Decrypting booleans |
| `fhevm.userDecryptEaddress(handle, contractAddr, signer)` | Decrypting addresses |

### Multiple encrypted inputs

```typescript
const input = fhevm.createEncryptedInput(contractAddr, alice.address);
input.add64(1000);  // handles[0] = encrypted 1000
input.add64(500);   // handles[1] = encrypted 500
const enc = await input.encrypt();

await contract.connect(alice).doSomething(
    enc.handles[0], enc.handles[1], enc.inputProof
);
```

### Testing access control

```typescript
it("should not allow Bob to decrypt Alice's balance", async function () {
    // Alice deposits
    const enc = await fhevm
        .createEncryptedInput(contractAddr, alice.address)
        .add64(1000)
        .encrypt();
    await lending.connect(alice).deposit(enc.handles[0], enc.inputProof);

    // Bob tries to decrypt Alice's balance — should fail
    const encBal = await lending.getBalance(alice.address);
    try {
        await fhevm.userDecryptEuint(FhevmType.euint64, encBal, contractAddr, bob);
        expect.fail("Should have thrown");
    } catch (e) {
        // Expected: Bob has no ACL permission
    }
});
```

### Testing modes

| Mode | Command | Encryption | Speed | Use case |
|------|---------|-----------|-------|----------|
| Hardhat in-memory | `npx hardhat test` | Mock (deterministic) | Fast | Unit tests, CI |
| Hardhat node | `npx hardhat node` + `--network localhost` | Mock | Medium | Frontend dev |
| Sepolia | `--network sepolia` | Real FHE | Slow | Integration, pre-deploy |

In mock mode, encryption is deterministic and decryption is instant. This is by design — it lets you test logic without waiting for the KMS. But it means mock-mode tests won't catch timing issues or real crypto failures.

### Coprocessor initialization check

```typescript
it("should have coprocessor initialized", async function () {
    await fhevm.assertCoprocessorInitialized(contract, "MyContract");
});
```

Verifies that `ZamaEthereumConfig` was inherited correctly and the coprocessor addresses are set.

## The closed-loop workflow

After writing any FHEVM contract, run this closed loop before considering the code complete:

### Step 1 — Trace

```bash
node tools/fhevm-trace/src/index.js path/to/contracts/
```

Produces `fhevm-trace-output/trace.json` and `fhevm-trace-output/trace.md`. Review all findings. Fix any errors before proceeding.

### Step 2 — Attack

```bash
node tools/fhevm-attack/src/index.js path/to/project/
```

Reads `fhevm-trace-output/trace.json`, generates attack test files in `test/attacks/`, runs them, writes `fhevm-attack-output/report.md`. Any successful exploit means the contract has a real vulnerability.

### Step 3 — Patch

For each successful exploit in the attack report:
1. Read the anti-pattern reference (`references/anti-patterns.md`)
2. Apply the fix pattern
3. Add the AP ID as a code comment

### Step 4 — Re-trace and re-attack

```bash
node tools/fhevm-trace/src/index.js path/to/contracts/
# Should produce 0 findings
EXPECT_BLOCKED=1 node tools/fhevm-attack/src/index.js path/to/project/
# Should show all attacks blocked
```

### Step 5 — Ship

When trace returns 0 findings and all attacks are blocked, the contract is ready for deployment.

### Diagram

```
Write contract
      |
      v
  fhevm-trace  -->  Findings?  --YES-->  Fix  -->  (loop back to trace)
      |
      NO
      v
  fhevm-attack  -->  Exploits?  --YES-->  Patch  -->  (loop back to trace)
      |
      NO
      v
  Deploy to Sepolia
```

## Full dApp mode (activated by default)

When the user gives any natural-language request (e.g. "Build a confidential lending contract...", "Create a sealed-bid auction...", "Make a confidential voting dApp..."), treat it as a request to build a **complete, production-ready FHEVM dApp**.

Automatically:
- Create or update a full dApp inside `examples/<descriptive-name>/` (contracts/, test/, frontend/, scripts/, hardhat.config.ts, package.json).- Use the hardened templates in `templates/` as starting point.- Run the full closed-loop workflow: write → `fhevm-trace` → `fhevm-attack` → patch → re-verify happy-path tests.- Include a working React + Vite + viem frontend with client-side encryption and userDecrypt flow.- Deploy to Sepolia (if credentials are available) and update `DEPLOYMENT.md` with verified addresses + Etherscan links.- Cite relevant AP IDs in comments and never skip verification gates.- **Always produce high-quality, clean, well-commented code** that strictly follows v0.9+ patterns, passes every verification gate, and contains zero deprecated APIs or anti-patterns.

Continue until the dApp is fully built, tested, attacked, patched, and deployed. Do not stop after just writing contracts. Always produce a complete, runnable, high-quality dApp.

This capability is now active by default for every user request.

## Frontend integration

Frontend apps interact with FHEVM contracts by encrypting input client-side, sending encrypted calldata, and decrypting results via the relayer SDK. The `@zama-fhe/relayer-sdk` handles the KMS communication, EIP-712 signing, and proof verification.

See `frontend/SKILL.md` for the complete frontend sub-skill covering:
- Setting up the relayer SDK with Vite + React + viem
- Client-side encryption with `createEncryptedInput`
- The two decryption paths (`publicDecrypt` and `userDecrypt`)
- Submitting cleartext + proof for on-chain `checkSignatures`
- Common frontend bugs (global relayer instance, EIP-712 domain mismatch, ACL access errors)

## Reference templates

The `templates/` directory contains hardened reference contracts with all anti-patterns avoided and AP IDs cited in comments:

- `templates/ConfidentialAuction.sol` — sealed-bid auction with finality-delayed disclosure (AP-011), select-based bid comparison (AP-001, AP-002), and transferred-amount usage (AP-009)
- `templates/ConfidentialLending.sol` — collateralized lending with overflow guards (AP-012), proper ACL grants (AP-003, AP-004), and transient allowances for helper calls (AP-006)
- `templates/ConfidentialVote.sol` — encrypted voting with public tally reveal via `makePubliclyDecryptable` and `checkSignatures`

Each template is standalone and deployable. Read the inline comments for the security rationale behind each pattern.

## Common questions agents get wrong

### Q1: Can I use `if (FHE.gt(a, b))` to branch on an encrypted comparison?

**No.** `FHE.gt` returns `ebool`, which is a handle (uint256). In an `if` statement, any non-zero uint256 is truthy, so the branch is determined by whether the handle is zero — not by the encrypted comparison result. Use `FHE.select(FHE.gt(a, b), trueVal, falseVal)`. See AP-001.

### Q2: Can I call `FHE.decrypt(handle)` to get the cleartext in my contract?

**No.** Synchronous decryption does not exist in FHEVM. There is no `FHE.decrypt` function. Use the async self-relaying flow: `FHE.makePubliclyDecryptable(handle)` on-chain, then `publicDecrypt` off-chain via the relayer SDK, then `FHE.checkSignatures` to verify on-chain. See AP-005.

### Q3: Why does my contract revert with "ACL: sender not allowed" on the second transaction?

You forgot `FHE.allowThis(handle)` when storing the encrypted value. The contract itself doesn't have permission to read the handle it stored. Add `FHE.allowThis(handle)` after every storage write. See AP-003.

### Q4: Can I use `FHE.allowTransient` for values I'm storing in state?

**No.** Transient allowances expire at the end of the transaction. If you store a handle and only grant transient access, the contract loses permission in the next transaction. Use `FHE.allowThis` for state storage. `FHE.allowTransient` is only for handles you're passing to another contract within the same transaction. See AP-006.

### Q5: Does `FHE.allowTransient` leak under Account Abstraction (AA)?

**Yes, it can.** Under AA, `msg.sender` at the target contract is the AA wallet (smart account), not the EOA. If the AA wallet calls contract A, which uses `allowTransient` to pass a handle to contract B, then B's `msg.sender` is the AA wallet. If the AA wallet is compromised or has a generic `execute` function, an attacker can call B from the same AA wallet within the same tx and access the transient-allowed handle. Mitigation: when your protocol serves AA wallets, validate `tx.origin` in addition to `msg.sender`, or use handle-specific nonces to prevent same-tx replay through the AA wallet.

### Q6: My encrypted input proof fails when a relayer submits on behalf of the user. Why?

The encrypted input proof is bound to `(contractAddress, msg.sender)`. When a relayer submits the transaction, `msg.sender` is the relayer, not the user who created the proof. The proof was bound to the user's address, so `FHE.fromExternal` reverts. Solutions: (a) have the user submit directly, (b) bind the proof to the relayer's address (but then the relayer can replay), or (c) use ERC-2771 with a trusted forwarder that preserves `_msgSender()` (but the FHE library checks `msg.sender`, not `_msgSender()`). This is an unsolved UX friction point in the current FHEVM.

### Q7: Can I do `euint256` arithmetic for large token balances?

**No.** `euint256` does not support `add`, `sub`, `mul`, `div`, `rem`, `min`, or `max`. It only supports `eq`, `ne`, bitwise operations, `select`, and `rand`. Use `euint64` (up to 1.8x10^19) or `euint128` (up to 3.4x10^38) for arithmetic. See AP-008.

### Q8: Why does my confidential transfer succeed but the receiver's balance doesn't change?

You're probably using the requested amount instead of the returned transferred amount. Confidential ERC20 transfers silently return zero on insufficient balance (they can't revert — the balance check is encrypted). If you ignore the return value and use the original amount, your accounting is wrong. Always use the returned value. See AP-009.

### Q9: Can an attacker replay a decryption callback to double-drain funds?

**Yes, if you don't delete the pending-request mapping entry before the external call.** The relayer's calldata (cleartext + proof) is valid forever against `FHE.checkSignatures` as long as the contract state expects it. Delete the pending entry before any external call. This is exactly the checks-effects-interactions pattern applied to FHE decryption callbacks. See AP-010.

### Q10: Is it safe to have an `execute(address target, bytes data)` function in a contract that holds encrypted state?

**No.** A generic `execute` function can be used to call ACL grant functions, giving the attacker ACL access to any handle the contract owns. They then call `userDecrypt` off-chain to read everything. Whitelist allowed targets and explicitly block the ACL contract address. See AP-013. This applies to governance contracts, multisigs, and any contract with arbitrary-calldata execution.

### Q11: How do I handle errors in encrypted logic when I can't revert?

Use an encrypted error code pattern. Instead of `require(condition, "error")`, compute an `ebool` error flag and use `FHE.select` to zero-out the operation when the error condition is true. Return or store the error flag alongside the result so the client can decrypt it and display an appropriate message. Example:

```solidity
function withdraw(externalEuint64 encAmount, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(encAmount, proof);
    ebool hasEnough = FHE.ge(balances[msg.sender], amount);
    // AP-002: cannot require(hasEnough) — use select instead
    euint64 actualWithdraw = FHE.select(hasEnough, amount, FHE.asEuint64(0));
    balances[msg.sender] = FHE.sub(balances[msg.sender], actualWithdraw);
    FHE.allowThis(balances[msg.sender]);
    FHE.allow(balances[msg.sender], msg.sender);
    // Store error flag so client can check
    lastWithdrawSuccess[msg.sender] = hasEnough;
    FHE.allowThis(hasEnough);
    FHE.allow(hasEnough, msg.sender);
}
```

The client decrypts `lastWithdrawSuccess` to know if the withdrawal actually happened. Both code paths execute on-chain, preserving privacy about the balance.

### Q12: Can I iterate over an encrypted array with an encrypted index?

**Technically yes, but it is extremely expensive.** You must loop over every element and use `FHE.select` to pick the one at the encrypted index. For an array of N elements, this costs N comparisons + N selections per access. With `euint64` that's N x (120K + 55K) = 175K x N HCU. At N=100, that's 17.5M HCU — nearly the global limit for a single array access. Prefer fixed-position mappings or restructure your data model to avoid encrypted indexing.

```solidity
// Expensive: O(N) per access
function getAtEncryptedIndex(euint64[] storage arr, euint64 encIdx) internal returns (euint64) {
    euint64 result = FHE.asEuint64(0);
    for (uint256 i = 0; i < arr.length; i++) {
        ebool isMatch = FHE.eq(encIdx, FHE.asEuint64(i));
        result = FHE.select(isMatch, arr[i], result);
    }
    return result;
}
```

### Q13: What happens if I forget `FHE.allow` but the test still passes in mock mode?

Mock mode may be more permissive than the real coprocessor on Sepolia. Some ACL violations that would fail on-chain may succeed in mock mode because the mock doesn't fully replicate KMS permission checks. Always test on Sepolia before deploying to mainnet if you want to verify ACL correctness. The `fhevm-trace` tool catches missing `allow*` calls statically, without relying on runtime behavior.

### Q14: Can I use `delegatecall` to share FHE logic between contracts?

**Be extremely careful.** `delegatecall` executes the target's code in the caller's storage context, but `msg.sender` remains the original caller. ACL grants made inside a `delegatecall` target will be associated with the calling contract's address, not the library's address. This can work for shared utility libraries, but if the library grants ACL access based on assumptions about its own address, those assumptions break under `delegatecall`. Prefer regular function calls with `allowTransient` for inter-contract FHE logic sharing. If you must use `delegatecall`, audit every ACL grant in the target for address assumptions.

### Q15: How do I prevent information leakage through gas usage patterns?

FHE operations have data-independent execution cost — the gas consumed doesn't depend on the encrypted values. However, **control flow based on plaintext conditions that correlate with encrypted state** can leak information. For example, if your contract has a plaintext `isActive` flag that's set based on a decrypted encrypted value, an observer can infer the encrypted state from the flag. Keep all state that derives from encrypted values encrypted. When you must branch on plaintext (e.g., `block.timestamp > deadline`), ensure the branch doesn't reveal information about encrypted state — execute the same FHE operations in both paths.

### Q16: What is the difference between `FHE.isInitialized` and checking for zero?

`FHE.isInitialized(handle)` checks if the handle is `bytes32(0)` — i.e., whether the variable has ever been assigned an encrypted value. This is a **plaintext** check (returns `bool`, not `ebool`) and is safe to use in `if` statements. It does NOT decrypt the value. An initialized handle holding encrypted zero is still "initialized". Use this to distinguish "never set" from "set to encrypted zero":

```solidity
if (!FHE.isInitialized(balances[user])) {
    // First deposit — no previous balance to add to
    balances[user] = amount;
} else {
    // Has a balance (possibly encrypted zero) — add to it
    balances[user] = FHE.add(balances[user], amount);
}
FHE.allowThis(balances[user]);
FHE.allow(balances[user], user);
```
