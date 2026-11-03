const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const config = require("../config");

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

let resolved;

function parse(source) {
  return acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
}

function walk(node, visit) {
  if (!node || typeof node.type !== "string") {
    return;
  }

  visit(node);

  for (const key of Object.keys(node)) {
    const child = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        walk(item, visit);
      }
    } else if (child && typeof child.type === "string") {
      walk(child, visit);
    }
  }
}

function isStringLiteral(node) {
  return !!node && node.type === "Literal" && typeof node.value === "string";
}

function memberName(node) {
  if (!node || node.type !== "MemberExpression") {
    return null;
  }

  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && isStringLiteral(node.property)) {
    return node.property.value;
  }

  return null;
}

function isCallOn(node, method, firstArg) {
  return (
    !!node &&
    node.type === "CallExpression" &&
    memberName(node.callee) === method &&
    isStringLiteral(node.arguments[0]) &&
    node.arguments[0].value === firstArg
  );
}

function extractTermsFromRenderer(source) {
  const comparedOperands = [];
  const stringDeclarations = new Map();

  walk(parse(source), (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      isStringLiteral(node.init)
    ) {
      const declaredValues = stringDeclarations.get(node.id.name) || [];
      declaredValues.push(node.init.value);
      stringDeclarations.set(node.id.name, declaredValues);
    }

    if (
      node.type !== "BinaryExpression" ||
      !EQUALITY_OPERATORS.has(node.operator)
    ) {
      return;
    }

    if (isCallOn(node.right, "sendSync", "terms")) {
      comparedOperands.push(node.left);
    } else if (isCallOn(node.left, "sendSync", "terms")) {
      comparedOperands.push(node.right);
    }
  });

  const comparedLiteral = comparedOperands.find(isStringLiteral);

  if (comparedLiteral) {
    return comparedLiteral.value;
  }

  for (const operand of comparedOperands) {
    if (operand.type !== "Identifier") {
      continue;
    }

    const declaredValues = stringDeclarations.get(operand.name) || [];

    if (declaredValues.length === 1) {
      return declaredValues[0];
    }
  }

  return null;
}

function extractTermsFromMain(source) {
  const ast = parse(source);
  const topLevelStrings = new Map();

  for (const statement of ast.body) {
    if (statement.type !== "VariableDeclaration") {
      continue;
    }

    for (const declarator of statement.declarations) {
      if (
        declarator.id.type === "Identifier" &&
        isStringLiteral(declarator.init)
      ) {
        topLevelStrings.set(declarator.id.name, declarator.init.value);
      }
    }
  }

  let handler = null;

  walk(ast, (node) => {
    if (handler === null && isCallOn(node, "on", "terms")) {
      handler = node.arguments[1] || null;
    }
  });

  if (!handler) {
    return null;
  }

  let terms = null;

  walk(handler, (node) => {
    if (
      terms !== null ||
      node.type !== "AssignmentExpression" ||
      memberName(node.left) !== "returnValue"
    ) {
      return;
    }

    if (node.right.type === "Identifier") {
      terms = topLevelStrings.get(node.right.name) ?? null;
    }
  });

  return terms;
}

function extractFromAsset(assetsPath, name, extract) {
  let source;

  try {
    source = fs.readFileSync(path.join(assetsPath, name), "utf-8");
  } catch {
    return null;
  }

  try {
    return extract(source);
  } catch (e) {
    console.warn(
      `[ignis] Obsidian terms: could not parse ${name}: ${e.message}`,
    );
    return null;
  }
}

function resolveObsidianTerms({
  assetsPath = config.obsidianAssetsPath,
  override = config.obsidianTermsOverride,
} = {}) {
  if (override) {
    console.log("[ignis] Obsidian terms: using OBSIDIAN_TERMS_STRING");
    return override;
  }

  const fromRenderer = extractFromAsset(
    assetsPath,
    "app.js",
    extractTermsFromRenderer,
  );
  const fromMain = extractFromAsset(
    assetsPath,
    "main.js",
    extractTermsFromMain,
  );

  if (fromRenderer !== null && fromMain !== null && fromRenderer !== fromMain) {
    console.warn(
      "[ignis] Obsidian terms: app.js and main.js disagree, using app.js",
    );
  }

  if (fromRenderer !== null) {
    console.log("[ignis] Obsidian terms: extracted from app.js");
    return fromRenderer;
  }

  if (fromMain !== null) {
    console.warn(
      "[ignis] Obsidian terms: not found in app.js, using the main.js value",
    );
    return fromMain;
  }

  console.log("[ignis] Obsidian terms: no handshake in the served Obsidian");
  return null;
}

function getObsidianTerms() {
  if (resolved === undefined) {
    resolved = resolveObsidianTerms();
  }

  return resolved;
}

module.exports = {
  getObsidianTerms,
  resolveObsidianTerms,
  extractTermsFromRenderer,
  extractTermsFromMain,
};
