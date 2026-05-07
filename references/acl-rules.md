# FHEVM ACL Rules Reference

## ACL Primitives

| Function | Persistence | Scope | Gas | Use when |
|----------|------------|-------|-----|----------|
| `FHE.allow(handle, addr)` | Permanent | Specific address | Storage write | User needs to decrypt off-chain, or another contract needs persistent access |
| `FHE.allowThis(handle)` | Permanent | `address(this)` | Storage write | Storing encrypted value for use in future transactions (always required) |
| `FHE.allowTransient(handle, addr)` | Current tx only | Specific address | Transient storage (EIP-1153) | Passing handle to external contract within same transaction |
| `FHE.makePubliclyDecryptable(handle)` | Permanent | Everyone | Storage write | Public reveal (auction result, vote tally). Irreversible. |
| `FHE.isSenderAllowed(handle)` | N/A (read) | Checks `msg.sender` | View call | Validating incoming handle from external caller |
| `FHE.isAllowed(handle, addr)` | N/A (read) | Checks specific addr | View call | Checking if an address has permission |
| `FHE.cleanTransientStorage()` | N/A | Clears transient | Transient clear | Explicitly clearing transient permissions mid-tx |

## When to use each primitive

### Storage writes → `allowThis` (always)

Every `mapping[key] = encryptedValue` or `stateVar = encryptedValue` must be followed by `FHE.allowThis(encryptedValue)`. Without it, the contract itself cannot read the value in the next transaction. This is AP-003.

### User-visible values → `allow(handle, user)`

Any value the user should be able to read in a frontend (balances, positions, bids) needs `FHE.allow(handle, userAddress)`. This is AP-004.

### Inter-contract calls → `allowTransient` (prefer)

When contract A calls `B.process(handle)`, use `FHE.allowTransient(handle, address(B))`. This prevents B from retaining access after the transaction ends. This is AP-006.

Exception: if B needs to store the handle and use it in future transactions, B must call `FHE.allowThis(handle)` on its end, and A must use `FHE.allow(handle, address(B))` (persistent). But this is a design smell — consider whether B genuinely needs cross-tx access.

### Public reveals → `makePubliclyDecryptable`

Once called, anyone can call `publicDecrypt` off-chain to get the cleartext. Cannot be revoked. Only use for values that should be permanently public (final vote tallies, auction outcomes after finality delay).

### Incoming handles → `isSenderAllowed`

At the top of any function receiving `euint*`/`ebool` from an external caller (not from `FHE.fromExternal`), validate with `require(FHE.isSenderAllowed(handle))`. This is AP-007.

## Common ACL patterns

### Deposit (user → contract)

```solidity
function deposit(externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    balances[msg.sender] = FHE.add(balances[msg.sender], amount);
    FHE.allowThis(balances[msg.sender]);      // contract can use next tx
    FHE.allow(balances[msg.sender], msg.sender); // user can decrypt
}
```

### Transfer (user → user via contract)

```solidity
function transfer(address to, externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    ebool ok = FHE.ge(balances[msg.sender], amount);
    euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));

    balances[msg.sender] = FHE.sub(balances[msg.sender], actual);
    balances[to] = FHE.add(balances[to], actual);

    FHE.allowThis(balances[msg.sender]);
    FHE.allow(balances[msg.sender], msg.sender);
    FHE.allowThis(balances[to]);
    FHE.allow(balances[to], to);
}
```

### Helper call (contract → contract, same tx)

```solidity
function processWithHelper(euint64 amount) internal {
    FHE.allowTransient(amount, address(helper));  // transient only
    helper.compute(amount);
}
```

### Public reveal (two-phase)

```solidity
function finalize() external {
    require(block.timestamp > deadline);
    finalized = true;
    finalizedBlock = block.number;
}

function reveal() external {
    require(finalized && block.number > finalizedBlock + DELAY);
    FHE.makePubliclyDecryptable(result);
}
```
