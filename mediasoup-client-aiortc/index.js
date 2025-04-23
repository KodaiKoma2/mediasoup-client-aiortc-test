import {
    createWorker,
} from 'mediasoup-client-aiortc';

import { Device } from "mediasoup-client";
import { WebSocket } from 'ws';

async function main() {
    const worker = await createWorker({
        logLevel: 'warn',
    });

    const stream = await worker.getUserMedia({
        video: {
            source: 'file',
            file: 'rtsp://KodaiKomatsu:Kodai1998@10.0.0.60/stream1',
            // file: 'file:///home/kodai/documents/camera/mediasoup-client-test/mediasoup-client-aiortc/mov_hts-samp009.mp4',
            // file: 'mov_hts-samp009.mp4',
        },
    });

    const videoTrack = stream.getVideoTracks()[0];
    console.log(videoTrack);

    const device = new Device({
        handlerFactory: worker.createHandlerFactory(),
    });

    // Connect to the SFU server using WebSocket
    const ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
        console.log('WebSocket connection established');

        // Request RTP Capabilities from the SFU server
        ws.send(JSON.stringify({ event: 'getRtpCapabilities' }));
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data);

            if (data.event === 'getRtpCapabilities') {
                if (data.error) {
                    console.error('Error getting RTP Capabilities:', data.error);
                } else {
                    console.log('RTP Capabilities received from SFU:', data.rtpCapabilities.codecs);

                    try {
                        await device.load({ routerRtpCapabilities: data.rtpCapabilities });
                        console.log(data.rtpCapabilities.codecs);
                        console.log('Device loaded successfully');
                        ws.send(JSON.stringify({ event: 'createProducerTransport' }));
                    } catch (error) {
                        console.error('Error loading device:', error);
                    }
                }
            } else if (data.event === 'producerTransportCreated') {
                if (data.error) {
                    console.error('Error creating transport:', data.error);
                } else {
                    console.log('Transport created:', data.producerTransport);

                    const transport = device.createSendTransport({
                        id: data.producerTransport.id,
                        iceParameters: data.producerTransport.iceParameters,
                        iceCandidates: data.producerTransport.iceCandidates,
                        dtlsParameters: data.producerTransport.dtlsParameters,
                    });

                    let connectHandler = null;
                    let produceHandler = null;

                    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                        console.log('Transport connect event:', dtlsParameters);

                        ws.send(JSON.stringify({
                            event: 'connectProducerTransport',
                            transportId: transport.id,
                            dtlsParameters,
                        }));

                        // Remove previous handler if exists
                        if (connectHandler) {
                            ws.removeListener('message', connectHandler);
                        }

                        // Create new handler
                        connectHandler = (event) => {
                            try {
                                const responseData = JSON.parse(event.data);
                                if (responseData.event === 'producerTransportConnected' && responseData.transportId === transport.id) {
                                    ws.removeListener('message', connectHandler);
                                    connectHandler = null;
                                    if (responseData.error) {
                                        errback(new Error(responseData.error));
                                    } else {
                                        console.log('Transport connected successfully');
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
                        console.log('Transport produce event:', kind, rtpParameters.codecs);

                        ws.send(JSON.stringify({
                            event: 'produce',
                            transportData: {
                                transportId: transport.id,
                                kind,
                                rtpParameters,
                                appData
                            }
                        }));

                        // Remove previous handler if exists
                        if (produceHandler) {
                            ws.removeListener('message', produceHandler);
                        }

                        // Create new handler
                        produceHandler = (event) => {
                            try {
                                const responseData = JSON.parse(event.data);
                                if (responseData.event === 'produced' && responseData.transportId === transport.id) {
                                    ws.removeListener('message', produceHandler);
                                    produceHandler = null;
                                    if (responseData.error) {
                                        errback(new Error(responseData.error));
                                    } else {
                                        console.log('Video track produced:', transport.id);
                                        callback({ id: responseData.producerId });
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing message in produce handler:', error);
                            }
                        };
                        ws.on('message', produceHandler);
                    });

                    transport.on('connectionstatechange', (state) => {
                        console.log('Transport connection state:', state);
                    });

                    try {
                        await transport.produce({ track: videoTrack });
                        console.log('Video track production started');
                    } catch (error) {
                        console.error('Error producing video track:', error);
                    }
                }
            } else if (data.event === 'producerTransportConnected') {
                console.log('Transport connected:', data.status);
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

main().catch((error) => {
    console.error('Error:', error);
});