#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const process = require("node:process");

const {
  SUPPORTED_LANGUAGES,
  detectLanguage,
  instrumentSource,
} = require("./instrument");

function printHelp() {
  console.log(`AutologInsert Node.js (AST-based)

Usage:
  node ./src/cli.js [options] [source-file]

Options:
  -i <file>           Input file. Defaults to stdin.
  -o <file>           Output file. Defaults to stdout.
  -c                  Treat input as C.
  -cpp                Treat input as C++.
  -csharp | -cs       Treat input as C#.
  -java               Treat input as Java.
  -javascript | -js   Treat input as JavaScript.
  -php                Treat input as PHP.
  -VC                 Alias of -c.
  -h | -help          Show this help.

Supported languages:
  ${SUPPORTED_LANGUAGES.join(", ")}
`);
}

function parseArgs(argv) {
  const options = {
    input: "stdin",
    output: "stdout",
    language: null,
    passthrough: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-i":
        index += 1;
        options.input = argv[index] ?? "stdin";
        break;
      case "-o":
        index += 1;
        options.output = argv[index] ?? "stdout";
        break;
      case "-c":
      case "-cpp":
      case "-csharp":
      case "-cs":
      case "-java":
      case "-javascript":
      case "-js":
      case "-php":
      case "-VC":
        options.language = detectLanguage({
          explicitFlag: arg,
          inputPath: options.input !== "stdin" ? options.input : null,
        });
        break;
      case "-h":
      case "-help":
      case "--help":
        options.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          options.passthrough.push(arg);
        } else if (options.input === "stdin") {
          options.input = arg;
        } else {
          options.passthrough.push(arg);
        }
        break;
    }
  }

  return options;
}

async function readInput(inputPath) {
  if (inputPath === "stdin") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return fs.readFile(inputPath, "utf8");
}

async function writeOutput(outputPath, content) {
  if (outputPath === "stdout") {
    process.stdout.write(content);
    return;
  }

  await fs.writeFile(outputPath, content, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.passthrough.length > 0) {
    console.error(
      `Ignored options: ${options.passthrough.join(", ")}`
    );
  }

  const resolvedLanguage =
    options.language ||
    detectLanguage({
      explicitFlag: null,
      inputPath: options.input !== "stdin" ? options.input : null,
    });

  if (!resolvedLanguage) {
    console.error(
      "Unable to detect the input language. Pass -c, -cpp, -csharp, -java, -javascript, or -php."
    );
    process.exitCode = 1;
    return;
  }

  const source = await readInput(options.input);
  const result = instrumentSource(source, resolvedLanguage, {
    filePath: options.input === "stdin" ? null : path.resolve(options.input),
  });

  await writeOutput(options.output, result.code);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.error(`warning: ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
