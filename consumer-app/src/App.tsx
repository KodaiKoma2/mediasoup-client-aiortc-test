import React, { useEffect, useRef } from 'react';
import { Device, types } from 'mediasoup-client';
import './App.css';

interface DtlsParameters {
  [key: string]: any;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceRef = useRef<Device | null>(null);
  const consumerRef = useRef<any>(null);
  const transportRef = useRef<types.Transport | undefined>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const handleConsume = async () => {
    if (wsRef.current && transportRef.current && deviceRef.current) {
      console.log('Sending consume request');
      wsRef.current.send(
        JSON.stringify({
          event: 'consume',
          transportId: transportRef.current.id,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        })
      );
    }
  };

  useEffect(() => {
    const initialize = async () => {
      deviceRef.current = new Device();
      wsRef.current = new WebSocket('ws://localhost:3000');

      wsRef.current.onopen = () => {
        console.log('WebSocket connection established');
        wsRef.current?.send(JSON.stringify({ event: 'getRtpCapabilities' }));
      };

      wsRef.current.onmessage = async (event) => {
        const message = event.data.toString();
        const data = JSON.parse(message);

        if (data.event === 'getRtpCapabilities') {
          if (data.error) {
            console.error('Error getting RTP Capabilities:', data.error);
          } else {
            console.log('RTP Capabilities received from SFU', data.rtpCapabilities);
            try {
              await deviceRef.current?.load({ routerRtpCapabilities: data.rtpCapabilities });
              console.log('Device loaded successfully');
              wsRef.current?.send(JSON.stringify({ event: 'createConsumerTransport' }));
            } catch (error) {
              console.error('Error loading device:', error);
            }
          }
        } else if (data.event === 'consumerTransportCreated') {
          if (data.error) {
            console.error('Error creating transport:', data.error);
          } else {
            console.log('Consumer transport created:', data.consumerTransport);
            transportRef.current = deviceRef.current?.createRecvTransport({
              id: data.consumerTransport.id,
              iceParameters: data.consumerTransport.iceParameters,
              iceCandidates: data.consumerTransport.iceCandidates,
              dtlsParameters: data.consumerTransport.dtlsParameters,
            });

            transportRef.current?.on(
              'connect',
              async (
                { dtlsParameters }: { dtlsParameters: DtlsParameters },
                callback: () => void,
                errback: (error: Error) => void
              ) => {
                console.log('Transport connect event');
                wsRef.current?.send(
                  JSON.stringify({
                    event: 'connectConsumerTransport',
                    transportId: transportRef.current?.id,
                    dtlsParameters,
                  })
                );
                callback();
              }
            );
            transportRef.current?.on('connectionstatechange', (state) => {
              console.log('!!!! Transport connection state:', state);
            });
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

            const stream = new MediaStream([consumerRef.current.track]);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          }
        } else if (data.event === 'consumerTransportConnected') {
          if (data.error) {
            console.error('Error connecting transport:', data.error);
          } else {
            console.log('Consumer transport connected');
            // await transportRef.current?.connect({ dtlsParameters: data.dtlsParameters });
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
          controls
          muted
          style={{ width: '640px', height: '480px' }}
        />
        <button onClick={handleConsume} style={{ marginTop: '20px' }}>
          Start Consuming
        </button>
      </header>
    </div>
  );
}

export default App;
