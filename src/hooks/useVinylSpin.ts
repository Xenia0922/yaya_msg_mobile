import { useEffect } from 'react';
import { Animated, AppState, Easing } from 'react-native';

export const vinylSpin = new Animated.Value(0);

const ROTATION_MS = 12000;
let spinAnim: Animated.CompositeAnimation | null = null;
let spinSeq = 0;
let spinningTrackKey: string | null = null;
let currentSpinValue = 0;
let appActive = AppState.currentState === 'active';
let appSubInstalled = false;

let desiredTrackKey: string | undefined;
let desiredPlaying = false;
const activeConsumers = new Set<symbol>();

function normFrac(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const f = v - Math.floor(v);
  return f < 0 ? f + 1 : f;
}

function stopLoop() {
  spinSeq += 1;
  const active = spinAnim;
  spinAnim = null;
  if (active) {
    active.stop();
    vinylSpin.stopAnimation((val) => {
      if (Number.isFinite(val)) {
        currentSpinValue = normFrac(val);
        vinylSpin.setValue(currentSpinValue);
      }
    });
  }
}

function startLoop() {
  if (spinAnim || activeConsumers.size === 0 || !desiredPlaying || !appActive) return;
  const frac = normFrac(currentSpinValue);
  currentSpinValue = frac;
  vinylSpin.setValue(frac);
  const remaining = frac > 0.001 && frac < 0.999 ? 1 - frac : 1;
  const duration = Math.max(80, Math.round(remaining * ROTATION_MS));
  const mySeq = ++spinSeq;
  const tick = Animated.timing(vinylSpin, {
    toValue: 1,
    duration,
    easing: Easing.linear,
    useNativeDriver: true,
  });
  spinAnim = tick;
  tick.start(({ finished }) => {
    if (mySeq !== spinSeq || spinAnim !== tick) return;
    spinAnim = null;
    if (finished) {
      currentSpinValue = 0;
      vinylSpin.setValue(0);
      startLoop();
    }
  });
}

function syncSpinState() {
  if (activeConsumers.size === 0) {
    stopLoop();
    return;
  }
  if (desiredTrackKey && desiredTrackKey !== spinningTrackKey) {
    stopLoop();
    currentSpinValue = 0;
    vinylSpin.setValue(0);
    spinningTrackKey = desiredTrackKey;
  }
  if (desiredPlaying && appActive) startLoop();
  else stopLoop();
}

function ensureAppStateListener() {
  if (appSubInstalled) return;
  appSubInstalled = true;
  AppState.addEventListener('change', (next) => {
    appActive = next === 'active';
    syncSpinState();
  });
}

export function useVinylSpin(trackKey: string | undefined, isPlaying: boolean): Animated.Value {
  useEffect(() => {
    ensureAppStateListener();
    const token = Symbol('vinyl-consumer');
    activeConsumers.add(token);
    return () => {
      activeConsumers.delete(token);
      if (activeConsumers.size === 0) stopLoop();
    };
  }, []);

  useEffect(() => {
    desiredTrackKey = trackKey;
    desiredPlaying = isPlaying;
    syncSpinState();
  }, [trackKey, isPlaying]);

  return vinylSpin;
}
