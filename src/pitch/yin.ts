/**
 * YIN 基频估计（de Cheveigné & Kawahara 2002），单帧。纯函数，零 IO。
 * 参数见主 spec §9.1：48 kHz / 帧长 2048 / hop 512。
 */
export const SAMPLE_RATE = 48_000
export const FRAME_SIZE = 2048
export const HOP_SIZE = 512
/** 累积均值归一化差分的绝对阈值 */
export const YIN_THRESHOLD = 0.15
export const F0_MIN_HZ = 60
export const F0_MAX_HZ = 1100

export interface PitchFrame {
  /** 无声或不可信时为 null */
  f0Hz: number | null
  /** 所选周期处的 d′ 值；越小越周期 */
  aperiodicity: number
  rms: number
}

// 复用的工作缓冲区（仅在所需长度增长时重新分配）；yinFrame 同步执行，无重入
let dBuf = new Float64Array(0)
let cmndBuf = new Float64Array(0)

export function yinFrame(samples: Float32Array, sampleRate: number = SAMPLE_RATE): PitchFrame {
  const n = samples.length
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i]
  const rms = n > 0 ? Math.sqrt(sumSq / n) : 0

  const tauMin = Math.max(2, Math.floor(sampleRate / F0_MAX_HZ))
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / F0_MIN_HZ))
  if (tauMax <= tauMin + 1) return { f0Hz: null, aperiodicity: 1, rms }
  const w = n - tauMax

  // 1. 差分函数
  if (dBuf.length < tauMax + 1) {
    dBuf = new Float64Array(tauMax + 1)
    cmndBuf = new Float64Array(tauMax + 1)
  }
  const d = dBuf
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0
    for (let j = 0; j < w; j++) {
      const diff = samples[j] - samples[j + tau]
      s += diff * diff
    }
    d[tau] = s
  }

  // 2. 累积均值归一化
  const cmnd = cmndBuf
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1
  }

  // 3. 绝对阈值：第一个低于阈值的谷，取该谷的局部极小
  let tauEst = -1
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++
      tauEst = tau
      break
    }
  }
  if (tauEst < 0) {
    let best = tauMin
    for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau
    return { f0Hz: null, aperiodicity: cmnd[best], rms }
  }

  // 4. 抛物线插值（在原始差分函数上，精度更好）
  let refined = tauEst
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = d[tauEst - 1]
    const s1 = d[tauEst]
    const s2 = d[tauEst + 1]
    const denom = s0 + s2 - 2 * s1
    if (denom > 0) refined = tauEst + (s0 - s2) / (2 * denom)
  }
  return { f0Hz: sampleRate / refined, aperiodicity: cmnd[tauEst], rms }
}
