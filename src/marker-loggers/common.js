"use strict";

const MARKER_LINE_PATTERN = /^([ \t]*)\/\/\$\$(.*?)\$\$(\r?\n|$)/gm;
const AUTOLOG_LOG_PREFIX = "[autolog] ";

function escapeDoubleQuotedString(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function escapeSingleQuotedString(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function parseMarkerBody(markerBody) {
  const parts = String(markerBody || "").trim().split("|");
  const markerName = (parts.shift() || "").trim();
  const metadata = {};

  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1);
    metadata[key] = decodeURIComponent(value);
  }

  return { markerName, metadata };
}

function splitArguments(argumentText) {
  const input = String(argumentText || "").trim();
  if (input.length === 0) {
    return [];
  }

  const parts = [];
  let current = "";
  let stringQuote = null;
  let escaped = false;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let angleDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (stringQuote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      stringQuote = char;
      current += char;
      continue;
    }

    if (char === "(") {
      roundDepth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      roundDepth = Math.max(0, roundDepth - 1);
      current += char;
      continue;
    }
    if (char === "[") {
      squareDepth += 1;
      current += char;
      continue;
    }
    if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      current += char;
      continue;
    }
    if (char === "{") {
      curlyDepth += 1;
      current += char;
      continue;
    }
    if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      current += char;
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
      current += char;
      continue;
    }
    if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      current += char;
      continue;
    }

    if (
      char === "," &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0 &&
      angleDepth === 0
    ) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function stripDefaultValue(argumentText) {
  const input = String(argumentText || "");
  let stringQuote = null;
  let escaped = false;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let angleDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      stringQuote = char;
      continue;
    }

    if (char === "(") {
      roundDepth += 1;
      continue;
    }
    if (char === ")") {
      roundDepth = Math.max(0, roundDepth - 1);
      continue;
    }
    if (char === "[") {
      squareDepth += 1;
      continue;
    }
    if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (char === "{") {
      curlyDepth += 1;
      continue;
    }
    if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
      continue;
    }
    if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }

    if (
      char === "=" &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0 &&
      angleDepth === 0
    ) {
      return input.slice(0, index).trim();
    }
  }

  return input.trim();
}

function extractTrailingIdentifier(argumentText) {
  const match = String(argumentText || "").match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  return match ? match[1] : "";
}

function extractPhpVariable(argumentText) {
  const match = String(argumentText || "").match(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*$/);
  return match ? match[1] : "";
}

function formatBlockLabel(kind, metadata) {
  const details = [];
  if (metadata.expr) {
    details.push(metadata.expr);
  }
  if (metadata.detail) {
    details.push(metadata.detail);
  }
  if (metadata.args) {
    details.push(`args: ${metadata.args}`);
  }
  return details.length > 0 ? `${kind} ${details.join(" | ")}` : kind;
}

function buildMklog2seqMessage(markerBody) {
  return buildMklog2seqMessageFromParsed(parseMarkerBody(markerBody));
}

function buildMarkerLocationPrefix(metadata = {}) {
  const file = metadata.file || "<unknown>";
  const line = metadata.line || "0";
  const func = metadata.func || "<unknown>";
  return `${AUTOLOG_LOG_PREFIX}${file}:${line}:${func}`;
}

function buildMklog2seqMessageFromParsed({ markerName, metadata }) {
  const location = buildMarkerLocationPrefix(metadata);

  if (markerName === "START_FUNC") {
    const args = metadata.args || "";
    return `${location}(${args}) start`;
  }

  if (markerName === "RETURN_FUNC") {
    return metadata.expr
      ? `${location} return(${metadata.expr})`
      : `${location} return`;
  }

  if (markerName === "END_FUNC") {
    return `${location} end`;
  }

  return `${location} ${markerName}`;
}

function shouldEmitMarker(markerName) {
  return markerName === "START_FUNC" || markerName === "RETURN_FUNC" || markerName === "END_FUNC";
}

function createMarkerTransformer(buildStatement) {
  return function transformMarkers(source) {
    return {
      code: source.replace(
        MARKER_LINE_PATTERN,
        (match, indent, markerBody, lineEnding) => {
          const parsed = parseMarkerBody(markerBody.trim());
          if (!shouldEmitMarker(parsed.markerName)) {
            return "";
          }
          return `${buildStatement({
            markerName: parsed.markerName,
            metadata: parsed.metadata,
            message: buildMklog2seqMessageFromParsed(parsed),
          })}${lineEnding}`;
        }
      ),
      warnings: [],
    };
  };
}

module.exports = {
  AUTOLOG_LOG_PREFIX,
  buildMarkerLocationPrefix,
  buildMklog2seqMessage,
  buildMklog2seqMessageFromParsed,
  createMarkerTransformer,
  escapeDoubleQuotedString,
  escapeSingleQuotedString,
  extractPhpVariable,
  extractTrailingIdentifier,
  parseMarkerBody,
  splitArguments,
  stripDefaultValue,
  shouldEmitMarker,
};
