# fhevm-attack

Trace-directed dynamic attack generator for FHEVM contracts. Reads findings from `fhevm-trace-output/trace.json`, instantiates attack test templates, runs them against the target Hardhat project, and writes a report.

## Usage

```bash
# First, run fhevm-trace to generate trace.json
node ../fhevm-trace/src/index.js contracts/

# Then, run fhevm-attack
node src/index.js <path-to-hardhat-project>

# After patching, verify attacks are blocked
EXPECT_BLOCKED=1 node src/index.js <path-to-hardhat-project>
```

## Attack templates

| Template | Anti-pattern | Exploit |
|----------|-------------|---------|
| `silent-failure-bid` | AP-009 | Zero-balance bid recorded at full amount |
| `acl-leak-via-proxy` | AP-006 | Persistent ACL leaks handle to attacker |
| `callback-replay` | AP-010 | Callback calldata replayed for double-drain |
| `reorg-disclosure` | AP-011 | Premature disclosure leaked through reorg |
| `hcu-budget` | HCU | Gas growth indicates HCU limit risk |

## Dual-mode

Each template supports two modes via the `EXPECT_BLOCKED` env var:
- **Default (unset)**: asserts the exploit succeeds (validates the attack is real)
- **`EXPECT_BLOCKED=1`**: asserts the exploit is blocked (validates the patch works)

## Output

`fhevm-attack-output/report.md` with per-finding results marked with ❌ (exploit succeeded) or ✅ (attack blocked).

## Test

```bash
npm test
```
