# AutologInsert Node

AST-based Node.js CLI for inserting Autolog markers into source code.

This tool reads source code, detects functions and control-flow blocks, and inserts markers such as `//$$START_FUNC$$`, `//$$END_IF$$`, and `//$$RETURN_FUNC$$`.

## Supported languages

- C
- C++
- C#
- Java
- JavaScript
- PHP

## Requirements

- Node.js `>= 24`

## Install

```bash
npm install
```

## Usage

```bash
node ./src/cli.js [options] [source-file]
```

Options:

- `-i <file>`: input file. Defaults to stdin.
- `-o <file>`: output file. Defaults to stdout.
- `-c`: treat input as C.
- `-cpp`: treat input as C++.
- `-csharp` or `-cs`: treat input as C#.
- `-java`: treat input as Java.
- `-javascript` or `-js`: treat input as JavaScript.
- `-php`: treat input as PHP.
- `-VC`: alias of `-c`.
- `-h`, `-help`, `--help`: show help.

If no language flag is given, the CLI tries to detect the language from the file extension.

## Examples

Instrument a JavaScript file and write the result to stdout:

```bash
node ./src/cli.js -javascript ./example.js
```

Instrument a PHP file and save the output:

```bash
node ./src/cli.js -php -i ./input.php -o ./output.php
```

Pipe input through stdin:

```bash
Get-Content .\input.java | node .\src\cli.js -java > output.java
```

## Verification

You can verify the behavior of Autolog on the following site:

- https://www.mics-soft.jp/autolog/

## Notes

- C input currently uses the C++ tree-sitter grammar as a fallback.
- C# currently uses a token-based fallback path instead of tree-sitter.
- The tool writes warnings to stderr when a fallback path is used.
- `package.json` is marked `"private": true`, so this repository is intended for GitHub publication, not direct npm publication in its current form.

## Repository contents

- [src/cli.js](./src/cli.js): command line entry point
- [src/instrument.js](./src/instrument.js): language detection and instrumentation logic

## License

MIT. See [LICENSE](./LICENSE).
