"use strict";

const {
  createMarkerTransformer,
  escapeDoubleQuotedString,
  extractTrailingIdentifier,
  splitArguments,
  stripDefaultValue,
} = require("./common");

function quoteCsharpString(value) {
  return `"${escapeDoubleQuotedString(value)}"`;
}

function getCsharpArgumentExpressions(argumentText) {
  return splitArguments(argumentText).map((argument) => {
    const normalized = stripDefaultValue(argument).replace(/\.\.\./g, "").trim();
    const identifier = extractTrailingIdentifier(normalized);
    return identifier ? `System.Convert.ToString(${identifier})` : quoteCsharpString("<unknown>");
  });
}

function buildCsharpStartStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func}(`;
  const suffix = ") start";
  const expressions = getCsharpArgumentExpressions(marker.metadata.args || "");

  if (expressions.length === 0) {
    return `System.Console.WriteLine("${escapeDoubleQuotedString(`${prefix}${suffix}`)}");`;
  }

  return `System.Console.WriteLine("${escapeDoubleQuotedString(prefix)}" + string.Join(", ", new[] { ${expressions.join(", ")} }) + "${escapeDoubleQuotedString(suffix)}");`;
}

function buildCsharpValueExpression(expressionText) {
  return `System.Convert.ToString(${expressionText})`;
}

function buildCsharpBlockStatement(marker, action) {
  const kind = marker.markerName.slice(action === "block-start" ? "START_".length : "END_".length);
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} ${action}(${kind}`;
  if (!marker.metadata.expr) {
    return `System.Console.WriteLine("${escapeDoubleQuotedString(`${prefix})`)}");`;
  }
  return `System.Console.WriteLine("${escapeDoubleQuotedString(`${prefix} `)}" + ${buildCsharpValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

function buildCsharpReturnStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} return`;
  if (!marker.metadata.expr) {
    return `System.Console.WriteLine("${escapeDoubleQuotedString(prefix)}");`;
  }
  return `System.Console.WriteLine("${escapeDoubleQuotedString(`${prefix}(`)}" + ${buildCsharpValueExpression(marker.metadata.expr)} + "${escapeDoubleQuotedString(")")}");`;
}

const transformCsharpMarkers = createMarkerTransformer(
  (marker) => {
    if (marker.markerName === "START_FUNC") {
      return buildCsharpStartStatement(marker);
    }
    if (marker.markerName === "RETURN_FUNC") {
      return buildCsharpReturnStatement(marker);
    }
    if (marker.markerName.startsWith("START_")) {
      return buildCsharpBlockStatement(marker, "block-start");
    }
    if (marker.markerName.startsWith("END_") && marker.markerName !== "END_FUNC") {
      return buildCsharpBlockStatement(marker, "block-end");
    }
    return `System.Console.WriteLine("${escapeDoubleQuotedString(marker.message)}");`;
  }
);

module.exports = {
  transformCsharpMarkers,
};
