import React, { useEffect, useRef, useState } from 'react';
import { Device, types } from 'mediasoup-client';
import './App.css';

interface DtlsParameters {
  [key: string]: any;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceRef = useRef<Device | null>(null);
  const consumerRef = useRef<types.Consumer | undefined>(null);
  const transportRef = useRef<types.Transport | undefined>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

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

  const handlePlay = async () => {
    if (videoRef.current && stream) {
      try {
        await videoRef.current.play();
        console.log('Video playback started');
      } catch (error) {
        console.error('Error playing video:', error);
      }
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
                console.log('Transport connect event', dtlsParameters);
                wsRef.current?.send(
                  JSON.stringify({
                    event: 'connectConsumerTransport',
                    transportId: transportRef.current?.id,
                    dtlsParameters,
                  })
                );

                // Temporary handler for the 'consumerTransportConnected' event
                const handleTransportConnected = (event: MessageEvent) => {
                  const message = event.data.toString();
                  const data = JSON.parse(message);

                  if (data.event === 'consumerTransportConnected') {
                    if (data.error) {
                      console.error('Error connecting transport:', data.error);
                      errback(new Error(data.error));
                    } else {
                      console.log('Consumer transport connected');
                      callback();
                    }

                    // Remove this handler after processing the event
                    wsRef.current?.removeEventListener('message', handleTransportConnected);
                  }
                };

                // Add the temporary handler
                wsRef.current?.addEventListener('message', handleTransportConnected);
              }
            );

            transportRef.current?.on('connectionstatechange', (state) => {
              console.log('Transport connection state:', state);
            });

            handleConsume();
          }
        } else if (data.event === 'consumed') {
          if (data.error) {
            console.error('Error consuming:', data.error);
          } else {
            console.log('Consumer created:', data.consumer);
            try {
              consumerRef.current = await transportRef.current?.consume({
                id: data.consumer.id,
                producerId: data.consumer.producerId,
                kind: data.consumer.kind,
                rtpParameters: data.consumer.rtpParameters,
              });
              console.log('consumerRef:', consumerRef.current);
              console.log('Consumer track:', consumerRef.current?.track);
              const newStream = new MediaStream();
              if (consumerRef.current?.track) {
                newStream.addTrack(consumerRef.current.track);
                console.log('Stream tracks:', newStream.getTracks());
                console.log('consumer stats:', await consumerRef.current.getStats());
                setStream(newStream);
                setIsStreamReady(true);

                // Force video element to update
                if (videoRef.current) {
                  videoRef.current.srcObject = newStream;
                  // 自動再生を試みる
                  // videoRef.current.play().then(() => {
                  //   console.log('Video playback started successfully');
                  // }).catch(error => {
                  //   console.error('Error playing video:', error);
                  //   // 自動再生が失敗した場合、ユーザーに手動再生を促す
                  //   alert('Please click the play button to start the video');
                  // });
                }
              }
            } catch (error) {
              console.error('Error setting up consumer:', error);
            }
          }
        } 
        // else if (data.event === 'consumerTransportConnected') {
        //   if (data.error) {
        //     console.error('Error connecting transport:', data.error);
        //   } else {
        //     console.log('Consumer transport connected');
        //   }
        // }
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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (consumerRef.current?.track) {
      consumerRef.current.track.enabled = true; // トラックを有効化
      consumerRef.current.track.onunmute = () => {
        console.log('Track unmuted');
      };
    }
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
          muted  // 初期状態でミュート
          style={{ width: '640px', height: '480px' }}
        />
        <div style={{ marginTop: '20px' }}>
          <button onClick={handleConsume} style={{ marginRight: '10px' }}>
            Start Consuming
          </button>
          {isStreamReady && (
            <button onClick={handlePlay}>
              Play Video
            </button>
          )}
        </div>
      </header>
    </div>
  );
}

export default App;
