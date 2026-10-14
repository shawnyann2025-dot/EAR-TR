// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BossChallenge } from '../../boss/types'
import { generateBoss } from '../../boss/generate'
import { buildCurriculum } from '../../curriculum/curriculum'
import type { PlaybackPlan } from '../../music/playback'
import { labelFor } from '../labels'
import type { LazyAudio } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Boss, FULL_REPLAYS } from './Boss'

afterEach(cleanup)
const c = buildCurriculum()

function fakeAudio() {
  const plays: PlaybackPlan[] = []
  const audio = {
    ready: true, latencySec: 0, currentTime: 0, state: 'running' as const, context: null,
    async unlock() {},
    play: (plan: PlaybackPlan) => { plays.push(plan); return { startSec: 0, endSec: plan.totalDurSec } },
    stopAll: vi.fn(),
    onStateChange: () => () => {},
  }
  return { audio: audio as unknown as LazyAudio, plays }
}

function fakeRuntime(ch: BossChallenge, opts: { remaining?: number } = {}) {
  const recorded: unknown[] = []
  const snap = { profile: { id: 'p', phaseId: ch.piece.phaseId, displayScheme: 'solfege' }, session: null, storage: 'ok', lastError: null, storageError: null, lastBackup: null, playback: null }
  const rt = {
    getSnapshot: () => snap,
    subscribe: () => () => {},
    bossStatus: async () => ({ phaseId: ch.piece.phaseId, masteryReady: true, blockingKeys: 0, attemptsToday: 0, remainingToday: opts.remaining ?? 3 }),
    newBossChallenge: async () => ch,
    recordBossAttempt: vi.fn(async (_c: unknown, g: { passed: boolean }) => { recorded.push(g); return { advancedTo: g.passed ? 'P2' : null } }),
  }
  return { rt, recorded }
}

const mic = { ensure: async () => {}, start: async () => {}, stop: async () => [], close() {} }

function mount(ch: BossChallenge, onExit = vi.fn()) {
  const { audio, plays } = fakeAudio()
  const { rt, recorded } = fakeRuntime(ch)
  render(
    <RuntimeProvider runtime={rt as never} audio={audio} mic={mic}>
      <Boss onExit={onExit} />
    </RuntimeProvider>,
  )
  return { plays, recorded, rt }
}

const label = (_ch: BossChallenge, prompt: Parameters<typeof labelFor>[1]['prompt'], id: string) =>
  labelFor(id, { scheme: 'solfege', mode: 'major', prompt })

async function fillSequence(ch: BossChallenge, prompt: Parameters<typeof labelFor>[1]['prompt'], ids: string[], groupIndex: number) {
  const groups = document.querySelectorAll('.sequence')
  const group = groups[groupIndex] as HTMLElement
  for (const id of ids) {
    const btn = [...group.querySelectorAll('button')].find((b) => b.textContent === label(ch, prompt, id))!
    await act(async () => { fireEvent.click(btn) })
  }
  const submit = [...group.querySelectorAll('button')].find((b) => b.textContent === '提交')!
  await act(async () => { fireEvent.click(submit) })
}

describe('关卡页（P-5 spec §4.2）', () => {
  it('P1：听整曲 → 拍号（在乐句之前）→ 逐句 → 提交 → 通过结果', async () => {
    const ch = generateBoss(c, 'P1', 1)
    const { plays, recorded } = mount(ch)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    expect(plays).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始作答' })) })
    // 拍号先于任何乐句
    expect(screen.queryByText(/第 1 \/ /)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label(ch, 'which-meter', ch.answer.meter!) })) })
    for (let i = 0; i < ch.phrases.length; i++) {
      expect(screen.getByText(new RegExp(`第 ${i + 1} / ${ch.phrases.length} 句`))).toBeTruthy()
      await fillSequence(ch, 'notate-melody', ch.answer.melody[i], 0)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: i === ch.phrases.length - 1 ? '提交关卡' : '下一句' })) })
    }
    expect(recorded).toHaveLength(1)
    expect(await screen.findByText(/升入 P2/)).toBeTruthy()
  })

  it('整曲重听最多 3 次；单句重听不限', async () => {
    const ch = generateBoss(c, 'P2', 2)
    const { plays } = mount(ch)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始作答' })) })
    for (let k = FULL_REPLAYS; k > 0; k--) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: `重听整曲（剩 ${k} 次）` })) })
    }
    expect(screen.getByRole('button', { name: '重听整曲（剩 0 次）' })).toHaveProperty('disabled', true)
    for (let k = 0; k < 5; k++) await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重听本句' })) })
    expect(plays).toHaveLength(1 + FULL_REPLAYS + 5)
  })

  it('P3：每句有旋律与和弦两组作答，两组都提交后才能「下一句」', async () => {
    const ch = generateBoss(c, 'P3', 3)
    mount(ch)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始作答' })) })
    expect(document.querySelectorAll('.sequence')).toHaveLength(2)
    await fillSequence(ch, 'notate-melody', ch.answer.melody[0], 0)
    expect(screen.getByRole('button', { name: '下一句' })).toHaveProperty('disabled', true)
    await fillSequence(ch, 'notate-chords', ch.answer.chords!.slice(0, 2), 0)
    expect(screen.getByRole('button', { name: '下一句' })).toHaveProperty('disabled', false)
  })

  it('P5：最后一页是新调主音；乐句页提示第 5–8 小节按新调标注', async () => {
    const ch = generateBoss(c, 'P5', 0)
    mount(ch)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始作答' })) })
    for (let i = 0; i < ch.phrases.length; i++) {
      if (ch.phrases[i].startBar >= ch.piece.modulationBar!) expect(screen.getByText(/第 5–8 小节按新调标注/)).toBeTruthy()
      await fillSequence(ch, 'notate-melody', ch.answer.melody[i], 0)
      await fillSequence(ch, 'notate-chords', ch.answer.chords!.slice(ch.phrases[i].startBar, ch.phrases[i].endBar), 0)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下一句' })) })
    }
    expect(screen.getByText(/新调的主音是原调的哪个音级/)).toBeTruthy()
  })

  it('中途离开不记录尝试', async () => {
    const ch = generateBoss(c, 'P2', 4)
    const onExit = vi.fn()
    const { recorded } = mount(ch, onExit)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    cleanup()
    expect(recorded).toHaveLength(0)
  })

  it('没过：显示逐句对照与「换一段再试」', async () => {
    const ch = generateBoss(c, 'P2', 5)
    mount(ch)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '播放整曲' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始作答' })) })
    for (let i = 0; i < ch.phrases.length; i++) {
      const wrong = ch.answer.melody[i].map((d) => (d === 'do' ? 're' : 'do'))
      await fillSequence(ch, 'notate-melody', wrong, 0)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: i === ch.phrases.length - 1 ? '提交关卡' : '下一句' })) })
    }
    expect(await screen.findByText(/换一段再试/)).toBeTruthy()
    expect(document.querySelectorAll('[data-mark="chosen"]').length).toBeGreaterThan(0)
  })
})
