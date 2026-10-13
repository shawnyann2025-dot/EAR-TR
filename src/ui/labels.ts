import type { PromptId } from '../exercises/generate'
import { displayDegree, type DisplayScheme } from '../music/display'
import { SCALE_DEGREES, type Mode, type ScaleDegree } from '../music/key'

/**
 * 显示文案表（P-3 spec §6.4、P-2b §14）。
 * 作答前只显示题干，绝不显示知识点名称或标签。
 */
export const PROMPT_TEXT: Record<PromptId, string> = {
  'which-degree': '目标音是哪个音级？',
  'sing-degrees': '听完语境后，唱出下面的音级',
  'notate-melody': '依次写出你听到的音级',
  'did-it-modulate': '这段音乐转调了吗？',
  'sing-new-tonic': '唱出新调的主音',
  'new-tonic-degree': '新主音是原调的哪个音级？',
  'which-quality': '这个和弦是大三还是小三？',
  'which-chord': '这是哪个和弦？',
  'sing-arpeggio': '唱出下面的分解和弦',
  'notate-chords': '依次写出你听到的和弦',
  'notate-qualities': '依次写出每个和弦的大小',
  'which-progression': '这是哪条和弦进行？',
  'sing-bassline': '唱出下面的低音线',
  'notate-progression': '写出这条和弦进行',
  'which-inversion': '这个和弦是哪个转位？',
  'which-bass-contour': '低音线是哪一条？',
  'notate-bassline': '依次写出低音的音级',
  'notate-inversions': '依次写出每个和弦的转位',
  'which-pattern': '你听到的是哪个节奏型？',
  'tap-pattern': '跟着节拍器，打出下面的节奏',
  'notate-patterns': '依次写出你听到的节奏型',
  'which-meter': '这是几拍子？',
  'tap-downbeats': '边听边在每小节的第一拍点一下',
  'which-onset-is-beat-one': '第几个音是第一拍？',
  'which-pickup': '这段节奏有没有弱起？',
  'which-meter-sequence': '拍号是怎么变化的？',
  'notate-meters': '依次写出每段的拍号',
}

type LabelKind =
  | 'degree' | 'degreeLine' | 'modulation' | 'quality' | 'chord' | 'progression'
  | 'inversion' | 'onsetOrdinal' | 'meter' | 'meterSequence' | 'pickup' | 'pattern' | 'none'

const KIND: Record<PromptId, LabelKind> = {
  'which-degree': 'degree', 'sing-degrees': 'none', 'notate-melody': 'degree',
  'did-it-modulate': 'modulation', 'sing-new-tonic': 'none', 'new-tonic-degree': 'degree',
  'which-quality': 'quality', 'which-chord': 'chord', 'sing-arpeggio': 'none',
  'notate-chords': 'chord', 'notate-qualities': 'quality',
  'which-progression': 'progression', 'sing-bassline': 'none', 'notate-progression': 'chord',
  'which-inversion': 'inversion', 'which-bass-contour': 'degreeLine', 'notate-bassline': 'degree',
  'notate-inversions': 'inversion',
  'which-pattern': 'pattern', 'tap-pattern': 'pattern', 'notate-patterns': 'pattern',
  'which-meter': 'meter', 'tap-downbeats': 'none', 'which-onset-is-beat-one': 'onsetOrdinal',
  'which-pickup': 'pickup', 'which-meter-sequence': 'meterSequence', 'notate-meters': 'meter',
}

export interface LabelContext {
  scheme: DisplayScheme
  mode: Mode
  prompt: PromptId
}

const isDegree = (id: string): id is ScaleDegree => (SCALE_DEGREES as readonly string[]).includes(id)

/** §15.1：小调（la 基）里半音 8 是升 7 级，拼作 si */
const MINOR_LE: Record<DisplayScheme, string> = { solfege: 'si', numeric: '♯5', degree: '♯^5' }

export function degreeLabel(id: string, scheme: DisplayScheme, mode: Mode): string {
  if (!isDegree(id)) throw new Error(`未知音级 ${id}`)
  if (mode === 'minor' && id === 'le') return MINOR_LE[scheme]
  return displayDegree(id, scheme)
}

const CHORD_IDS = new Set([
  'I', 'ii', 'iii', 'IV', 'V', 'vi', 'Imaj7', 'ii7', 'V7', 'vi7', 'V/V', 'bVI', 'bVII',
  'i', 'iv', 'v', 'III', 'VI', 'VII',
])

export function chordLabel(id: string): string {
  if (!CHORD_IDS.has(id)) throw new Error(`未知和弦 ${id}`)
  return id.replace(/^b/, '♭')
}

const QUALITY: Record<string, string> = { maj: '大三和弦', min: '小三和弦' }
const INVERSION: Record<string, string> = { root: '原位', first: '第一转位', second: '第二转位' }
const MODULATION: Record<string, string> = { shift: '转调了', stay: '没转调' }
const PICKUP: Record<string, string> = { none: '无弱起', half: '弱起半拍', one: '弱起一拍' }
const METERS = new Set(['2/4', '3/4', '4/4', '6/8'])

/** 音型词汇表（P-2b §14） */
const PATTERN_TOKEN: Record<string, string> = {
  q: '♩', ee: '♫', e: '♪', dq: '♩.', h: '𝅗𝅥', r: '𝄽', s: '𝅘𝅥𝅯', ssss: '𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯', trip: '³♪♪♪',
}

function table(t: Record<string, string>, id: string, what: string): string {
  const v = t[id]
  if (v === undefined) throw new Error(`未知${what} ${id}`)
  return v
}

export function patternLabel(id: string): string {
  if (id in PICKUP) return PICKUP[id]
  return id
    .split('|')
    .map((bar) =>
      bar
        .split('-')
        .map((tok) => tok.split('~').map((t) => table(PATTERN_TOKEN, t, '音型')).join('‿'))
        .join(' '),
    )
    .join(' | ')
}

function meterLabel(id: string): string {
  if (!METERS.has(id)) throw new Error(`未知拍号 ${id}`)
  return id
}

export function labelFor(id: string, ctx: LabelContext): string {
  try {
    switch (KIND[ctx.prompt]) {
      case 'degree':
        return degreeLabel(id, ctx.scheme, ctx.mode)
      case 'degreeLine':
        return id.split('-').map((d) => degreeLabel(d, ctx.scheme, ctx.mode)).join(' – ')
      case 'modulation':
        return table(MODULATION, id, '转调选项')
      case 'quality':
        return table(QUALITY, id, '和弦性质')
      case 'chord':
        return chordLabel(id)
      case 'progression':
        return id.split('-').map(chordLabel).join(' → ')
      case 'inversion':
        return table(INVERSION, id, '转位')
      case 'onsetOrdinal':
        if (!/^\d+$/.test(id)) throw new Error(`未知序号 ${id}`)
        return `第 ${id} 个音`
      case 'meter':
        return meterLabel(id)
      case 'meterSequence':
        return id.split('+').map(meterLabel).join(' → ')
      case 'pickup':
        return table(PICKUP, id, '弱起')
      case 'pattern':
        return patternLabel(id)
      case 'none':
        throw new Error('该题型没有可选答案')
    }
  } catch (e) {
    throw new Error(`文案表缺项（${ctx.prompt}）：${(e as Error).message}`)
  }
}

/** 唱模态是否显示要唱的音级。新主音靠耳朵找，显示即泄题 */
export function showsSingTargets(prompt: PromptId): boolean {
  return prompt !== 'sing-new-tonic'
}
