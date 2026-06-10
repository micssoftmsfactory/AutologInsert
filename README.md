## Related Project

Visualize generated logs with mklog2seq:

https://github.com/micssoftmsfactory/mklog2seq

# AutologInsert Node

ソースコードに Autolog マーカーを挿入するための、AST ベースの Node.js CLI です。

このツールはソースコードを読み取り、関数や制御フローブロックを検出して、`//$$START_FUNC$$`、`//$$END_IF$$`、`//$$RETURN_FUNC$$` のようなマーカーを挿入します。

各マーカーには、元ソースのファイル名・行番号・関数名が自動で埋め込まれます。関数名が取れない場合は `<anonymous>`、関数外は `<global>`、標準入力は `<stdin>` を使います。マーカー行は必ず行頭から挿入され、インデントは付けません。

入力ソースへマーカーを挿入したうえで、`mklog2seq` 向けの `start` / `return` / `end` 形式のログ出力文へ変換するモードも利用できます。変換後のログ文も行頭から出力します。

`START_FUNC` のログでは、引数名の文字列ではなく実行時の引数値を出力します。`RETURN_FUNC` は戻り値の式を出力します。`START_FUNC` / `RETURN_FUNC` / `END_FUNC` 以外のマーカーは、将来対応予定として現状は `-logs` 変換時に破棄します。C については可変な型を安全に文字列化しにくいため、現状は静的メッセージのままです。

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
- `-markers-to-logs`, `-logs`: 入力ソースへ `//$$...$$` マーカーを挿入し、その結果を `mklog2seq` 互換のログ出力文へ変換します。
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

JavaScript ファイルを `console.log(...)` ベースのログ出力コードへ変換する例:

```bash
node ./src/cli.js -javascript -logs -i ./input.js -o ./logged.js
```

生成されるマーカー例:

```js
function example(value) {
//$$START_FUNC|file=input.js|line=1|func=example|args=value$$
//$$RETURN_FUNC|file=input.js|line=3|func=example|expr=value$$
//$$END_FUNC|file=input.js|line=1|func=example|args=value$$
}
```

実際のマーカー値は、区切り文字を安全に扱うため URL エンコードされます。

`-logs` の JavaScript 出力例:

```js
function example(value) {
console.log("input.js:1:example(" + [value].join(", ") + ") start");
console.log("input.js:3:example return(" + String(value) + ")");
console.log("input.js:1:example end");
}
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
- `javascript` は、この Node.js runtime で tree-sitter の 32,767 文字制限を超える入力に対して、自動でトークンベースのフォールバック処理へ切り替えます。
- `c` / `cpp` は、この Node.js runtime で tree-sitter の 32,767 文字制限を超える入力に対して、自動でトークンベースのフォールバック処理へ切り替えます。
- `java` の tree-sitter 経路は、この Node.js runtime では 32,767 文字を超える入力で失敗することがあります。
- フォールバック処理が使われた場合、警告は標準エラー出力へ出力されます。
- `package.json` には `"private": true` が設定されているため、現状は npm 公開ではなく GitHub 公開を前提としています。

## リポジトリ構成

- [src/cli.js](./src/cli.js): コマンドラインのエントリーポイント
- [src/instrument.js](./src/instrument.js): 言語判定とマーカー挿入の実装
- [src/markerToLog.js](./src/markerToLog.js): マーカー置換モードのディスパッチ
- [src/marker-loggers/](./src/marker-loggers): `mklog2seq` 互換ログへの言語別変換

## ライセンス

MIT ライセンスです。詳細は [LICENSE](./LICENSE) を参照してください。
