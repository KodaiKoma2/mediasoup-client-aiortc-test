import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createWorker } from 'mediasoup';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active producers and transports by camera ID
const producers = new Map();
const transports = new Map();

// Get IP address from environment variable or use default
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || '10.0.0.52';
const PORT = process.env.PORT || 3000;
const MAX_PRODUCERS = parseInt(process.env.MAX_PRODUCERS || '10', 10);

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
                    const cameraId = data.cameraId;
                    console.log(`Creating transport for camera ${cameraId}`);

                    const producerTransport = await router.createWebRtcTransport({
                        listenIps: [{ ip: '0.0.0.0', announcedIp: ANNOUNCED_IP }],
                        enableUdp: true,
                        enableTcp: true,
                        preferUdp: true,
                    });

                    console.log(`Transport created for camera ${cameraId}:`, producerTransport.id);

                    // Store transport
                    if (!transports.has(cameraId)) {
                        transports.set(cameraId, new Map());
                    }
                    transports.get(cameraId).set(producerTransport.id, producerTransport);

                    ws.send(JSON.stringify({
                        event: 'producerTransportCreated',
                        cameraId: cameraId,
                        producerTransport: {
                            id: producerTransport.id,
                            iceParameters: producerTransport.iceParameters,
                            iceCandidates: producerTransport.iceCandidates,
                            dtlsParameters: producerTransport.dtlsParameters,
                        }
                    }));

                    producerTransport.on('icestatechange', (iceState) => {
                        console.log(`Producer transport ICE state changed for camera ${cameraId}:`, iceState);
                    });

                    producerTransport.on('connectionstatechange', (state) => {
                        console.log(`Producer transport connection state changed for camera ${cameraId}:`, state);
                    });

                    // Handle DTLS parameters from the client
                    ws.on('message', async (message) => {
                        const transportData = JSON.parse(message);
                        
                        if (transportData.event === 'connectProducerTransport' && 
                            transportData.cameraId === cameraId) {
                            console.log(`Received DTLS parameters for camera ${cameraId}:`, transportData.dtlsParameters);

                            try {
                                await producerTransport.connect({ dtlsParameters: transportData.dtlsParameters });
                                console.log(`Transport connected for camera ${cameraId}:`, producerTransport.id);
                                ws.send(JSON.stringify({ 
                                    event: 'producerTransportConnected', 
                                    cameraId: cameraId,
                                    status: 'connected' 
                                }));
                            } catch (error) {
                                console.error(`Error connecting transport for camera ${cameraId}:`, error);
                                ws.send(JSON.stringify({ 
                                    event: 'producerTransportConnected', 
                                    cameraId: cameraId,
                                    error: error.message 
                                }));
                            }
                        } else if (transportData.event === 'produce' && 
                                 transportData.transportData.cameraId === cameraId) {
                            try {
                                console.log(`Producing for camera ${cameraId}:`, transportData.transportData);
                                const producer = await producerTransport.produce({
                                    kind: transportData.transportData.kind, 
                                    rtpParameters: transportData.transportData.rtpParameters, 
                                    appData: transportData.transportData.appData
                                });

                                // Store the producer
                                if (!producers.has(cameraId)) {
                                    producers.set(cameraId, new Map());
                                }
                                producers.get(cameraId).set(producer.id, producer);
                                
                                console.log(`Producer created for camera ${cameraId}:`, producer.id);
                                ws.send(JSON.stringify({ 
                                    event: 'produced', 
                                    cameraId: cameraId,
                                    id: producer.id 
                                }));
                            } catch (error) {
                                console.log(`Error producing for camera ${cameraId}:`, error);
                                ws.send(JSON.stringify({ 
                                    event: 'produced', 
                                    cameraId: cameraId,
                                    error: error.message 
                                }));
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error creating transport:', error);
                    ws.send(JSON.stringify({ 
                        event: 'createTransport', 
                        cameraId: data.cameraId,
                        error: error.message 
                    }));
                }
            } else if (data.event === 'createConsumerTransport') {
                try {
                    const consumerTransport = await router.createWebRtcTransport({
                        listenIps: [
                            { ip: '0.0.0.0', announcedIp: ANNOUNCED_IP }
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
                                const cameraId = transportData.cameraId;
                                console.log(`Consuming request received for camera ${cameraId}`);

                                // Get the producer for the specified camera
                                const cameraProducers = producers.get(cameraId);
                                console.log(`Available producers for camera ${cameraId}:`, 
                                    cameraProducers ? Array.from(cameraProducers.keys()) : 'none');

                                if (!cameraProducers || cameraProducers.size === 0) {
                                    console.error(`No producers available for camera ${cameraId}`);
                                    throw new Error(`No producers available for camera ${cameraId}`);
                                }

                                const producerId = Array.from(cameraProducers.keys())[0];
                                const producer = cameraProducers.get(producerId);

                                console.log(`Consuming for producer: ${producerId} (camera ${cameraId})`);
                                console.log('rtpCapabilities:', transportData.rtpCapabilities);

                                const consumer = await consumerTransport.consume({
                                    producerId: producer.id,
                                    rtpCapabilities: transportData.rtpCapabilities,
                                });

                                console.log('Consumer created:', consumer.id);
                                console.log('Consumer parameters:', consumer.rtpParameters);

                                ws.send(JSON.stringify({
                                    event: 'consumed',
                                    cameraId: cameraId,
                                    consumer: {
                                        id: consumer.id,
                                        producerId: producer.id,
                                        kind: consumer.kind,
                                        rtpParameters: consumer.rtpParameters,
                                    }
                                }));
                            } catch (error) {
                                console.error('Error consuming:', error);
                                ws.send(JSON.stringify({ 
                                    event: 'consumed', 
                                    cameraId: transportData.cameraId,
                                    error: error.message 
                                }));
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
            // Clean up producers and transports when client disconnects
            producers.forEach((cameraProducers, cameraId) => {
                cameraProducers.forEach((producer, id) => {
                    if (producer.closed) {
                        cameraProducers.delete(id);
                    }
                });
                if (cameraProducers.size === 0) {
                    producers.delete(cameraId);
                }
            });

            transports.forEach((cameraTransports, cameraId) => {
                cameraTransports.forEach((transport, id) => {
                    if (transport.closed) {
                        cameraTransports.delete(id);
                    }
                });
                if (cameraTransports.size === 0) {
                    transports.delete(cameraId);
                }
            });
        });
    });
};

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Announced IP: ${ANNOUNCED_IP}`);
    console.log(`Maximum producers per camera: ${MAX_PRODUCERS}`);
});

// Initialize mediasoup worker and router
init().catch((error) => {
    console.error('Error initializing mediasoup:', error);
});