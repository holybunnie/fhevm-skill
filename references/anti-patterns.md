# FHEVM Anti-Patterns Reference

Quick reference for all 13 anti-patterns. Each entry: rule, why, wrong code, right code, detection.

---

## AP-001 — Never branch on encrypted values

**Rule**: No `if`/`else`/ternary on encrypted values. Use `FHE.select`.

**Why**: The EVM sees handles (uint256), not encrypted bits. Branching on a handle checks if it's zero, not its encrypted value.

**Detection**: `fhevm-trace` — flags `if` conditions referencing encrypted types.

```solidity
// ❌ WRONG
ebool cond = FHE.gt(a, b);
if (cond) { result = a; } else { result = b; }

// ✅ RIGHT
ebool cond = FHE.gt(a, b);
result = FHE.select(cond, a, b);
FHE.allowThis(result);
```

---

## AP-002 — Never require on encrypted comparisons

**Rule**: No `require(ebool)` or `assert(ebool)`.

**Why**: `require` casts ebool handle to uint256. Non-zero handles always pass. The encrypted bit is invisible.

**Detection**: `fhevm-trace` — flags `require` with FHE comparison arguments.

```solidity
// ❌ WRONG
require(FHE.ge(balance, amount), "Insufficient");

// ✅ RIGHT
ebool ok = FHE.ge(balance, amount);
euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));
```

---

## AP-003 — Always allowThis for stored encrypted values

**Rule**: Every encrypted value written to storage needs `FHE.allowThis(handle)`.

**Why**: Without it, the contract cannot use the stored handle in the next transaction. The coprocessor rejects operations on handles without ACL permission.

**Detection**: `fhevm-trace` — flags storage writes to encrypted types without `allowThis` in the same function.

```solidity
// ❌ WRONG
balances[user] = newBal;

// ✅ RIGHT
balances[user] = newBal;
FHE.allowThis(newBal);
```

---

## AP-004 — Always allow users who need to decrypt

**Rule**: Call `FHE.allow(handle, userAddress)` for every value a user needs to read off-chain.

**Why**: The KMS refuses `userDecrypt` from addresses without ACL permission.

**Detection**: `fhevm-trace` — flags per-user mapping writes without corresponding `FHE.allow`.

```solidity
// ❌ WRONG
balances[msg.sender] = newBal;
FHE.allowThis(newBal);

// ✅ RIGHT
balances[msg.sender] = newBal;
FHE.allowThis(newBal);
FHE.allow(newBal, msg.sender);
```

---

## AP-005 — Synchronous decryption does not exist

**Rule**: No `FHE.decrypt()`, no `FHE.requestDecryption()`. Use the async self-relaying flow.

**Why**: FHE decryption requires the KMS cluster. Synchronous decrypt was never implemented.

**Detection**: `fhevm-trace` — flags calls to `decrypt`, `requestDecryption`, `loadRequestedHandles`.

```solidity
// ❌ WRONG — does not exist (fabricated)
uint64 clear = FHE.decrypt(enc);

// ✅ RIGHT
FHE.makePubliclyDecryptable(enc);
// Off-chain: publicDecrypt → relay cleartext + proof → checkSignatures on-chain
```

---

## AP-006 — Prefer allowTransient for inter-contract handle passing

**Rule**: Use `FHE.allowTransient` (not `FHE.allow`) when passing handles to external contracts within a transaction.

**Why**: Persistent allowances survive the tx. A compromised target retains access forever. Transient allowances expire at tx end (EIP-1153).

**Detection**: `fhevm-trace` — flags `FHE.allow(handle, externalAddr)` where `externalAddr` is not `msg.sender` or `address(this)`.

```solidity
// ❌ WRONG
FHE.allow(amount, address(helper));
helper.process(amount);

// ✅ RIGHT
FHE.allowTransient(amount, address(helper));
helper.process(amount);
```

---

## AP-007 — Validate sender permission on received handles

**Rule**: Check `FHE.isSenderAllowed(handle)` at entry of any function receiving encrypted handles from external callers.

**Why**: Without validation, anyone can pass arbitrary handle values causing silent failures or wrong computations.

**Detection**: `fhevm-trace` — flags public/external functions with `euint*`/`ebool` params lacking `isSenderAllowed`.

```solidity
// ❌ WRONG
function process(euint64 amount) external { ... }

// ✅ RIGHT
function process(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "Not allowed");
    ...
}
```

---

## AP-008 — Use euint64 for balances, not euint256

**Rule**: Default to `euint64` for token amounts. `euint256` has no arithmetic.

**Why**: `euint256` does not support add/sub/mul/div/rem/min/max. It's 4x more expensive for the ops it does have. `euint64` covers up to 1.8x10^19.

**Detection**: `fhevm-trace` — flags `euint256` state vars in arithmetic contexts.

```solidity
// ❌ WRONG
euint256 balance; // cannot add/sub

// ✅ RIGHT
euint64 balance;
```

---

## AP-009 — Use the transferred amount, not the requested amount

**Rule**: Use the return value of confidential token transfers, not the requested amount.

**Why**: Confidential ERC20 silently zeroes on insufficient balance. The requested amount may not have actually transferred.

**Detection**: `fhevm-trace` — flags ignored return values from external calls followed by use of the original argument.

```solidity
// ❌ WRONG
token.transfer(to, requestedAmt);
bids[user] = requestedAmt;

// ✅ RIGHT
euint64 actual = token.transfer(to, requestedAmt);
bids[user] = actual;
FHE.allowThis(actual);
```

---

## AP-010 — Delete pending-request mapping before external calls

**Rule**: In decryption callbacks, `delete` the pending mapping entry before any `.call`/`.transfer`/`.send`.

**Why**: Without deletion, the callback calldata (cleartext + proof) can be replayed for double-drain. Classic reentrancy adapted for FHE.

**Detection**: `fhevm-trace` — flags callback functions with mapping reads and external calls without intervening `delete`.

```solidity
// ❌ WRONG
function onDecrypted(...) {
    address r = pending[id];
    payable(r).transfer(amt); // replayable
    delete pending[id];
}

// ✅ RIGHT
function onDecrypted(...) {
    address r = pending[id];
    require(r != address(0), "Processed");
    delete pending[id]; // AP-010: before external call
    payable(r).transfer(amt);
}
```

---

## AP-011 — Schedule disclosure with finality delay

**Rule**: Don't grant decryption rights in the same block as the state-changing event. Add a finality delay.

**Why**: Reorg can replace the winner, but the old winner retains decryption rights. Dangerous when the product is information.

**Detection**: `fhevm-trace` — flags `makePubliclyDecryptable` in same function as `block.timestamp`/`block.number` checks.

```solidity
// ❌ WRONG
function finalize() external {
    require(block.timestamp > end);
    FHE.makePubliclyDecryptable(winner);
}

// ✅ RIGHT
function finalize() external {
    require(block.timestamp > end);
    finalizedAt = block.number;
}
function disclose() external {
    require(block.number >= finalizedAt + DELAY);
    FHE.makePubliclyDecryptable(winner);
}
```

---

## AP-012 — Guard against silent arithmetic overflow

**Rule**: FHE arithmetic wraps silently. Clamp with `FHE.gt` + `FHE.select` before dangerous operations.

**Why**: No revert on overflow/underflow. `2^64 - 1 + 1 = 0` silently.

**Detection**: `fhevm-trace` — flags arithmetic on user-supplied inputs without preceding range checks.

```solidity
// ❌ WRONG
balance = FHE.add(balance, userAmount);

// ✅ RIGHT
euint64 max = FHE.asEuint64(type(uint64).max / 2);
ebool tooLarge = FHE.gt(userAmount, max);
euint64 safe = FHE.select(tooLarge, FHE.asEuint64(0), userAmount);
balance = FHE.add(balance, safe);
```

---

## AP-013 — Never grant ACL from arbitrary execute functions

**Rule**: Block `execute(target, data)` from calling ACL grant functions.

**Why**: Attacker crafts calldata to `FHE.allow(handle, attackerAddr)`, reads all encrypted state off-chain via `userDecrypt`.

**Detection**: `fhevm-trace` — flags functions with `.call(data)` or `.delegatecall(data)` where target/data comes from parameters.

```solidity
// ❌ WRONG
function execute(address t, bytes calldata d) external onlyOwner {
    (bool ok,) = t.call(d);
}

// ✅ RIGHT
function execute(address t, bytes calldata d) external onlyOwner {
    require(t != FHE_ACL, "Blocked");
    require(allowed[t], "Not whitelisted");
    (bool ok,) = t.call(d);
}
```
