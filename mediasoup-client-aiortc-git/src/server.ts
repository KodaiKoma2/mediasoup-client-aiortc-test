// CommonJS style.
const {
	createWorker,
	// Worker,
	// WorkerSettings,
	// WorkerLogLevel,
	// AiortcMediaStream,
	// AiortcMediaStreamConstraints,
	// AiortcMediaTrackConstraints,
} = require('mediasoup-client-aiortc');

async function main() {
    const worker = await createWorker({
        logLevel: 'warn',
    });

    const stream = await worker.getUserMedia({
        video: {
            source: 'file',
            file: 'file:///home/kodai/documents/camera/mediasoup-client-test/mediasoup-client-aiortc/mov_hts-samp009.mp4',
        },
    });

    const videoTrack = stream.getVideoTracks()[0];
    console.log(videoTrack);
}

main().catch((error) => {
    console.error('Error:', error);
});