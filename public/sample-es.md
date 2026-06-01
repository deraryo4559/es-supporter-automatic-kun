# 公開デモ用 ES 入力シート

## 1. 配属予約（マッチング）希望先

複数選択可。選択数に上限なし。

<!-- es:choice id=matching_targets type=checkbox label="配属予約希望先" required=true -->
- [x] サンプル部門A
- [ ] サンプル部門B
- [ ] サンプル部門C
- [ ] サンプル部門D
<!-- es:choice-end -->

---

## 2. 希望職務

複数選択可。

<!-- es:choice id=preferred_jobs type=checkbox label="希望職務" required=true -->
- [x] 企画
- [x] 分析
- [ ] 開発
- [ ] 改善
- [ ] 管理
<!-- es:choice-end -->

---

## 3. 志望理由

上限：500文字以内
設問：当社志望理由をご記入ください。

<!-- es:meta id=company_reason type=textarea targetMin=490 targetMax=500 required=true ai=true tone=business -->
<!-- es:start id=company_reason limit=500 label="志望理由" -->

これは公開デモ用のダミー回答です。実在する企業名、学校名、研究テーマ、選考状況、個人の経験は含めていません。このアプリは、Markdownで定義した設問をフォーム化し、文字数を見ながら回答を編集するためのものです。実際のESを扱う場合は、公開ページに表示されているサンプルではなく、手元のMarkdownファイルを読み込むか、Markdown貼り付け欄にローカルの内容を貼り付けて利用してください。APIキーや個人情報を公開ファイルに含めない運用を前提としています。

<!-- es:end -->

---

## 4. 最も重視するポイント

配属予約希望先を考えるうえで、最も重視するポイントを一つだけ選択。

<!-- es:choice id=priority_point type=radio label="最も重視するポイント" required=true -->
- [ ] 担当製品
- [x] 関連テーマ
- [ ] 勤務エリア
- [ ] 事業スケール
<!-- es:choice-end -->

---

## 5. 大学情報

<!-- es:table id=university_info label="大学情報" required=true -->
| 項目 | 回答 |
| --- | --- |
| 項目A | サンプル回答A |
| 項目B | サンプル回答B |
| 項目C | サンプル回答C |
<!-- es:table-end -->
