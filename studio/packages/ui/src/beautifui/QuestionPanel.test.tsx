import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentQuestion } from '@openclaude-studio/acp'
import { QuestionPanel, collectAnswers } from './QuestionPanel.js'

const modelQuestion: AgentQuestion = {
  question: 'Which model should OpenClaude use?',
  multiSelect: false,
  options: [{ label: 'Claude Code 4' }, { label: 'Claude Code 4 Mini' }],
}

const featureQuestion: AgentQuestion = {
  question: 'Which features do you want to enable?',
  multiSelect: true,
  options: [{ label: 'Plan mode' }, { label: 'Auto-save' }],
}

const questions: AgentQuestion[] = [modelQuestion, featureQuestion]

describe('QuestionPanel', () => {
  test('renders a question with a list of options', () => {
    const html = renderToStaticMarkup(
      <QuestionPanel questions={[modelQuestion]} onSubmit={() => {}} />,
    )
    expect(html).toContain('Which model should OpenClaude use?')
    expect(html).toContain('Claude Code 4')
    expect(html).toContain('Claude Code 4 Mini')
    expect(html).toContain('Step 1 of 1')
  })

  test('multi select renders a helper line', () => {
    const html = renderToStaticMarkup(
      <QuestionPanel questions={[featureQuestion]} onSubmit={() => {}} />,
    )
    expect(html).toContain('Select all that apply.')
  })

  test('omits the cancel button when onCancel is not provided', () => {
    const withCancel = renderToStaticMarkup(
      <QuestionPanel
        questions={[modelQuestion]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(withCancel).toContain('Cancel')
    const withoutCancel = renderToStaticMarkup(
      <QuestionPanel questions={[modelQuestion]} onSubmit={() => {}} />,
    )
    expect(withoutCancel).not.toContain('Cancel')
  })
})

describe('collectAnswers', () => {
  test('keys single-select answers by question text', () => {
    expect(
      collectAnswers(questions, {
        'Which model should OpenClaude use?': ['Claude Code 4'],
      }, {}),
    ).toEqual({ 'Which model should OpenClaude use?': 'Claude Code 4' })
  })

  test('joins multi-select answers with ", "', () => {
    expect(
      collectAnswers(questions, {
        'Which features do you want to enable?': ['Plan mode', 'Auto-save'],
      }, {}),
    ).toEqual({
      'Which features do you want to enable?': 'Plan mode, Auto-save',
    })
  })

  test('omits unanswered questions', () => {
    expect(collectAnswers(questions, {}, {})).toEqual({})
  })
})
