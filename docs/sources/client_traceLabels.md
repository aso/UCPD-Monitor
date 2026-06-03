# client/src/data/traceLabels.ts

## 役割
USB-PD トレース解析で使う表示ラベル辞書を集約したリソースモジュール。

## 主な責務
- parser/UI で使うトレース種別名の集中管理
- firmware/XML 由来の PE_STATE 名オーバーライド
- 表示用方向語彙と処理用方向語彙の分離

## 主要エクスポート
- `PE_STATE_OVERRIDES`
  - PE_STATE インデックスに対する優先表示名
- `CPD_TRACE_EVENT`
  - 低レイヤ trace code の表示名（`0x01=IN`, `0x02=OUT`）
- `CPD_PACKET_DIR`
  - PD 処理方向の正規化辞書（`SRC→SNK` / `SNK→SRC`）
- `CPD_RECORD_TYPE`
  - CPD レコード種別の論理分類（`PD_MSG`, `ASCII_LOG`, `CAD_EVENT`, `PRL` など）
- `MSG_TYPE_CTRL` / `MSG_TYPE_DATA` / `MSG_TYPE_EXT`
  - USB-PD Header msgType の名前解決辞書

## 3.2.7 時点の要点
- `IN/OUT` 表示要件に対応しつつ、PD ロジック側は `CPD_PACKET_DIR` で方向解釈を維持
- parser 直書き文字列を本ファイルへ分離し、辞書差し替えを容易化
- 未知値は parser 側でフォールバック表示（例: `PE_STATE[0x..]`）
