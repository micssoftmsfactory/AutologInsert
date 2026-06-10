"use strict";

const path = require("node:path");
const Parser = require("tree-sitter");
const cppLanguage = require("tree-sitter-cpp");
const javaLanguage = require("tree-sitter-java");
const javascriptLanguage = require("tree-sitter-javascript");
const phpParser = require("php-parser");

const TREE_SITTER_SOURCE_LENGTH_LIMIT = 32767;

const SUPPORTED_LANGUAGES = ["c", "cpp", "csharp", "java", "javascript", "php"];

const FUNCTION_NODE_TYPES = {
  cpp: new Set(["function_definition"]),
  c: new Set(["function_definition"]),
  java: new Set([
    "method_declaration",
    "constructor_declaration",
    "compact_constructor_declaration",
  ]),
  javascript: new Set([
    "function_declaration",
    "function_expression",
    "generator_function",
    "generator_function_declaration",
    "arrow_function",
    "method_definition",
  ]),
};

const LOOP_MARKERS = new Map([
  ["while_statement", "WHILE"],
  ["for_statement", "FOR"],
  ["for_in_statement", "FOR"],
  ["for_of_statement", "FOR"],
  ["foreach_statement", "FOREACH"],
  ["do_statement", "DO"],
  ["switch_statement", "SWITCH"],
  ["try_statement", "TRY"],
]);

const CONTROL_KEYWORDS = new Map([
  ["if", "IF"],
  ["else", "ELSE"],
  ["while", "WHILE"],
  ["for", "FOR"],
  ["foreach", "FOREACH"],
  ["do", "DO"],
  ["switch", "SWITCH"],
  ["try", "TRY"],
  ["catch", "CATCH"],
  ["finally", "FINALLY"],
]);

function detectLanguage({ explicitFlag, inputPath }) {
  if (explicitFlag) {
    switch (explicitFlag.toLowerCase()) {
      case "-c":
      case "-vc":
        return "c";
      case "-cpp":
        return "cpp";
      case "-csharp":
      case "-cs":
        return "csharp";
      case "-java":
        return "java";
      case "-javascript":
      case "-js":
        return "javascript";
      case "-php":
        return "php";
      default:
        return null;
    }
  }

  if (!inputPath) {
    return null;
  }

  const extension = inputPath.toLowerCase().split(".").pop();
  switch (extension) {
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "cs":
      return "csharp";
    case "java":
      return "java";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "php":
    case "phtml":
      return "php";
    default:
      return null;
  }
}

function instrumentSource(source, language, context = {}) {
  const instrumentContext = createInstrumentContext(context);

  switch (language) {
    case "javascript":
      if (source.length > TREE_SITTER_SOURCE_LENGTH_LIMIT) {
        return instrumentLargeJavascriptSource(source, instrumentContext);
      }
      return instrumentTreeSitterSource(source, language, instrumentContext);
    case "java":
    case "cpp":
    case "c":
      return instrumentTreeSitterSource(source, language, instrumentContext);
    case "php":
      return instrumentPhpSource(source, instrumentContext);
    case "csharp":
      return instrumentBraceLanguageSource(source, "csharp", instrumentContext);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

function createInstrumentContext(context) {
  const filePath =
    context && typeof context.filePath === "string" && context.filePath.length > 0
      ? context.filePath
      : null;

  return {
    filePath,
    fileLabel: filePath ? path.basename(filePath) : "<stdin>",
  };
}

function instrumentLargeJavascriptSource(source, context) {
  return instrumentBraceLanguageSource(source, "javascript", context, {
    warningMessage:
      `JavaScript input exceeded the tree-sitter limit of ${TREE_SITTER_SOURCE_LENGTH_LIMIT} characters, so a token-based fallback was used.`,
  });
}

function instrumentTreeSitterSource(source, language, context) {
  const parser = new Parser();
  parser.setLanguage(getTreeSitterGrammar(language));

  let tree;
  try {
    tree = parser.parse(source);
  } catch (error) {
    if (
      error &&
      error.message === "Invalid argument" &&
      source.length > TREE_SITTER_SOURCE_LENGTH_LIMIT
    ) {
      throw new Error(
        `The ${language} tree-sitter parser in this Node.js runtime cannot parse inputs longer than ${TREE_SITTER_SOURCE_LENGTH_LIMIT} characters. Received ${source.length} characters for ${context.fileLabel}. Split the file or use a smaller input.`
      );
    }
    throw error;
  }
  const layout = createLayout(source);
  const insertions = [];
  const seen = new Set();

  walkTree(tree.rootNode, (node) => {
    if (FUNCTION_NODE_TYPES[language].has(node.type)) {
      const body = node.childForFieldName("body");
      if (isBlockNode(body, language)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          body,
          "FUNC",
          createMarkerMetadata(
            layout,
            context,
            node.startIndex,
            getTreeSitterFunctionName(source, language, node),
            getTreeSitterFunctionMetadata(source, language, node)
          )
        );
      }
    }

    if (node.type === "return_statement") {
      addReturnMarker(
        source,
        layout,
        insertions,
        seen,
        node.startIndex,
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          getTreeSitterReturnMetadata(source, node)
        )
      );
      return;
    }

    if (node.type === "if_statement") {
      const consequence = node.childForFieldName("consequence");
      const alternative = node.childForFieldName("alternative");
      const functionName = getEnclosingTreeSitterFunctionName(source, language, node);

      if (isBlockNode(consequence, language)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          consequence,
          "IF",
          createMarkerMetadata(
            layout,
            context,
            node.startIndex,
            functionName,
            getTreeSitterConditionMetadata(source, node)
          )
        );
      }

      const elseBlock = getElseBlockNode(alternative, language);
      if (elseBlock) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          elseBlock,
          "ELSE",
          createMarkerMetadata(layout, context, alternative.startIndex, functionName, null)
        );
      }
      return;
    }

    if (node.type === "catch_clause") {
      const body = node.childForFieldName("body");
      if (isBlockNode(body, language)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          body,
          "CATCH",
          createMarkerMetadata(
            layout,
            context,
            node.startIndex,
            getEnclosingTreeSitterFunctionName(source, language, node),
            getTreeSitterCatchMetadata(source, node)
          )
        );
      }
      return;
    }

    if (node.type === "finally_clause") {
      const body = node.childForFieldName("body") || node.namedChild(0);
      if (isBlockNode(body, language)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          body,
          "FINALLY",
          createMarkerMetadata(
            layout,
            context,
            node.startIndex,
            getEnclosingTreeSitterFunctionName(source, language, node),
            null
          )
        );
      }
      return;
    }

    if (language === "javascript" && node.type === "switch_case") {
      addRangeMarkers(
        source,
        layout,
        insertions,
        seen,
        node.startIndex,
        node.endIndex,
        "CASE",
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          getTreeSitterCaseMetadata(source, node)
        )
      );
      return;
    }

    if (language === "javascript" && node.type === "switch_default") {
      addRangeMarkers(
        source,
        layout,
        insertions,
        seen,
        node.startIndex,
        node.endIndex,
        "DEFAULT",
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          null
        )
      );
      return;
    }

    if (language === "java" && node.type === "switch_block_statement_group") {
      const label = node.namedChild(0);
      const markerName = isJavaDefaultLabel(label) ? "DEFAULT" : "CASE";
      addRangeMarkers(
        source,
        layout,
        insertions,
        seen,
        node.startIndex,
        node.endIndex,
        markerName,
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          markerName === "CASE" ? getTreeSitterCaseMetadata(source, label) : null
        )
      );
      return;
    }

    if ((language === "cpp" || language === "c") && node.type === "case_statement") {
      const markerName = node.namedChildCount > 1 ? "CASE" : "DEFAULT";
      addRangeMarkers(
        source,
        layout,
        insertions,
        seen,
        node.startIndex,
        node.endIndex,
        markerName,
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          markerName === "CASE" ? getTreeSitterCaseMetadata(source, node) : null
        )
      );
      return;
    }

    const loopMarker = LOOP_MARKERS.get(node.type);
    if (!loopMarker) {
      return;
    }

    const body = node.childForFieldName("body");
    if (isBlockNode(body, language)) {
      addBlockMarkers(
        source,
        layout,
        insertions,
        seen,
        body,
        loopMarker,
        createMarkerMetadata(
          layout,
          context,
          node.startIndex,
          getEnclosingTreeSitterFunctionName(source, language, node),
          getTreeSitterConditionMetadata(source, node)
        )
      );
    }
  });

  return {
    code: applyInsertions(source, insertions),
    warnings: language === "c"
      ? [
          "C input is parsed with the C++ grammar because the C grammar binding is not compatible with this Node.js runtime.",
        ]
      : [],
  };
}

function instrumentPhpSource(source, context) {
  const engine = new phpParser.Engine({
    parser: {
      php7: true,
      extractDoc: false,
      suppressErrors: false,
    },
    ast: {
      withPositions: true,
    },
  });

  const ast = engine.parseCode(source);
  const layout = createLayout(source);
  const insertions = [];
  const seen = new Set();

  walkPhpAst(ast, (node, ancestors) => {
    if (!node || !node.kind) {
      return;
    }

    if ((node.kind === "function" || node.kind === "method") && isPhpBlock(node.body)) {
      addBlockMarkers(
        source,
        layout,
        insertions,
        seen,
        node.body.loc,
        "FUNC",
        createMarkerMetadata(
          layout,
          context,
          node.loc?.start?.offset ?? node.body.loc.start.offset,
          getPhpFunctionName(node),
          getPhpFunctionMetadata(source, node)
        )
      );
      return;
    }

    if (node.kind === "return" && node.loc) {
      addReturnMarker(
        source,
        layout,
        insertions,
        seen,
        node.loc.start.offset,
        createMarkerMetadata(
          layout,
          context,
          node.loc.start.offset,
          getEnclosingPhpFunctionName(ancestors),
          getPhpReturnMetadata(source, node)
        )
      );
      return;
    }

    if (node.kind === "if") {
      if (isPhpBlock(node.body)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          node.body.loc,
          "IF",
          createMarkerMetadata(
            layout,
            context,
            node.loc?.start?.offset ?? node.body.loc.start.offset,
            getEnclosingPhpFunctionName(ancestors),
            getPhpConditionMetadata(source, node)
          )
        );
      }
      if (isPhpBlock(node.alternate)) {
        addBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          node.alternate.loc,
          "ELSE",
          createMarkerMetadata(
            layout,
            context,
            node.alternate.loc.start.offset,
            getEnclosingPhpFunctionName(ancestors),
            null
          )
        );
      }
      return;
    }

    if (node.kind === "catch" && isPhpBlock(node.body)) {
      addBlockMarkers(
        source,
        layout,
        insertions,
        seen,
        node.body.loc,
        "CATCH",
        createMarkerMetadata(
          layout,
          context,
          node.loc?.start?.offset ?? node.body.loc.start.offset,
          getEnclosingPhpFunctionName(ancestors),
          getPhpCatchMetadata(source, node)
        )
      );
      return;
    }

    switch (node.kind) {
      case "while":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "WHILE",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              getPhpConditionMetadata(source, node)
            )
          );
        }
        break;
      case "for":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "FOR",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              getPhpConditionMetadata(source, node)
            )
          );
        }
        break;
      case "foreach":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "FOREACH",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              getPhpConditionMetadata(source, node)
            )
          );
        }
        break;
      case "do":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "DO",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              getPhpConditionMetadata(source, node)
            )
          );
        }
        break;
      case "switch":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "SWITCH",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              getPhpConditionMetadata(source, node)
            )
          );
        }
        break;
      case "try":
        if (isPhpBlock(node.body)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.body.loc,
            "TRY",
            createMarkerMetadata(
              layout,
              context,
              node.loc?.start?.offset ?? node.body.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              null
            )
          );
        }
        if (Array.isArray(node.catches)) {
          for (const catchNode of node.catches) {
            if (catchNode && isPhpBlock(catchNode.body)) {
              addBlockMarkers(
                source,
                layout,
                insertions,
                seen,
                catchNode.body.loc,
                "CATCH",
                createMarkerMetadata(
                  layout,
                  context,
                  catchNode.loc?.start?.offset ?? catchNode.body.loc.start.offset,
                  getEnclosingPhpFunctionName(ancestors),
                  getPhpCatchMetadata(source, catchNode)
                )
              );
            }
          }
        }
        if (isPhpBlock(node.always)) {
          addBlockMarkers(
            source,
            layout,
            insertions,
            seen,
            node.always.loc,
            "FINALLY",
            createMarkerMetadata(
              layout,
              context,
              node.always.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              null
            )
          );
        }
        break;
      case "case":
        if (isPhpBlock(node.body)) {
          addRangeMarkersFromLoc(
            source,
            layout,
            insertions,
            seen,
            node.loc,
            node.test ? "CASE" : "DEFAULT",
            createMarkerMetadata(
              layout,
              context,
              node.loc.start.offset,
              getEnclosingPhpFunctionName(ancestors),
              node.test ? getPhpCaseMetadata(source, node) : null
            )
          );
        }
        break;
      default:
        break;
    }
  });

  return {
    code: applyInsertions(source, insertions),
    warnings: [],
  };
}

function instrumentBraceLanguageSource(source, language, context, options = {}) {
  const layout = createLayout(source);
  const tokens = tokenizeBraceLanguage(source);
  const insertions = [];
  const seen = new Set();
  const blockStack = [];
  let openLabeledBranch = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "word" && token.value === "return" && isInsideFunction(blockStack)) {
      addReturnMarker(
        source,
        layout,
        insertions,
        seen,
        token.start,
        createMarkerMetadata(
          layout,
          context,
          token.start,
          getCurrentBraceFunctionName(blockStack),
          buildBraceReturnMetadata(source, tokens, index)
        )
      );
      continue;
    }

    if (token.type === "word" && (token.value === "case" || token.value === "default") && isInsideSwitch(blockStack)) {
      if (openLabeledBranch && openLabeledBranch.switchDepth === getSwitchDepth(blockStack)) {
        addRangeMarkers(
          source,
          layout,
          insertions,
          seen,
          openLabeledBranch.start,
          token.start,
          openLabeledBranch.kind,
          openLabeledBranch.metadata
        );
      }

      openLabeledBranch = {
        kind: token.value === "case" ? "CASE" : "DEFAULT",
        metadata: createMarkerMetadata(
          layout,
          context,
          token.start,
          getCurrentBraceFunctionName(blockStack),
          token.value === "case" ? buildBraceCaseMetadata(tokens, index) : null
        ),
        start: token.start,
        switchDepth: getSwitchDepth(blockStack),
      };
      continue;
    }

    if (token.type === "symbol" && token.value === "{") {
      const block = classifyBraceBlock(tokens, index, getCurrentBraceFunctionName(blockStack), language);
      blockStack.push(block);
      if (block && block.kind) {
        block.markerMetadata = createMarkerMetadata(
          layout,
          context,
          block.originOffset ?? token.start,
          block.functionName,
          block.metadata
        );
        addBraceBlockMarkers(
          source,
          layout,
          insertions,
          seen,
          token,
          block.kind,
          true,
          block.markerMetadata
        );
      }
      continue;
    }

    if (token.type === "symbol" && token.value === "}") {
      const closingSwitchDepth = getSwitchDepth(blockStack);
      const topBlock = blockStack[blockStack.length - 1] || null;
      if (openLabeledBranch && topBlock && topBlock.kind === "SWITCH" && openLabeledBranch.switchDepth === closingSwitchDepth) {
        addRangeMarkers(
          source,
          layout,
          insertions,
          seen,
          openLabeledBranch.start,
          token.start,
          openLabeledBranch.kind,
          openLabeledBranch.metadata
        );
        openLabeledBranch = null;
      }

      const block = blockStack.pop() || null;
      if (block && block.kind) {
        addBraceBlockMarkers(source, layout, insertions, seen, token, block.kind, false, block.markerMetadata);
      }
    }
  }

  return {
    code: applyInsertions(source, insertions),
    warnings: [
      options.warningMessage ||
        `The ${language} path uses a token-based fallback because a compatible tree-sitter grammar binding is not available for this Node.js runtime.`,
    ],
  };
}

function getTreeSitterGrammar(language) {
  switch (language) {
    case "cpp":
      return cppLanguage;
    case "c":
      return cppLanguage;
    case "java":
      return javaLanguage;
    case "javascript":
      return javascriptLanguage;
    default:
      throw new Error(`No tree-sitter grammar configured for ${language}`);
  }
}

function walkTree(node, visit) {
  visit(node);
  for (let index = 0; index < node.namedChildCount; index += 1) {
    walkTree(node.namedChild(index), visit);
  }
}

function walkPhpAst(node, visit, ancestors = []) {
  if (!node || typeof node !== "object") {
    return;
  }

  visit(node, ancestors);
  const nextAncestors = [...ancestors, node];

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walkPhpAst(item, visit, nextAncestors);
      }
      continue;
    }

    walkPhpAst(value, visit, nextAncestors);
  }
}

function isBlockNode(node, language) {
  if (!node) {
    return false;
  }

  switch (language) {
    case "javascript":
      return node.type === "statement_block" || node.type === "switch_body";
    case "java":
      return node.type === "block";
    case "cpp":
    case "c":
      return node.type === "compound_statement";
    default:
      return false;
  }
}

function getElseBlockNode(alternative, language) {
  if (!alternative) {
    return null;
  }

  if (isBlockNode(alternative, language)) {
    return alternative;
  }

  if (alternative.type === "else_clause") {
    for (let index = 0; index < alternative.namedChildCount; index += 1) {
      const child = alternative.namedChild(index);
      if (isBlockNode(child, language)) {
        return child;
      }
    }
  }

  return null;
}

function isPhpBlock(node) {
  return Boolean(node && node.kind === "block" && node.loc);
}

function createLayout(source) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStarts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  const indentUnit = detectIndentUnit(source);

  function getLineIndex(offset) {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const start = lineStarts[middle];
      const next = middle + 1 < lineStarts.length ? lineStarts[middle + 1] : source.length + 1;

      if (offset < start) {
        high = middle - 1;
      } else if (offset >= next) {
        low = middle + 1;
      } else {
        return middle;
      }
    }

    return lineStarts.length - 1;
  }

  function getLineStart(offset) {
    return lineStarts[getLineIndex(offset)];
  }

  function getLineNumber(offset) {
    return getLineIndex(offset) + 1;
  }

  function getLineIndent(offset) {
    const start = getLineStart(offset);
    let cursor = start;

    while (cursor < source.length && (source[cursor] === " " || source[cursor] === "\t")) {
      cursor += 1;
    }

    return source.slice(start, cursor);
  }

  return {
    newline,
    indentUnit,
    getLineNumber,
    getLineStart,
    getLineIndent,
  };
}

function detectIndentUnit(source) {
  const lines = source.split(/\r?\n/);
  let best = null;

  for (const line of lines) {
    const match = line.match(/^([ \t]+)/);
    if (!match) {
      continue;
    }

    const indent = match[1];
    if (!best || indent.length < best.length) {
      best = indent;
    }
  }

  return best || "    ";
}

function addBlockMarkers(source, layout, insertions, seen, blockNodeOrLoc, markerName, metadata = null) {
  const range = normalizeBlockRange(source, blockNodeOrLoc);
  if (!range) {
    return;
  }

  const innerIndent = getInnerIndent(layout, range.openBraceEnd, source);
  const isSingleLineBlock = !source.slice(range.openBraceEnd, range.closeBraceStart).includes("\n");
  const closingIndent = layout.getLineIndent(range.closeBraceStart);
  const closingLineStart = layout.getLineStart(range.closeBraceStart);
  const closingPrefix = source.slice(closingLineStart, range.closeBraceStart);
  const startMarker = buildStartMarker(markerName, metadata);
  const startText = isSingleLineBlock
    ? `${layout.newline}${startMarker}${layout.newline}${innerIndent}`
    : `${layout.newline}${startMarker}`;
  const endAtLineStart = closingPrefix.trim().length === 0;
  const endText = isSingleLineBlock || !endAtLineStart
    ? `${layout.newline}${buildEndMarker(markerName, metadata)}${layout.newline}${closingIndent}`
    : `${buildEndMarker(markerName, metadata)}${layout.newline}`;

  pushInsertion(insertions, seen, range.openBraceEnd, startText);
  pushInsertion(insertions, seen, endAtLineStart ? closingLineStart : range.closeBraceStart, endText);
}

function addBraceBlockMarkers(source, layout, insertions, seen, token, markerName, isStart, metadata = null) {
  const innerIndent = getInnerIndent(layout, token.start, source);
  const nextLineBreak = source.indexOf("\n", token.end);
  const blockEnd = isStart && nextLineBreak !== -1 ? nextLineBreak : token.end;
  const immediateContent = source.slice(token.end, blockEnd).trim().length > 0;
  const closingIndent = layout.getLineIndent(token.start);
  const closingLineStart = layout.getLineStart(token.start);
  const closingPrefix = source.slice(closingLineStart, token.start);
  const text = isStart
    ? immediateContent
      ? `${layout.newline}${buildStartMarker(markerName, metadata)}${layout.newline}${innerIndent}`
      : `${layout.newline}${buildStartMarker(markerName, metadata)}`
    : closingPrefix.trim().length === 0
      ? `${buildEndMarker(markerName, metadata)}${layout.newline}`
      : `${layout.newline}${buildEndMarker(markerName, metadata)}${layout.newline}${closingIndent}`;
  const index = isStart ? token.end : closingPrefix.trim().length === 0 ? closingLineStart : token.start;
  pushInsertion(insertions, seen, index, text);
}

function addRangeMarkers(source, layout, insertions, seen, startIndex, endIndex, markerName, metadata = null) {
  const lineStart = layout.getLineStart(startIndex);
  const startText = `${buildStartMarker(markerName, metadata)}${layout.newline}`;

  const endLineStart = layout.getLineStart(endIndex);
  const endPrefix = source.slice(endLineStart, endIndex);
  const endText = endPrefix.trim().length === 0
    ? `${buildEndMarker(markerName, metadata)}${layout.newline}`
    : `${layout.newline}${buildEndMarker(markerName, metadata)}${layout.newline}`;

  pushInsertion(insertions, seen, lineStart, startText);
  pushInsertion(insertions, seen, endPrefix.trim().length === 0 ? endLineStart : endIndex, endText);
}

function addRangeMarkersFromLoc(source, layout, insertions, seen, loc, markerName, metadata = null) {
  if (!loc || !loc.start || !loc.end) {
    return;
  }
  addRangeMarkers(source, layout, insertions, seen, loc.start.offset, loc.end.offset, markerName, metadata);
}

function addReturnMarker(source, layout, insertions, seen, returnStart, metadata = null) {
  const lineStart = layout.getLineStart(returnStart);
  const indent = layout.getLineIndent(returnStart);
  const marker = buildReturnMarker(metadata);
  const prefix = source.slice(lineStart, returnStart);
  if (prefix.trim().length === 0) {
    const text = `${marker}${layout.newline}`;
    pushInsertion(insertions, seen, lineStart, text);
    return;
  }

  const inlineIndent = `${indent}${layout.indentUnit}`;
  const text = `${layout.newline}${marker}${layout.newline}${inlineIndent}`;
  pushInsertion(insertions, seen, returnStart, text);
}

function normalizeBlockRange(source, blockNodeOrLoc) {
  if (!blockNodeOrLoc) {
    return null;
  }

  let startIndex;
  let endIndex;

  if (typeof blockNodeOrLoc.startIndex === "number") {
    startIndex = blockNodeOrLoc.startIndex;
    endIndex = blockNodeOrLoc.endIndex;
  } else if (blockNodeOrLoc.start && blockNodeOrLoc.end) {
    startIndex = blockNodeOrLoc.start.offset;
    endIndex = blockNodeOrLoc.end.offset;
  } else {
    return null;
  }

  const openBraceStart = source.indexOf("{", startIndex);
  const closeBraceStart = source.lastIndexOf("}", endIndex - 1);

  if (openBraceStart === -1 || closeBraceStart === -1 || closeBraceStart < openBraceStart) {
    return null;
  }

  return {
    openBraceEnd: openBraceStart + 1,
    closeBraceStart,
  };
}

function getInnerIndent(layout, offset, source) {
  const lineIndent = layout.getLineIndent(offset);
  const currentLineStart = layout.getLineStart(offset);
  const currentLineText = source.slice(currentLineStart, offset);
  if (currentLineText.trim().length === 0) {
    return lineIndent;
  }
  return `${lineIndent}${layout.indentUnit}`;
}

function buildStartMarker(markerName, metadata) {
  if (!metadata) {
    return `//$$START_${markerName}$$`;
  }
  return `//$$START_${markerName}|${metadata}$$`;
}

function buildEndMarker(markerName, metadata) {
  if (!metadata) {
    return `//$$END_${markerName}$$`;
  }
  return `//$$END_${markerName}|${metadata}$$`;
}

function buildReturnMarker(metadata) {
  if (!metadata) {
    return "//$$RETURN_FUNC$$";
  }
  return `//$$RETURN_FUNC|${metadata}$$`;
}

function createMarkerMetadata(layout, context, offset, functionName, metadata = null) {
  const fields = [
    ["file", context.fileLabel],
    ["line", layout.getLineNumber(offset)],
    ["func", functionName || "<global>"],
  ];

  for (const [key, value] of Object.entries(parseLegacyMetadata(metadata))) {
    fields.push([key, value]);
  }

  return fields
    .filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("|");
}

function parseLegacyMetadata(metadata) {
  if (!metadata) {
    return {};
  }

  if (metadata.startsWith("args: ")) {
    return { args: metadata.slice("args: ".length) };
  }

  if (metadata.startsWith("expr: ")) {
    return { expr: metadata.slice("expr: ".length) };
  }

  return { detail: metadata };
}

function getTreeSitterFunctionName(source, language, node) {
  switch (language) {
    case "javascript":
      return getJavascriptFunctionName(source, node);
    case "java":
      return getJavaFunctionName(source, node);
    case "cpp":
    case "c":
      return getCppFunctionName(source, node);
    default:
      return "<anonymous>";
  }
}

function getEnclosingTreeSitterFunctionName(source, language, node) {
  let current = node;

  while (current) {
    if (FUNCTION_NODE_TYPES[language] && FUNCTION_NODE_TYPES[language].has(current.type)) {
      return getTreeSitterFunctionName(source, language, current);
    }
    current = current.parent;
  }

  return "<global>";
}

function getJavascriptFunctionName(source, node) {
  const directName = normalizeInlineText(getNodeText(source, node.childForFieldName("name")));
  if (directName) {
    return directName;
  }

  const parent = node.parent;
  if (!parent) {
    return "<anonymous>";
  }

  if (parent.type === "variable_declarator") {
    const variableName = normalizeInlineText(getNodeText(source, parent.childForFieldName("name")));
    return variableName || "<anonymous>";
  }

  if (parent.type === "assignment_expression") {
    const leftText = normalizeInlineText(getNodeText(source, parent.childForFieldName("left") || parent.namedChild(0)));
    return extractTrailingIdentifier(leftText) || "<anonymous>";
  }

  if (parent.type === "pair" || parent.type === "property_definition" || parent.type === "public_field_definition") {
    const keyText = normalizeInlineText(
      getNodeText(source, parent.childForFieldName("key") || parent.childForFieldName("name") || parent.namedChild(0))
    );
    return extractTrailingIdentifier(keyText) || keyText || "<anonymous>";
  }

  return "<anonymous>";
}

function getJavaFunctionName(source, node) {
  const directName = normalizeInlineText(getNodeText(source, node.childForFieldName("name")));
  if (directName) {
    return directName;
  }

  if (node.type === "compact_constructor_declaration") {
    let current = node.parent;
    while (current) {
      const className = normalizeInlineText(getNodeText(source, current.childForFieldName("name")));
      if (className) {
        return className;
      }
      current = current.parent;
    }
  }

  return "<anonymous>";
}

function getCppFunctionName(source, node) {
  const declaratorText = getNodeText(source, node.childForFieldName("declarator"));
  const beforeParen = declaratorText.split("(")[0] || "";
  const match = beforeParen.match(/([~A-Za-z_][A-Za-z0-9_:~]*)\s*$/);
  return match ? match[1] : "<anonymous>";
}

function getPhpFunctionName(node) {
  if (!node) {
    return "<anonymous>";
  }

  if (typeof node.name === "string" && node.name.length > 0) {
    return node.name;
  }

  if (node.name && typeof node.name.name === "string" && node.name.name.length > 0) {
    return node.name.name;
  }

  return "<anonymous>";
}

function getEnclosingPhpFunctionName(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor && (ancestor.kind === "function" || ancestor.kind === "method")) {
      return getPhpFunctionName(ancestor);
    }
  }

  return "<global>";
}

function getCurrentBraceFunctionName(blockStack) {
  for (let index = blockStack.length - 1; index >= 0; index -= 1) {
    const block = blockStack[index];
    if (block && block.kind === "FUNC" && block.functionName) {
      return block.functionName;
    }
  }

  return "<global>";
}

function extractTrailingIdentifier(text) {
  const match = String(text || "").match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
  return match ? match[1] : "";
}

function getTreeSitterFunctionMetadata(source, language, node) {
  let parameterText = "";

  if (language === "cpp" || language === "c") {
    const declarator = node.childForFieldName("declarator");
    parameterText = extractParameterListFromText(getNodeText(source, declarator));
  } else {
    const parameters = node.childForFieldName("parameters");
    parameterText = normalizeParameterText(getNodeText(source, parameters));
  }

  return parameterText ? `args: ${parameterText}` : null;
}

function getTreeSitterConditionMetadata(source, node) {
  const conditionNode =
    node.childForFieldName("condition") ||
    node.childForFieldName("value");
  let expressionText = normalizeExpressionText(getNodeText(source, conditionNode));

  if (!expressionText && node.type === "for_statement") {
    expressionText = getTreeSitterForConditionText(source, node);
  }

  return expressionText ? `expr: ${expressionText}` : null;
}

function getTreeSitterReturnMetadata(source, node) {
  if (!node || node.namedChildCount === 0) {
    return null;
  }
  const expressionText = normalizeExpressionText(getNodeText(source, node.namedChild(0)));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getTreeSitterCatchMetadata(source, node) {
  const firstChild = node.namedChild(0);
  if (!firstChild) {
    return null;
  }
  const expressionText = normalizeExpressionText(getNodeText(source, firstChild));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getTreeSitterCaseMetadata(source, node) {
  const valueNode = node.childForFieldName("value") || node.namedChild(0);
  const expressionText = normalizeExpressionText(getNodeText(source, valueNode));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getTreeSitterForConditionText(source, node) {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (!child || child.type === "statement_block" || child.type === "compound_statement" || child.type === "block") {
      continue;
    }
    if (child.type === "binary_expression" || child.type === "condition_clause" || child.type === "expression_statement" || child.type === "parenthesized_expression") {
      return normalizeExpressionText(getNodeText(source, child));
    }
  }
  return null;
}

function getPhpFunctionMetadata(source, node) {
  if (!Array.isArray(node.arguments) || node.arguments.length === 0) {
    return null;
  }

  const args = node.arguments
    .map((argument) => normalizeParameterText(getLocText(source, argument.loc)))
    .filter(Boolean);
  return args.length > 0 ? `args: ${args.join(", ")}` : null;
}

function getPhpConditionMetadata(source, node) {
  if (node.kind === "foreach") {
    const sourceText = normalizeExpressionText(getLocText(source, node.source?.loc));
    const key = normalizeExpressionText(getLocText(source, node.key?.loc));
    const value = normalizeExpressionText(getLocText(source, node.value?.loc));
    const parts = [];
    if (sourceText) {
      parts.push(`source=${sourceText}`);
    }
    if (key) {
      parts.push(`key=${key}`);
    }
    if (value) {
      parts.push(`value=${value}`);
    }
    return parts.length > 0 ? parts.join(", ") : null;
  }

  const testNode = node.test || node.condition;
  const expressionText = normalizeExpressionText(getLocText(source, testNode?.loc));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getPhpReturnMetadata(source, node) {
  const expressionText = normalizeExpressionText(getLocText(source, node.expr?.loc));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getPhpCatchMetadata(source, node) {
  const what = normalizeExpressionText(getLocText(source, node.what?.loc));
  const variable = normalizeExpressionText(getLocText(source, node.variable?.loc));
  if (!what && !variable) {
    return null;
  }
  if (what && variable) {
    return `expr: ${what} ${variable}`;
  }
  return `expr: ${what || variable}`;
}

function getPhpCaseMetadata(source, node) {
  const expressionText = normalizeExpressionText(getLocText(source, node.test?.loc));
  return expressionText ? `expr: ${expressionText}` : null;
}

function getNodeText(source, node) {
  if (!node || typeof node.startIndex !== "number" || typeof node.endIndex !== "number") {
    return "";
  }
  return source.slice(node.startIndex, node.endIndex);
}

function getLocText(source, loc) {
  if (!loc || !loc.start || !loc.end) {
    return "";
  }
  return source.slice(loc.start.offset, loc.end.offset);
}

function normalizeParameterText(text) {
  return normalizeInlineText(stripWrappingParentheses(text));
}

function normalizeExpressionText(text) {
  let result = normalizeInlineText(text);
  result = stripWrappingParentheses(result);
  result = result.replace(/;$/, "").trim();
  return result;
}

function normalizeInlineText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stripWrappingParentheses(text) {
  let result = String(text || "").trim();
  while (result.startsWith("(") && result.endsWith(")") && hasBalancedOuterParentheses(result)) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function hasBalancedOuterParentheses(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index !== text.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function extractParameterListFromText(text) {
  const value = String(text || "");
  const start = value.indexOf("(");
  const end = value.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }
  return normalizeParameterText(value.slice(start + 1, end));
}

function pushInsertion(insertions, seen, index, text) {
  const key = `${index}:${text}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  insertions.push({ index, text, order: insertions.length });
}

function applyInsertions(source, insertions) {
  const sorted = [...insertions].sort((left, right) => {
    if (left.index !== right.index) {
      return right.index - left.index;
    }
    if (left.order !== right.order) {
      return right.order - left.order;
    }
    return right.text.length - left.text.length;
  });

  let result = source;
  for (const insertion of sorted) {
    result =
      result.slice(0, insertion.index) +
      insertion.text +
      result.slice(insertion.index);
  }
  return result;
}

function tokenizeBraceLanguage(source) {
  const tokens = [];
  const symbols = new Set(["{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "=", ">", "<", "+", "-", "*", "/", "!", "?"]);
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (char === "/" && shouldTreatAsRegexLiteral(tokens)) {
      const start = index;
      index += 1;
      let escaped = false;
      let inCharClass = false;

      while (index < source.length) {
        const current = source[index];
        if (escaped) {
          escaped = false;
          index += 1;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          index += 1;
          continue;
        }
        if (current === "[" && !inCharClass) {
          inCharClass = true;
          index += 1;
          continue;
        }
        if (current === "]" && inCharClass) {
          inCharClass = false;
          index += 1;
          continue;
        }
        if (current === "/" && !inCharClass) {
          index += 1;
          while (index < source.length && /[A-Za-z]/.test(source[index])) {
            index += 1;
          }
          break;
        }
        index += 1;
      }

      tokens.push({ type: "regex", start, end: index, value: source.slice(start, index) });
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      const quote = char;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ type: "string", start, end: index, value: source.slice(start, index) });
      continue;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: "word", start, end: index, value: source.slice(start, index) });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9A-Za-z_.]/.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: "number", start, end: index, value: source.slice(start, index) });
      continue;
    }

    if (symbols.has(char)) {
      const start = index;
      index += 1;
      if ((char === "=" || char === "!" || char === "<" || char === ">") && source[index] === "=") {
        index += 1;
      } else if ((char === "+" || char === "-" || char === "&" || char === "|") && source[index] === char) {
        index += 1;
      } else if (char === "=" && source[index] === ">") {
        index += 1;
      }
      tokens.push({ type: "symbol", start, end: index, value: source.slice(start, index) });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function shouldTreatAsRegexLiteral(tokens) {
  const previous = tokens[tokens.length - 1] || null;
  if (!previous) {
    return true;
  }

  if (previous.type === "word") {
    return new Set([
      "return",
      "case",
      "throw",
      "typeof",
      "instanceof",
      "delete",
      "void",
      "new",
      "in",
      "of",
      "yield",
      "await",
    ]).has(previous.value);
  }

  if (previous.type !== "symbol") {
    return false;
  }

  return new Set([
    "(",
    "{",
    "[",
    ",",
    ":",
    ";",
    "=",
    "=>",
    "!",
    "?",
    "+",
    "-",
    "*",
    "/",
    "%",
    "&",
    "|",
    "<",
    ">",
  ]).has(previous.value);
}

function classifyBraceBlock(tokens, braceIndex, currentFunctionName, language) {
  const previous = tokens[braceIndex - 1] || null;
  if (!previous) {
    return null;
  }

  if (previous.type === "word" && CONTROL_KEYWORDS.has(previous.value)) {
    return {
      kind: CONTROL_KEYWORDS.get(previous.value),
      metadata: null,
      functionName: currentFunctionName,
      originOffset: previous.start,
    };
  }

  if (previous.type === "symbol" && previous.value === ")") {
    const openParenIndex = findMatchingOpenToken(tokens, braceIndex - 1, "(", ")");
    if (openParenIndex === -1) {
      return null;
    }

    const beforeParen = tokens[openParenIndex - 1] || null;
    if (beforeParen && beforeParen.type === "word") {
      const control = CONTROL_KEYWORDS.get(beforeParen.value);
      if (control) {
        return {
          kind: control,
          metadata: buildBraceConditionMetadata(tokens, openParenIndex, braceIndex - 1),
          functionName: currentFunctionName,
          originOffset: beforeParen.start,
        };
      }
    }

    if (looksLikeFunctionSignature(tokens, openParenIndex - 1)) {
      return {
        kind: "FUNC",
        metadata: buildBraceFunctionMetadata(tokens, openParenIndex, braceIndex - 1),
        functionName: buildBraceFunctionName(tokens, openParenIndex - 1),
        originOffset: tokens[openParenIndex - 1].start,
      };
    }
  }

  if (language === "javascript" && previous.type === "symbol" && previous.value === "=>") {
    return classifyJavascriptArrowFunction(tokens, braceIndex, currentFunctionName);
  }

  if (previous.type === "word" && (previous.value === "try" || previous.value === "do")) {
    return {
      kind: CONTROL_KEYWORDS.get(previous.value),
      metadata: null,
      functionName: currentFunctionName,
      originOffset: previous.start,
    };
  }

  return null;
}

function looksLikeFunctionSignature(tokens, identifierIndex) {
  const identifier = tokens[identifierIndex];
  if (!identifier || identifier.type !== "word") {
    return false;
  }

  const disallowedNames = new Set([
    "if",
    "for",
    "foreach",
    "while",
    "switch",
    "catch",
    "lock",
    "using",
    "new",
    "return",
    "get",
    "set",
    "init",
    "add",
    "remove",
  ]);
  if (disallowedNames.has(identifier.value)) {
    return false;
  }

  const before = tokens[identifierIndex - 1] || null;
  if (before && before.type === "word" && before.value === "new") {
    return false;
  }

  return true;
}

function findMatchingOpenToken(tokens, closeIndex, openValue, closeValue) {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.type !== "symbol") {
      continue;
    }
    if (token.value === closeValue) {
      depth += 1;
      continue;
    }
    if (token.value === openValue) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function isInsideFunction(blockStack) {
  return blockStack.some((block) => block && block.kind === "FUNC");
}

function isInsideSwitch(blockStack) {
  return blockStack.some((block) => block && block.kind === "SWITCH");
}

function getSwitchDepth(blockStack) {
  return blockStack.filter((block) => block && block.kind === "SWITCH").length;
}

function isJavaDefaultLabel(node) {
  return Boolean(node && node.type === "switch_label" && node.namedChildCount === 0);
}

function buildBraceFunctionName(tokens, identifierIndex) {
  const identifier = tokens[identifierIndex];
  if (!identifier || identifier.type !== "word") {
    return "<anonymous>";
  }
  return identifier.value === "function" ? "<anonymous>" : identifier.value;
}

function classifyJavascriptArrowFunction(tokens, braceIndex, currentFunctionName) {
  const arrowIndex = braceIndex - 1;
  const parameterToken = tokens[arrowIndex - 1] || null;
  let functionName = findJavascriptAssignedFunctionName(tokens, arrowIndex);
  let metadata = null;
  let originOffset = parameterToken ? parameterToken.start : tokens[arrowIndex].start;

  if (parameterToken && parameterToken.type === "symbol" && parameterToken.value === ")") {
    const openParenIndex = findMatchingOpenToken(tokens, arrowIndex - 1, "(", ")");
    if (openParenIndex !== -1) {
      metadata = buildBraceFunctionMetadata(tokens, openParenIndex, arrowIndex - 1);
      originOffset = tokens[openParenIndex].start;
    }
  } else if (parameterToken && parameterToken.type === "word") {
    metadata = `args: ${parameterToken.value}`;
    originOffset = parameterToken.start;
  }

  return {
    kind: "FUNC",
    metadata,
    functionName: functionName || currentFunctionName || "<anonymous>",
    originOffset,
  };
}

function findJavascriptAssignedFunctionName(tokens, arrowIndex) {
  for (let index = arrowIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];

    if (token.type === "symbol" && (token.value === "=" || token.value === ":")) {
      return findPreviousWordToken(tokens, index - 1)?.value || "";
    }

    if (token.type === "symbol" && (token.value === ";" || token.value === "{" || token.value === "}" || token.value === ",")) {
      break;
    }
  }

  return "";
}

function findPreviousWordToken(tokens, startIndex) {
  for (let index = startIndex; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.type === "word") {
      if (token.value === "async") {
        continue;
      }
      return token;
    }
    if (token.type === "symbol" && token.value === ".") {
      continue;
    }
    if (token.type === "symbol" && (token.value === "]" || token.value === ")")) {
      break;
    }
  }
  return null;
}

function buildBraceFunctionMetadata(tokens, openParenIndex, closeParenIndex) {
  const text = tokens
    .slice(openParenIndex + 1, closeParenIndex)
    .map((token) => token.value)
    .join(" ");
  const normalized = normalizeInlineText(text.replace(/\s+([,)\]])/g, "$1").replace(/([(\[])\s+/g, "$1"));
  return normalized ? `args: ${normalized}` : null;
}

function buildBraceConditionMetadata(tokens, openParenIndex, closeParenIndex) {
  const text = tokens
    .slice(openParenIndex + 1, closeParenIndex)
    .map((token) => token.value)
    .join(" ");
  const normalized = normalizeInlineText(text.replace(/\s+([,)\]])/g, "$1").replace(/([(\[])\s+/g, "$1"));
  return normalized ? `expr: ${normalized}` : null;
}

function buildBraceCaseMetadata(tokens, caseIndex) {
  const values = [];
  for (let index = caseIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "symbol" && token.value === ":") {
      break;
    }
    values.push(token.value);
  }

  const normalized = normalizeInlineText(
    values.join(" ")
      .replace(/\s+([,.;)\]}>])/g, "$1")
      .replace(/([({\[<])\s+/g, "$1")
  );
  return normalized ? `expr: ${normalized}` : null;
}

function buildBraceReturnMetadata(source, tokens, returnIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let expressionStart = -1;
  let expressionEnd = -1;

  for (let index = returnIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "symbol") {
      if (token.value === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        break;
      }
      if (token.value === "(") {
        parenDepth += 1;
      } else if (token.value === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (token.value === "[") {
        bracketDepth += 1;
      } else if (token.value === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (token.value === "{") {
        braceDepth += 1;
      } else if (token.value === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    if (expressionStart === -1) {
      expressionStart = token.start;
    }
    expressionEnd = token.end;
  }

  if (expressionStart === -1 || expressionEnd === -1) {
    return null;
  }

  const normalized = normalizeExpressionText(source.slice(expressionStart, expressionEnd));

  return normalized ? `expr: ${normalized}` : null;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  detectLanguage,
  instrumentSource,
};
