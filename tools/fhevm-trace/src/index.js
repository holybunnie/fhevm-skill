#!/usr/bin/env node
// fhevm-trace — Static ACL flow analyzer for FHEVM smart contracts
// Usage: node src/index.js <path-to-sol-file-or-directory>

const fs = require("fs");
const path = require("path");
const { parseFile, extractImports } = require("./parser");
const { runAllRules, detectCrossContractLeak } = require("./rules");
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
  // Map contract name -> contract analysis (for cross-contract lookup)
  const contractMap = new Map();

  for (const filePath of solFiles) {
    scannedFiles.push(filePath);
    const result = parseFile(filePath);

    if (result.error) {
      console.warn(`Warning: parse error in ${filePath}: ${result.error}`);
      console.warn("Falling back to regex-only analysis.");
      const source = fs.readFileSync(filePath, "utf8");
      const lines = source.split("\n");
      const { runAllRules: runRules } = require("./rules");
      const findings = runRules([], source, lines, filePath);
      allFindings.push(...findings);
      continue;
    }

    const { contracts, source, lines } = result;
    allContracts.push(...contracts);
    for (const c of contracts) {
      contractMap.set(c.name, c);
    }

    const findings = runAllRules(contracts, source, lines, filePath);
    allFindings.push(...findings);
  }

  // Cross-contract analysis (one level deep)
  if (solFiles.length > 1) {
    // Build import graph: for each file, resolve which contracts are imported
    const importGraph = buildImportGraph(solFiles, resolvedTarget);
    const crossFindings = detectCrossContractLeak(allContracts, contractMap, importGraph);
    allFindings.push(...crossFindings);
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

function buildImportGraph(solFiles, baseDir) {
  // Maps contractName -> [imported contract names]
  const graph = new Map();
  const stat = fs.statSync(baseDir);
  const dir = stat.isDirectory() ? baseDir : path.dirname(baseDir);

  for (const filePath of solFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const imports = extractImports(source);
    // Extract contract names from each file
    const contractNames = extractContractNames(source);
    // Resolve local imports to contract names
    const importedContracts = [];
    for (const imp of imports) {
      // Only follow local/relative imports
      if (imp.startsWith("./") || imp.startsWith("../")) {
        const resolved = path.resolve(path.dirname(filePath), imp);
        if (fs.existsSync(resolved)) {
          const importedSource = fs.readFileSync(resolved, "utf8");
          importedContracts.push(...extractContractNames(importedSource));
        }
      }
    }
    for (const name of contractNames) {
      graph.set(name, importedContracts);
    }
  }
  return graph;
}

function extractContractNames(source) {
  const names = [];
  const regex = /contract\s+(\w+)/g;
  let m;
  while ((m = regex.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
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
