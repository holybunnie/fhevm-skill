// selector.js — Reads trace.json, picks attack templates for each finding

const fs = require("fs");
const path = require("path");

const TEMPLATE_MAP = {
  "silent-failure-bid": "silent-failure-bid.test.ts.tmpl",
  "acl-leak-via-proxy": "acl-leak-via-proxy.test.ts.tmpl",
  "callback-replay": "callback-replay.test.ts.tmpl",
  "reorg-disclosure": "reorg-disclosure.test.ts.tmpl",
  "hcu-budget": "hcu-budget.test.ts.tmpl",
};

function selectAttacks(traceJsonPath, templatesDir) {
  if (!fs.existsSync(traceJsonPath)) {
    console.error(`trace.json not found at ${traceJsonPath}`);
    return [];
  }

  const trace = JSON.parse(fs.readFileSync(traceJsonPath, "utf8"));
  const attacks = [];

  // Build file→contract name map
  const fileToContract = {};
  for (const c of (trace.contracts || [])) {
    if (c.file && c.name) fileToContract[c.file] = c.name;
  }

  for (const finding of trace.findings) {
    const attackKey = finding.suggested_attack;
    if (!attackKey || !TEMPLATE_MAP[attackKey]) continue;

    const templateFile = path.join(templatesDir, TEMPLATE_MAP[attackKey]);
    if (!fs.existsSync(templateFile)) {
      console.warn(`Template not found: ${templateFile} (for ${attackKey})`);
      continue;
    }

    attacks.push({
      findingId: finding.id,
      rule: finding.rule,
      attackKey,
      templateFile,
      contractFile: finding.file,
      contractName: fileToContract[finding.file] || "",
      contractFunction: finding.function,
      line: finding.line,
      message: finding.message,
      snippet: finding.snippet,
    });
  }

  return attacks;
}

module.exports = { selectAttacks };
