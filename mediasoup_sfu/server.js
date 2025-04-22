import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createWorker } from 'mediasoup';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const init = async () => {
    const worker = await createWorker({
        logLevel: 'warn',
    });

    console.log('Worker created');

    const mediaCodecs = [
        {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {
                xGoogleStartBitrate: 1000,
            },
        },
    ];

    const router = await worker.createRouter({
        mediaCodecs,
    });
    console.log('Router created');

    // WebSocket connection handling
    wss.on('connection', (ws) => {
        console.log('Client connected');

        ws.on('message', async (message) => {
            const data = JSON.parse(message);

            if (data.event === 'getRtpCapabilities') {
                try {
                    const rtpCapabilities = router.rtpCapabilities;
                    console.log('Sending RTP Capabilities:', rtpCapabilities);
                    ws.send(JSON.stringify({ event: 'getRtpCapabilities', rtpCapabilities }));
                } catch (error) {
                    console.error('Error getting RTP Capabilities:', error);
                    ws.send(JSON.stringify({ event: 'getRtpCapabilities', error: error.message }));
                }
            } else if (data.event === 'createProducerTransport') {
                try {
                    const transport = await router.createWebRtcTransport({
                        listenIps: [{ ip: '0.0.0.0', announcedIp: null }], // Replace with your public IP if needed
                        enableUdp: true,
                        enableTcp: true,
                        preferUdp: true,
                    });

                    console.log('Transport created:', transport.id);

                    ws.send(JSON.stringify({
                        event: 'producerTransportCreated',
                        transport: {
                            id: transport.id,
                            iceParameters: transport.iceParameters,
                            iceCandidates: transport.iceCandidates,
                            dtlsParameters: transport.dtlsParameters,
                        }
                    }));

                    // Handle DTLS parameters from the client
                    ws.on('message', async (message) => {
                        const transportData = JSON.parse(message);
                        if (transportData.event === 'connectProducerTransport') {
                            try {
                                await transport.connect({ dtlsParameters: transportData.dtlsParameters });
                                console.log('Transport connected:', transport.id);
                                ws.send(JSON.stringify({ event: 'producerTransportConnected', status: 'connected' }));
                            } catch (error) {
                                console.error('Error connecting transport:', error);
                                ws.send(JSON.stringify({ event: 'producerTransportConnected', error: error.message }));
                            }
                        } else if (transportData.event === 'produce') {
                            try {
                                console.log(transportData.transportData)
                                const producer = await transport.produce({
                                    kind: transportData.transportData.kind, 
                                    rtpParameters: transportData.transportData.rtpParameters, 
                                    appData: transportData.transportData.appData
                                })
                                ws.send(JSON.stringify({ event: 'produced', id: producer.id }))
                            } catch (error) {
                                console.log("Error producing: ", error)
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error creating transport:', error);
                    ws.send(JSON.stringify({ event: 'createTransport', error: error.message }));
                }
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
        });
    });
};

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Initialize mediasoup worker and router
init().catch((error) => {
    console.error('Error initializing mediasoup:', error);
});