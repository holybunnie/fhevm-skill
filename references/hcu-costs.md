# FHEVM HCU (Homomorphic Complexity Unit) Costs

## Transaction limits

- **Global limit**: 20,000,000 HCU per transaction
- **Sequential depth limit**: 5,000,000 HCU per transaction
- Exceeding either limit reverts the transaction.

## Cost table (non-scalar operations)

| Operation | euint8 | euint16 | euint32 | euint64 | euint128 | euint256 |
|-----------|--------|---------|---------|---------|----------|----------|
| `add` | 88K | 105K | 125K | 162K | 259K | N/A |
| `sub` | 91K | 105K | 125K | 162K | 260K | N/A |
| `mul` | 150K | 197K | 328K | 596K | 1,686K | N/A |
| `div` (scalar) | 210K | 306K | 438K | 715K | 1,225K | N/A |
| `rem` (scalar) | 440K | 570K | 792K | 1,153K | 1,943K | N/A |
| `eq` | 55K | 62K | 86K | 120K | 122K | 122K |
| `ne` | 55K | 62K | 86K | 120K | 122K | 122K |
| `ge/gt/le/lt` | 55K | 62K | 86K | 120K | 122K | N/A |
| `select` | 55K | 55K | 55K | 55K | 57K | 57K |
| `min/max` | 162K | 177K | 199K | 236K | 333K | N/A |
| `neg` | 91K | 105K | 125K | 162K | 260K | N/A |
| `not` | 9 | 16 | 32 | 63 | 130 | 256 |
| `and/or/xor` | 9 | 16 | 32 | 63 | 130 | 256 |
| `shl/shr` | 116K | 133K | 150K | 186K | 282K | 370K |
| `rotl/rotr` | 116K | 133K | 150K | 186K | 282K | 370K |
| `rand` | 23K | 23K | 24K | 24K | 25K | 25K |
| `cast` | 32 | 32 | 32 | 32 | 32 | 32 |
| `trivialEncrypt` | 32 | 32 | 32 | 32 | 32 | 32 |

## Relative cost ordering (cheapest to most expensive)

```
not/and/or/xor  (< 1K)
    ↓
cast/trivialEncrypt  (32)
    ↓
rand  (~24K)
    ↓
select  (~55K)
    ↓
eq/ne  (55-122K)
    ↓
add/sub  (88-260K)
    ↓
ge/gt/le/lt  (55-122K)
    ↓
shl/shr/rotl/rotr  (116-370K)
    ↓
min/max  (162-333K)
    ↓
mul  (150K-1.7M)
    ↓
div  (210K-1.2M)
    ↓
rem  (440K-1.9M)
```

## Loop danger zone

| Loop iterations | add(euint64) | mul(euint64) | div(euint64,scalar) | rem(euint64,scalar) |
|----------------|-------------|-------------|--------------------|--------------------|
| 1 | 162K | 596K | 715K | 1,153K |
| 5 | 810K | 2,980K | 3,575K | 5,765K |
| 10 | 1,620K | 5,960K | 7,150K | 11,530K |
| 20 | 3,240K | 11,920K | 14,300K | 23,060K |
| 50 | 8,100K | 29,800K | 35,750K | 57,650K |

Cells exceeding the 5M sequential limit: mul x10+, div x10+, rem x5+

Cells exceeding the 20M global limit: mul x50, div x50, rem x20+

## Optimization tips

1. **Prefer scalar operands** — `FHE.add(x, 5)` is cheaper than `FHE.add(x, FHE.asEuint64(5))`
2. **Use smallest type** — `euint8` add is 88K vs `euint64` at 162K (46% cheaper)
3. **Pre-compute constants** — `FHE.asEuint64(value)` outside loops (32 HCU each, vs repeating inside)
4. **Avoid rem** — it's the most expensive operation. Consider bitwise AND with power-of-2 masks instead
5. **Batch select** — a single `select` (55K) is much cheaper than multiple conditional computations
6. **Split heavy functions** — if a function exceeds limits, split across multiple transactions
