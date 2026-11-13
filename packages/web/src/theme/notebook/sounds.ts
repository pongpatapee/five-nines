/**
 * The notebook's sounds, synthesised with the Web Audio API: no audio files. Desk sounds for the desk theme: a page
 * turning, a pen scratching, a rubber stamp, a pencil tick, the on-call pager buzzing and a small win chime.
 *
 * Every synth starts its sources at `at` and stops them a moment later, so nothing keeps running.
 */
import type { SoundCue, SoundSynth } from '../contract.ts';

/** One second of white noise per context, made once. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(context: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    // A fixed linear congruential sequence: the same hiss every time.
    let seed = 1;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

/** A gain that rises to `peak` in `attack` seconds and decays to silence by `at + length`. */
function envelope(context: BaseAudioContext, out: AudioNode, at: number, peak: number, attack: number, length: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.connect(out);
  return gain;
}

function noiseBurst(context: BaseAudioContext, into: AudioNode, at: number, length: number, offset = 0): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = noise(context);
  source.connect(into);
  source.start(at, offset);
  source.stop(at + length);
  return source;
}

function tone(
  context: BaseAudioContext,
  into: AudioNode,
  at: number,
  length: number,
  type: OscillatorType,
  from: number,
  to = from,
): OscillatorNode {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
  osc.connect(into);
  osc.start(at);
  osc.stop(at + length);
  return osc;
}

function filter(context: BaseAudioContext, out: AudioNode, type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.connect(out);
  return node;
}

/** A page turning: a swish of paper noise whose brightness sweeps up and back. */
const pageTurn: SoundSynth = (context, out, at) => {
  const gain = envelope(context, out, at, 0.35, 0.06, 0.32);
  const band = filter(context, gain, 'bandpass', 900, 0.8);
  band.frequency.setValueAtTime(700, at);
  band.frequency.exponentialRampToValueAtTime(3200, at + 0.14);
  band.frequency.exponentialRampToValueAtTime(1200, at + 0.3);
  noiseBurst(context, band, at, 0.34);
};

/** A pen scratching a quick stroke: bright noise in three short strokes. */
const penScratch: SoundSynth = (context, out, at) => {
  const band = filter(context, out, 'bandpass', 3800, 2.5);
  for (const [i, start] of [0, 0.06, 0.13].entries()) {
    const gain = envelope(context, band, at + start, 0.22 - i * 0.04, 0.008, 0.05);
    noiseBurst(context, gain, at + start, 0.06, i * 0.1);
  }
};

/** A pencil tick: one tiny, bright click. */
const pencilTick: SoundSynth = (context, out, at) => {
  const gain = envelope(context, out, at, 0.18, 0.003, 0.05);
  noiseBurst(context, filter(context, gain, 'bandpass', 5200, 4), at, 0.05);
  tone(context, envelope(context, out, at, 0.05, 0.003, 0.04), at, 0.04, 'sine', 1900);
};

/** A rubber stamp landing: a low thump with a papery slap on top. */
const stamp: SoundSynth = (context, out, at) => {
  tone(context, envelope(context, out, at, 0.6, 0.005, 0.18), at, 0.18, 'sine', 150, 48);
  const slap = envelope(context, out, at, 0.3, 0.002, 0.08);
  noiseBurst(context, filter(context, slap, 'lowpass', 1800, 0.7), at, 0.09);
};

/** The on-call pager: three short buzzes of a vibrating motor. */
const pager: SoundSynth = (context, out, at) => {
  const body = filter(context, out, 'lowpass', 900, 1.5);
  for (const start of [0, 0.16, 0.32]) {
    const gain = envelope(context, body, at + start, 0.22, 0.01, 0.12);
    tone(context, gain, at + start, 0.12, 'sawtooth', 110);
    tone(context, gain, at + start, 0.12, 'square', 220);
  }
};

/** A small win chime: three bell notes rising (C6, E6, G6). */
const chime: SoundSynth = (context, out, at) => {
  for (const [i, frequency] of [1046.5, 1318.5, 1568].entries()) {
    const start = at + i * 0.09;
    tone(context, envelope(context, out, start, 0.16, 0.005, 0.9), start, 0.9, 'sine', frequency);
    // A quiet overtone makes it ring like a bell rather than a beep.
    tone(context, envelope(context, out, start, 0.04, 0.005, 0.4), start, 0.4, 'sine', frequency * 2.76);
  }
};

export const NOTEBOOK_SOUNDS: Readonly<Record<SoundCue, SoundSynth>> = {
  navigate: pageTurn,
  hint: penScratch,
  nine: pencilTick,
  grade: stamp,
  badge: stamp,
  win: chime,
  crash: pager,
  incident: stamp,
};
