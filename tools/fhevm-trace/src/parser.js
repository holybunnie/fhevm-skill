// parser.js — AST walker for Solidity files using @solidity-parser/parser
// Extracts: ACL grants, external calls returning encrypted values,
// encrypted variable usage in conditions, callback patterns, disclosure patterns.

const parser = require("@solidity-parser/parser");
const fs = require("fs");

const ENCRYPTED_TYPES = new Set([
  "ebool", "euint8", "euint16", "euint32", "euint64", "euint128", "euint256",
  "eaddress", "ebytes64", "ebytes128", "ebytes256",
  "externalEbool", "externalEuint8", "externalEuint16", "externalEuint32",
  "externalEuint64", "externalEuint128", "externalEuint256", "externalEaddress",
]);

const ACL_FUNCTIONS = new Set(["allow", "allowThis", "allowTransient", "makePubliclyDecryptable"]);

function parseFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  let ast;
  try {
    ast = parser.parse(source, { loc: true, range: true, tolerant: true });
  } catch (e) {
    return { error: e.message, contracts: [], source, lines };
  }
  return { ast, contracts: extractContracts(ast, lines, filePath), source, lines };
}

function extractContracts(ast, lines, filePath) {
  const results = [];
  for (const node of ast.children || []) {
    if (node.type === "ContractDefinition") {
      results.push(analyzeContract(node, lines, filePath));
    }
  }
  return results;
}

function analyzeContract(contractNode, lines, filePath) {
  const contract = {
    name: contractNode.name,
    file: filePath,
    stateVars: {},
    functions: [],
    aclGrants: [],
    externalReturns: [],
    suspectedSilentFailureConsumers: [],
    suspectedReplayCallbacks: [],
    suspectedPrematureDisclosures: [],
  };

  // Collect state variable types
  for (const sub of contractNode.subNodes || []) {
    if (sub.type === "StateVariableDeclaration") {
      for (const v of sub.variables || []) {
        if (v.name && v.typeName) {
          const typeName = resolveTypeName(v.typeName);
          contract.stateVars[v.name] = typeName;
        }
      }
    }
  }

  // Analyze functions
  for (const sub of contractNode.subNodes || []) {
    if (sub.type === "FunctionDefinition") {
      const funcInfo = analyzeFunction(sub, lines, contract);
      contract.functions.push(funcInfo);
    }
  }

  return contract;
}

function resolveTypeName(typeNode) {
  if (!typeNode) return "unknown";
  if (typeNode.type === "ElementaryTypeName") return typeNode.name || "unknown";
  if (typeNode.type === "UserDefinedTypeName") return typeNode.namePath || "unknown";
  if (typeNode.type === "Mapping") return "mapping";
  if (typeNode.type === "ArrayTypeName") return "array";
  return "unknown";
}

function analyzeFunction(funcNode, lines, contract) {
  const funcName = funcNode.name || (funcNode.isConstructor ? "constructor" : "fallback");
  const visibility = funcNode.visibility || "public";
  const params = (funcNode.parameters || []).map(p => ({
    name: p.name,
    type: resolveTypeName(p.typeName),
  }));

  const info = {
    name: funcName,
    visibility,
    params,
    hasEncryptedParams: params.some(p => ENCRYPTED_TYPES.has(p.type)),
    aclGrants: [],
    externalCalls: [],
    hasDelete: false,
    hasExternalCall: false,
    hasMakePubliclyDecryptable: false,
    hasTimestampCheck: false,
    hasBlockNumberCheck: false,
    hasSenderAllowedCheck: false,
    localVars: {},
    externalReturnVars: new Set(),
    comparisonVarsFromExternal: [],
  };

  // Walk the function body
  if (funcNode.body) {
    walkStatements(funcNode.body.statements || [], info, lines, contract);
  }

  // Merge into contract-level collections
  contract.aclGrants.push(...info.aclGrants);
  contract.externalReturns.push(...info.externalCalls.filter(c => c.returnsEncrypted));

  return info;
}

function walkStatements(stmts, info, lines, contract) {
  for (const stmt of stmts) {
    walkNode(stmt, info, lines, contract);
  }
}

function walkNode(node, info, lines, contract) {
  if (!node) return;

  switch (node.type) {
    case "ExpressionStatement":
      analyzeExpression(node.expression, info, lines, contract);
      break;
    case "VariableDeclarationStatement":
      handleVarDecl(node, info, lines, contract);
      break;
    case "IfStatement":
      // Check if condition references encrypted types
      checkConditionForEncrypted(node.condition, info, lines);
      if (node.trueBody) walkNode(node.trueBody, info, lines, contract);
      if (node.falseBody) walkNode(node.falseBody, info, lines, contract);
      break;
    case "Block":
      walkStatements(node.statements || [], info, lines, contract);
      break;
    case "ForStatement":
    case "WhileStatement":
      if (node.body) walkNode(node.body, info, lines, contract);
      break;
    case "Return":
      if (node.expression) analyzeExpression(node.expression, info, lines, contract);
      break;
    default:
      // Recurse into children for other node types
      break;
  }
}

function handleVarDecl(node, info, lines, contract) {
  const vars = node.variables || [];
  for (const v of vars) {
    if (v && v.name && v.typeName) {
      const typeName = resolveTypeName(v.typeName);
      info.localVars[v.name] = typeName;
    }
  }
  // Check if initial value is a function call (external call returning encrypted)
  if (node.initialValue) {
    const callInfo = extractFunctionCall(node.initialValue);
    if (callInfo && callInfo.isExternal) {
      const lhsType = vars[0] && vars[0].typeName ? resolveTypeName(vars[0].typeName) : null;
      if (lhsType && ENCRYPTED_TYPES.has(lhsType)) {
        const line = node.loc ? node.loc.start.line : 0;
        info.externalCalls.push({
          line,
          functionName: callInfo.name,
          returnsEncrypted: true,
          lhsVar: vars[0] ? vars[0].name : null,
        });
        if (vars[0] && vars[0].name) {
          info.externalReturnVars.add(vars[0].name);
        }
      }
    }
    analyzeExpression(node.initialValue, info, lines, contract);
  }
}

function analyzeExpression(expr, info, lines, contract) {
  if (!expr) return;

  if (expr.type === "FunctionCall") {
    handleFunctionCall(expr, info, lines, contract);
  }

  if (expr.type === "BinaryOperation" && expr.operator === "=") {
    analyzeExpression(expr.right, info, lines, contract);
  }

  // Check for delete statements
  if (expr.type === "UnaryOperation" && expr.operator === "delete") {
    info.hasDelete = true;
  }
}

function handleFunctionCall(expr, info, lines, contract) {
  const callInfo = extractFunctionCall(expr);
  if (!callInfo) return;
  const line = expr.loc ? expr.loc.start.line : 0;
  const snippet = line > 0 && lines[line - 1] ? lines[line - 1].trim() : "";

  // Check for FHE.allow*, FHE.makePubliclyDecryptable
  if (callInfo.object === "FHE" && ACL_FUNCTIONS.has(callInfo.method)) {
    const grantType = mapGrantType(callInfo.method);
    const args = expr.arguments || [];
    const handle = args[0] ? expressionToString(args[0]) : "unknown";
    const grantee = args[1] ? expressionToString(args[1]) : (callInfo.method === "allowThis" ? "address(this)" : callInfo.method === "makePubliclyDecryptable" ? "public" : "unknown");

    info.aclGrants.push({
      function: info.name,
      line,
      type: grantType,
      handle,
      grantee,
      method: callInfo.method,
      snippet,
    });

    if (callInfo.method === "makePubliclyDecryptable") {
      info.hasMakePubliclyDecryptable = true;
    }
  }

  // Check for FHE comparison calls used later in external-return context
  if (callInfo.object === "FHE" && ["gt", "lt", "ge", "le", "eq", "ne"].includes(callInfo.method)) {
    const args = expr.arguments || [];
    for (const arg of args) {
      const argName = expressionToString(arg);
      if (info.externalReturnVars.has(argName)) {
        info.comparisonVarsFromExternal.push({
          line,
          comparedVar: argName,
          snippet,
        });
      }
    }
  }

  // Check for FHE.isSenderAllowed
  if (callInfo.object === "FHE" && callInfo.method === "isSenderAllowed") {
    info.hasSenderAllowedCheck = true;
  }

  // Check for external .call, .transfer, .send
  if (callInfo.method === "call" || callInfo.method === "transfer" || callInfo.method === "send") {
    info.hasExternalCall = true;
  }

  // Check for block.timestamp or block.number in conditions
  if (callInfo.object === "block" || snippet.includes("block.timestamp") || snippet.includes("block.number")) {
    info.hasTimestampCheck = true;
    info.hasBlockNumberCheck = true;
  }
}

function checkConditionForEncrypted(condNode, info, lines) {
  if (!condNode) return;
  // Check if any identifier in the condition is an encrypted type
  const identifiers = collectIdentifiers(condNode);
  for (const id of identifiers) {
    if (info.localVars[id] && ENCRYPTED_TYPES.has(info.localVars[id])) {
      // This is branching on an encrypted value — but we don't flag it here
      // (that's for rules.js to handle based on the analysis)
    }
  }
}

function collectIdentifiers(node) {
  const ids = [];
  if (!node) return ids;
  if (node.type === "Identifier") {
    ids.push(node.name);
  }
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "range") continue;
    const val = node[key];
    if (val && typeof val === "object") {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") ids.push(...collectIdentifiers(item));
        }
      } else {
        ids.push(...collectIdentifiers(val));
      }
    }
  }
  return ids;
}

function extractFunctionCall(expr) {
  if (!expr || expr.type !== "FunctionCall") return null;
  const callee = expr.expression;
  if (!callee) return null;

  // FHE.method(args)
  if (callee.type === "MemberAccess") {
    const obj = callee.expression;
    if (obj && obj.type === "Identifier") {
      return { object: obj.name, method: callee.memberName, name: `${obj.name}.${callee.memberName}`, isExternal: obj.name !== "FHE" };
    }
    // contract.method() — external call
    return { object: expressionToString(obj), method: callee.memberName, name: `?.${callee.memberName}`, isExternal: true };
  }

  // Direct function call
  if (callee.type === "Identifier") {
    return { object: null, method: callee.name, name: callee.name, isExternal: false };
  }

  return null;
}

function expressionToString(expr) {
  if (!expr) return "unknown";
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberAccess") return `${expressionToString(expr.expression)}.${expr.memberName}`;
  if (expr.type === "IndexAccess") return `${expressionToString(expr.base)}[${expressionToString(expr.index)}]`;
  if (expr.type === "FunctionCall") {
    const fn = extractFunctionCall(expr);
    return fn ? `${fn.name}(...)` : "call(...)";
  }
  if (expr.type === "NumberLiteral") return expr.number;
  if (expr.type === "StringLiteral") return `"${expr.value}"`;
  if (expr.type === "BooleanLiteral") return String(expr.value);
  return "expr";
}

function mapGrantType(method) {
  switch (method) {
    case "allow": return "persistent";
    case "allowThis": return "persistent-self";
    case "allowTransient": return "transient";
    case "makePubliclyDecryptable": return "public";
    default: return "unknown";
  }
}

function extractImports(source) {
  const imports = [];
  const regex = /import\s+.*?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(source)) !== null) {
    imports.push(m[1]);
  }
  // Also match: import "path";
  const regex2 = /import\s+["']([^"']+)["']\s*;/g;
  while ((m = regex2.exec(source)) !== null) {
    imports.push(m[1]);
  }
  // Also match: import { X } from "path";
  const regex3 = /import\s+\{[^}]*\}\s+from\s+["']([^"']+)["']/g;
  while ((m = regex3.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return [...new Set(imports)];
}

module.exports = { parseFile, extractImports, ENCRYPTED_TYPES };
