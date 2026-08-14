// iOS 26 动效曲线：弹性 spring 反馈
export const motion = {
  duration: {
    fast: 160,
    base: 240,
    slow: 360,
  },
  // iOS spring response/dampingFriction：response 越小越快，damping 越大越稳
  spring: {
    /** 弹性反馈按钮/列表 */
    bouncy: { damping: 14, mass: 1, stiffness: 180, overshootClamping: false },
    /** 全局默认 transition */
    default: { damping: 22, mass: 1, stiffness: 220, overshootClamping: false },
    /** 精确不抖动（页面过渡） */
    precise: { damping: 30, mass: 1, stiffness: 250, overshootClamping: true },
  },
} as const;
