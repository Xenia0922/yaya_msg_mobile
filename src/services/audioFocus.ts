export type AudioOwner = 'music' | 'video' | 'mini' | 'radio' | 'voice';
export type AudioYieldReason = AudioOwner | 'reset';
export type AudioYieldHandler = (reason: AudioYieldReason) => void;

const handlers = new Map<AudioOwner, AudioYieldHandler>();
let activeOwner: AudioOwner | null = null;
let radioForegroundActive = false;

export function registerAudioHandler(owner: AudioOwner, onYield: AudioYieldHandler): () => void {
  handlers.set(owner, onYield);
  return () => {
    if (handlers.get(owner) === onYield) {
      handlers.delete(owner);
    }
  };
}

export function claimAudioFocus(owner: AudioOwner): void {
  activeOwner = owner;
  if (owner !== 'radio' && owner !== 'mini') {
    radioForegroundActive = false;
  }
  handlers.forEach((handler, key) => {
    if (key === owner) return;
    try {
      handler(owner);
    } catch {}
  });
}

export function releaseAudioFocus(owner: AudioOwner): void {
  if (activeOwner === owner) {
    activeOwner = null;
  }
}

export function getActiveAudioOwner(): AudioOwner | null {
  return activeOwner;
}

export function stopAllAudio(_reason?: string): void {
  activeOwner = null;
  radioForegroundActive = false;
  handlers.forEach((handler) => {
    try {
      handler('reset');
    } catch {}
  });
}

export function setRadioForegroundActive(active: boolean): void {
  radioForegroundActive = !!active;
}

export function isRadioForegroundActive(): boolean {
  return radioForegroundActive;
}
