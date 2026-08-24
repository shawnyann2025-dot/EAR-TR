/** 音类，0–11，0 = C */
export type PitchClass = number

export type Mode = 'major' | 'minor'

export interface Key {
  tonic: PitchClass
  mode: Mode
}

/**
 * 首调音级名。12 个音类各一名。
 *
 * 注意：本枚举不处理语境相关拼写（半音 8 上行传统上称 si、下行称 le，
 * 此处统一为 le）。这是有意的——底层需要一个稳定的 key 供掌握度模型使用。
 * 显示层的语境相关拼写见 spec §15.1，在 T6 进入课程前解决。
 */
export const SCALE_DEGREES = [
  'do', 'ra', 're', 'me', 'mi', 'fa',
  'fi', 'sol', 'le', 'la', 'te', 'ti',
] as const

export type ScaleDegree = (typeof SCALE_DEGREES)[number]

/** 各音级相对 do 的半音数 */
export const DEGREE_SEMITONES: Record<ScaleDegree, number> = {
  do: 0, ra: 1, re: 2, me: 3, mi: 4, fa: 5,
  fi: 6, sol: 7, le: 8, la: 9, te: 10, ti: 11,
}

/** 大调音阶的七个音级 */
export const MAJOR_SCALE_DEGREES = [
  'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
] as const satisfies readonly ScaleDegree[]

/** 自然小调音阶的七个音级（la 基） */
export const NATURAL_MINOR_DEGREES = [
  'la', 'ti', 'do', 're', 'mi', 'fa', 'sol',
] as const satisfies readonly ScaleDegree[]

/**
 * 'do' 在该调中对应的音类。
 *
 * 大调：do 即主音。
 * 小调：采用 la 基唱名，主音是 la，故 do 落在主音上方小三度
 *       （即关系大调的主音）。
 */
export function doReference(key: Key): PitchClass {
  return key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12
}

/** 某音级在该调中对应的音类 */
export function degreeToPitchClass(degree: ScaleDegree, key: Key): PitchClass {
  return (doReference(key) + DEGREE_SEMITONES[degree]) % 12
}

/** 该调主音对应的音级名 */
export function tonicDegree(key: Key): ScaleDegree {
  return key.mode === 'major' ? 'do' : 'la'
}
