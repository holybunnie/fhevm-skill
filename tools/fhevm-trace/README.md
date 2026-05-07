# fhevm-trace

Static ACL flow analyzer for FHEVM smart contracts. Parses Solidity source using `@solidity-parser/parser`, walks the AST to extract ACL grants and detect anti-pattern violations, and falls back to regex-based detection for patterns the AST walker cannot capture.

## Usage

```bash
node src/index.js <path-to-sol-file-or-directory>
```

## Output

Two artifacts in `./fhevm-trace-output/`:
- `trace.json` — machine-readable findings (consumed by `fhevm-attack`)
- `trace.md` — human-readable report with Mermaid ACL flow graphs

## Detected anti-patterns

- **AP-006** — Persistent allowance to external address (should use `allowTransient`)
- **AP-009** — External call return value ignored, original argument used in FHE comparison
- **AP-010** — Callback function with external call before `delete` of pending mapping
- **AP-011** — `makePubliclyDecryptable` in same function as `block.timestamp`/`block.number` check

## Test

```bash
npm test
```
