"use strict";

const {
  createMarkerTransformer,
  escapeDoubleQuotedString,
  extractTrailingIdentifier,
  splitArguments,
  stripDefaultValue,
} = require("./common");

function quoteCppString(value) {
  return `"${escapeDoubleQuotedString(value)}"`;
}

function getCppArgumentExpressions(argumentText) {
  return splitArguments(argumentText).map((argument) => {
    const normalized = stripDefaultValue(argument).replace(/\.\.\./g, "").trim();
    const identifier = extractTrailingIdentifier(normalized);
    return identifier || quoteCppString("<unknown>");
  });
}

function buildCppStartStatement(marker) {
  const prefix = `${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func}(`;
  const expressions = [quoteCppString(prefix)];

  for (const [index, argument] of getCppArgumentExpressions(marker.metadata.args || "").entries()) {
    if (index > 0) {
      expressions.push(quoteCppString(", "));
    }
    expressions.push(argument);
  }

  expressions.push(quoteCppString(") start"));
  return `std::cerr << ${expressions.join(" << ")} << std::endl;`;
}

function buildCppBlockStatement(marker, action) {
  const kind = marker.markerName.slice(action === "block-start" ? "START_".length : "END_".length);
  const expressions = [quoteCppString(`${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} ${action}(${kind}`)];

  if (marker.metadata.expr) {
    expressions.push(quoteCppString(" "));
    expressions.push(`(${marker.metadata.expr})`);
  }

  expressions.push(quoteCppString(")"));
  return `std::cerr << ${expressions.join(" << ")} << std::endl;`;
}

function buildCppReturnStatement(marker) {
  const expressions = [quoteCppString(`${marker.metadata.file}:${marker.metadata.line}:${marker.metadata.func} return`)];

  if (marker.metadata.expr) {
    expressions.push(quoteCppString("("));
    expressions.push(`(${marker.metadata.expr})`);
    expressions.push(quoteCppString(")"));
  }

  return `std::cerr << ${expressions.join(" << ")} << std::endl;`;
}

const transformCppMarkers = createMarkerTransformer(
  (marker) => {
    if (marker.markerName === "START_FUNC") {
      return buildCppStartStatement(marker);
    }
    if (marker.markerName === "RETURN_FUNC") {
      return buildCppReturnStatement(marker);
    }
    if (marker.markerName.startsWith("START_")) {
      return buildCppBlockStatement(marker, "block-start");
    }
    if (marker.markerName.startsWith("END_") && marker.markerName !== "END_FUNC") {
      return buildCppBlockStatement(marker, "block-end");
    }
    return `std::cerr << "${escapeDoubleQuotedString(marker.message)}" << std::endl;`;
  }
);

module.exports = {
  transformCppMarkers,
};
