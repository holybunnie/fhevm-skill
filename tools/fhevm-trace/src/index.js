#!/usr/bin/env node
// fhevm-trace — Static ACL flow analyzer for FHEVM smart contracts
// Usage: node src/index.js <path-to-sol-file-or-directory>

const fs = require("fs");
const path = require("path");
const { parseFile } = require("./parser");
const { runAllRules } = require("./rules");
const { buildTraceJson, buildTraceMd } = require("./report");

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node src/index.js <path-to-sol-file-or-directory>");
    process.exit(1);
  }

  const resolvedTarget = path.resolve(target);
  const solFiles = collectSolFiles(resolvedTarget);

  if (solFiles.length === 0) {
    console.error(`No .sol files found at ${resolvedTarget}`);
    process.exit(1);
  }

  const allContracts = [];
  const allFindings = [];
  const scannedFiles = [];

  for (const filePath of solFiles) {
    scannedFiles.push(filePath);
    const result = parseFile(filePath);

    if (result.error) {
      console.warn(`Warning: parse error in ${filePath}: ${result.error}`);
      console.warn("Falling back to regex-only analysis.");
      // Regex fallback
      const source = fs.readFileSync(filePath, "utf8");
      const lines = source.split("\n");
      const { runAllRules: runRules } = require("./rules");
      const findings = runRules([], source, lines, filePath);
      allFindings.push(...findings);
      continue;
    }

    const { contracts, source, lines } = result;
    allContracts.push(...contracts);

    const findings = runAllRules(contracts, source, lines, filePath);
    allFindings.push(...findings);
  }

  // Re-number all findings globally
  for (let i = 0; i < allFindings.length; i++) {
    allFindings[i].id = `F-${String(i + 1).padStart(3, "0")}`;
  }

  // Write output
  const outputDir = path.resolve("fhevm-trace-output");
  fs.mkdirSync(outputDir, { recursive: true });

  const traceJson = buildTraceJson(scannedFiles, allContracts, allFindings);
  fs.writeFileSync(path.join(outputDir, "trace.json"), JSON.stringify(traceJson, null, 2));

  const traceMd = buildTraceMd(allContracts, allFindings);
  fs.writeFileSync(path.join(outputDir, "trace.md"), traceMd);

  console.log(`Scanned ${solFiles.length} file(s), ${allContracts.length} contract(s).`);
  console.log(`Found ${allFindings.length} finding(s).`);
  console.log(`Output: ${outputDir}/trace.json, ${outputDir}/trace.md`);
}

function collectSolFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile() && target.endsWith(".sol")) {
    return [target];
  }
  if (stat.isDirectory()) {
    const files = [];
    for (const entry of fs.readdirSync(target, { recursive: true })) {
      const full = path.join(target, entry);
      if (full.endsWith(".sol") && fs.statSync(full).isFile()) {
        files.push(full);
      }
    }
    return files;
  }
  return [];
}

main();
