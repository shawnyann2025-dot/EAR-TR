import {
  makeKpId,
  trackOfKind,
  type KnowledgePoint,
  type KnowledgePointId,
  type KnowledgePointKind,
  type Track,
} from './knowledgePoints'

function kp(
  kind: KnowledgePointKind,
  name: string,
  label: string,
  prerequisites: KnowledgePointId[] = [],
): KnowledgePoint {
  return { id: makeKpId(kind, name), kind, track: trackOfKind(kind), label, prerequisites }
}

const D = (name: string) => makeKpId('degree', name)
const C = (name: string) => makeKpId('chord', name)

/**
 * T 轨 · 音级（spec §8.1）
 *
 * 调式进 id：la 基唱名下 `mi` 在大调是第 3 级（稳定），在小调是第 5 级
 * （属音，倾向性完全不同）。听辨它们是两种技能，掌握度必须分开追踪。
 */
const TONAL: KnowledgePoint[] = [
  // T1 主三和弦骨架
  kp('degree', 'major:do', '大调 do（主音）'),
  kp('degree', 'major:mi', '大调 mi（三级）'),
  kp('degree', 'major:sol', '大调 sol（属音）'),
  // T2 五声
  kp('degree', 'major:re', '大调 re（二级）', [D('major:do'), D('major:mi')]),
  kp('degree', 'major:la', '大调 la（六级）', [D('major:sol')]),
  // T3 补全大调
  kp('degree', 'major:fa', '大调 fa（下属，倾向 mi）', [D('major:mi'), D('major:sol')]),
  kp('degree', 'major:ti', '大调 ti（导音，倾向 do）', [D('major:do'), D('major:la')]),
  // T5 自然小调（la 基）
  kp('degree', 'minor:la', '小调 la（主音）', [D('major:la')]),
  kp('degree', 'minor:do', '小调 do（三级）', [D('minor:la')]),
  kp('degree', 'minor:mi', '小调 mi（属音）', [D('minor:la')]),
  kp('degree', 'minor:ti', '小调 ti（二级）', [D('minor:la'), D('minor:do')]),
  kp('degree', 'minor:re', '小调 re（四级）', [D('minor:do')]),
  kp('degree', 'minor:fa', '小调 fa（六级）', [D('minor:mi')]),
  kp('degree', 'minor:sol', '小调 sol（七级）', [D('minor:mi')]),
  // T6 和声/旋律小调
  kp('degree', 'minor:si', '小调升 7 级（和声小调导音）', [D('minor:sol'), D('minor:la')]),
  kp('degree', 'minor:fi', '小调升 6 级（旋律小调）', [D('minor:fa')]),
  // T7 常见变化音
  kp('degree', 'major:fi', '大调升 4 级 fi', [D('major:fa'), D('major:sol')]),
  kp('degree', 'major:te', '大调降 7 级 te', [D('major:ti'), D('major:la')]),
  kp('degree', 'major:me', '大调降 3 级 me', [D('major:mi'), D('major:re')]),
  // T8 转调
  kp('degree', 'modulation:shift', '调中心是否移动', [D('major:ti'), D('minor:si')]),
]

/** H 轨 · 和声（spec §8.1） */
const HARMONY: KnowledgePoint[] = [
  // H1 品质
  kp('chord', 'quality-maj', '大三和弦'),
  kp('chord', 'quality-min', '小三和弦'),
  // H2 主要功能
  kp('chord', 'I', 'I 级（主）', [C('quality-maj')]),
  kp('chord', 'IV', 'IV 级（下属）', [C('quality-maj'), C('I')]),
  kp('chord', 'V', 'V 级（属）', [C('quality-maj'), C('I')]),
  // H3 次要功能
  kp('chord', 'vi', 'vi 级', [C('quality-min'), C('I')]),
  kp('chord', 'ii', 'ii 级', [C('quality-min'), C('IV')]),
  // H4 七和弦
  kp('chord', 'V7', '属七和弦', [C('V')]),
  kp('chord', 'Imaj7', '大七和弦 Imaj7', [C('I')]),
  kp('chord', 'ii7', '小七和弦 ii7', [C('ii')]),
  kp('chord', 'vi7', '小七和弦 vi7', [C('vi')]),
  // H5 整条进行
  kp('prog', 'I-V-vi-IV', '进行 I–V–vi–IV', [C('I'), C('V'), C('vi'), C('IV')]),
  kp('prog', 'vi-IV-I-V', '进行 vi–IV–I–V', [C('I'), C('V'), C('vi'), C('IV')]),
  kp('prog', 'I-vi-IV-V', '进行 I–vi–IV–V', [C('I'), C('V'), C('vi'), C('IV')]),
  // H6 转位与低音线
  kp('chord', 'inv-first', '第一转位', [C('I'), C('IV'), C('V')]),
  kp('chord', 'inv-second', '第二转位', [C('inv-first')]),
  kp('chord', 'bassline', '低音线走向', [C('inv-first')]),
  // H7 小调进行
  kp('chord', 'i', 'i 级（小调主）', [C('quality-min')]),
  kp('chord', 'iv', 'iv 级（小调下属）', [C('quality-min'), C('i')]),
  kp('chord', 'VI', 'VI 级（小调）', [C('quality-maj'), C('i')]),
  kp('chord', 'III', 'III 级（小调）', [C('quality-maj'), C('i')]),
  kp('chord', 'VII', 'VII 级（小调）', [C('quality-maj'), C('i')]),
  kp('prog', 'i-VI-III-VII', '小调进行 i–VI–III–VII', [C('i'), C('III'), C('VI'), C('VII')]),
  // H8 借用与副属
  kp('chord', 'V-of-V', '副属 V/V', [C('V'), C('ii')]),
  kp('chord', 'borrowed-bVI', '借用 ♭VI', [C('VI'), C('I')]),
  kp('chord', 'borrowed-bVII', '借用 ♭VII', [C('VII'), C('I')]),
]

/** R 轨 · 节奏（spec §8.1） */
const RHYTHM: KnowledgePoint[] = [
  // R1 拍点与拍号
  kp('rhythm', 'beat-one', '找 beat 1'),
  kp('rhythm', 'meter-2-4', '2/4 拍', [makeKpId('rhythm', 'beat-one')]),
  kp('rhythm', 'meter-3-4', '3/4 拍', [makeKpId('rhythm', 'beat-one')]),
  // R2 基本组合
  kp('rhythm', 'quarter', '四分音符', [makeKpId('rhythm', 'beat-one')]),
  kp('rhythm', 'eighth-pair', '八分音符组合', [makeKpId('rhythm', 'quarter')]),
  // R3 附点与休止
  kp('rhythm', 'dotted', '附点节奏', [makeKpId('rhythm', 'eighth-pair')]),
  kp('rhythm', 'rest', '休止符', [makeKpId('rhythm', 'quarter')]),
  // R4 十六分
  kp('rhythm', 'sixteenth', '十六分组合', [makeKpId('rhythm', 'eighth-pair')]),
  // R5 切分
  kp('rhythm', 'synco-8', '八分切分', [makeKpId('rhythm', 'eighth-pair'), makeKpId('rhythm', 'dotted')]),
  // R6 三连音与复合拍
  kp('rhythm', 'triplet', '三连音', [makeKpId('rhythm', 'eighth-pair')]),
  kp('rhythm', 'meter-6-8', '6/8 复合拍', [makeKpId('rhythm', 'triplet'), makeKpId('rhythm', 'meter-3-4')]),
  // R7 弱起与连线
  kp('rhythm', 'anacrusis', '弱起', [makeKpId('rhythm', 'beat-one'), makeKpId('rhythm', 'quarter')]),
  kp('rhythm', 'tie-across-bar', '跨小节连线', [makeKpId('rhythm', 'synco-8')]),
  // R8 混合拍子与复杂切分
  kp('rhythm', 'mixed-meter', '混合拍子', [makeKpId('rhythm', 'meter-6-8'), makeKpId('rhythm', 'meter-2-4')]),
  kp('rhythm', 'synco-16', '十六分切分', [makeKpId('rhythm', 'synco-8'), makeKpId('rhythm', 'sixteenth')]),
]

export const ALL_KNOWLEDGE_POINTS: readonly KnowledgePoint[] = [
  ...TONAL,
  ...HARMONY,
  ...RHYTHM,
]

export function knowledgePointsOfTrack(track: Track): KnowledgePoint[] {
  return ALL_KNOWLEDGE_POINTS.filter((kp) => kp.track === track)
}
