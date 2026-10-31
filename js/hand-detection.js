// Wraps MediaPipe's Hand Landmarker: finds up to two hands and their 21 joint points in each video frame.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const MODEL_URL = '/models/hand_landmarker.task';

// Pairs of joint indexes that are connected by a line when drawing a hand skeleton.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export async function createHandDetector() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

// Returns an array of { landmarks, handedness } where landmarks are normalized 0-1 coordinates.
export function detectHands(detector, video, timestamp) {
  const result = detector.detectForVideo(video, timestamp);
  return result.landmarks.map((landmarks, index) => ({
    landmarks,
    handedness: result.handedness[index]?.[0]?.categoryName ?? 'Unknown',
  }));
}

export function drawHands(canvas, video, hands) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  for (const hand of hands) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    for (const [from, to] of HAND_CONNECTIONS) {
      const a = hand.landmarks[from];
      const b = hand.landmarks[to];
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
      ctx.stroke();
    }
    ctx.fillStyle = '#f8fafc';
    for (const point of hand.landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function clearOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
