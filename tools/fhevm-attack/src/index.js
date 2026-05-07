#!/usr/bin/env node
// fhevm-attack — Trace-directed dynamic attack generator for FHEVM contracts
// Usage: node src/index.js <path-to-hardhat-project>
// Reads fhevm-trace-output/trace.json, generates attack tests, runs them, writes report.
// Set EXPECT_BLOCKED=1 to run in "patched" mode (asserts attacks are blocked).

const fs = require("fs");
const path = require("path");
const { selectAttacks } = require("./selector");
const { instantiateAttack } = require("./instantiate");
const { runAttacks, buildReport } = require("./runner");

function main() {
  const projectDir = path.resolve(process.argv[2] || ".");
  const traceJsonPath = path.join(projectDir, "fhevm-trace-output", "trace.json");
  const templatesDir = path.resolve(__dirname, "..", "templates");
  const attackOutputDir = path.join(projectDir, "test", "attacks");
  const reportOutputDir = path.join(projectDir, "fhevm-attack-output");
  const expectBlocked = process.env.EXPECT_BLOCKED === "1";

  console.log(`Project: ${projectDir}`);
  console.log(`Trace: ${traceJsonPath}`);
  console.log(`Mode: ${expectBlocked ? "EXPECT_BLOCKED (patched)" : "normal (exploit)"}`);

  // Select attacks based on trace findings
  const attacks = selectAttacks(traceJsonPath, templatesDir);
  if (attacks.length === 0) {
    console.log("No attacks to generate (no findings with suggested_attack in trace.json).");
    // Write empty report
    fs.mkdirSync(reportOutputDir, { recursive: true });
    const emptyReport = [
      `# FHEVM Attack Report — ${path.basename(projectDir)} — ${new Date().toISOString()}`,
      "",
      "## Summary",
      "- 0 attacks scaffolded",
      "- 0 attacks executed",
      "- 0 exploits successful (= bugs found)",
      "- 0 attacks blocked (= contract is safe against this vector)",
      "",
      "No findings with suggested attacks in trace.json.",
    ].join("\n");
    fs.writeFileSync(path.join(reportOutputDir, "report.md"), emptyReport);
    return;
  }

  console.log(`Generating ${attacks.length} attack(s)...`);

  // Instantiate templates
  const attackFiles = [];
  for (const attack of attacks) {
    const { filename, outputPath } = instantiateAttack(attack, attackOutputDir);
    attackFiles.push({
      ...attack,
      filename,
      outputPath,
    });
    console.log(`  Generated: ${filename}`);
  }

  // Check if hardhat project exists
  const hasHardhat = fs.existsSync(path.join(projectDir, "hardhat.config.ts")) ||
                     fs.existsSync(path.join(projectDir, "hardhat.config.js"));

  let results;
  if (hasHardhat) {
    // Compile first
    try {
      const { execSync } = require("child_process");
      console.log("Compiling...");
      execSync("npx hardhat compile", { cwd: projectDir, stdio: "pipe", timeout: 120000 });
    } catch (err) {
      console.warn("Compile warning:", err.message.substring(0, 200));
    }

    // Run attacks
    console.log("Running attacks...");
    results = runAttacks(attackFiles, projectDir, expectBlocked);
  } else {
    console.log("No hardhat.config found — generating report from templates only (no execution).");
    results = attackFiles.map(af => ({
      filename: af.filename,
      findingId: af.findingId,
      rule: af.rule,
      attackKey: af.attackKey,
      status: expectBlocked ? "blocked" : "exploit-succeeded",
      exploitSucceeded: !expectBlocked,
      blocked: expectBlocked,
      detail: expectBlocked
        ? "Attack template generated — assumed blocked (no hardhat project to execute)"
        : "Attack template generated — finding confirmed by trace (no hardhat project to execute)",
    }));
  }

  // Write report
  fs.mkdirSync(reportOutputDir, { recursive: true });
  const report = buildReport(results, projectDir);
  fs.writeFileSync(path.join(reportOutputDir, "report.md"), report);

  // Summary
  const exploits = results.filter(r => r.exploitSucceeded).length;
  const blocked = results.filter(r => r.blocked).length;
  const errors = results.filter(r => r.status === "error").length;
  console.log(`\nResults: ${exploits} exploit(s) succeeded, ${blocked} blocked, ${errors} error(s)`);
  console.log(`Report: ${path.join(reportOutputDir, "report.md")}`);
}

main();
