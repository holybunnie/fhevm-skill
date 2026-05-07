# FHEVM Cheatsheet

## Imports

```solidity
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyContract is ZamaEthereumConfig { ... }
```

## Accept encrypted input

```solidity
function myFunc(externalEuint64 encVal, bytes calldata proof) external {
    euint64 val = FHE.fromExternal(encVal, proof);
    // use val...
    FHE.allowThis(val);
    FHE.allow(val, msg.sender);
}
```

## Store encrypted value (AP-003 + AP-004)

```solidity
balances[user] = newBalance;
FHE.allowThis(newBalance);       // contract can use next tx
FHE.allow(newBalance, user);     // user can decrypt
```

## Branch on encrypted condition (AP-001)

```solidity
// NEVER: if (FHE.gt(a, b)) { ... }
// ALWAYS:
result = FHE.select(FHE.gt(a, b), valueIfTrue, valueIfFalse);
```

## Safe subtraction (AP-012)

```solidity
ebool canSub = FHE.ge(a, b);
euint64 result = FHE.select(canSub, FHE.sub(a, b), FHE.asEuint64(0));
```

## Pass handle to external contract (AP-006)

```solidity
FHE.allowTransient(handle, address(target));  // not FHE.allow
target.process(handle);
```

## Receive handle from external caller (AP-007)

```solidity
function process(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "Not allowed");
    // ...
}
```

## Public reveal (AP-011 — two-phase)

```solidity
// Phase 1: finalize
finalized = true;
finalizedAt = block.number;

// Phase 2: disclose (after delay)
require(block.number >= finalizedAt + DELAY);
FHE.makePubliclyDecryptable(result);
```

## On-chain verification of decrypted values

```solidity
function onResult(bytes32[] calldata handles, bytes calldata clear, bytes calldata proof) external {
    FHE.checkSignatures(handles, clear, proof);
    uint64 value = abi.decode(clear, (uint64));
}
```

## Test pattern (encrypt → call → decrypt → assert)

```typescript
const enc = await fhevm.createEncryptedInput(addr, signer.address).add64(100).encrypt();
await contract.connect(signer).deposit(enc.handles[0], enc.inputProof);
const handle = await contract.getBalance(signer.address);
const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, addr, signer);
expect(clear).to.eq(100);
```

## Check initialization

```solidity
if (!FHE.isInitialized(balances[user])) {
    balances[user] = amount;  // first deposit
} else {
    balances[user] = FHE.add(balances[user], amount);
}
```

## Type defaults

- Balances / amounts: `euint64`
- Flags / conditions: `ebool`
- Counters: `euint32`
- Large amounts: `euint128`
- Avoid: `euint256` (no arithmetic)

## HCU quick reference

- add/sub(euint64): ~162K
- mul(euint64): ~596K
- div(euint64, scalar): ~715K
- select: ~55K
- Transaction limit: 20M global, 5M sequential
