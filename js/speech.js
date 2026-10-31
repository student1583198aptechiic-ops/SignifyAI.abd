// Text-to-speech helpers built on the browser's speech synthesis.
const synth = window.speechSynthesis;

export function isSpeechSupported() {
  return Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function getVoices() {
  return synth ? synth.getVoices() : [];
}

export function onVoicesChanged(callback) {
  synth.addEventListener('voiceschanged', callback);
}

export function speak(text, { voice, rate }) {
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  synth.speak(utterance);
}

export function stopSpeech() {
  synth.cancel();
}
