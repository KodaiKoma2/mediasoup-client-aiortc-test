import React, { useEffect, useRef } from 'react';
import { Device } from 'mediasoup-client';
import './App.css';

interface DtlsParameters {
  // Add the actual properties of dtlsParameters here
  [key: string]: any;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceRef = useRef<Device | null>(null);
  const consumerRef = useRef<any>(null);
  const transportRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const initialize = async () => {
      // Create a new mediasoup device
      deviceRef.current = new Device();

      // Connect to the SFU server using WebSocket
      wsRef.current = new WebSocket('ws://localhost:3000');

      wsRef.current.onopen = () => {
        console.log('WebSocket connection established');
        // Request RTP Capabilities from the SFU server
        wsRef.current?.send(JSON.stringify({ event: 'getRtpCapabilities' }));
      };

      wsRef.current.onmessage = async (event) => {
        const message = event.data.toString();
        const data = JSON.parse(message);

        if (data.event === 'getRtpCapabilities') {
          if (data.error) {
            console.error('Error getting RTP Capabilities:', data.error);
          } else {
            console.log('RTP Capabilities received from SFU');
            try {
              await deviceRef.current?.load({ routerRtpCapabilities: data.rtpCapabilities });
              console.log('Device loaded successfully');
              // Create a consumer transport
              wsRef.current?.send(JSON.stringify({ event: 'createConsumerTransport' }));
            } catch (error) {
              console.error('Error loading device:', error);
            }
          }
        } else if (data.event === 'consumerTransportCreated') {
          if (data.error) {
            console.error('Error creating transport:', data.error);
          } else {
            console.log('Consumer transport created:', data.transport);
            transportRef.current = deviceRef.current?.createRecvTransport({
              id: data.transport.id,
              iceParameters: data.transport.iceParameters,
              iceCandidates: data.transport.iceCandidates,
              dtlsParameters: data.transport.dtlsParameters,
            });

            transportRef.current?.on('connect', async ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback: () => void, errback: (error: Error) => void) => {
              console.log('Transport connect event');
              wsRef.current?.send(JSON.stringify({
                event: 'connectConsumerTransport',
                transportId: transportRef.current?.id,
                dtlsParameters,
              }));
              callback();
            });

            // Request to consume the producer
            wsRef.current?.send(JSON.stringify({
              event: 'consume',
              transportId: transportRef.current?.id,
              rtpCapabilities: deviceRef.current?.rtpCapabilities,
            }));
          }
        } else if (data.event === 'consumed') {
          if (data.error) {
            console.error('Error consuming:', data.error);
          } else {
            console.log('Consumer created:', data.consumer);
            consumerRef.current = await transportRef.current?.consume({
              id: data.consumer.id,
              producerId: data.consumer.producerId,
              kind: data.consumer.kind,
              rtpParameters: data.consumer.rtpParameters,
            });

            // Set up the video track
            const stream = new MediaStream();
            stream.addTrack(consumerRef.current.track);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          }
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket connection closed');
      };
    };

    initialize();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (consumerRef.current) {
        consumerRef.current.close();
      }
      if (transportRef.current) {
        transportRef.current.close();
      }
    };
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>SFU Consumer</h1>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: '640px', height: '480px' }}
        />
      </header>
    </div>
  );
}

export default App;
