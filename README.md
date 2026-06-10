## Related Project

Visualize generated logs with mklog2seq:

https://github.com/micssoftmsfactory/mklog2seq

# AutologInsert Node

ソースコードに Autolog マーカーを挿入するための、AST ベースの Node.js CLI です。

このツールはソースコードを読み取り、関数や制御フローブロックを検出して、`//$$START_FUNC$$`、`//$$END_IF$$`、`//$$RETURN_FUNC$$` のようなマーカーを挿入します。

## 対応言語

- C
- C++
- C#
- Java
- JavaScript
- PHP

## 動作要件

- Node.js `>= 24`

## インストール

```bash
npm install
```

## 使い方

```bash
node ./src/cli.js [options] [source-file]
```

オプション:

- `-i <file>`: 入力ファイルを指定します。省略時は標準入力です。
- `-o <file>`: 出力ファイルを指定します。省略時は標準出力です。
- `-c`: 入力を C として扱います。
- `-cpp`: 入力を C++ として扱います。
- `-csharp` または `-cs`: 入力を C# として扱います。
- `-java`: 入力を Java として扱います。
- `-javascript` または `-js`: 入力を JavaScript として扱います。
- `-php`: 入力を PHP として扱います。
- `-VC`: `-c` の別名です。
- `-h`, `-help`, `--help`: ヘルプを表示します。

言語指定のフラグを省略した場合は、CLI がファイル拡張子から言語を判定します。

## 使用例

JavaScript ファイルを変換して標準出力へ出力する例:

```bash
node ./src/cli.js -javascript ./example.js
```

PHP ファイルを変換して保存する例:

```bash
node ./src/cli.js -php -i ./input.php -o ./output.php
```

標準入力から受け取る例:

```bash
Get-Content .\input.java | node .\src\cli.js -java > output.java
```

## 動作確認

以下のサイトで Autolog の動作を確認できます。

- https://www.mics-soft.jp/autolog/

## 注意事項

- C の入力は現在、フォールバックとして C++ の tree-sitter grammar を使用します。
- C# は現在、tree-sitter ではなくトークンベースのフォールバック処理を使用します。
- フォールバック処理が使われた場合、警告は標準エラー出力へ出力されます。
- `package.json` には `"private": true` が設定されているため、現状は npm 公開ではなく GitHub 公開を前提としています。

## リポジトリ構成

- [src/cli.js](./src/cli.js): コマンドラインのエントリーポイント
- [src/instrument.js](./src/instrument.js): 言語判定とマーカー挿入の実装

## ライセンス

MIT ライセンスです。詳細は [LICENSE](./LICENSE) を参照してください。
