"use strict";

const {
  createMarkerTransformer,
  escapeDoubleQuotedString,
  splitArguments,
  stripDefaultValue,
} = require("./common");

function quoteJavascriptString(value) {
  return `"${escapeDoubleQuotedString(value)}"`;
}

function isCompilableJavascriptExpression(expressionText) {
  try {
    // Syntax check only. The generated function is not executed here.
    // eslint-disable-next-line no-new-func
    new Function(`return (${expressionText});`);
    return true;
  } catch {
    return false;
  }
}

function stripJavascriptDestructuredDefaults(patternText) {
  const input = String(patternText || "");
  let result = "";
  let index = 0;
  let stringQuote = null;
  let escaped = false;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let templateDepth = 0;

  while (index < input.length) {
    const char = input[index];

    if (stringQuote) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      stringQuote = char;
      result += char;
      index += 1;
      continue;
    }

    if (char === "(") {
      roundDepth += 1;
      result += char;
      index += 1;
      continue;
    }
    if (char === ")") {
      roundDepth = Math.max(0, roundDepth - 1);
      result += char;
      index += 1;
      continue;
    }
    if (char === "[") {
      squareDepth += 1;
      result += char;
      index += 1;
      continue;
    }
    if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      result += char;
      index += 1;
      continue;
    }
    if (char === "{") {
      curlyDepth += 1;
      result += char;
      index += 1;
      continue;
    }
    if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      result += char;
      index += 1;
      continue;
    }
    if (char === "<") {
      templateDepth += 1;
      result += char;
      index += 1;
      continue;
    }
    if (char === ">") {
      templateDepth = Math.max(0, templateDepth - 1);
      result += char;
      index += 1;
      continue;
    }

    if (char === "=") {
      index += 1;

      while (index < input.length) {
        const current = input[index];

        if (stringQuote) {
          if (escaped) {
            escaped = false;
          } else if (current === "\\") {
            escaped = true;
          } else if (current === stringQuote) {
            stringQuote = null;
          }
          index += 1;
          continue;
        }

        if (current === "\"" || current === "'" || current === "`") {
          stringQuote = current;
          index += 1;
          continue;
        }

        if (current === "(") {
          roundDepth += 1;
          index += 1;
          continue;
        }
        if (current === ")" && roundDepth > 0) {
          roundDepth -= 1;
          index += 1;
          continue;
        }
        if (current === "[") {
          squareDepth += 1;
          index += 1;
          continue;
        }
        if (current === "]" && squareDepth > 0) {
          squareDepth -= 1;
          index += 1;
          continue;
        }
        if (current === "{") {
          curlyDepth += 1;
          index += 1;
          continue;
        }
        if (current === "}" && curlyDepth > 0) {
          curlyDepth -= 1;
          index += 1;
          continue;
        }
        if (current === "<") {
          templateDepth += 1;
          index += 1;
          continue;
        }
        if (current === ">" && templateDepth > 0) {
          templateDepth -= 1;
          index += 1;
          continue;
        }

        if (roundDepth === 0 && squareDepth === 0 && curlyDepth === 1 && templateDepth === 0 && (current === "," || current === "}")) {
          if (current === ",") {
            result += ",";
            index += 1;
          }
          break;
        }

        if (roundDepth === 0 && squareDepth === 1 && curlyDepth === 0 && templateDepth === 0 && (current === "," || current === "]")) {
          if (current === ",") {
            result += ",";
            index += 1;
          }
          break;
        }

        index += 1;
      }

      continue;
    }

    result += char;
    index += 1;
  }

  return result
    .replace(/,\s*(\}|\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildJavascriptRuntimeArgumentExpression(argumentText) {
  const normalized = stripDefaultValue(argumentText).replace(/^\.\.\./, "").trim();

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized)) {
    return normalized;
  }

  if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
    const expression = stripJavascriptDestructuredDefaults(normalized);
    if (expression && isCompilableJavascriptExpression(expression)) {
      return `JSON.stringify(${expression})`;
    }
    return quoteJavascriptString("<destructured>");
  }

  return quoteJavascriptString("<destructured>");
}

function getJavascriptArgumentExpressions(argumentText) {
  return splitArguments(argumentText).map(buildJavascriptRuntimeArgumentExpression);
}

function buildJavascriptStartStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func}(`;
  const suffix = ") start";
  const expressions = getJavascriptArgumentExpressions(marker.metadata.args || "");

  if (expressions.length === 0) {
    return `console.log("${escapeDoubleQuotedString(`${prefix}${suffix}`)}");`;
  }

  return `console.log("${escapeDoubleQuotedString(prefix)}" + [${expressions.join(", ")}].join(", ") + "${escapeDoubleQuotedString(suffix)}");`;
}

function buildJavascriptValueExpression(expressionText) {
  return `String(${expressionText})`;
}

function buildJavascriptBlockStatement(marker, action) {
  const kind = marker.markerName.slice(action === "block-start" ? "START_".length : "END_".length);
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} ${action}(${kind}`;
  if (!marker.metadata.expr) {
    return `console.log("${escapeDoubleQuotedString(`${prefix})`)}");`;
  }
  return `console.log("${escapeDoubleQuotedString(`${prefix} `)}" + ${buildJavascriptValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

function buildJavascriptReturnStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} return`;
  if (!marker.metadata.expr) {
    return `console.log("${escapeDoubleQuotedString(prefix)}");`;
  }
  if (!isCompilableJavascriptExpression(marker.metadata.expr)) {
    return `console.log("${escapeDoubleQuotedString(`${prefix}(${marker.metadata.expr})`)}");`;
  }
  return `console.log("${escapeDoubleQuotedString(`${prefix}(`)}" + ${buildJavascriptValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

const transformJavascriptMarkers = createMarkerTransformer(
  (marker) => {
    if (marker.markerName === "START_FUNC") {
      return buildJavascriptStartStatement(marker);
    }
    if (marker.markerName === "RETURN_FUNC") {
      return buildJavascriptReturnStatement(marker);
    }
    if (marker.markerName.startsWith("START_")) {
      return buildJavascriptBlockStatement(marker, "block-start");
    }
    if (marker.markerName.startsWith("END_") && marker.markerName !== "END_FUNC") {
      return buildJavascriptBlockStatement(marker, "block-end");
    }
    return `console.log("${escapeDoubleQuotedString(marker.message)}");`;
  }
);

module.exports = {
  transformJavascriptMarkers,
};
