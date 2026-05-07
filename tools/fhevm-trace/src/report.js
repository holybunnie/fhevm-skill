// report.js — Markdown report writer

const { buildMermaidGraph } = require("./graph");

function buildTraceJson(scannedFiles, contracts, findings) {
  return {
    version: "1.0",
    scanned_files: scannedFiles,
    contracts: contracts.map(c => ({
      name: c.name,
      file: c.file,
      acl_grants: c.aclGrants.map(g => ({
        function: g.function,
        line: g.line,
        type: g.type,
        handle: g.handle,
        grantee: g.grantee,
      })),
      external_returns: c.externalReturns || [],
      suspected_silent_failure_consumers: c.suspectedSilentFailureConsumers || [],
      suspected_replay_callbacks: c.suspectedReplayCallbacks || [],
      suspected_premature_disclosures: c.suspectedPrematureDisclosures || [],
    })),
    findings: findings.map(f => ({
      id: f.id,
      rule: f.rule,
      severity: f.severity,
      file: f.file,
      line: f.line,
      function: f.function,
      message: f.message,
      snippet: f.snippet,
      suggested_attack: f.suggested_attack || null,
    })),
  };
}

function buildTraceMd(contracts, findings, lines) {
  const sections = [];

  sections.push("# FHEVM Trace Report\n");
  sections.push(`Scanned ${contracts.length} contract(s). Found ${findings.length} finding(s).\n`);

  for (const contract of contracts) {
    sections.push(`## ${contract.name}\n`);
    sections.push(`File: \`${contract.file}\`\n`);
    sections.push(`ACL grants: ${contract.aclGrants.length}\n`);

    // Mermaid graph
    const graph = buildMermaidGraph(contract);
    sections.push("### ACL Flow Graph\n");
    sections.push("```mermaid");
    sections.push(graph);
    sections.push("```\n");

    // Contract-specific findings
    const contractFindings = findings.filter(f => f.file === contract.file);
    if (contractFindings.length > 0) {
      sections.push("### Findings\n");
      for (const f of contractFindings) {
        sections.push(`#### ${f.id} — ${f.rule}\n`);
        sections.push(`- **Severity**: ${f.severity}`);
        sections.push(`- **Function**: \`${f.function}\``);
        sections.push(`- **Line**: ${f.line}`);
        sections.push(`- **Message**: ${f.message}`);
        if (f.snippet) {
          sections.push(`- **Code**: \`${f.snippet}\``);
        }
        if (f.suggested_attack) {
          sections.push(`- **Suggested attack**: ${f.suggested_attack}`);
        }
        sections.push("");
      }
    } else {
      sections.push("No findings for this contract.\n");
    }
  }

  if (findings.length === 0) {
    sections.push("## Summary\n");
    sections.push("No anti-pattern violations detected.\n");
  }

  return sections.join("\n");
}

module.exports = { buildTraceJson, buildTraceMd };
