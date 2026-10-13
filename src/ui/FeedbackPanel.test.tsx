// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate } from '../exercises/generate'
import { FeedbackPanel, ScaleBar } from './FeedbackPanel'

afterEach(cleanup)
const c = buildCurriculum()
const degreeEx = generate({ kpId: 'degree:major:mi', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 3, segment: 'focus' }, c)

describe('FeedbackPanel', () => {
  it('答错：显示正确答案、音阶条、慢速再听与下一题', () => {
    if (degreeEx.answer.kind !== 'choice' || degreeEx.format.kind !== 'choice') throw new Error('应为选择题')
    const correct = degreeEx.answer.id
    const wrong = degreeEx.format.options.find((o) => o.id !== correct)!.id
    const onSlow = vi.fn()
    const onNext = vi.fn()
    render(
      <FeedbackPanel exercise={degreeEx} grade={{ correct: false, detail: { kind: 'choice' } }} response={{ kind: 'choice', id: wrong }} scheme="solfege" onSlow={onSlow} onReplay={vi.fn()} onNext={onNext} />,
    )
    expect(screen.getByText(/正确答案/)).toBeTruthy()
    expect(document.querySelector('[data-mark="chosen"]')?.textContent).toBe(wrong)
    expect(document.querySelector('[data-mark="correct"]')?.textContent).toBe(correct)
    fireEvent.click(screen.getByRole('button', { name: '慢速再听' }))
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(onSlow).toHaveBeenCalled()
    expect(onNext).toHaveBeenCalled()
  })

  it('答对：只显示确认与下一题', () => {
    render(<FeedbackPanel exercise={degreeEx} grade={{ correct: true, detail: { kind: 'choice' } }} response={null} scheme="solfege" onSlow={vi.fn()} onReplay={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByText('答对了')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '慢速再听' })).toBeNull()
  })
})

describe('ScaleBar', () => {
  it('同一个音既是所选又是正确时标 both；按半音排序', () => {
    render(<ScaleBar degrees={['sol', 'do', 'mi']} chosen="mi" correct="mi" scheme="numeric" mode="major" />)
    const cells = [...document.querySelectorAll('.scale-cell')].map((e) => e.textContent)
    expect(cells).toEqual(['1', '3', '5'])
    expect(document.querySelector('[data-mark="both"]')?.textContent).toBe('3')
  })
})
