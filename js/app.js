// Page controller: connects the camera, hand tracking, gesture recognition, sentence builder, speech, and teaching panel.
import { createHandDetector, detectHands, drawHands, clearOverlay } from './hand-detection.js';
import { extractFeatures, classifyGesture } from './gesture-classifier.js';
import { isStoreConfigured, loadSamples, addSamples, deleteSamples } from './gesture-store.js';
import { isSpeechSupported, getVoices, onVoicesChanged, speak, stopSpeech } from './speech.js';

// A sign must be held this many frames in a row before its word is added to the sentence.
const STABLE_FRAMES = 12;
const SAMPLES_PER_SIGN = 30;
const SPEECH_SETTINGS_KEY = 'signify-speech-settings';

const el = {
  pill: document.getElementById('status-pill'),
  video: document.getElementById('video'),
  overlay: document.getElementById('overlay'),
  placeholder: document.getElementById('camera-placeholder'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  cameraMessage: document.getElementById('camera-message'),
  handSide: document.getElementById('hand-side'),
  gestureName: document.getElementById('gesture-name'),
  confidenceText: document.getElementById('confidence-text'),
  confidenceFill: document.getElementById('confidence-fill'),
  confidenceTrack: document.querySelector('.confidence-track'),
  recognitionStatus: document.getElementById('recognition-status'),
  sentence: document.getElementById('sentence'),
  undoBtn: document.getElementById('undo-btn'),
  clearBtn: document.getElementById('clear-btn'),
  speakBtn: document.getElementById('speak-btn'),
  stopSpeechBtn: document.getElementById('stop-speech-btn'),
  voiceSelect: document.getElementById('voice-select'),
  rateRange: document.getElementById('rate-range'),
  rateValue: document.getElementById('rate-value'),
  speechNotice: document.getElementById('speech-notice'),
  trainForm: document.getElementById('train-form'),
  wordInput: document.getElementById('word-input'),
  recordBtn: document.getElementById('record-btn'),
  trainStatus: document.getElementById('train-status'),
  trainedList: document.getElementById('trained-list'),
};

const state = {
  running: false,
  stream: null,
  detector: null,
  rafId: 0,
  lastTimestamp: -1,
  samples: [],
  sentence: [],
  candidate: null,
  candidateFrames: 0,
  lockedLabel: null,
  recording: null,
};

function setPill(text, kind = '') {
  el.pill.textContent = text;
  el.pill.className = `pill ${kind ? `is-${kind}` : ''}`.trim();
}

function showCameraMessage(text) {
  el.cameraMessage.textContent = text;
  el.cameraMessage.hidden = !text;
}

function describeCameraError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return 'Camera permission was blocked. Click the camera icon in your browser address bar, allow camera access for this site, then press Start camera again.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
    return 'No camera was found. Connect a webcam or use a device with a camera, then try again.';
  }
  if (err?.name === 'NotReadableError') {
    return 'The camera is being used by another app. Close other apps that use the camera, then try again.';
  }
  return 'Something went wrong while starting the camera. Please try again.';
}

async function startCamera() {
  showCameraMessage('');
  el.startBtn.disabled = true;
  setPill('Starting', 'busy');

  try {
    if (!state.detector) {
      el.recognitionStatus.textContent = 'Loading hand tracking model...';
      state.detector = await createHandDetector();
    }
  } catch {
    el.startBtn.disabled = false;
    setPill('Error', 'error');
    showCameraMessage('Hand tracking could not load. Check your internet connection and reload the page.');
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    el.video.srcObject = state.stream;
    await el.video.play();
  } catch (err) {
    stopCamera();
    setPill('Error', 'error');
    showCameraMessage(describeCameraError(err));
    return;
  }

  state.running = true;
  el.placeholder.hidden = true;
  el.stopBtn.disabled = false;
  setPill('Live', 'live');
  el.recognitionStatus.textContent = state.samples.length
    ? 'Show a hand to the camera.'
    : 'No signs taught yet. Use "Teach a sign" below first.';
  frame();
}

function stopCamera() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  el.video.srcObject = null;
  clearOverlay(el.overlay);
  el.placeholder.hidden = false;
  el.startBtn.disabled = false;
  el.stopBtn.disabled = true;
  setPill('Camera off');
  state.candidate = null;
  state.candidateFrames = 0;
  state.lockedLabel = null;
  if (state.recording) {
    state.recording = null;
    setTrainStatus('Recording stopped because the camera was turned off.');
  }
  showRecognition({ hand: 'None', gesture: 'Waiting', confidence: 0 });
  el.recognitionStatus.textContent = 'Start the camera to begin.';
}

function frame() {
  if (!state.running) return;
  if (el.video.readyState >= 2) {
    const now = performance.now();
    if (now > state.lastTimestamp) {
      state.lastTimestamp = now;
      processFrame(now);
    }
  }
  state.rafId = requestAnimationFrame(frame);
}

function processFrame(now) {
  let hands;
  try {
    hands = detectHands(state.detector, el.video, now);
  } catch {
    stopCamera();
    setPill('Error', 'error');
    showCameraMessage('Hand tracking stopped unexpectedly. Press Start camera to try again.');
    return;
  }
  drawHands(el.overlay, el.video, hands);
  handleHands(hands);
}

function handleHands(hands) {
  if (hands.length === 0) {
    state.candidate = null;
    state.candidateFrames = 0;
    state.lockedLabel = null;
    showRecognition({ hand: 'None', gesture: 'Waiting', confidence: 0 });
    el.recognitionStatus.textContent = 'Show a hand to the camera.';
    return;
  }

  const hand = hands[0];
  const features = extractFeatures(hand.landmarks);

  if (state.recording) {
    collectRecordingFrame(features);
  }

  const { label, confidence } = classifyGesture(features, state.samples);
  updateStability(label);

  showRecognition({
    hand: `${hand.handedness} hand`,
    gesture: label ?? 'Unknown Gesture',
    confidence,
    unknown: !label,
  });

  if (state.samples.length === 0) {
    el.recognitionStatus.textContent = 'No signs taught yet. Use "Teach a sign" below first.';
  } else if (!label) {
    el.recognitionStatus.textContent = 'Hand detected, but this sign is not in your taught list.';
  } else {
    el.recognitionStatus.textContent = `Recognized "${label}". Hold steady to add it to the translation.`;
  }
}

function showRecognition({ hand, gesture, confidence, unknown = false }) {
  el.handSide.textContent = hand;
  el.gestureName.textContent = gesture;
  el.gestureName.classList.toggle('is-unknown', unknown);
  const percent = Math.round(confidence * 100);
  el.confidenceText.textContent = `${percent}%`;
  el.confidenceFill.style.width = `${percent}%`;
  el.confidenceTrack.setAttribute('aria-valuenow', String(percent));
}

// Adds a word once the same sign has been held for STABLE_FRAMES frames; the word is not repeated until the hand changes.
function updateStability(label) {
  if (!label) {
    state.candidate = null;
    state.candidateFrames = 0;
    state.lockedLabel = null;
    return;
  }

  if (label === state.candidate) {
    state.candidateFrames += 1;
  } else {
    state.candidate = label;
    state.candidateFrames = 1;
  }

  if (state.candidateFrames >= STABLE_FRAMES && state.lockedLabel !== label) {
    state.lockedLabel = label;
    addWord(label);
  }
}

function addWord(word) {
  state.sentence.push(word);
  renderSentence();
}

function renderSentence() {
  el.sentence.replaceChildren();
  el.sentence.classList.toggle('is-empty', state.sentence.length === 0);

  if (state.sentence.length === 0) {
    el.sentence.textContent = 'Your translated words will appear here.';
    return;
  }
  for (const word of state.sentence) {
    const chip = document.createElement('span');
    chip.className = 'word-chip';
    chip.textContent = word;
    el.sentence.append(chip, ' ');
  }
}

function setTrainStatus(text) {
  el.trainStatus.textContent = text;
}

function normalizeWord(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function handleTrainSubmit(event) {
  event.preventDefault();
  const word = normalizeWord(el.wordInput.value);

  if (!word) {
    setTrainStatus('Type the word this sign means first.');
    return;
  }
  if (!state.running) {
    setTrainStatus('Start the camera before recording a sign.');
    return;
  }
  if (state.recording) return;

  state.recording = { label: word, features: [] };
  el.recordBtn.disabled = true;
  setTrainStatus(`Hold the "${word}" sign steady. Recording 0/${SAMPLES_PER_SIGN}...`);
}

function collectRecordingFrame(features) {
  const recording = state.recording;
  recording.features.push(features);
  setTrainStatus(
    `Hold the "${recording.label}" sign steady. Recording ${recording.features.length}/${SAMPLES_PER_SIGN}...`,
  );
  if (recording.features.length >= SAMPLES_PER_SIGN) {
    finishRecording();
  }
}

async function finishRecording() {
  const { label, features } = state.recording;
  state.recording = null;
  try {
    await addSamples(label, features);
    state.samples.push(...features.map((vector) => ({ label, features: vector })));
    renderTrainedList();
    el.wordInput.value = '';
    setTrainStatus(`Saved ${features.length} examples for "${label}".`);
  } catch {
    setTrainStatus('The sign could not be saved. Check your connection and try recording again.');
  } finally {
    el.recordBtn.disabled = false;
  }
}

async function removeSign(label) {
  if (!window.confirm(`Delete all examples for "${label}"?`)) return;
  try {
    await deleteSamples(label);
    state.samples = state.samples.filter((sample) => sample.label !== label);
    renderTrainedList();
    setTrainStatus(`Deleted "${label}".`);
  } catch {
    setTrainStatus(`"${label}" could not be deleted. Please try again.`);
  }
}

function renderTrainedList() {
  const counts = new Map();
  for (const sample of state.samples) {
    counts.set(sample.label, (counts.get(sample.label) ?? 0) + 1);
  }

  el.trainedList.replaceChildren();
  if (counts.size === 0) {
    const empty = document.createElement('li');
    empty.className = 'trained-list-empty';
    empty.textContent = 'No signs taught yet.';
    el.trainedList.append(empty);
    return;
  }

  for (const [label, count] of counts) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${label} (${count} examples)`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-danger btn-small';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => removeSign(label));

    item.append(name, remove);
    el.trainedList.append(item);
  }
}

async function loadTaughtSigns() {
  if (!isStoreConfigured()) {
    el.recordBtn.disabled = true;
    setTrainStatus('Sign storage is not connected, so new signs cannot be saved.');
    return;
  }
  try {
    const rows = await loadSamples();
    state.samples = rows.map((row) => ({ label: row.label, features: row.features }));
    renderTrainedList();
  } catch {
    setTrainStatus('Your taught signs could not be loaded. Reload the page to try again.');
  }
}

function speechSettings() {
  try {
    return JSON.parse(localStorage.getItem(SPEECH_SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveSpeechSettings(settings) {
  localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify({ ...speechSettings(), ...settings }));
}

function selectedVoice() {
  const name = el.voiceSelect.value;
  return getVoices().find((voice) => voice.name === name) ?? null;
}

function populateVoices() {
  const voices = getVoices();
  const savedName = speechSettings().voiceName;
  el.voiceSelect.replaceChildren();
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = voice.name === savedName;
    el.voiceSelect.append(option);
  }
}

function speakSentence() {
  const text = state.sentence.join(' ');
  if (!text) {
    el.speechNotice.textContent = 'Translate a sign first, then press Speak.';
    el.speechNotice.hidden = false;
    return;
  }
  el.speechNotice.hidden = true;
  speak(text, { voice: selectedVoice(), rate: Number(el.rateRange.value) });
}

function initSpeech() {
  if (!isSpeechSupported()) {
    el.speakBtn.disabled = true;
    el.speechNotice.textContent = 'Your browser does not support speech output.';
    el.speechNotice.hidden = false;
    return;
  }

  populateVoices();
  onVoicesChanged(populateVoices);

  const settings = speechSettings();
  if (settings.rate) el.rateRange.value = settings.rate;
  el.rateValue.textContent = `${Number(el.rateRange.value).toFixed(1)}x`;

  el.voiceSelect.addEventListener('change', () => saveSpeechSettings({ voiceName: el.voiceSelect.value }));
  el.rateRange.addEventListener('input', () => {
    el.rateValue.textContent = `${Number(el.rateRange.value).toFixed(1)}x`;
    saveSpeechSettings({ rate: Number(el.rateRange.value) });
  });
  el.speakBtn.addEventListener('click', speakSentence);
  el.stopSpeechBtn.addEventListener('click', stopSpeech);
}

function init() {
  el.startBtn.addEventListener('click', startCamera);
  el.stopBtn.addEventListener('click', stopCamera);
  el.undoBtn.addEventListener('click', () => {
    state.sentence.pop();
    renderSentence();
  });
  el.clearBtn.addEventListener('click', () => {
    state.sentence = [];
    renderSentence();
  });
  el.trainForm.addEventListener('submit', handleTrainSubmit);

  renderSentence();
  initSpeech();
  renderTrainedList();
  loadTaughtSigns();
}

init();
