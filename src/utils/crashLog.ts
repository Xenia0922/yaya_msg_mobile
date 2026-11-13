import * as FileSystem from 'expo-file-system/legacy';
import { logCrash, logInfo } from './runtimeLog';

/**
 * 原生崩溃回收。
 *
 * 原生侧 CrashLogger 把未捕获异常写到 filesDir/crash/crash-<ts>.log；
 * expo 的 documentDirectory 就是 filesDir，所以这里可以直接读到。
 *
 * 每次 App 启动扫一遍：把新崩溃并入「运行日志」(level=crash) 后删除文件，
 * 用户可在 设置 → 运行日志 → 崩溃 里直接看到堆栈并复制/分享。
 */
const CRASH_DIR = `${FileSystem.documentDirectory || ''}crash/`;
/** 原生诊断日志目录（非崩溃）：系统小窗等静默失败的关键节点 */
const DIAG_DIR = `${FileSystem.documentDirectory || ''}diag/`;

/** 读取并消费所有未处理的原生崩溃日志，返回本次导入条数 */
export async function syncNativeCrashes(limit = 3): Promise<number> {
  if (!FileSystem.documentDirectory) return 0;
  try {
    const info = await FileSystem.getInfoAsync(CRASH_DIR);
    if (!info.exists) return 0;
    const names = (await FileSystem.readDirectoryAsync(CRASH_DIR))
      .filter((n) => n.endsWith('.log'))
      .sort();
    if (!names.length) return 0;
    // 只取最新的 limit 个，避免一次灌爆日志缓冲
    const picked = names.slice(-limit);
    let imported = 0;
    for (const name of picked) {
      try {
        const text = await FileSystem.readAsStringAsync(`${CRASH_DIR}${name}`);
        logCrash(text.slice(0, 4000), 'native-crash');
        imported += 1;
      } catch {
        /* 单条读取失败不影响其他 */
      }
      // 无论读取成功与否都删掉，避免每次启动重复导入
      await FileSystem.deleteAsync(`${CRASH_DIR}${name}`, { idempotent: true }).catch(() => {});
    }
    // 剩余旧文件一并清理（只保留最近一次会话的记录价值）
    for (const name of names.slice(0, Math.max(0, names.length - limit))) {
      await FileSystem.deleteAsync(`${CRASH_DIR}${name}`, { idempotent: true }).catch(() => {});
    }
    return imported;
  } catch {
    return 0;
  }
}

/**
 * 读取并消费原生诊断日志（非崩溃）。
 *
 * 原生侧把系统小窗（PiP）等「静默失败」的关键节点写进 filesDir/diag/，
 * release 包 console.log 不落地、用户也不会看 logcat，必须走 App 的「运行日志 →
 * 日志导出」通道才能远程定位。启动时并入一次，用户导出时就能看到。
 */
export async function syncNativeDiags(limit = 3): Promise<number> {
  if (!FileSystem.documentDirectory) return 0;
  try {
    const info = await FileSystem.getInfoAsync(DIAG_DIR);
    if (!info.exists) return 0;
    const names = (await FileSystem.readDirectoryAsync(DIAG_DIR))
      .filter((n) => n.endsWith('.log'))
      .sort();
    if (!names.length) return 0;
    const picked = names.slice(-limit);
    let imported = 0;
    for (const name of picked) {
      try {
        const text = await FileSystem.readAsStringAsync(`${DIAG_DIR}${name}`);
        const lines = text.split('\n').filter((l) => l.trim()).slice(-120);
        if (lines.length) {
          logInfo(lines.join('\n'), 'native-diag');
          imported += 1;
        }
      } catch {
        /* 单条读取失败不影响其他 */
      }
      await FileSystem.deleteAsync(`${DIAG_DIR}${name}`, { idempotent: true }).catch(() => {});
    }
    for (const name of names.slice(0, Math.max(0, names.length - limit))) {
      await FileSystem.deleteAsync(`${DIAG_DIR}${name}`, { idempotent: true }).catch(() => {});
    }
    return imported;
  } catch {
    return 0;
  }
}
