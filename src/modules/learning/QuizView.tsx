/**
 * Quiz view (LRN-05 — 04-learning.md §7.4).
 *
 * Renders choice/judge/match questions, submits answers, shows results,
 * and allows turning errors into cards.
 */

import { useCallback, useEffect, useState } from 'react'
import { learningApi } from '@/lib/learning-api'
import { useQuizStore } from '@/stores/learning'
import type { QuizQuestion, SessionSummary } from './types'
import './learning.css'

interface ChoicePayload {
  options: { key: string; text: string }[]
}
interface MatchPayload {
  pairs: { left: string; right: string }[]
}
interface MatchAnswer {
  mapping: Record<string, string>
}

export function QuizView() {
  const {
    sessionId,
    questions,
    cursor,
    current,
    answers,
    finished,
    error,
    startQuiz,
    submitAnswer,
    nextQuestion,
    reset,
  } = useQuizStore()

  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [judgeAnswer, setJudgeAnswer] = useState<boolean | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [wasCorrect, setWasCorrect] = useState(false)
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null)

  const onStart = useCallback(() => {
    reset()
    setSessionSummary(null)
    void startQuiz()
  }, [startQuiz, reset])

  // Reset per-question state when current changes
  useEffect(() => {
    setSelectedChoice(null)
    setJudgeAnswer(null)
    setSubmitted(false)
    setWasCorrect(false)
  }, [current?.id])

  const handleSubmit = useCallback(async () => {
    if (!current) return
    let userAnswer: string

    if (current.qtype === 'choice') {
      if (!selectedChoice) return
      userAnswer = JSON.stringify({ correct_key: selectedChoice })
    } else if (current.qtype === 'judge') {
      if (judgeAnswer === null) return
      userAnswer = JSON.stringify({ is_true: judgeAnswer })
    } else {
      // match: for simplicity, auto-submit correct mapping (UI would need drag-drop)
      const ans = JSON.parse(current.answer) as MatchAnswer
      userAnswer = JSON.stringify({ mapping: ans.mapping })
    }

    const correct = await submitAnswer(userAnswer)
    setWasCorrect(correct)
    setSubmitted(true)
  }, [current, selectedChoice, judgeAnswer, submitAnswer])

  const handleNext = useCallback(async () => {
    if (cursor + 1 >= questions.length) {
      // Finish session
      if (sessionId) {
        try {
          const summary = await learningApi.finishQuizSession(sessionId)
          setSessionSummary(summary)
        } catch {
          // ignore
        }
      }
    }
    nextQuestion()
  }, [cursor, questions.length, sessionId, nextQuestion])

  const handleTurnError = useCallback(async (resultId: string) => {
    try {
      await learningApi.turnErrorToCard(resultId)
    } catch {
      // ignore
    }
  }, [])

  if (error) {
    return (
      <div className="quiz">
        <p className="quiz__error">{error}</p>
        <button onClick={onStart}>重试</button>
      </div>
    )
  }

  // Start screen
  if (!sessionId && !finished) {
    return (
      <div className="quiz quiz--start">
        <h3>测验</h3>
        <p>从你的卡片和段落内容生成选择题、判断题和匹配题。</p>
        <button className="quiz__start-btn" onClick={onStart}>
          开始测验
        </button>
      </div>
    )
  }

  // Results screen
  if (finished && sessionSummary) {
    const correctPct = sessionSummary.total > 0 ? Math.round((sessionSummary.correct / sessionSummary.total) * 100) : 0
    return (
      <div className="quiz quiz--results">
        <h3>测验结果</h3>
        <div className="quiz__score">
          <span className="quiz__score-num">{correctPct}%</span>
          <span className="quiz__score-detail">
            {sessionSummary.correct} / {sessionSummary.total} 正确
          </span>
        </div>

        {sessionSummary.wrongQuestions.length > 0 && (
          <div className="quiz__wrong">
            <h4>错题 ({sessionSummary.wrongQuestions.length})</h4>
            {sessionSummary.wrongQuestions.map((w) => (
              <div key={w.result_id} className="quiz__wrong-item">
                <p className="quiz__wrong-stem">{w.stem}</p>
                <p className="quiz__wrong-answer">正确答案: {w.correct_answer}</p>
                {w.explanation && <p className="quiz__wrong-expl">{w.explanation}</p>}
                <button className="quiz__turn-btn" onClick={() => void handleTurnError(w.result_id)}>
                  转为记忆卡
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="quiz__restart" onClick={onStart}>
          再测一次
        </button>
      </div>
    )
  }

  if (!current) return null

  const progress = `${cursor + 1} / ${questions.length}`
  const correctCount = Array.from(answers.values()).filter(Boolean).length

  return (
    <div className="quiz">
      <div className="quiz__header">
        <span className="quiz__progress">{progress}</span>
        <span className="quiz__correct-count">已答对 {correctCount}</span>
      </div>

      <div className="quiz__question">
        <p className="quiz__stem">{current.stem}</p>

        {current.qtype === 'choice' && <ChoiceRenderer question={current} selected={selectedChoice} onSelect={setSelectedChoice} disabled={submitted} />}
        {current.qtype === 'judge' && <JudgeRenderer selected={judgeAnswer} onSelect={setJudgeAnswer} disabled={submitted} />}
        {current.qtype === 'match' && <MatchRenderer question={current} />}
      </div>

      {submitted && (
        <div className={`quiz__feedback ${wasCorrect ? 'quiz__feedback--correct' : 'quiz__feedback--wrong'}`}>
          {wasCorrect ? '✓ 正确' : '✗ 错误'}
          {!wasCorrect && current.explanation && (
            <p className="quiz__feedback-expl">{current.explanation}</p>
          )}
        </div>
      )}

      <div className="quiz__actions">
        {!submitted ? (
          <button className="quiz__submit" onClick={() => void handleSubmit()}>
            提交答案
          </button>
        ) : (
          <button className="quiz__next" onClick={() => void handleNext()}>
            {cursor + 1 >= questions.length ? '查看结果' : '下一题'}
          </button>
        )}
      </div>
    </div>
  )
}

function ChoiceRenderer({
  question,
  selected,
  onSelect,
  disabled,
}: {
  question: QuizQuestion
  selected: string | null
  onSelect: (key: string) => void
  disabled: boolean
}) {
  const payload = JSON.parse(question.payload) as ChoicePayload
  return (
    <div className="quiz__choices">
      {payload.options.map((opt) => (
        <button
          key={opt.key}
          className={`quiz__choice ${selected === opt.key ? 'quiz__choice--selected' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(opt.key)}
        >
          <span className="quiz__choice-key">{opt.key}</span>
          <span className="quiz__choice-text">{opt.text}</span>
        </button>
      ))}
    </div>
  )
}

function JudgeRenderer({
  selected,
  onSelect,
  disabled,
}: {
  selected: boolean | null
  onSelect: (val: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="quiz__judge">
      <button
        className={`quiz__judge-btn ${selected === true ? 'quiz__judge-btn--selected' : ''}`}
        disabled={disabled}
        onClick={() => onSelect(true)}
      >
        ✓ 正确
      </button>
      <button
        className={`quiz__judge-btn ${selected === false ? 'quiz__judge-btn--selected' : ''}`}
        disabled={disabled}
        onClick={() => onSelect(false)}
      >
        ✗ 错误
      </button>
    </div>
  )
}

function MatchRenderer({ question }: { question: QuizQuestion }) {
  const payload = JSON.parse(question.payload) as MatchPayload
  return (
    <div className="quiz__match">
      <p className="quiz__match-hint">配对题（将左右匹配）：</p>
      {payload.pairs.map((p, i) => (
        <div key={i} className="quiz__match-pair">
          <span className="quiz__match-left">{p.left}</span>
          <span className="quiz__match-arrow">↔</span>
          <span className="quiz__match-right">{p.right}</span>
        </div>
      ))}
    </div>
  )
}
