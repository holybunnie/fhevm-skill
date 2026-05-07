// graph.js — Mermaid graph emitter for ACL flow visualization

function buildMermaidGraph(contract) {
  const lines = ["graph LR"];
  const nodeIds = new Map();
  let nodeCounter = 0;

  function getNodeId(label) {
    if (!nodeIds.has(label)) {
      nodeIds.set(label, `N${nodeCounter++}`);
    }
    return nodeIds.get(label);
  }

  if (contract.aclGrants.length === 0) {
    lines.push(`  ${getNodeId(contract.name)}["${contract.name}"]`);
    lines.push(`  ${getNodeId("no-grants")}["No ACL grants found"]`);
    lines.push(`  ${getNodeId(contract.name)} --> ${getNodeId("no-grants")}`);
    return lines.join("\n");
  }

  // Contract node
  const contractId = getNodeId(contract.name);
  lines.push(`  ${contractId}["${contract.name}"]`);

  for (const grant of contract.aclGrants) {
    const handleId = getNodeId(`handle:${grant.handle}:${grant.function}`);
    const granteeId = getNodeId(`grantee:${grant.grantee}`);

    // Handle node
    lines.push(`  ${handleId}["${grant.handle}<br/>${grant.function}:L${grant.line}"]`);

    // Grantee node
    lines.push(`  ${granteeId}["${grant.grantee}"]`);

    // Edge with style based on grant type
    const style = grantTypeStyle(grant.type);
    lines.push(`  ${handleId} -->|"${grant.type}"| ${granteeId}`);
    lines.push(`  ${contractId} --> ${handleId}`);

    // Color coding
    if (grant.type === "persistent" && grant.method === "allow") {
      lines.push(`  style ${granteeId} fill:#f96,stroke:#333`);
    } else if (grant.type === "transient") {
      lines.push(`  style ${granteeId} fill:#6f9,stroke:#333`);
    } else if (grant.type === "public") {
      lines.push(`  style ${granteeId} fill:#f66,stroke:#333`);
    } else if (grant.type === "persistent-self") {
      lines.push(`  style ${granteeId} fill:#69f,stroke:#333`);
    }
  }

  return lines.join("\n");
}

function grantTypeStyle(type) {
  switch (type) {
    case "persistent": return "persistent (orange)";
    case "persistent-self": return "self (blue)";
    case "transient": return "transient (green)";
    case "public": return "public (red)";
    default: return type;
  }
}

module.exports = { buildMermaidGraph };
