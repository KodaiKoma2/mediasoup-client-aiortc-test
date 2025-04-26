# MediaSoup Client AIORTC Test

このプロジェクトは、MediaSoupを使用したWebRTCベースのビデオストリーミングシステムを実装したものです。RTSPカメラフィードをソースとして、Webベースのコンシューマークライアントで表示する機能を提供します。

## プロジェクト構成

プロジェクトは以下の3つの主要コンポーネントで構成されています：

1. **MediaSoup Client (RTSPソース)**
   - `mediasoup-client-aiortc/` に配置
   - RTSPカメラフィードに接続
   - SFUサーバーにビデオをストリーミング

2. **MediaSoup SFU Server**
   - `mediasoup_sfu/` に配置
   - WebRTCシグナリングとメディアルーティングを処理
   - プロデューサーとコンシューマーのトランスポートを管理

3. **Web Consumer Client**
   - `consumer-app/` に配置
   - ReactベースのWebアプリケーション
   - SFUサーバーからのビデオストリームを表示

## 必要条件

- Node.js (v14以上)
- Python 3.7+ (aiortc用)
- RTSPカメラまたはRTSPストリームソース
- コンポーネント間のネットワークアクセス

## 環境変数

### MediaSoup Client (RTSPソース)
```env
RTSP_URL=rtsp://username:password@camera-ip/stream1
SFU_HOST=10.0.0.52
SFU_PORT=3000
```

### SFU Server
```env
ANNOUNCED_IP=10.0.0.52
PORT=3000
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

- RTSPからWebRTCへのストリーミング
- リアルタイムビデオ配信
- Webベースのビデオプレーヤー
- ICE/DTLS接続処理
- トランスポート状態の監視
- プロデューサー/コンシューマー管理

## 技術的詳細

### MediaSoup設定
- VP8ビデオコーデックを使用
- UDPとTCPトランスポートの両方をサポート
- セキュアなメディアトランスポートのためのICE/DTLSを実装
- WebSocketによるWebRTCシグナリング処理

### WebRTC機能
- ICE候補の収集
- DTLSパラメータのネゴシエーション
- RTP/RTCP処理
- メディアトラック管理

## トラブルシューティング

1. **接続の問題**
   - コンポーネント間のネットワーク接続を確認
   - ファイアウォール設定を確認
   - 環境変数のIPアドレスが正しいことを確認

2. **ビデオストリーミングの問題**
   - RTSPストリームがアクセス可能か確認
   - SFUサーバーのログでトランスポートエラーを確認
   - WebRTC接続状態を監視

3. **Webクライアントの問題**
   - ブラウザのコンソールでエラーを確認
   - WebSocket接続状態を確認
   - CORS設定が適切か確認

## ライセンス

[ライセンス情報を追加してください] 