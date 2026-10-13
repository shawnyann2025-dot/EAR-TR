import type { Answer, Exercise, GradeResult, Response } from './types'

const TAP_EPSILON = 1e-9

function mismatch(expected: string, got: string): never {
  throw new Error(`作答格式 ${got} 与题目格式 ${expected} 不匹配`)
}

/**
 * 判定（P-2b spec §8）。纯函数。
 * 作答种类与题目格式不匹配时抛错——那是调用方的 bug，不是学习者答错。
 */
export function grade(
  exercise: Pick<Exercise, 'format' | 'answer'>,
  response: Response,
): GradeResult {
  const { answer } = exercise
  switch (answer.kind) {
    case 'choice': {
      if (response.kind !== 'choice') return mismatch('choice', response.kind)
      return { correct: response.id === answer.id, detail: { kind: 'choice' } }
    }
    case 'sequence': {
      if (response.kind !== 'sequence') return mismatch('sequence', response.kind)
      const positions = answer.ids.map((id, i) => response.ids[i] === id)
      const correct =
        response.ids.length === answer.ids.length && positions.every(Boolean)
      return { correct, detail: { kind: 'sequence', positions } }
    }
    case 'pitch': {
      if (response.kind !== 'pitch') return mismatch('pitch', response.kind)
      return { correct: response.selfAssessedCorrect, detail: { kind: 'pitch' } }
    }
    case 'tap': {
      if (response.kind !== 'tap') return mismatch('tap', response.kind)
      if (exercise.format.kind !== 'tap') return mismatch('tap', exercise.format.kind)
      const target = answer.onsetsSec
      const taps = response.tapsSec
      if (taps.length === 0) {
        return { correct: false, detail: { kind: 'tap', offsetsSec: [] } }
      }
      // 整串平移，让首击对齐首个目标起音——消除反应延迟，只比节奏本身
      const shift = target[0] - taps[0]
      const n = Math.min(taps.length, target.length)
      const offsetsSec = Array.from({ length: n }, (_, i) => taps[i] + shift - target[i])
      const tolerance = exercise.format.toleranceSec
      const correct =
        taps.length === target.length &&
        offsetsSec.every((o) => Math.abs(o) <= tolerance + TAP_EPSILON)
      return { correct, detail: { kind: 'tap', offsetsSec } }
    }
  }
}

/** 正确答案 → 完美作答。属性测试与 P-3 演示模式用 */
export function answerAsResponse(answer: Answer): Response {
  switch (answer.kind) {
    case 'choice':
      return { kind: 'choice', id: answer.id }
    case 'sequence':
      return { kind: 'sequence', ids: [...answer.ids] }
    case 'pitch':
      return { kind: 'pitch', selfAssessedCorrect: true }
    case 'tap':
      return { kind: 'tap', tapsSec: [...answer.onsetsSec] }
  }
}
