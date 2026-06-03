# client/src/data/pdPeStates.ts

## 役割
USB PD Policy Engine 状態名の参照辞書を提供するデータモジュール。

## 主な責務
- **状態辞書**: USB PD Rev 3.2 の Policy Engine 名称を `PE_STATES` として保持
- **分類情報**: state ごとに group / role / section を保持
- **参照 API**: 名前検索・グループ集約に使える補助関数を提供

## 主な機能
- **仕様参照の明示**: USB PD Rev 3.2 Table 8.157 ベース
- **ロジック分離**: 解析ロジックと状態名称データを分離

## 注意点
- 本ファイルは SOP 種別辞書ではない
- 画面表示で使う PE_STATE 名の最終優先は `traceLabels.ts` の `PE_STATE_OVERRIDES`