import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createWorker } from 'mediasoup';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active producers
const producers = new Map();

const init = async () => {
    const worker = await createWorker({
        logLevel: 'debug',
        logTags: [
            'info',
            'ice',
            'dtls',
            'rtp',
            'srtp',
            'rtcp',
        ],
        rtcMinPort: 40000,
        rtcMaxPort: 49999,
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
    // const router = await worker.createRouter();
    console.log('Router created');

    // WebSocket connection handling
    wss.on('connection', (ws) => {
        console.log('Client connected');

        ws.on('message', async (message) => {
            const data = JSON.parse(message);

            if (data.event === 'getRtpCapabilities') {
                try {
                    const rtpCapabilities = router.rtpCapabilities;
                    console.log('Sending RTP Capabilities:', rtpCapabilities.codecs);
                    ws.send(JSON.stringify({ event: 'getRtpCapabilities', rtpCapabilities }));
                } catch (error) {
                    console.error('Error getting RTP Capabilities:', error);
                    ws.send(JSON.stringify({ event: 'getRtpCapabilities', error: error.message }));
                }
            } else if (data.event === 'createProducerTransport') {
                try {
                    const producerTransport = await router.createWebRtcTransport({
                        // listenIps: [{ ip: '0.0.0.0', announcedIp: '172.20.197.163' }],
                        listenIps: [{ ip: '0.0.0.0', announcedIp: '10.0.0.52' }],
                        enableUdp: true,
                        enableTcp: true,
                        preferUdp: true,
                    });

                    console.log('Transport created:', producerTransport.id);

                    ws.send(JSON.stringify({
                        event: 'producerTransportCreated',
                        producerTransport: {
                            id: producerTransport.id,
                            iceParameters: producerTransport.iceParameters,
                            iceCandidates: producerTransport.iceCandidates,
                            dtlsParameters: producerTransport.dtlsParameters,
                        }
                    }));

                    producerTransport.on('icestatechange', (iceState) => {
                        console.log('Producer transport ICE state changed:', iceState);
                    });

                    producerTransport.on('connectionstatechange', (state) => {
                        console.log('Producer transport connection state changed:', state);
                    });

                    // Handle DTLS parameters from the client
                    ws.on('message', async (message) => {
                        const transportData = JSON.parse(message);
                        
                        if (transportData.event === 'connectProducerTransport') {
                            console.log('Received DTLS parameters:', transportData.dtlsParameters);

                            try {
                                await producerTransport.connect({ dtlsParameters: transportData.dtlsParameters });
                                console.log('Transport connected:', producerTransport.id);
                                ws.send(JSON.stringify({ event: 'producerTransportConnected', status: 'connected' }));
                            } catch (error) {
                                console.error('Error connecting transport:', error);
                                ws.send(JSON.stringify({ event: 'producerTransportConnected', error: error.message }));
                            }
                        } else if (transportData.event === 'produce') {
                            try {
                                console.log(transportData.transportData)
                                const producer = await producerTransport.produce({
                                    kind: transportData.transportData.kind, 
                                    rtpParameters: transportData.transportData.rtpParameters, 
                                    appData: transportData.transportData.appData
                                });
                                // await producer.enableTraceEvent(["rtp", "pli", 'fir', "keyframe", "nack", "sr"]);
                                // producer.on('trace', (trace) => {
                                //     console.log('Producer trace event:', trace);
                                // })
                                // Store the producer
                                console.log('Producer created:', producer.id);
                                producers.set(producer.id, producer);
                                ws.send(JSON.stringify({ event: 'produced', id: producer.id }));
                            } catch (error) {
                                console.log("Error producing: ", error);
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error creating transport:', error);
                    ws.send(JSON.stringify({ event: 'createTransport', error: error.message }));
                }
            } else if (data.event === 'createConsumerTransport') {
                try {
                    const consumerTransport = await router.createWebRtcTransport({
                        listenIps: [
                            { ip: '0.0.0.0', announcedIp: '10.0.0.52' }
                        ],
                        enableUdp: true,
                        enableTcp: true,
                        preferUdp: true,
                    });

                    consumerTransport.on('icestatechange', (iceState) => {
                        console.log('Consumer transport ICE state changed:', iceState);
                    });

                    consumerTransport.on('connectionstatechange', (state) => {
                        console.log('Consumer transport connection state changed:', state);
                    });

                    console.log('Consumer transport created:', consumerTransport.id);

                    ws.send(JSON.stringify({
                        event: 'consumerTransportCreated',
                        consumerTransport: {
                            id: consumerTransport.id,
                            iceParameters: consumerTransport.iceParameters,
                            iceCandidates: consumerTransport.iceCandidates,
                            dtlsParameters: consumerTransport.dtlsParameters,
                        }
                    }));

                    // Handle DTLS parameters from the client
                    ws.on('message', async (message) => {
                        const transportData = JSON.parse(message);
                        if (transportData.event === 'connectConsumerTransport') {
                            try {
                                await consumerTransport.connect({ dtlsParameters: transportData.dtlsParameters });
                                console.log('Consumer transport connected:', consumerTransport.id);
                                ws.send(JSON.stringify({ event: 'consumerTransportConnected', status: 'connected' }));
                            } catch (error) {
                                console.error('Error connecting consumer transport:', error);
                                ws.send(JSON.stringify({ event: 'consumerTransportConnected', error: error.message }));
                            }
                        } else if (transportData.event === 'consume') {
                            try {
                                // Get the first available producer
                                const producerIds = Array.from(producers.keys());
                                console.log('consume event')
                                if (producerIds.length === 0) {
                                    throw new Error('No producers available');
                                }
                                const producerId = producerIds[0];
                                const producer = producers.get(producerId);

                                console.log('Consuming for producer:', producerId);
                                console.log('rtpCapabilities:', transportData.rtpCapabilities);

                                const consumer = await consumerTransport.consume({
                                    producerId: producer.id,
                                    rtpCapabilities: transportData.rtpCapabilities,
                                });

                                console.log('Consumer created:', consumer.id);
                                console.log('Consumer parameters:', consumer.rtpParameters);

                                ws.send(JSON.stringify({
                                    event: 'consumed',
                                    consumer: {
                                        id: consumer.id,
                                        producerId: producer.id,
                                        kind: consumer.kind,
                                        rtpParameters: consumer.rtpParameters,
                                    }
                                }));
                            } catch (error) {
                                console.error('Error consuming:', error);
                                ws.send(JSON.stringify({ event: 'consumed', error: error.message }));
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error creating consumer transport:', error);
                    ws.send(JSON.stringify({ event: 'createConsumerTransport', error: error.message }));
                }
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
            // Clean up producers when client disconnects
            producers.forEach((producer, id) => {
                if (producer.closed) {
                    producers.delete(id);
                }
            });
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