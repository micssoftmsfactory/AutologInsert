"use strict";

const {
  createMarkerTransformer,
  escapeSingleQuotedString,
  extractPhpVariable,
  splitArguments,
  stripDefaultValue,
} = require("./common");

function quotePhpString(value) {
  return `'${escapeSingleQuotedString(value)}'`;
}

function getPhpArgumentExpressions(argumentText) {
  return splitArguments(argumentText).map((argument) => {
    const normalized = stripDefaultValue(argument)
      .replace(/^\.\.\./, "")
      .replace(/^&/, "")
      .trim();
    const variable = extractPhpVariable(normalized);
    return variable ? `var_export(${variable}, true)` : quotePhpString("<unknown>");
  });
}

function buildPhpStartStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func}(`;
  const suffix = ") start";
  const expressions = getPhpArgumentExpressions(marker.metadata.args || "");

  if (expressions.length === 0) {
    return `error_log(${quotePhpString(`${prefix}${suffix}`)});`;
  }

  return `error_log(${quotePhpString(prefix)} . implode(', ', [${expressions.join(", ")}]) . ${quotePhpString(suffix)});`;
}

function buildPhpValueExpression(expressionText) {
  return `var_export(${expressionText}, true)`;
}

function buildPhpBlockStatement(marker, action) {
  const kind = marker.markerName.slice(action === "block-start" ? "START_".length : "END_".length);
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} ${action}(${kind}`;
  if (!marker.metadata.expr) {
    return `error_log(${quotePhpString(`${prefix})`)});`;
  }
  return `error_log(${quotePhpString(`${prefix} `)} . ${buildPhpValueExpression(marker.metadata.expr)} . ${quotePhpString(")")});`;
}

function buildPhpReturnStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} return`;
  if (!marker.metadata.expr) {
    return `error_log(${quotePhpString(prefix)});`;
  }
  return `error_log(${quotePhpString(`${prefix}(`)} . ${buildPhpValueExpression(marker.metadata.expr)} . ${quotePhpString(")")});`;
}

const transformPhpMarkers = createMarkerTransformer(
  (marker) => {
    if (marker.markerName === "START_FUNC") {
      return buildPhpStartStatement(marker);
    }
    if (marker.markerName === "RETURN_FUNC") {
      return buildPhpReturnStatement(marker);
    }
    if (marker.markerName.startsWith("START_")) {
      return buildPhpBlockStatement(marker, "block-start");
    }
    if (marker.markerName.startsWith("END_") && marker.markerName !== "END_FUNC") {
      return buildPhpBlockStatement(marker, "block-end");
    }
    return `error_log('${escapeSingleQuotedString(marker.message)}');`;
  }
);

module.exports = {
  transformPhpMarkers,
};
