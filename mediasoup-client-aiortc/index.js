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
            file: 'file:///home/kodai/documents/camera/mediasoup-client-test/mediasoup-client-aiortc/mov_hts-samp009.mp4',
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
        const data = JSON.parse(event.data);

        if (data.event === 'getRtpCapabilities') {
            if (data.error) {
                console.error('Error getting RTP Capabilities:', data.error);
            } else {
                console.log('RTP Capabilities received from SFU:', data.rtpCapabilities.codecs);

                // Load the device with the received RTP Capabilities
                try {
                    await device.load({ routerRtpCapabilities: data.rtpCapabilities });
                    console.log(data.rtpCapabilities);
                    console.log('Device loaded successfully');
                    // Create a transport
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

                // create the transport
                const transport = device.createSendTransport({
                    id: data.producerTransport.id,
                    iceParameters: data.producerTransport.iceParameters,
                    iceCandidates: data.producerTransport.iceCandidates,
                    dtlsParameters: data.producerTransport.dtlsParameters,
                });

                transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    console.log('Transport connect event:', dtlsParameters);

                    // Send the DTLS parameters to the SFU server
                    ws.send(JSON.stringify({
                        event: 'connectProducerTransport',
                        transportId: transport.id,
                        dtlsParameters,
                    }));
                    callback();

                    // // Wait for the server to respond with the connection status
                    // ws.onmessage = (event) => {
                    //     const data = JSON.parse(event.data);
                    //     if (data.event === 'producerTransportConnected' && data.transportId === transport.id) {
                    //         console.log()
                    //         if (data.error) {
                    //             errback(new Error(data.error));
                    //         } else {
                    //             callback();
                    //         }
                    //     }
                    // };
                });
                transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                    console.log('Transport produce event:', kind, rtpParameters.codecs);

                    // Send the produce request to the SFU server
                    ws.send(JSON.stringify({
                        event: 'produce',
                        transportData: {
                            transportId: transport.id,
                            kind,
                            rtpParameters,
                            appData
                        }
                    }));

                    // Wait for the server to respond with the producer ID
                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.event === 'produce' && data.transportId === transport.id) {
                            if (data.error) {
                                errback(new Error(data.error));
                            } else {
                                console.log('Video track produced:', transport.id);
                                callback({ id: data.producerId });
                            }
                        }
                    };
                });

                transport.on('connectionstatechange', (state) => {
                    console.log('!!!! Transport connection state:', state);
                });

                await transport.produce({ track: videoTrack })
                
            }
        }
        else if (data.event === 'connectTransport') {
            if (data.error) {
                console.error('Error connecting transport:', data.error);
            } else {
                console.log('Transport connected:', data.status);
            }
        } else {
            console.log('Unknown event:', data);
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