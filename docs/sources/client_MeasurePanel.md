# client/src/components/MeasurePanel.jsx

## 役割
ハードウェアから受信したリアルタイム VBUS/IBUS 測定を表示し、測定開始/停止を制御する UI コンポーネント。

## 主な責務
- **測定制御**: `MEASURE_START` / `MEASURE_STOP` を送信して計測を開始・停止
- **状態表示**: `measureMonitor.phase` と `measureRunning` による通信状態表示
- **メーター表示**: 最新 VBUS/IBUS をカードとバーで表示
- **観測値表示**: 直近サンプルの observed min/max をメタ行へ表示

## 3.2.7 時点の要点
- **Active 判定**: `measureRunning && measureMonitor.phase === 'streaming'`
- **非稼働時ダーク化**:
	- メーターカード
	- バー（トラック/フィル）
	- 数値フォント
- **レンジ表示仕様**:
	- メーター下段は観測レンジではなくスケール端（0 .. max）を表示
	- max は `topology.measureScale`（Source Capabilities 由来）を参照
- **Observed min/max 表示位置**:
	- メーター下段ではなく `FW Tick` メタ行へ表示
- **SPY モード制約**:
	- SPY 中は測定開始不可（SNK モード専用）

## 主なロジック
- **`fmtV(mv)` / `fmtA(ma)`**: 一貫した単位フォーマットのためのユーティリティ関数。
- **`handleStart` / `handleStop`**: 測定コマンド送信と monitor phase 遷移
- **ACK/サンプルタイムアウト監視**:
	- ACK timeout: 1500 ms
	- sample timeout: 2000 ms
