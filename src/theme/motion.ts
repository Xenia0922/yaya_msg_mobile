export const motion = {
  duration: {
    fast: 160,
    base: 240,
    slow: 360,
  },

  spring: {
    bouncy: { damping: 14, mass: 1, stiffness: 180, overshootClamping: false },

    default: { damping: 22, mass: 1, stiffness: 220, overshootClamping: false },

    precise: { damping: 30, mass: 1, stiffness: 250, overshootClamping: true },
  },
} as const;
