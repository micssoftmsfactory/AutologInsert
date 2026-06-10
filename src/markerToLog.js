"use strict";

const { transformCMarkers } = require("./marker-loggers/c");
const { transformCppMarkers } = require("./marker-loggers/cpp");
const { transformCsharpMarkers } = require("./marker-loggers/csharp");
const { transformJavaMarkers } = require("./marker-loggers/java");
const { transformJavascriptMarkers } = require("./marker-loggers/javascript");
const { transformPhpMarkers } = require("./marker-loggers/php");

function transformSourceMarkers(source, language) {
  switch (language) {
    case "c":
      return transformCMarkers(source);
    case "cpp":
      return transformCppMarkers(source);
    case "csharp":
      return transformCsharpMarkers(source);
    case "java":
      return transformJavaMarkers(source);
    case "javascript":
      return transformJavascriptMarkers(source);
    case "php":
      return transformPhpMarkers(source);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

module.exports = {
  transformSourceMarkers,
};
