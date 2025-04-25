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
            // file: 'file:///home/kodai/documents/camera/mediasoup-client-test/mediasoup-client-aiortc/build_code_demo.mp4',
            // file: 'mov_hts-samp009.mp4',
        },
    });

    const videoTrack = stream.getVideoTracks()[0];
    console.log(videoTrack);

    const device = new Device({
        handlerFactory: worker.createHandlerFactory(),
        logLevel: 'debug',
    });

    // Connect to the SFU server using WebSocket
    const ws = new WebSocket('ws://10.0.0.52:3000');

    ws.onopen = () => {
        console.log('WebSocket connection established');

        // Request RTP Capabilities from the SFU server
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
                        iceTransportPolicy: 'all',
                    });

                    let connectHandler = null;
                    let produceHandler = null;

                    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                        console.log('Transport connect event:', dtlsParameters);

                        // Ensure role is set to 'auto' or 'client'
                        // if (dtlsParameters.role !== 'client' && dtlsParameters.role !== 'auto') {
                        //     console.log('Setting DTLS role to client from ', dtlsParameters.role);
                        //     dtlsParameters.role = 'client';
                        // }

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
                                const responseData = JSON.parse(event);
                                console.log('Respnse data:', responseData);
                                if (responseData.event === 'producerTransportConnected') {
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
                                const responseData = JSON.parse(event);
                                console.log('Response data:', responseData);
                                if (responseData.event === 'produced') {
                                    ws.removeListener('message', produceHandler);
                                    produceHandler = null;
                                    if (responseData.error) {
                                        errback(new Error(responseData.error));
                                    } else {
                                        console.log('Video track produced:', responseData.id);
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
                        console.log('Transport connection state:', state);
                    });

                    transport.on('icestatechange', (state) => {
                        console.log('Producer transport ICE state changed:', state);
                    });
                    transport.on('iceconnectionstatechange', (state) => {
                        console.log('Transport ICE connection state:', state);
                    });

                    try {
                        const producer = await transport.produce({ track: videoTrack });
                        console.log('Video track production started');

                        // Monitor producer events
                        producer.on('trace', (trace) => {
                            console.log('Producer trace event:', trace);
                        });

                        // // Periodically check if the producer is active
                        // const monitorInterval = setInterval(() => {
                        //     if (producer.closed) {
                        //         console.error('Producer is closed');
                        //         clearInterval(monitorInterval);
                        //     } else {
                        //         console.log('Producer is active:', producer.id);
                        //     }
                        // }, 5000); // Check every 5 seconds

                        // // Clean up the interval when the producer is closed
                        // producer.on('close', () => {
                        //     console.log('Producer closed');
                        //     clearInterval(monitorInterval);
                        // });
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