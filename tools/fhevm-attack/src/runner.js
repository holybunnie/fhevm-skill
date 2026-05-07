// runner.js — Executes hardhat tests for generated attacks, parses results

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function runAttacks(attackFiles, projectDir, expectBlocked) {
  const results = [];

  for (const af of attackFiles) {
    const result = runSingleAttack(af, projectDir, expectBlocked);
    results.push(result);
  }

  return results;
}

function runSingleAttack(attackFile, projectDir, expectBlocked) {
  const testPath = attackFile.outputPath;
  const relPath = path.relative(projectDir, testPath);

  try {
    const env = { ...process.env };
    if (expectBlocked) {
      env.EXPECT_BLOCKED = "1";
    }

    const stdout = execSync(`npx hardhat test "${testPath}" --no-compile`, {
      cwd: projectDir,
      env,
      stdio: "pipe",
      timeout: 120000,
    }).toString();

    const passing = /(\d+) passing/.exec(stdout);
    const failing = /(\d+) failing/.exec(stdout);
    const passCount = passing ? parseInt(passing[1]) : 0;
    const failCount = failing ? parseInt(failing[1]) : 0;

    if (failCount > 0) {
      return {
        filename: attackFile.filename,
        findingId: attackFile.findingId,
        rule: attackFile.rule,
        attackKey: attackFile.attackKey,
        status: "test-failed",
        exploitSucceeded: false,
        blocked: false,
        detail: `${failCount} test(s) failed, ${passCount} passed`,
        stdout: stdout.substring(0, 2000),
      };
    }

    // All tests passed
    if (expectBlocked) {
      return {
        filename: attackFile.filename,
        findingId: attackFile.findingId,
        rule: attackFile.rule,
        attackKey: attackFile.attackKey,
        status: "blocked",
        exploitSucceeded: false,
        blocked: true,
        detail: "Attack was blocked (contract is safe against this vector)",
        stdout: stdout.substring(0, 2000),
      };
    } else {
      return {
        filename: attackFile.filename,
        findingId: attackFile.findingId,
        rule: attackFile.rule,
        attackKey: attackFile.attackKey,
        status: "exploit-succeeded",
        exploitSucceeded: true,
        blocked: false,
        detail: "Exploit succeeded — contract is vulnerable",
        stdout: stdout.substring(0, 2000),
      };
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().substring(0, 2000) : "";
    const stdout = err.stdout ? err.stdout.toString().substring(0, 2000) : "";

    // Check if there are test failures in stdout (hardhat exits non-zero on test failure)
    const failing = /(\d+) failing/.exec(stdout);
    const passing = /(\d+) passing/.exec(stdout);

    if (failing) {
      if (expectBlocked) {
        // In EXPECT_BLOCKED mode, test failures mean the exploit was NOT blocked
        return {
          filename: attackFile.filename,
          findingId: attackFile.findingId,
          rule: attackFile.rule,
          attackKey: attackFile.attackKey,
          status: "exploit-succeeded",
          exploitSucceeded: true,
          blocked: false,
          detail: "Exploit succeeded (tests failed in EXPECT_BLOCKED mode)",
          stdout,
        };
      } else {
        // In normal mode, test failures mean the exploit assertion failed
        // This could mean the contract is already patched
        return {
          filename: attackFile.filename,
          findingId: attackFile.findingId,
          rule: attackFile.rule,
          attackKey: attackFile.attackKey,
          status: "blocked",
          exploitSucceeded: false,
          blocked: true,
          detail: "Attack was blocked (exploit assertion failed)",
          stdout,
        };
      }
    }

    return {
      filename: attackFile.filename,
      findingId: attackFile.findingId,
      rule: attackFile.rule,
      attackKey: attackFile.attackKey,
      status: "error",
      exploitSucceeded: false,
      blocked: false,
      detail: `Execution error: ${err.message}`,
      stdout,
      stderr,
    };
  }
}

function buildReport(results, projectDir) {
  const timestamp = new Date().toISOString();
  const lines = [];

  const scaffolded = results.length;
  const executed = results.filter(r => r.status !== "error").length;
  const exploits = results.filter(r => r.exploitSucceeded).length;
  const blocked = results.filter(r => r.blocked).length;

  lines.push(`# FHEVM Attack Report — ${path.basename(projectDir)} — ${timestamp}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- ${scaffolded} attacks scaffolded`);
  lines.push(`- ${executed} attacks executed`);
  lines.push(`- ${exploits} exploits successful (= bugs found)`);
  lines.push(`- ${blocked} attacks blocked (= contract is safe against this vector)`);
  lines.push("");
  lines.push("## Detailed findings");
  lines.push("");

  for (const r of results) {
    lines.push(`### ${r.findingId} / ${r.rule} / ${r.attackKey}`);
    lines.push(`- Template: ${r.attackKey}`);
    if (r.exploitSucceeded) {
      lines.push(`- Result: ❌ Exploit succeeded`);
    } else if (r.blocked) {
      lines.push(`- Result: ✅ Attack blocked`);
    } else {
      lines.push(`- Result: ❌ Error (${r.status})`);
    }
    lines.push(`- Detail: ${r.detail}`);
    lines.push(`- Fix: see references/anti-patterns.md#${r.rule.toLowerCase()}`);
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = { runAttacks, buildReport };
