// instantiate.js — Template substitution: reads .tmpl, replaces placeholders, writes .test.ts

const fs = require("fs");
const path = require("path");

function instantiateAttack(attack, outputDir) {
  const template = fs.readFileSync(attack.templateFile, "utf8");

  // Substitute placeholders
  let output = template;
  output = output.replace(/\{\{FINDING_ID\}\}/g, attack.findingId);
  output = output.replace(/\{\{RULE\}\}/g, attack.rule);
  output = output.replace(/\{\{CONTRACT_FILE\}\}/g, attack.contractFile || "");
  output = output.replace(/\{\{CONTRACT_FUNCTION\}\}/g, attack.contractFunction || "");
  output = output.replace(/\{\{LINE\}\}/g, String(attack.line || 0));
  output = output.replace(/\{\{MESSAGE\}\}/g, attack.message || "");
  output = output.replace(/\{\{SNIPPET\}\}/g, (attack.snippet || "").replace(/"/g, '\\"'));
  output = output.replace(/\{\{ATTACK_KEY\}\}/g, attack.attackKey);
  output = output.replace(/\{\{CONTRACT_NAME\}\}/g, attack.contractName || "");

  const filename = `${attack.findingId}-${attack.rule}.test.ts`;
  const outputPath = path.join(outputDir, filename);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, output);

  return { filename, outputPath };
}

module.exports = { instantiateAttack };
