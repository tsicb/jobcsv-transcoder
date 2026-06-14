# CSVエンコード・デコード変換ツール

GitHub Pagesで公開できる静的ブラウザアプリです。
求人CSVをアップロードし、`data/transform-config.json` の変換設定と `data/masters.json` のマスタに基づいて、コード→値、または値→コードの変換を行います。

## ファイル構成

```text
index.html
style.css
app.js
data/
  masters.json
  transform-config.json
source/
  master.csv
  transform_mapping.csv
tools/
  build_data.py
```

## 使い方

1. このフォルダ内のファイルをGitHubリポジトリに配置します。
2. GitHub Pagesを有効化します。
3. ブラウザで公開URLを開きます。
4. 入力CSVをアップロードします。
5. デコードまたはエンコードを選択します。
6. 上書きまたは変換後列追加を選択します。
7. 変換済CSVをダウンロードします。

## 仕様メモ

- 対象外列はそのまま出力します。
- デコード時は `<BR>` を改行に変換します。
- エンコード時は改行を `<BR>` に変換します。
- 複数値列は `::` で分割し、個別に変換して `::` で再結合します。
- 未変換値は元値を残し、画面上に注意一覧を表示します。
- 市区町村は、県コード列と市区町村コード列をセットで処理します。
- 市区町村のデコード出力は、県列が都道府県名、市区町村列が市区町村名です。
- 市区町村のエンコード出力は、県列が都道府県コード、市区町村列が市区町村コードです。
- 駅名エンコードは、完全一致または一意一致のみ自動変換します。複数候補は未変換にします。
- Shift_JIS出力には `encoding-japanese` をCDNから読み込みます。

## マスタを更新する場合

`source/master.csv` と `source/transform_mapping.csv` を更新し、ローカルで以下を実行してください。

```bash
python tools/build_data.py
```

生成された `data/masters.json` と `data/transform-config.json` をコミットしてください。

## 注意

- `encoding-japanese` は以下のCDNを利用しています。
  - `https://cdn.jsdelivr.net/npm/encoding-japanese@2.2.0/encoding.min.js`
- ネットワーク制限でCDNが読めない環境では、Shift_JIS出力ができません。その場合は同ファイルをダウンロードしてリポジトリ内に同梱し、`index.html` のscript参照先をローカルファイルに変更してください。
