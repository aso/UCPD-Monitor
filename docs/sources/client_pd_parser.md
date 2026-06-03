# client/src/parsers/pd_parser.ts

## 役割
`.cpd` ファイルおよび生の USB-PD フレームのバイナリ構造をデコードする、TypeScript ベースのパーサーです。

## 主な責務
- **バイナリ解析**: `.cpd` (CPD) バイナリレコードの複雑で多層的な構造をデコードします。
- **フォーマット準拠**: USB-PD Rev 3.2 仕様に準拠した解析ロジックを実装します。
- **データ変換**: 生の `ArrayBuffer` データを、高レベルで型付けされた JavaScript オブジェクト（例：`Pdo`、`Rdo`、`MessageHeader`）に変換します。
- **エラー処理**: バイナリストリームの整合性（例：同期ワードやセンチネルバイトのチェック）を検証します。

## 3.2.7 時点の要点
- **文字列辞書の分離**:
	- `client/src/data/traceLabels.ts` から各種ラベルを参照
	- parser 本体に固定文字列を持たせず、辞書更新で追従可能
- **方向語彙の分離**:
	- `CPD_TRACE_EVENT` の `0x01/0x02` は表示語彙として `IN/OUT`
	- PD 処理方向は `CPD_PACKET_DIR` で `SRC→SNK` / `SNK→SRC` を維持
- **PE_STATE 解釈の整合化**:
	- `PE_STATE_OVERRIDES` により firmware/XML ベース名で表示
	- 未定義値は推測せず `PE_STATE[0x..]` 形式でフォールバック

## 主要なエントリーポイント
- `parseCpdFile(arrayBuffer)`: メモリから `.cpd` ファイル全体を解析するための主要な関数です。
- `parseRawFrame(hexStr, source)`: 16進数文字列表現から単一の USB-PD フレームを解析します。

## 解析ロジックの概要
- **同期/センチネル検証**: 各レコードが `FD FD FD FD` で始まり、`A5 A5 A5 A5` で終わることを保証します。
- **ヘッダー抽出**: 方向（Source $\to$ Sink）、タイムスタンプ、ペイロード長などのメタデータを抽出します。
- **ペイロードデコード**: 抽出された長さとタイプに基づいて、USB-PD メッセージペイロードを反復的に解析します。

## 拡張処理
- EPR Source/Sink Capabilities の chunk 継続データを考慮して PDO 配列を補正
- SCEDB / SKEDB / Status / Extended_Control の `parsedPayload` ツリーを生成
- `collectParseViolations` で USB PD 規格の主要制約違反を検出
