const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const toolDir = path.resolve(__dirname, "..");
const indexJs = path.join(toolDir, "src", "index.js");
const fixtureDir = path.join(toolDir, "test", "fixtures");
const outputDir = path.join(toolDir, "fhevm-trace-output");

function run(fixture) {
  const fixturePath = path.join(fixtureDir, fixture);
  execSync(`node ${indexJs} ${fixturePath}`, { cwd: toolDir, stdio: "pipe" });
  const trace = JSON.parse(fs.readFileSync(path.join(outputDir, "trace.json"), "utf8"));
  const md = fs.readFileSync(path.join(outputDir, "trace.md"), "utf8");
  return { trace, md };
}

// Clean fixture: 0 findings
console.log("Test: clean fixture produces 0 findings");
{
  const { trace } = run("clean.sol");
  assert.strictEqual(trace.findings.length, 0, "Expected 0 findings for clean fixture");
  console.log("  PASS");
}

// Dirty ACL leak: AP-006
console.log("Test: dirty-acl-leak flags AP-006");
{
  const { trace } = run("dirty-acl-leak.sol");
  assert(trace.findings.length >= 1, "Expected at least 1 finding");
  assert.strictEqual(trace.findings[0].rule, "AP-006");
  assert(trace.findings[0].suggested_attack === "acl-leak-via-proxy");
  console.log("  PASS");
}

// Dirty replay: AP-010
console.log("Test: dirty-replay flags AP-010");
{
  const { trace } = run("dirty-replay.sol");
  assert(trace.findings.length >= 1, "Expected at least 1 finding");
  assert.strictEqual(trace.findings[0].rule, "AP-010");
  assert(trace.findings[0].suggested_attack === "callback-replay");
  console.log("  PASS");
}

// Dirty disclosure: AP-011
console.log("Test: dirty-disclosure flags AP-011");
{
  const { trace } = run("dirty-disclosure.sol");
  assert(trace.findings.length >= 1, "Expected at least 1 finding");
  assert.strictEqual(trace.findings[0].rule, "AP-011");
  assert(trace.findings[0].suggested_attack === "reorg-disclosure");
  console.log("  PASS");
}

// Dirty silent failure: AP-009
console.log("Test: dirty-silent-failure flags AP-009");
{
  const { trace } = run("dirty-silent-failure.sol");
  assert(trace.findings.length >= 1, "Expected at least 1 finding");
  assert.strictEqual(trace.findings[0].rule, "AP-009");
  assert(trace.findings[0].suggested_attack === "silent-failure-bid");
  console.log("  PASS");
}

// Mermaid graph in trace.md
console.log("Test: trace.md contains Mermaid graph");
{
  const { md } = run("dirty-acl-leak.sol");
  assert(md.includes("graph LR") || md.includes("graph TD"), "Expected Mermaid graph");
  console.log("  PASS");
}

// trace.json is valid JSON (already parsed above, but verify structure)
console.log("Test: trace.json structure");
{
  const { trace } = run("clean.sol");
  assert(trace.version === "1.0");
  assert(Array.isArray(trace.scanned_files));
  assert(Array.isArray(trace.contracts));
  assert(Array.isArray(trace.findings));
  console.log("  PASS");
}

// Cross-contract leak: AP-006-EXT
console.log("Test: dirty-cross-contract-leak flags AP-006-EXT");
{
  const { trace } = run("dirty-cross-contract-leak");
  assert(trace.findings.length >= 1, "Expected at least 1 finding");
  const extFindings = trace.findings.filter(f => f.rule === "AP-006-EXT");
  assert(extFindings.length >= 1, "Expected AP-006-EXT finding");
  assert(extFindings[0].message.includes("Cross-contract"), "Expected cross-contract message");
  console.log("  PASS");
}

console.log("\nAll tests passed.");
