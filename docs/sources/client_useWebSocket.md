# client/src/hooks/useWebSocket.js

## 役割
バックエンドサーバーへの WebSocket 接続を管理し、リアルタイムデータストリーミングを処理するカスタム React フックです。

## 主な責務
- **接続管理**: バックエンドサーバー (`ws://...`) への WebSocket 接続を確立し、維持します。
- **リアルタイムデータ取り込み**: サーバーからの受信メッセージ（USB-PD フレーム、ステータス更新）をリッスンします。
- **データ処理**: `pd_parser.ts` を使用して生のフレームをデコードし、グローバルな `appStore` を即座に更新します。
- **回復力**: 接続が失われた場合に、遅延 (`RECONNECT_DELAY_MS`) を伴う自動再接続ロジックを実装します。
- **エラーロギング**: クライアントが解析できない「不明」または未デコードのパケットレコードを、`/api/log-unknown` へ POST 送信します。
- **タイムスタンプアンカリング**: 受信したフレームをスキャンし、特定の `ATTACHED` イベントと関連付けられたタイムスタンプを検出するロジックを含み、リアルタイムデータを実時間と同期させます。

## 3.2.7 時点の要点
- `MEASURE_ACK` / `MEASURE_RUNNING` / `MEASURE_SAMPLE` を受けて `measureMonitor` と `measureRunning` を更新
- `SERIAL_STATUS.connected=false` 時に `resetMeasureMonitor()` を実行
- `CPD_RECORD` 処理で `Accept` 後の `PS_RDY` 監視（480 ms）を実施
- `NOTE:` の自動時刻行（`YYYY-MM-DD HH:MM:SS`）は memo ではなく `tsAnchor` 更新として扱う

## 主要なロジック
- **`findTsAnchor(frames)`**: フレーム履歴をスキャンし、`ATTACHED` イベントの後にタイムスタンプを含む `ASCII_LOG` が続く特定のパターンを見つけることで、ハードウェアイベントを実世界の時間と相関付けることを可能にします。
- **`logUnknownRecords(records)`**: クライアントが解析できないデータがデバッグのためにサーバー上に保持されることを保証するための「ファイア・アンド・フォーゲット」メカニズムです。

