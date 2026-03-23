import * as ort from 'onnxruntime-web';

// CONFIGURATION 
ort.env.wasm.wasmPaths = chrome.runtime.getURL("assets/");
ort.env.wasm.numThreads = 1; 
ort.env.wasm.proxy = false;

// CONSTANTS
const DETECTION_SIZE = 640;
const EMOTION_SIZE = 128; 

let detectionSession: ort.InferenceSession | null = null;
let emotionSession: ort.InferenceSession | null = null;
let audioPlayer: HTMLAudioElement | null = null;

async function init() {
    console.log("🚀 Init started...");
    try {
        const options: ort.InferenceSession.SessionOptions = {
            executionProviders: ['wasm']
        };
        console.log(`Loading models...`);
        detectionSession = await ort.InferenceSession.create(
            chrome.runtime.getURL("models/yolo11n.onnx"), 
            options
        );
        emotionSession = await ort.InferenceSession.create(
            chrome.runtime.getURL("models/yolov11n-emotion.onnx"), 
            options
        );
        
        console.log(`✅ System Ready: Models Loaded`);

        // Setup Audio Player
        audioPlayer = new Audio("https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3"); // placeholder soothing music
        audioPlayer.loop = true;

        startLoop();
    } catch (e: any) {
        console.error("❌ Model Load Failed:", e.message || e);
    }
}

async function startLoop() {
    console.log("📷 Requesting camera access...");
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: DETECTION_SIZE }, 
                height: { ideal: DETECTION_SIZE } 
            } 
        });
        console.log("✅ Camera access granted:", stream.active);
    } catch (e: any) {
        console.error("❌ Camera Error:", e.message || e);
        return;
    }
    
    const track = stream.getVideoTracks()[0];
    
    if (!('ImageCapture' in window)) {
        console.error("❌ ImageCapture API not supported in this browser version/context.");
        return;
    }

    // @ts-ignore
    const imageCapture = new ImageCapture(track);
    
    // Canvas for full frame (detection)
    const fbCanvas = new OffscreenCanvas(DETECTION_SIZE, DETECTION_SIZE);
    const fbCtx = fbCanvas.getContext('2d', { willReadFrequently: true })!;

    // Canvas for cropped face/person (emotion)
    const emCanvas = new OffscreenCanvas(EMOTION_SIZE, EMOTION_SIZE);
    const emCtx = emCanvas.getContext('2d', { willReadFrequently: true })!;

    console.log("⏱️ Starting inference loop...");
    
    const runInference = async () => {
        if (!detectionSession || !emotionSession) {
            return;
        }

        try {
            // @ts-ignore
            const bitmap = await imageCapture.grabFrame();
            
            // 1. Person Detection
            fbCtx.drawImage(bitmap, 0, 0, DETECTION_SIZE, DETECTION_SIZE);
            const fbImgData = fbCtx.getImageData(0, 0, DETECTION_SIZE, DETECTION_SIZE);
            
            const detectionTensor = preprocessDetection(fbImgData);
            const detResults = await detectionSession.run({ images: detectionTensor });
            
            // output shape: [1, 84, 8400]
            const detOutput = detResults.output0.data as Float32Array;
            const personBox = getBestPersonBox(detOutput, 8400); // returns [x, y, w, h] or null
            
            if (personBox) {
                // 2. Crop & Emotion Prediction
                const cx = personBox[0];
                const cy = personBox[1];
                const w = personBox[2];
                const h = personBox[3];

                const x1 = Math.max(0, cx - w / 2);
                const y1 = Math.max(0, cy - h / 2);
                const cropW = Math.min(DETECTION_SIZE - x1, w);
                const cropH = Math.min(DETECTION_SIZE - y1, h);

                emCtx.clearRect(0, 0, EMOTION_SIZE, EMOTION_SIZE);
                emCtx.drawImage(
                    fbCanvas, 
                    x1, y1, cropW, cropH,
                    0, 0, EMOTION_SIZE, EMOTION_SIZE
                );

                const emImgData = emCtx.getImageData(0, 0, EMOTION_SIZE, EMOTION_SIZE);
                const emotionTensor = preprocessEmotion(emImgData);
                
                const emResults = await emotionSession.run({ images: emotionTensor });
                const rawMood = getTopClass(emResults.output0 as any);
               
                //Emotion Mapping 
                let mappedMood = "neutral";
                if (["happy", "surprise"].includes(rawMood)) mappedMood = "positive";
                if (["angry", "disgust", "fear", "sad"].includes(rawMood)) mappedMood = "negative";

                console.log(`🧠 Inferred mood reading: ${mappedMood} (Raw: ${rawMood})`);

                chrome.runtime.sendMessage({ type: "MOOD_READING", mood: mappedMood })
                    .catch((e: any) => console.error("❌ Message Send Error from Offscreen:", e.message || e));
            } else {
                console.log("No person detected in frame for interval.");
            }
            
            bitmap.close(); 
        } catch (err: any) {
            console.error("❌ Inference Pipeline Error:", err.message || err);
        }
    };

    // Run immediately, then every 5 seconds to gather more readings for a stable average.
    runInference();
    setInterval(runInference, 5000);
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "PLAY_MUSIC") {
        if (audioPlayer) {
            if (msg.url) {
                audioPlayer.src = msg.url;
            }
            audioPlayer.play().catch(e => console.error("Audio play error", e));
        }
    } else if (msg.type === "STOP_MUSIC") {
        if (audioPlayer && !audioPlayer.paused) {
            audioPlayer.pause();
        }
    }
});

// Preprocess for YOLO11n (RGB, normalization / 255.0)
function preprocessDetection(img: ImageData): ort.Tensor {
    const { data } = img;
    const size = DETECTION_SIZE * DETECTION_SIZE;
    const float32 = new Float32Array(1 * 3 * size);
    
    for (let i = 0; i < size; i++) {
        float32[i] = data[i * 4] / 255.0;            // R
        float32[i + size] = data[i * 4 + 1] / 255.0; // G
        float32[i + 2 * size] = data[i * 4 + 2] / 255.0; // B
    }
    
    return new ort.Tensor('float32', float32, [1, 3, DETECTION_SIZE, DETECTION_SIZE]);
}

// Preprocess for Emotion (Grayscale replicated 3 times, normalization / 255.0)
function preprocessEmotion(img: ImageData): ort.Tensor {
    const { data } = img;
    const size = EMOTION_SIZE * EMOTION_SIZE;
    const float32 = new Float32Array(1 * 3 * size);
    
    for (let i = 0; i < size; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const norm = gray / 255.0;

        float32[i] = norm;            // Red
        float32[i + size] = norm;     // Green
        float32[i + 2 * size] = norm; // Blue
    }
    
    return new ort.Tensor('float32', float32, [1, 3, EMOTION_SIZE, EMOTION_SIZE]);
}

function getBestPersonBox(output: Float32Array, numAnchors: number) {
    let bestConf = 0.5; // Threshold
    let bestIdx = -1;

    // Feature offsets: 0: cx, 1: cy, 2: w, 3: h, 4: class 0 (person)
    const cls0Offset = 4 * numAnchors;
    
    for (let i = 0; i < numAnchors; i++) {
        const conf = output[cls0Offset + i];
        if (conf > bestConf) {
            bestConf = conf;
            bestIdx = i;
        }
    }

    if (bestIdx !== -1) {
        // found a person
        const cx = output[0 * numAnchors + bestIdx];
        const cy = output[1 * numAnchors + bestIdx];
        const w = output[2 * numAnchors + bestIdx];
        const h = output[3 * numAnchors + bestIdx];
        return [cx, cy, w, h];
    }
    return null;
}

function getTopClass(tensor: { data: Float32Array }) {
    const data = tensor.data;
    let max = -Infinity;
    let index = -1;
    
    for(let i=0; i<data.length; i++) {
        if(data[i] > max) { max = data[i]; index = i; }
    }
    
    const labels = [
        "angry",     // 0
        "disgust",   // 1
        "fear",      // 2
        "happy",     // 3
        "neutral",   // 4
        "sad",       // 5
        "surprise"   // 6
    ];

    return labels[index] || "neutral";
}

init();