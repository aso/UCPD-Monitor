# client/src/components/messageLogLinking.js

## 役割
MessageTable の「要求-応答」関連付けを生成するユーティリティ。

## 主な責務
- Request/EPR_Request と応答列（GoodCRC/Accept/Reject/Wait/PS_RDY）のリンク生成
- Get_* 系クエリと応答メッセージの関連付け
- GoodCRC の MsgID 妥当性チェック
- Type 表示補助（`describeTypeName`）とリンク要約文の生成

## 主要関数
- `buildContractLinks(messages)`
  - 契約シーケンスの関連を `Map` として返却
- `buildGoodCrcChecks(messages)`
  - GoodCRC と対向メッセージの MsgID 一致判定結果を返却
- `describeTypeName(typeName)`
  - Type 表示の補助ラベルを生成
- `formatLinkSummary(link)`
  - 行内の関連サマリ（`↔`, `↩`）を生成

## 3.2.7 時点の要点
- MessageTable 側の HEX/Parsed 拡張や Type 列固定化を支える補助ロジックとして利用
- Query 応答の代替（`Not_Supported`, `Reject`, `Wait`）も関連付け対象
