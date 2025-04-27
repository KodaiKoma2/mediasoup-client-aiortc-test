import {
    createWorker,
} from 'mediasoup-client-aiortc';

import { Device } from "mediasoup-client";
import { WebSocket } from 'ws';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get configuration from environment variables
const RTSP_URLS = {
    camera1: process.env.RTSP_URL_1 || 'rtsp://KodaiKomatsu:Kodai1998@10.0.0.60/stream1',
    camera2: process.env.RTSP_URL_2 || 'rtsp://KodaiKomatsu:Kodai1998@10.0.0.60/stream1',
    // Add more cameras as needed
};

const SFU_HOST = process.env.SFU_HOST || '10.0.0.52';
const SFU_PORT = process.env.SFU_PORT || '3000';

// Store active producers
const producers = new Map();

async function main() {
    const worker = await createWorker({
        logLevel: 'warn',
    });

    const device = new Device({
        handlerFactory: worker.createHandlerFactory(),
        logLevel: 'debug',
    });

    // Connect to the SFU server using WebSocket
    const ws = new WebSocket(`ws://${SFU_HOST}:${SFU_PORT}`);

    ws.onopen = () => {
        console.log('WebSocket connection established');
        ws.send(JSON.stringify({ event: 'getRtpCapabilities' }));
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data.event);

            if (data.event === 'getRtpCapabilities') {
                if (data.error) {
                    console.error('Error getting RTP Capabilities:', data.error);
                } else {
                    console.log('RTP Capabilities received from SFU:', data.rtpCapabilities.codecs);

                    try {
                        await device.load({ routerRtpCapabilities: data.rtpCapabilities });
                        console.log('Device loaded successfully');
                        console.log('can produce video:', device.canProduce('video'));
                        
                        // Initialize streams for all cameras
                        for (const [cameraId, rtspUrl] of Object.entries(RTSP_URLS)) {
                            await initializeCameraStream(cameraId, rtspUrl, worker, device, ws);
                        }
                    } catch (error) {
                        console.error('Error loading device:', error);
                    }
                }
            } else if (data.event === 'producerTransportCreated') {
                if (data.error) {
                    console.error('Error creating transport:', data.error);
                } else {
                    const cameraId = data.cameraId;
                    console.log(`Transport created for camera ${cameraId}:`, data.producerTransport);

                    const transport = device.createSendTransport({
                        id: data.producerTransport.id,
                        iceParameters: data.producerTransport.iceParameters,
                        iceCandidates: data.producerTransport.iceCandidates,
                        dtlsParameters: data.producerTransport.dtlsParameters,
                        iceTransportPolicy: 'all',
                    });

                    let connectHandler = null;
                    let produceHandler = null;

                    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                        console.log(`Transport connect event for camera ${cameraId}:`, dtlsParameters);

                        ws.send(JSON.stringify({
                            event: 'connectProducerTransport',
                            transportId: transport.id,
                            cameraId: cameraId,
                            dtlsParameters,
                        }));

                        if (connectHandler) {
                            ws.removeListener('message', connectHandler);
                        }

                        connectHandler = (event) => {
                            try {
                                const responseData = JSON.parse(event);
                                if (responseData.event === 'producerTransportConnected' && 
                                    responseData.cameraId === cameraId) {
                                    ws.removeListener('message', connectHandler);
                                    connectHandler = null;
                                    if (responseData.error) {
                                        errback(new Error(responseData.error));
                                    } else {
                                        console.log(`Transport connected successfully for camera ${cameraId}`);
                                        callback();
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing message in connect handler:', error);
                            }
                        };
                        ws.on('message', connectHandler);
                    });

                    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                        console.log(`Transport produce event for camera ${cameraId}:`, kind, rtpParameters.codecs);

                        ws.send(JSON.stringify({
                            event: 'produce',
                            transportData: {
                                transportId: transport.id,
                                cameraId: cameraId,
                                kind,
                                rtpParameters,
                                appData
                            }
                        }));

                        if (produceHandler) {
                            ws.removeListener('message', produceHandler);
                        }

                        produceHandler = (event) => {
                            try {
                                const responseData = JSON.parse(event);
                                if (responseData.event === 'produced' && 
                                    responseData.cameraId === cameraId) {
                                    ws.removeListener('message', produceHandler);
                                    produceHandler = null;
                                    if (responseData.error) {
                                        errback(new Error(responseData.error));
                                    } else {
                                        console.log(`Video track produced for camera ${cameraId}:`, responseData.id);
                                        callback({ id: responseData.id });
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing message in produce handler:', error);
                            }
                        };
                        ws.on('message', produceHandler);
                    });

                    transport.on('connectionstatechange', (state) => {
                        console.log(`Transport connection state for camera ${cameraId}:`, state);
                    });

                    transport.on('icestatechange', (state) => {
                        console.log(`Producer transport ICE state changed for camera ${cameraId}:`, state);
                    });

                    transport.on('iceconnectionstatechange', (state) => {
                        console.log(`Transport ICE connection state for camera ${cameraId}:`, state);
                    });

                    try {
                        const stream = await worker.getUserMedia({
                            video: {
                                source: 'file',
                                file: RTSP_URLS[cameraId],
                            },
                        });

                        const videoTrack = stream.getVideoTracks()[0];
                        console.log(`Video track obtained for camera ${cameraId}:`, videoTrack);
                        
                        const producer = await transport.produce({ track: videoTrack });
                        console.log(`Producer created for camera ${cameraId}:`, producer.id);

                        producers.set(cameraId, producer);

                        producer.on('trace', (trace) => {
                            console.log(`Producer trace event for camera ${cameraId}:`, trace);
                        });

                    } catch (error) {
                        console.error(`Error producing video track for camera ${cameraId}:`, error);
                    }
                }
            } else if (data.event === 'producerTransportConnected') {
                console.log(`Transport connected for camera ${data.cameraId}:`, data.status);
            } else {
                console.log('Unknown event:', data);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
    };
}

async function initializeCameraStream(cameraId, rtspUrl, worker, device, ws) {
    try {
        console.log(`Initializing stream for camera ${cameraId} with URL: ${rtspUrl}`);
        ws.send(JSON.stringify({ 
            event: 'createProducerTransport',
            cameraId: cameraId
        }));
    } catch (error) {
        console.error(`Error initializing camera ${cameraId}:`, error);
    }
}

main().catch((error) => {
    console.error('Error:', error);
});