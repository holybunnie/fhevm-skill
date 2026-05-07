// Unit tests for fhevm-attack tool
// Tests template selection, instantiation, and report generation
// Does NOT run hardhat tests (that requires the full lending app)

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { selectAttacks } = require("../src/selector");
const { instantiateAttack } = require("../src/instantiate");
const { buildReport } = require("../src/runner");

const toolDir = path.resolve(__dirname, "..");
const templatesDir = path.join(toolDir, "templates");
const tmpDir = path.join(toolDir, "test", "_tmp");

// Setup: create temp dir and a mock trace.json
function setup() {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "fhevm-trace-output"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "test", "attacks"), { recursive: true });
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

setup();

// Test 1: selectAttacks reads trace.json and matches templates
console.log("Test 1: selectAttacks matches findings to templates");
{
  const trace = {
    version: "1.0",
    scanned_files: ["test.sol"],
    contracts: [],
    findings: [
      { id: "F-001", rule: "AP-006", severity: "error", file: "test.sol", line: 10,
        function: "deposit", message: "Persistent allowance", snippet: "FHE.allow(...)",
        suggested_attack: "acl-leak-via-proxy" },
      { id: "F-002", rule: "AP-009", severity: "error", file: "test.sol", line: 20,
        function: "bid", message: "Silent failure", snippet: "token.transfer(...)",
        suggested_attack: "silent-failure-bid" },
      { id: "F-003", rule: "AP-010", severity: "error", file: "test.sol", line: 30,
        function: "onCallback", message: "Replay", snippet: "...",
        suggested_attack: "callback-replay" },
      { id: "F-004", rule: "AP-011", severity: "error", file: "test.sol", line: 40,
        function: "finalize", message: "Premature disclosure", snippet: "...",
        suggested_attack: "reorg-disclosure" },
    ],
  };
  fs.writeFileSync(
    path.join(tmpDir, "fhevm-trace-output", "trace.json"),
    JSON.stringify(trace, null, 2)
  );

  const attacks = selectAttacks(
    path.join(tmpDir, "fhevm-trace-output", "trace.json"),
    templatesDir
  );
  assert.strictEqual(attacks.length, 4, "Should select 4 attacks");
  assert.strictEqual(attacks[0].attackKey, "acl-leak-via-proxy");
  assert.strictEqual(attacks[1].attackKey, "silent-failure-bid");
  assert.strictEqual(attacks[2].attackKey, "callback-replay");
  assert.strictEqual(attacks[3].attackKey, "reorg-disclosure");
  console.log("  PASS");
}

// Test 2: instantiateAttack substitutes placeholders
console.log("Test 2: instantiateAttack writes .test.ts with substitutions");
{
  const attack = {
    findingId: "F-001",
    rule: "AP-006",
    attackKey: "acl-leak-via-proxy",
    templateFile: path.join(templatesDir, "acl-leak-via-proxy.test.ts.tmpl"),
    contractFile: "contracts/Vault.sol",
    contractFunction: "deposit",
    line: 42,
    message: "Persistent allowance to external",
    snippet: "FHE.allow(x, addr)",
  };

  const outputDir = path.join(tmpDir, "test", "attacks");
  const { filename, outputPath } = instantiateAttack(attack, outputDir);
  assert.strictEqual(filename, "F-001-AP-006.test.ts");
  assert(fs.existsSync(outputPath), "Output file should exist");

  const content = fs.readFileSync(outputPath, "utf8");
  assert(content.includes("F-001"), "Should contain finding ID");
  assert(content.includes("AP-006"), "Should contain rule");
  assert(content.includes("deposit"), "Should contain function name");
  assert(!content.includes("{{"), "Should not contain unsubstituted placeholders");
  console.log("  PASS");
}

// Test 3: All 5 templates exist and are non-empty
console.log("Test 3: All 5 templates exist");
{
  const templates = [
    "silent-failure-bid.test.ts.tmpl",
    "acl-leak-via-proxy.test.ts.tmpl",
    "callback-replay.test.ts.tmpl",
    "reorg-disclosure.test.ts.tmpl",
    "hcu-budget.test.ts.tmpl",
  ];
  for (const t of templates) {
    const p = path.join(templatesDir, t);
    assert(fs.existsSync(p), `Template ${t} should exist`);
    const stat = fs.statSync(p);
    assert(stat.size > 100, `Template ${t} should not be empty`);
  }
  console.log("  PASS");
}

// Test 4: Templates reference v0.9 imports
console.log("Test 4: Templates use correct imports");
{
  const templates = fs.readdirSync(templatesDir).filter(f => f.endsWith(".tmpl"));
  for (const t of templates) {
    const content = fs.readFileSync(path.join(templatesDir, t), "utf8");
    assert(
      content.includes("@fhevm/hardhat-plugin") || content.includes("@fhevm/solidity"),
      `${t} should import v0.9+ packages`
    );
    assert(!content.includes("TFHE"), `${t} should not reference TFHE`);
    assert(!content.includes("SepoliaConfig"), `${t} should not reference SepoliaConfig`);
  }
  console.log("  PASS");
}

// Test 5: buildReport generates correct markdown
console.log("Test 5: buildReport generates markdown with markers");
{
  const results = [
    { findingId: "F-001", rule: "AP-006", attackKey: "acl-leak-via-proxy",
      status: "exploit-succeeded", exploitSucceeded: true, blocked: false,
      detail: "Exploit succeeded", filename: "test.ts" },
    { findingId: "F-002", rule: "AP-009", attackKey: "silent-failure-bid",
      status: "blocked", exploitSucceeded: false, blocked: true,
      detail: "Blocked", filename: "test2.ts" },
  ];
  const report = buildReport(results, "/tmp/test-project");
  assert(report.includes("Summary"), "Report should have Summary");
  assert(report.includes("❌ Exploit succeeded"), "Report should have exploit marker");
  assert(report.includes("✅ Attack blocked"), "Report should have blocked marker");
  assert(report.includes("2 attacks scaffolded"), "Should count scaffolded");
  assert(report.includes("1 exploits successful"), "Should count exploits");
  assert(report.includes("1 attacks blocked"), "Should count blocked");
  console.log("  PASS");
}

// Test 6: No attacks for empty trace
console.log("Test 6: Empty trace produces 0 attacks");
{
  const trace = { version: "1.0", scanned_files: [], contracts: [], findings: [] };
  fs.writeFileSync(
    path.join(tmpDir, "fhevm-trace-output", "trace.json"),
    JSON.stringify(trace)
  );
  const attacks = selectAttacks(
    path.join(tmpDir, "fhevm-trace-output", "trace.json"),
    templatesDir
  );
  assert.strictEqual(attacks.length, 0);
  console.log("  PASS");
}

cleanup();
console.log("\nAll tests passed.");
