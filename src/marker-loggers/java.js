"use strict";

const {
  createMarkerTransformer,
  escapeDoubleQuotedString,
  extractTrailingIdentifier,
  splitArguments,
  stripDefaultValue,
} = require("./common");

function quoteJavaString(value) {
  return `"${escapeDoubleQuotedString(value)}"`;
}

function getJavaArgumentExpressions(argumentText) {
  return splitArguments(argumentText).map((argument) => {
    const normalized = stripDefaultValue(argument).replace(/\.\.\./g, "").trim();
    const identifier = extractTrailingIdentifier(normalized);
    return identifier ? `String.valueOf(${identifier})` : quoteJavaString("<unknown>");
  });
}

function buildJavaStartStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func}(`;
  const suffix = ") start";
  const expressions = getJavaArgumentExpressions(marker.metadata.args || "");

  if (expressions.length === 0) {
    return `System.out.println("${escapeDoubleQuotedString(`${prefix}${suffix}`)}");`;
  }

  return `System.out.println("${escapeDoubleQuotedString(prefix)}" + String.join(", ", new String[] { ${expressions.join(", ")} }) + "${escapeDoubleQuotedString(suffix)}");`;
}

function buildJavaValueExpression(expressionText) {
  return `String.valueOf(${expressionText})`;
}

function buildJavaBlockStatement(marker, action) {
  const kind = marker.markerName.slice(action === "block-start" ? "START_".length : "END_".length);
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} ${action}(${kind}`;
  if (!marker.metadata.expr) {
    return `System.out.println("${escapeDoubleQuotedString(`${prefix})`)}");`;
  }
  return `System.out.println("${escapeDoubleQuotedString(`${prefix} `)}" + ${buildJavaValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

function buildJavaReturnStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} return`;
  if (!marker.metadata.expr) {
    return `System.out.println("${escapeDoubleQuotedString(prefix)}");`;
  }
  return `System.out.println("${escapeDoubleQuotedString(`${prefix}(`)}" + ${buildJavaValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

const transformJavaMarkers = createMarkerTransformer(
  (marker) => {
    if (marker.markerName === "START_FUNC") {
      return buildJavaStartStatement(marker);
    }
    if (marker.markerName === "RETURN_FUNC") {
      return buildJavaReturnStatement(marker);
    }
    if (marker.markerName.startsWith("START_")) {
      return buildJavaBlockStatement(marker, "block-start");
    }
    if (marker.markerName.startsWith("END_") && marker.markerName !== "END_FUNC") {
      return buildJavaBlockStatement(marker, "block-end");
    }
    return `System.out.println("${escapeDoubleQuotedString(marker.message)}");`;
  }
);

module.exports = {
  transformJavaMarkers,
};
