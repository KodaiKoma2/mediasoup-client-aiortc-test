import React, { useEffect, useRef, useState } from 'react';
import { Device, types } from 'mediasoup-client';
import './App.css';

// Get configuration from environment variables
const SFU_HOST = process.env.SFU_HOST || 'localhost';
const SFU_PORT = process.env.SFU_PORT || '3000';

interface DtlsParameters {
  [key: string]: any;
}

interface CameraStream {
  cameraId: string;
  stream: MediaStream;
  consumer: types.Consumer;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<types.Transport | undefined>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [availableCameras] = useState<string[]>(['camera1', 'camera2']);

  const handleConsume = async (cameraId: string) => {
    if (!cameraId) {
      console.error('Cannot consume: camera ID is empty');
      return;
    }
    
    if (wsRef.current && transportRef.current && deviceRef.current) {
      console.log(`Sending consume request for camera ${cameraId}`);
      wsRef.current.send(
        JSON.stringify({
          event: 'consume',
          transportId: transportRef.current.id,
          cameraId: cameraId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        })
      );
    }
  };

  // const handlePlay = async () => {
  //   if (videoRef.current && selectedCamera) {
  //     const selectedStream = streams.find(s => s.cameraId === selectedCamera);
  //     if (selectedStream) {
  //       try {
  //         videoRef.current.srcObject = selectedStream.stream;
  //         await videoRef.current.play();
  //         console.log('Video playback started');
  //       } catch (error) {
  //         console.error('Error playing video:', error);
  //       }
  //     }
  //   }
  // };

  const handleCameraSelect = (cameraId: string) => {
    if (!cameraId) return;
    
    setSelectedCamera(cameraId);
    if (!streams.find(s => s.cameraId === cameraId)) {
      console.log(`No existing stream for camera ${cameraId}, initiating consume`);
      handleConsume(cameraId);
    } else {
      console.log(`Using existing stream for camera ${cameraId}`);
      const selectedStream = streams.find(s => s.cameraId === cameraId);
      if (selectedStream && videoRef.current) {
        videoRef.current.srcObject = selectedStream.stream;
      }
    }
  };

  useEffect(() => {
    const initialize = async () => {
      deviceRef.current = new Device();
      wsRef.current = new WebSocket(`ws://${SFU_HOST}:${SFU_PORT}`);

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

                    wsRef.current?.removeEventListener('message', handleTransportConnected);
                  }
                };

                wsRef.current?.addEventListener('message', handleTransportConnected);
              }
            );

            transportRef.current?.on('connectionstatechange', (state) => {
              console.log('Transport connection state:', state);
            });

            if (availableCameras.length > 0) {
              const firstCamera = availableCameras[0];
              console.log(`Initializing first camera stream: ${firstCamera}`);
              handleConsume(firstCamera);
            }
          }
        } else if (data.event === 'consumed') {
          if (data.error) {
            console.error(`Error consuming camera ${data.cameraId}:`, data.error);
            if (data.error.includes('No producers available')) {
              console.log(`Retrying consume for camera ${data.cameraId} in 2 seconds...`);
              setTimeout(() => {
                if (data.cameraId) {
                  handleConsume(data.cameraId);
                }
              }, 2000);
            }
          } else {
            console.log('Consumer created:', data.consumer);
            try {
              const consumer = await transportRef.current?.consume({
                id: data.consumer.id,
                producerId: data.consumer.producerId,
                kind: data.consumer.kind,
                rtpParameters: data.consumer.rtpParameters,
              });

              if (consumer) {
                console.log('Consumer track:', consumer.track);
                const newStream = new MediaStream();
                if (consumer.track) {
                  newStream.addTrack(consumer.track);
                  console.log('Stream tracks:', newStream.getTracks());
                  console.log('consumer stats:', await consumer.getStats());

                  setStreams(prevStreams => [
                    ...prevStreams,
                    {
                      cameraId: data.cameraId,
                      stream: newStream,
                      consumer: consumer
                    }
                  ]);

                  setIsStreamReady(true);
                  
                  if (data.cameraId === availableCameras[0]) {
                    setSelectedCamera(data.cameraId);
                  }
                }
              }
            } catch (error) {
              console.error('Error setting up consumer:', error);
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
      streams.forEach(stream => {
        if (stream.consumer) {
          stream.consumer.close();
        }
      });
      if (transportRef.current) {
        transportRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && selectedCamera) {
      const selectedStream = streams.find(s => s.cameraId === selectedCamera);
      if (selectedStream) {
        videoRef.current.srcObject = selectedStream.stream;
      }
    }
  }, [selectedCamera, streams]);

  useEffect(() => {
    streams.forEach(stream => {
      if (stream.consumer?.track) {
        stream.consumer.track.enabled = true;
        stream.consumer.track.onunmute = () => {
          console.log(`Track unmuted for camera ${stream.cameraId}`);
        };
      }
    });
  }, [streams]);

  return (
    <div className="App">
      <header className="App-header">
        <h1>SFU Consumer</h1>
        <div style={{ marginBottom: '20px' }}>
          <select 
            value={selectedCamera || ''} 
            onChange={(e) => handleCameraSelect(e.target.value)}
            style={{ padding: '5px', marginRight: '10px' }}
          >
            <option value="">カメラを選択</option>
            {availableCameras.map(cameraId => (
              <option key={cameraId} value={cameraId}>
                カメラ {cameraId}
              </option>
            ))}
          </select>
          {/* {isStreamReady && selectedCamera && (
            <button onClick={handlePlay}>
              再生
            </button>
          )} */}
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          controls
          muted
          style={{ width: '640px', height: '480px' }}
        />
      </header>
    </div>
  );
}

export default App;
