# ES Supporter Automatic Kun

Markdownで書いた就活ESを、一画面の入力フォームとして編集できるWebアプリです。

## 主な機能

- MarkdownからES入力フォームを自動生成
- Markdown読み込み時に、アプリ内の標準形式へ自動変換
- 文章入力欄、チェックボックス、ラジオ選択、表入力に対応
- 文字数をリアルタイム表示
- Markdownファイル読み込みと、テキスト貼り付け入力に対応
- 文字数超過や仮置き文字を検出
- Gemini APIによる文字数調整
- 編集結果をMarkdownとして保存・コピー

## Markdown形式

アプリは、読み込んだMarkdownを以下のような標準形式へ変換してからフォームを作成します。

対応しやすい元Markdownの例：

```md
## 志望理由

上限：500文字以内
設問：志望理由をご記入ください。

（回答欄）
```

以下のように、`###` 見出し、`*150文字以下*`、空の引用欄 `>` で書かれた設問も入力欄へ変換します。

```md
## 設問1｜データを用いた解決策の提案（必須）

### (1) 問題の概要と、その問題に対してどんな疑問を持ったのか
*150文字以下*

>
```

上記のような形式でも、読み込み時に `es:meta` / `es:start` 付きの入力欄へ標準化されます。

文章欄は以下の形式で定義します。

```md
<!-- es:meta id=company_reason type=textarea targetMin=490 targetMax=500 required=true ai=true tone=business -->
<!-- es:start id=company_reason limit=500 label="志望理由" -->

回答本文

<!-- es:end -->
```

選択肢は以下の形式です。

```md
<!-- es:choice id=priority_point type=radio label="最も重視するポイント" required=true -->
- [ ] 担当製品
- [x] 関連要素技術
- [ ] 勤務エリア
<!-- es:choice-end -->
```

## ローカル起動

```bash
npm install
cp .env.example .env
```

`.env` にGemini APIキーを設定します。

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

`.env.example` には実キーを書かないでください。実キーは公開されない `.env` にだけ保存します。ローカルAPIサーバーは `npm run dev` 実行時に `.env` を自動で読み込みます。

起動します。

```bash
npm run dev
```

ブラウザで表示されたViteのURLを開きます。

## GitHub Pages版について

GitHub Pagesは静的ホスティングのため、`GEMINI_API_KEY` を安全に保持できません。

そのため、Pages上ではMarkdown編集と文字数確認は利用できますが、Gemini APIによる文字数調整はローカルのAPIプロキシ付き起動時に使う想定です。APIキーをブラウザに埋め込まないことで、キー漏洩を防いでいます。

Pages上で「文字数調整」を押した場合、外部APIへは送信せず、ローカル起動が必要である旨を表示します。

公開ページに表示されるMarkdownは、個人情報を含まないデモ用サンプルです。実際のES Markdownは、ローカルでファイル読み込みするか、画面上の「Markdown貼り付け」から一時的に読み込んでください。

## 非公開にしているもの

以下は `.gitignore` で公開対象から除外しています。

- `docs/`
- `.env`
- `.env.*`
- `honsenko-es.md`
- `node_modules/`
- `dist/`
