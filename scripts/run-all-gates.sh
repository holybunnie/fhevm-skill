#!/bin/bash
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "=== STAGE 1: Workspace install + compile ==="
npm install 2>&1 | tail -3
echo "STAGE 1.1: npm install OK"

cd "$REPO/examples/confidential-lending-app"
npx hardhat compile 2>&1 | tail -3
echo "STAGE 1.2: compile OK"

echo ""
echo "=== STAGE 2: SKILL.md checks ==="
cd "$REPO"

LINES=$(wc -l < SKILL.md)
test "$LINES" -ge 1200 || (echo "FAIL: SKILL.md too short ($LINES lines, need 1200+)" && exit 1)
test "$LINES" -le 3000 || (echo "FAIL: SKILL.md too long ($LINES lines, max 3000)" && exit 1)
echo "STAGE 2.1: SKILL.md length OK ($LINES lines)"

for i in 001 002 003 004 005 006 007 008 009 010 011 012 013; do
  grep -q "AP-$i" SKILL.md || (echo "FAIL: AP-$i missing from SKILL.md" && exit 1)
done
echo "STAGE 2.2: All 13 AP rules in SKILL.md"

for i in 001 002 003 004 005 006 007 008 009 010 011 012 013; do
  grep -q "AP-$i" references/anti-patterns.md || (echo "FAIL: AP-$i missing from anti-patterns.md" && exit 1)
done
echo "STAGE 2.3: All 13 AP rules in anti-patterns.md"

grep -q "publicDecrypt\|userDecrypt" SKILL.md || (echo "FAIL: SKILL.md missing v0.9 SDK" && exit 1)
grep -q "checkSignatures" SKILL.md || (echo "FAIL: SKILL.md missing checkSignatures" && exit 1)
grep -q "fhevm-trace" SKILL.md || (echo "FAIL: SKILL.md missing fhevm-trace" && exit 1)
grep -q "fhevm-attack" SKILL.md || (echo "FAIL: SKILL.md missing fhevm-attack" && exit 1)
echo "STAGE 2.4: SKILL.md content checks OK"

echo ""
echo "=== STAGE 3: fhevm-trace ==="
cd "$REPO/tools/fhevm-trace"
npm test 2>&1 | tail -3
echo "STAGE 3.1: trace unit tests OK"

node src/index.js test/fixtures/clean.sol > /dev/null 2>&1
COUNT=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(len(d['findings']))")
test "$COUNT" -eq 0 || (echo "FAIL: clean fixture produced $COUNT findings" && exit 1)
echo "STAGE 3.2: clean fixture 0 findings OK"

for fixture in dirty-acl-leak dirty-replay dirty-disclosure dirty-silent-failure; do
  node src/index.js test/fixtures/${fixture}.sol > /dev/null 2>&1
  COUNT=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(len(d['findings']))")
  test "$COUNT" -ge 1 || (echo "FAIL: ${fixture} produced $COUNT findings" && exit 1)
done
echo "STAGE 3.3: dirty fixtures all produce findings OK"

# Specific rule mappings
node src/index.js test/fixtures/dirty-acl-leak.sol > /dev/null 2>&1
RULE=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(d['findings'][0]['rule'])")
test "$RULE" = "AP-006" || (echo "FAIL: dirty-acl-leak should flag AP-006, got $RULE" && exit 1)

node src/index.js test/fixtures/dirty-replay.sol > /dev/null 2>&1
RULE=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(d['findings'][0]['rule'])")
test "$RULE" = "AP-010" || (echo "FAIL: dirty-replay should flag AP-010, got $RULE" && exit 1)

node src/index.js test/fixtures/dirty-disclosure.sol > /dev/null 2>&1
RULE=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(d['findings'][0]['rule'])")
test "$RULE" = "AP-011" || (echo "FAIL: dirty-disclosure should flag AP-011, got $RULE" && exit 1)

node src/index.js test/fixtures/dirty-silent-failure.sol > /dev/null 2>&1
RULE=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(d['findings'][0]['rule'])")
test "$RULE" = "AP-009" || (echo "FAIL: dirty-silent-failure should flag AP-009, got $RULE" && exit 1)

grep -q "graph LR\|graph TD" fhevm-trace-output/trace.md || (echo "FAIL: no Mermaid graph" && exit 1)
echo "STAGE 3.4: rule mappings + Mermaid OK"

echo ""
echo "=== STAGE 4: fhevm-attack ==="
cd "$REPO/tools/fhevm-attack"
npm test 2>&1 | tail -3
echo "STAGE 4.1: attack unit tests OK"

for t in silent-failure-bid acl-leak-via-proxy callback-replay reorg-disclosure hcu-budget; do
  test -s templates/${t}.test.ts.tmpl || (echo "FAIL: template $t missing or empty" && exit 1)
done
echo "STAGE 4.2: all 5 templates exist OK"

echo ""
echo "=== STAGE 5: Lending app ==="
cd "$REPO/examples/confidential-lending-app"

# Trace on patched: zero findings
node "$REPO/tools/fhevm-trace/src/index.js" contracts/ConfidentialLending.sol > /dev/null 2>&1
COUNT=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(len(d['findings']))")
test "$COUNT" -eq 0 || (echo "FAIL: patched contract has $COUNT trace findings" && exit 1)
echo "STAGE 5.1: patched contract 0 findings OK"

# Trace on broken: at least 2 findings (AP-009, AP-011)
node "$REPO/tools/fhevm-trace/src/index.js" contracts/broken/ConfidentialLending.broken.sol > /dev/null 2>&1
COUNT=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(len(d['findings']))")
test "$COUNT" -ge 2 || (echo "FAIL: broken contract has $COUNT findings, expected >=2" && exit 1)

RULES=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(' '.join(sorted(set(f['rule'] for f in d['findings']))))")
echo "$RULES" | grep -q "AP-009" || (echo "FAIL: broken contract missing AP-009 finding" && exit 1)
echo "$RULES" | grep -q "AP-011" || (echo "FAIL: broken contract missing AP-011 finding" && exit 1)
echo "STAGE 5.2: broken contract findings OK ($RULES)"

# Run attack tests against broken contract (exploits should succeed)
npx hardhat test test/attacks/ 2>&1 | tail -5
echo "STAGE 5.3: broken contract attack tests OK"

# Run attack tests against patched contract in EXPECT_BLOCKED mode
# This proves the patched contract actually blocks the exploits
EXPECT_BLOCKED=1 npx hardhat test test/attacks/F-001-AP-011.test.ts 2>&1 | tail -5
echo "STAGE 5.4: patched contract EXPECT_BLOCKED OK"

echo ""
echo "=== STAGE 6: Frontend ==="
cd "$REPO/examples/confidential-lending-app/frontend"
npm run build 2>&1 | tail -5
echo "STAGE 6.1: frontend build OK"

grep -rq "@zama-fhe/relayer-sdk" src/ || (echo "FAIL: frontend not importing relayer SDK" && exit 1)
echo "STAGE 6.2: relayer SDK import OK"

test -f "$REPO/frontend/SKILL.md" || (echo "FAIL: frontend SKILL.md missing" && exit 1)
LINES=$(wc -l < "$REPO/frontend/SKILL.md")
test "$LINES" -ge 400 || (echo "FAIL: frontend SKILL.md too short ($LINES)" && exit 1)
grep -q "userDecrypt\|publicDecrypt" "$REPO/frontend/SKILL.md" || (echo "FAIL: frontend SKILL.md missing decrypt" && exit 1)
grep -q "createEncryptedInput" "$REPO/frontend/SKILL.md" || (echo "FAIL: frontend SKILL.md missing createEncryptedInput" && exit 1)
echo "STAGE 6.3: frontend SKILL.md OK ($LINES lines)"

grep -qE "0x[a-fA-F0-9]{40}" "$REPO/DEPLOYMENT.md" || (echo "FAIL: DEPLOYMENT.md missing addresses" && exit 1)
grep -q "sepolia.etherscan.io" "$REPO/DEPLOYMENT.md" || (echo "FAIL: DEPLOYMENT.md missing Etherscan links" && exit 1)
echo "STAGE 6.4: DEPLOYMENT.md OK"

echo ""
echo "=== STAGE 7: Cross-contract + final ==="
cd "$REPO"

node tools/fhevm-trace/src/index.js tools/fhevm-trace/test/fixtures/dirty-cross-contract-leak/ > /dev/null 2>&1
RULES=$(python3 -c "import json;d=json.load(open('fhevm-trace-output/trace.json'));print(' '.join(sorted(set(f['rule'] for f in d['findings']))))")
echo "$RULES" | grep -q "AP-006-EXT" || (echo "FAIL: cross-contract fixture missing AP-006-EXT" && exit 1)
echo "STAGE 7.1: cross-contract AP-006-EXT OK"

test -s SUBMISSION.md || (echo "FAIL: SUBMISSION.md missing" && exit 1)
LINES=$(wc -l < SUBMISSION.md)
test "$LINES" -ge 80 || (echo "FAIL: SUBMISSION.md too short ($LINES, need 80+)" && exit 1)
echo "STAGE 7.2: SUBMISSION.md OK ($LINES lines)"

grep -q "graph LR\|graph TD" README.md || (echo "FAIL: README missing closed-loop Mermaid" && exit 1)
echo "STAGE 7.3: README Mermaid OK"

echo ""
echo "=== ANTI-FABRICATION CHECKS ==="
# Forbidden API references — must return zero matches
BAD=$(grep -rn "TFHE\." . --include="*.sol" --include="*.ts" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=cache --exclude-dir=artifacts | grep -vE "deprecated|wrong|❌|never|forbidden|do not|removed|TFHE\.\*|old prefix" | wc -l)
test "$BAD" -eq 0 || (echo "FAIL: Found $BAD forbidden TFHE references" && grep -rn "TFHE\." . --include="*.sol" --include="*.ts" --include="*.md" --exclude-dir=node_modules --exclude-dir=cache --exclude-dir=artifacts | grep -vE "deprecated|wrong|❌|never|forbidden|do not|removed|TFHE\.\*|old prefix" && exit 1)
echo "Anti-fabrication: TFHE references OK"

BAD2=$(grep -rn "SepoliaConfig\|requestDecryption\|loadRequestedHandles\|TFHE.decrypt" . \
  --include="*.sol" --exclude-dir=node_modules --exclude-dir=fhevmTemp --exclude-dir=cache --exclude-dir=artifacts | wc -l)
test "$BAD2" -eq 0 || (echo "FAIL: Found $BAD2 deprecated API references in .sol files" && exit 1)
echo "Anti-fabrication: deprecated APIs OK"

echo ""
echo "========================================="
echo "ALL STAGE GATES PASS"
echo "========================================="
