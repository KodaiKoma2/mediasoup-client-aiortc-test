# MediaSoup SFU Server Test

このプロジェクトは、MediaSoupを使用したWebRTCベースのビデオストリーミングシステムを実装したものです。複数のRTSPカメラフィードをソースとして、Webベースのコンシューマークライアントで表示する機能を提供します。

## プロジェクト構成

プロジェクトは以下の3つの主要コンポーネントで構成されています：

1. **MediaSoup Client (RTSPソース)**
   - `mediasoup-client-aiortc/` に配置
   - 複数のRTSPカメラフィードに接続可能
   - 各カメラのストリームを個別のプロデューサーとしてSFUサーバーに送信
   - カメラごとに独立したトランスポートを管理

2. **MediaSoup SFU Server**
   - `mediasoup_sfu/` に配置
   - WebRTCシグナリングとメディアルーティングを処理
   - 複数のプロデューサーとコンシューマーのトランスポートを管理
   - 各カメラストリームを個別に識別して管理

3. **Web Consumer Client**
   - `consumer-app/` に配置
   - ReactベースのWebアプリケーション
   - 複数のカメラストリームを選択して表示可能
   - 各カメラストリームを個別のコンシューマーとして管理

## 必要条件

- Node.js (v18以上)
- Python 3.7+ (aiortc用)
- 複数のRTSPカメラまたはRTSPストリームソース
- コンポーネント間のネットワークアクセス
- 十分なネットワーク帯域幅（複数ストリームの同時配信に対応）

## 環境変数

### MediaSoup Client (RTSPソース)
```env
# カメラ1の設定
RTSP_URL_1=rtsp://username:password@camera-ip-1/stream1
# カメラ2の設定
RTSP_URL_2=rtsp://username:password@camera-ip-2/stream1
# 必要に応じて追加のカメラ設定
# RTSP_URL_3=rtsp://username:password@camera-ip-3/stream1

SFU_HOST=10.0.0.52
SFU_PORT=3000
```

### SFU Server
```env
ANNOUNCED_IP=10.0.0.52
PORT=3000
# 複数ストリーム対応のための設定
MAX_PRODUCERS=10  # 最大プロデューサー数
```

### Web Consumer Client
```env
SFU_HOST=localhost
SFU_PORT=3000
```

## セットアップと実行

1. **SFUサーバーの起動**
   ```bash
   cd mediasoup_sfu
   npm install
   npm start
   ```

2. **RTSPソースクライアントの起動**
   ```bash
   cd mediasoup-client-aiortc
   npm install
   npm start
   ```

3. **Webコンシューマークライアントの起動**
   ```bash
   cd consumer-app
   npm install
   npm start
   ```

## 機能

- 複数のRTSPカメラからの同時ストリーミング
- 各カメラストリームの個別管理
- リアルタイムビデオ配信
- Webベースのビデオプレーヤー（複数ストリーム対応）
- ICE/DTLS接続処理
- トランスポート状態の監視
- プロデューサー/コンシューマー管理
- カメラストリームの動的な追加/削除

## 技術的詳細

### MediaSoup設定
- VP8ビデオコーデックを使用
- UDPとTCPトランスポートの両方をサポート
- セキュアなメディアトランスポートのためのICE/DTLSを実装
- WebSocketによるWebRTCシグナリング処理
- 複数ストリームの同時処理に対応

### WebRTC機能
- ICE候補の収集
- DTLSパラメータのネゴシエーション
- RTP/RTCP処理
- メディアトラック管理
- 複数ストリームの個別制御

## トラブルシューティング

1. **接続の問題**
   - コンポーネント間のネットワーク接続を確認
   - ファイアウォール設定を確認
   - 環境変数のIPアドレスが正しいことを確認
   - ネットワーク帯域幅が十分か確認

2. **ビデオストリーミングの問題**
   - 各RTSPストリームがアクセス可能か確認
   - SFUサーバーのログでトランスポートエラーを確認
   - WebRTC接続状態を監視
   - 個別のカメラストリームの状態を確認

3. **Webクライアントの問題**
   - ブラウザのコンソールでエラーを確認
   - WebSocket接続状態を確認
   - CORS設定が適切か確認
   - 複数ストリームの表示に問題がないか確認
