# client/src/store/appStore.js

## 役割
**Zustand** で実装された、アプリ全体の状態管理ハブ。

## 主な責務
- **グローバル状態管理**: トポロジー、接続状態、解析済みデータを単一の状態ソースとして保持
- **トポロジー状態管理**: USB-PD 接続状態を追跡
    - **Source/Sink Capabilities**: PDO/RDO と各種プロトコル能力
    - **eMarker 情報**: ケーブル定格、EPR 対応、アクティブ状態
    - **接続イベント**: ATTACHED/DETACHED、ロールスワップ
- **データ処理**: `pd_parser.ts` と連携して受信フレームを反映
- **状態遷移**: `applyFrameToTopo` による純粋関数ベースの状態機械
- **測定状態管理**: ADC ストリームのサンプルリングバッファ、稼働フラグ、monitor phase、メータースケールを管理

## 主要データ構造
- `INITIAL_TOPOLOGY`: 接続の初期空状態（Source/Sink/eMarker/Cable など）
- `applyFrameToTopo(topo, frame)`: レコード種別に応じたトポロジー遷移の中核関数
- `measureMonitor`: ADC Stream UI のリンク状態（`idle` / `awaiting-ack` / `awaiting-sample` / `streaming` / `error`）
- `measureScale`: メーター上限スケール（`maxVbusMv`, `maxIbusMa`）。Source PDO から自動導出

## 主な特徴
- **リアクティブ更新**: 購読コンポーネントは状態変更時に自動再描画
- **リプレイ対応**: `.cpd` の履歴フレームをライブと同じ状態遷移ロジックで再適用可能

## 3.2.7 時点の要点
- ファイルリプレイ時は `DETACHED` で即全消去せず最終状態を保持（事後解析向け）。ライブ時は従来どおり `DETACHED` でリセット
- MeasurePanel の表示スケールは `topology.measureScale` を使用し、観測 min/max とは独立

