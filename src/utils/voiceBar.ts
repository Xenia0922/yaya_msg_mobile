export const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];

export function nextVoiceRate(current: number): VoiceRate {
  const idx = VOICE_RATES.indexOf(current as VoiceRate);
  if (idx < 0) return 1.5;
  return VOICE_RATES[(idx + 1) % VOICE_RATES.length];
}

export function formatVoiceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function computeVoiceBarWidth(durationSec: number): number {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 5;
  const raw = Math.round(150 + dur * 2.3);
  return Math.max(156, Math.min(252, raw));
}

export function buildVoiceWaveform(seed: string, barCount = 24): number[] {
  const count = Math.max(4, Math.round(barCount));
  let hash = 2166136261;
  const input = String(seed || 'yaya-voice');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    hash ^= (i + 1) * 2654435761;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
    const norm = (hash % 1000) / 1000;
    const edgeEnvelope = Math.sin(((i + 0.5) / count) * Math.PI);
    const val = 0.28 + (0.45 * norm + 0.27 * edgeEnvelope);
    bars.push(Number(Math.min(1, Math.max(0.26, val)).toFixed(3)));
  }
  return bars;
}

export function computeSeekSeconds(
  locationX: number,
  trackWidth: number,
  durationSec: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (Number(locationX) || 0) / trackWidth));
  return Number((ratio * durationSec).toFixed(2));
}
