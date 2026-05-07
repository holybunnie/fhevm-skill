// rules.js — Anti-pattern rule detectors
// Each rule function takes a contract analysis object and returns findings.

const fs = require("fs");

let findingCounter = 0;
function nextId() {
  findingCounter++;
  return `F-${String(findingCounter).padStart(3, "0")}`;
}

function resetCounter() {
  findingCounter = 0;
}

// AP-006: Persistent allowance to external address (not msg.sender or address(this))
function detectACLLeak(contract, lines) {
  const findings = [];
  for (const grant of contract.aclGrants) {
    if (grant.type === "persistent" && grant.method === "allow") {
      const grantee = grant.grantee;
      // If grantee is not msg.sender and not address(this), flag it
      if (grantee !== "msg.sender" && grantee !== "address(this)" && !grantee.includes("msg.sender")) {
        findings.push({
          id: nextId(),
          rule: "AP-006",
          severity: "error",
          file: contract.file,
          line: grant.line,
          function: grant.function,
          message: `Persistent allowance to external address '${grantee}'; consider allowTransient`,
          snippet: grant.snippet || getSnippet(lines, grant.line),
          suggested_attack: "acl-leak-via-proxy",
        });
      }
    }
  }
  return findings;
}

// AP-010: Callback without delete before external call
function detectReplayCallback(contract, lines) {
  const findings = [];
  for (const func of contract.functions) {
    const name = func.name.toLowerCase();
    const isCallback = name.includes("callback") || name.includes("ondecrypted") ||
                       name.includes("onresult") || name.includes("ondecrypt");
    if (!isCallback) continue;

    // Ordering check is complex in AST; skip here — regex fallback handles AP-010
    if (false) {
      const line = findFunctionLine(contract, func.name, lines);
      findings.push({
        id: nextId(),
        rule: "AP-010",
        severity: "error",
        file: contract.file,
        line,
        function: func.name,
        message: "Callback function has external call without preceding delete of pending mapping (replay risk)",
        snippet: getSnippet(lines, line),
        suggested_attack: "callback-replay",
      });
    }
  }
  return findings;
}

// AP-011: makePubliclyDecryptable in same function as timestamp/block check
function detectPrematureDisclosure(contract, lines) {
  const findings = [];
  for (const func of contract.functions) {
    if (func.hasMakePubliclyDecryptable && (func.hasTimestampCheck || func.hasBlockNumberCheck)) {
      // Find the line of makePubliclyDecryptable
      const grant = func.aclGrants.find(g => g.method === "makePubliclyDecryptable");
      const line = grant ? grant.line : findFunctionLine(contract, func.name, lines);
      findings.push({
        id: nextId(),
        rule: "AP-011",
        severity: "error",
        file: contract.file,
        line,
        function: func.name,
        message: "makePubliclyDecryptable in same function as block.timestamp/block.number check; use finality delay",
        snippet: grant ? grant.snippet : getSnippet(lines, line),
        suggested_attack: "reorg-disclosure",
      });
    }
  }
  return findings;
}

// AP-009: External call return value ignored, original argument used in FHE comparison
function detectSilentFailure(contract, lines) {
  const findings = [];
  for (const func of contract.functions) {
    if (func.comparisonVarsFromExternal.length > 0) {
      for (const comp of func.comparisonVarsFromExternal) {
        findings.push({
          id: nextId(),
          rule: "AP-009",
          severity: "error",
          file: contract.file,
          line: comp.line,
          function: func.name,
          message: `Variable '${comp.comparedVar}' from external call used in FHE comparison; use returned transfer amount`,
          snippet: comp.snippet || getSnippet(lines, comp.line),
          suggested_attack: "silent-failure-bid",
        });
      }
    }
  }
  return findings;
}

// Regex-based fallback detectors for broader coverage

// AP-006 regex: FHE.allow(x, address(something)) where something isn't this
function detectACLLeakRegex(source, filePath, lines) {
  const findings = [];
  const regex = /FHE\.allow\s*\(\s*\w+\s*,\s*address\s*\(\s*(\w+)\s*\)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const target = match[1];
    if (target !== "this") {
      const line = getLineNumber(source, match.index);
      findings.push({
        id: nextId(),
        rule: "AP-006",
        severity: "error",
        file: filePath,
        line,
        function: "unknown",
        message: `Persistent allowance to address(${target}); consider allowTransient`,
        snippet: lines[line - 1] ? lines[line - 1].trim() : "",
        suggested_attack: "acl-leak-via-proxy",
      });
    }
  }
  return findings;
}

// AP-010 regex: function with "callback"/"Callback" that has .transfer/.call/.send but no "delete"
function detectReplayCallbackRegex(source, filePath, lines) {
  const findings = [];
  // Find callback functions
  const funcRegex = /function\s+(\w*[Cc]allback\w*|\w*[Oo]n[Dd]ecrypt\w*)\s*\([^)]*\)[^{]*\{/g;
  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    const funcName = match[1];
    const startIdx = match.index;
    const bodyStart = source.indexOf("{", startIdx);
    if (bodyStart === -1) continue;

    // Find matching closing brace (simple depth counter)
    let depth = 1;
    let i = bodyStart + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      i++;
    }
    const body = source.substring(bodyStart, i);

    // Strip single-line comments to avoid false matches on "delete" in comments
    const bodyClean = body.replace(/\/\/.*$/gm, "");
    const extCallMatch = bodyClean.match(/\.(transfer|call|send)\s*[\({]/);
    const deleteMatch = bodyClean.match(/\bdelete\s+\w/);

    // Flag if: external call exists AND (no delete at all, OR delete comes AFTER external call)
    const hasExtCall = !!extCallMatch;
    const deleteBeforeCall = deleteMatch && extCallMatch && deleteMatch.index < extCallMatch.index;

    if (hasExtCall && !deleteBeforeCall) {
      const line = getLineNumber(source, startIdx);
      findings.push({
        id: nextId(),
        rule: "AP-010",
        severity: "error",
        file: filePath,
        line,
        function: funcName,
        message: "Callback function has external call without preceding delete (replay risk)",
        snippet: lines[line - 1] ? lines[line - 1].trim() : "",
        suggested_attack: "callback-replay",
      });
    }
  }
  return findings;
}

// AP-011 regex: makePubliclyDecryptable in same function as block.timestamp
function detectPrematureDisclosureRegex(source, filePath, lines) {
  const findings = [];
  // Find functions containing makePubliclyDecryptable
  const funcRegex = /function\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    const funcName = match[1];
    const startIdx = match.index;
    const bodyStart = source.indexOf("{", startIdx);
    if (bodyStart === -1) continue;

    let depth = 1;
    let i = bodyStart + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      i++;
    }
    const body = source.substring(bodyStart, i);

    if (body.includes("makePubliclyDecryptable") &&
        (body.includes("block.timestamp") || body.includes("block.number"))) {
      const discloseLine = getLineNumber(source, source.indexOf("makePubliclyDecryptable", bodyStart));
      findings.push({
        id: nextId(),
        rule: "AP-011",
        severity: "error",
        file: filePath,
        line: discloseLine,
        function: funcName,
        message: "makePubliclyDecryptable in same function as block.timestamp/block.number check",
        snippet: lines[discloseLine - 1] ? lines[discloseLine - 1].trim() : "",
        suggested_attack: "reorg-disclosure",
      });
    }
  }
  return findings;
}

// AP-009 regex: external.transfer/call that ignores return + uses original var in FHE comparison
function detectSilentFailureRegex(source, filePath, lines) {
  const findings = [];
  // Look for pattern: someContract.someMethod(someArg) without capturing return
  // followed by FHE.gt/lt/ge/le/eq/ne with the original arg
  const callRegex = /(\w+)\.(transfer|transferFrom)\s*\((?:[^,]+),\s*(\w+)\s*\)/g;
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    const argVar = match[3];
    const callLine = getLineNumber(source, match.index);
    // Check if the line starts with assignment (captured return) or not
    const lineText = lines[callLine - 1] || "";
    const hasAssignment = /^\s*(euint|ebool|eaddress)\w*\s+\w+\s*=/.test(lineText) ||
                          /^\s*\w+\s*=\s*\w+\.transfer/.test(lineText);
    if (!hasAssignment) {
      // Check if argVar appears in a subsequent FHE comparison
      const rest = source.substring(match.index + match[0].length);
      const compRegex = new RegExp(`FHE\\.(gt|lt|ge|le|eq|ne)\\s*\\([^)]*\\b${argVar}\\b`, "m");
      const compMatch = compRegex.exec(rest);
      if (compMatch) {
        const compLine = getLineNumber(source, match.index + match[0].length + compMatch.index);
        findings.push({
          id: nextId(),
          rule: "AP-009",
          severity: "error",
          file: filePath,
          line: compLine,
          function: "unknown",
          message: `External call return ignored; '${argVar}' used in FHE comparison instead of actual transferred amount`,
          snippet: lines[compLine - 1] ? lines[compLine - 1].trim() : "",
          suggested_attack: "silent-failure-bid",
        });
      }
    }
  }
  return findings;
}

function getLineNumber(source, index) {
  return source.substring(0, index).split("\n").length;
}

function getSnippet(lines, lineNum) {
  if (!lines || lineNum < 1) return "";
  return lines[lineNum - 1] ? lines[lineNum - 1].trim() : "";
}

function findFunctionLine(contract, funcName, lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`function ${funcName}`)) return i + 1;
  }
  return 0;
}

// Main entry: run all rules, deduplicate by (rule, line)
function runAllRules(contractAnalysis, source, lines, filePath) {
  resetCounter();
  const allFindings = [];

  for (const contract of contractAnalysis) {
    // AST-based detectors
    allFindings.push(...detectACLLeak(contract, lines));
    allFindings.push(...detectReplayCallback(contract, lines));
    allFindings.push(...detectPrematureDisclosure(contract, lines));
    allFindings.push(...detectSilentFailure(contract, lines));
  }

  // Regex fallback detectors (catch things AST missed)
  allFindings.push(...detectACLLeakRegex(source, filePath, lines));
  allFindings.push(...detectReplayCallbackRegex(source, filePath, lines));
  allFindings.push(...detectPrematureDisclosureRegex(source, filePath, lines));
  allFindings.push(...detectSilentFailureRegex(source, filePath, lines));

  // Deduplicate by (rule, line)
  const seen = new Set();
  const deduped = [];
  for (const f of allFindings) {
    const key = `${f.rule}:${f.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }

  // Re-number
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].id = `F-${String(i + 1).padStart(3, "0")}`;
  }

  return deduped;
}

module.exports = { runAllRules, resetCounter };
