import { useEffect, useRef, useState } from 'react'
import { api, type AdminPlayerHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './bingo-lms.css'

type Opt = {
  id: string
  label: string
  headshotUrl?: string
  teamLogoUrl?: string
  nationality?: string
  position?: string
}

type CareerClub = {
  name: string
  logoUrl?: string
  note?: 'loan'
  missing?: boolean
}

type CluePlayer = {
  id?: string
  name: string
  headshotUrl?: string
  nationality?: string
  position?: string
}

type Presentation = {
  layout?: string
  imageUrl?: string
  imageBlur?: number
  careerClubs?: CareerClub[]
  careerPathVersion?: 2
  cluePlayers?: CluePlayer[]
  [k: string]: unknown
}

type Q = {
  id: string
  type: string
  slot: number
  signature?: boolean
  prompt: string
  subPrompt?: string
  options: Opt[]
  presentation?: Presentation
}

type Ans = {
  questionId: string
  correctOptionId: string
  reveal?: string
}

type Puzzle = {
  modeId?: string
  puzzleId?: string
  date?: string
  title?: string
  version?: number
  questions: Q[]
}

type Answer = { questions: Ans[] }
const EMPTY_LMS_ANSWER: Answer = { questions: [] }

const QUESTION_TYPES = [
  'higher_lower',
  'career_path',
  'odd_one_out',
  'which_club',
  'image_badge',
  'custom_image',
  'missing_club',
  'custom_text',
  'custom_question',
] as const
type QuestionType = (typeof QUESTION_TYPES)[number]
type AnswerFormat = 'multiple_choice' | 'search'
type McSnapshot = {
  type: Exclude<QuestionType, 'custom_question'>
  options: Opt[]
  presentation?: Presentation
  correctOptionId?: string
  reveal?: string
}

const CONTENT_TYPES = QUESTION_TYPES.filter((type) => type !== 'custom_question')

const FRIENDLY_TYPES: Record<QuestionType, string> = {
  higher_lower: 'Higher or lower',
  career_path: 'Career path',
  odd_one_out: 'Odd one out',
  which_club: 'Which club?',
  image_badge: 'Image badge',
  custom_image: 'Custom image',
  missing_club: 'Missing club',
  custom_text: 'Custom text',
  custom_question: 'Type / search',
}

const PLAYER_OPTION_ID =
  /-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isQuestionType(value: string): value is QuestionType {
  return QUESTION_TYPES.some((type) => type === value)
}

function isContentType(value: string): value is Exclude<QuestionType, 'custom_question'> {
  return CONTENT_TYPES.some((type) => type === value)
}

function friendlyType(type: string): string {
  return isQuestionType(type) ? FRIENDLY_TYPES[type] : type.replaceAll('_', ' ')
}

function expectedOptionCount(question: Q): number {
  if (question.type === 'higher_lower') return 2
  if (question.type === 'custom_question') return 1
  if (
    (question.type === 'missing_club' || question.type === 'custom_text') &&
    question.options.length === 1
  ) {
    return 1
  }
  return 4
}

function makeOptionId(questionId: string, key: string): string {
  return `${questionId}-${key}`
}

function isSearchQuestion(question: Q): boolean {
  return question.type === 'custom_question' ||
    ((question.type === 'missing_club' || question.type === 'custom_text') &&
      question.options.length === 1)
}

function hasPlayerOptionId(optionId: string): boolean {
  return PLAYER_OPTION_ID.test(optionId)
}

function hasTeamOptionId(optionId: string): boolean {
  return /-\d+$/.test(optionId)
}

function hasSelectedSearchAnswer(question: Q): boolean {
  if (
    question.type === 'custom_question' ||
    (question.type === 'custom_text' && question.options.length === 1)
  ) {
    return hasPlayerOptionId(question.options[0]?.id ?? '')
  }
  if (question.type === 'missing_club' && question.options.length === 1) {
    return hasTeamOptionId(question.options[0]?.id ?? '')
  }
  return true
}

function isClubQuestion(q: Q): boolean {
  if (q.type === 'which_club' || q.type === 'image_badge' || q.type === 'missing_club') return true
  if (q.type !== 'odd_one_out') return false
  const sub = q.subPrompt?.toLowerCase() ?? ''
  return sub.includes('club')
}

function missingClubFromPath(clubs: CareerClub[] | undefined): CareerClub | undefined {
  return clubs?.find((club) => club.missing)
}

async function prepareImageUpload(file: File): Promise<{ fileBase64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * scale))
  let height = Math.max(1, Math.round(bitmap.height * scale))
  let quality = 0.86

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare images.')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('Could not prepare the image.')
    if (blob.size <= 2.5 * 1024 * 1024) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the prepared image.'))
        reader.readAsDataURL(blob)
      })
      bitmap.close()
      return { fileBase64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' }
    }
    quality = Math.max(0.65, quality - 0.06)
    width = Math.max(1, Math.round(width * 0.85))
    height = Math.max(1, Math.round(height * 0.85))
  }
  bitmap.close()
  throw new Error('The image is still too large after resizing.')
}

function sortedQuestions(p: Puzzle): Q[] {
  return [...(p.questions ?? [])].sort((x, y) => x.slot - y.slot)
}

export function LmsEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: Answer) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer as Answer | null) ?? EMPTY_LMS_ANSWER
  const questions = sortedQuestions(p)
  const [activeSlot, setActiveSlot] = useState(() => questions[0]?.slot ?? 1)
  const [imageUpload, setImageUpload] = useState<{ slot?: number; state: 'idle' | 'preparing' | 'uploading' | 'error'; error?: string }>({ state: 'idle' })
  const activeQuestion = questions.find((question) => question.slot === activeSlot) ?? questions[0]

  // Keep latest puzzle/answer for async pick handlers (avoid stale closures wiping media).
  const latestRef = useRef({ p, a })
  const mcSnapshots = useRef(new Map<string, McSnapshot>())
  const revealSeq = useRef(0)
  const [revealBusyFor, setRevealBusyFor] = useState<string | null>(null)
  useEffect(() => {
    latestRef.current = { p, a }
  }, [p, a])

  function commit(nextPuzzle: Puzzle, nextAnswer: Answer) {
    latestRef.current = { p: nextPuzzle, a: nextAnswer }
    onChange(nextPuzzle, nextAnswer)
  }

  /** Rebuild the answer explanation from the current options (e.g. Modrić's PL goals). */
  async function refreshReveal(questionId: string) {
    const seq = ++revealSeq.current
    const { p: curP, a: curA } = latestRef.current
    const question = sortedQuestions(curP).find((item) => item.id === questionId)
    const answerRow = curA.questions.find((item) => item.questionId === questionId)
    if (!question || !answerRow?.correctOptionId) return

    setRevealBusyFor(questionId)
    try {
      const { answer: nextAnswerRow } = await api.recomputeLmsReveal({
        question: {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          subPrompt: question.subPrompt,
          options: question.options.map((option) => ({ id: option.id, label: option.label })),
          presentation: question.presentation ?? null,
        },
        answer: {
          questionId: answerRow.questionId,
          correctOptionId: answerRow.correctOptionId,
          reveal: answerRow.reveal,
        },
      })
      if (seq !== revealSeq.current) return
      const { p: latestP, a: latestA } = latestRef.current
      const nextAnswers = latestA.questions.map((item) =>
        item.questionId === questionId
          ? {
              ...item,
              correctOptionId: nextAnswerRow.correctOptionId,
              reveal: nextAnswerRow.reveal ?? '',
            }
          : item
      )
      commit(latestP, { questions: nextAnswers })
    } catch {
      // Keep the previous explanation if recompute fails.
    } finally {
      if (seq === revealSeq.current) setRevealBusyFor(null)
    }
  }

  function updateQuestion(slot: number, patch: Partial<Q>) {
    const { p: curP, a: curA } = latestRef.current
    const nextQs = sortedQuestions(curP).map((q) => (q.slot === slot ? { ...q, ...patch } : q))
    commit({ ...curP, questions: nextQs }, curA)
  }

  function rememberMultipleChoice(question: Q) {
    if (isSearchQuestion(question)) return
    const answerRow = latestRef.current.a.questions.find((item) => item.questionId === question.id)
    mcSnapshots.current.set(question.id, {
      type: isContentType(question.type) ? question.type : 'odd_one_out',
      options: question.options,
      presentation: question.presentation,
      correctOptionId: answerRow?.correctOptionId,
      reveal: answerRow?.reveal,
    })
  }

  function setAnswerFormat(question: Q, format: AnswerFormat) {
    if (format === 'search') {
      if (isSearchQuestion(question)) return
      rememberMultipleChoice(question)
      const answerRow = latestRef.current.a.questions.find((item) => item.questionId === question.id)
      const correct = question.options.find((option) => option.id === answerRow?.correctOptionId)
      if (question.type === 'custom_text') {
        const option =
          correct && hasPlayerOptionId(correct.id)
            ? { ...correct }
            : {
                id: makeOptionId(question.id, 'choose-player'),
                label: 'Choose player',
              }
        const { p: curP, a: curA } = latestRef.current
        const nextQuestions = sortedQuestions(curP).map((item) =>
          item.id === question.id
            ? {
                ...item,
                type: 'custom_text' as const,
                options: [option],
                presentation: { layout: 'stack' },
              }
            : item
        )
        const existing = curA.questions.find((item) => item.questionId === question.id)
        const nextRow: Ans = {
          ...(existing ?? { questionId: question.id }),
          questionId: question.id,
          correctOptionId: option.id,
          reveal: hasPlayerOptionId(option.id) ? option.label : existing?.reveal ?? '',
        }
        const nextAnswers = existing
          ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
          : [...curA.questions, nextRow]
        commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
        return
      }
      if (question.type === 'missing_club') {
        const missing = missingClubFromPath(question.presentation?.careerClubs)
        const option =
          correct && hasTeamOptionId(correct.id)
            ? { ...correct }
            : missing?.name
              ? {
                  id: makeOptionId(question.id, 'choose-club'),
                  label: missing.name,
                  teamLogoUrl: missing.logoUrl,
                }
              : {
                  id: makeOptionId(question.id, 'choose-club'),
                  label: 'Choose club',
                }
        const { p: curP, a: curA } = latestRef.current
        const nextQuestions = sortedQuestions(curP).map((item) =>
          item.id === question.id
            ? {
                ...item,
                type: 'missing_club' as const,
                options: [option],
                presentation: { ...(item.presentation ?? {}), layout: 'stack' },
              }
            : item
        )
        const existing = curA.questions.find((item) => item.questionId === question.id)
        const nextRow: Ans = {
          ...(existing ?? { questionId: question.id }),
          questionId: question.id,
          correctOptionId: option.id,
          reveal: option.label === 'Choose club' ? existing?.reveal ?? '' : option.label,
        }
        const nextAnswers = existing
          ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
          : [...curA.questions, nextRow]
        commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
        return
      }
      const keepPlayer =
        correct &&
        hasPlayerOptionId(correct.id) &&
        !isClubQuestion(question)
      const option = keepPlayer
        ? { ...correct }
        : {
            id: makeOptionId(question.id, 'choose-player'),
            label: 'Choose player',
          }
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type: 'custom_question' as const,
              options: [option],
              presentation: { layout: 'stack' },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: option.id,
        reveal: keepPlayer ? option.label : existing?.reveal ?? '',
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }

    if (!isSearchQuestion(question)) return
    const snapshot = mcSnapshots.current.get(question.id)
    if (snapshot) {
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type: snapshot.type,
              options: snapshot.options,
              presentation: snapshot.presentation,
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const restoredCorrect =
        snapshot.correctOptionId &&
        snapshot.options.some((option) => option.id === snapshot.correctOptionId)
          ? snapshot.correctOptionId
          : snapshot.options[0]?.id ?? ''
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: restoredCorrect,
        reveal: snapshot.reveal ?? existing?.reveal ?? '',
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    if (question.type === 'custom_text' || question.type === 'custom_question') {
      const options = Array.from({ length: 4 }, (_, index) => ({
        id: makeOptionId(question.id, `player-${index + 1}`),
        label: `Player ${index + 1}`,
      }))
      if (question.options[0] && hasPlayerOptionId(question.options[0].id)) {
        options[0] = { ...question.options[0] }
      }
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type: 'custom_text' as const,
              options,
              presentation: { layout: 'grid' },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: options[0]!.id,
        reveal: options[0]!.label === 'Player 1' ? existing?.reveal ?? '' : options[0]!.label,
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    if (question.type === 'missing_club') {
      const missing = missingClubFromPath(question.presentation?.careerClubs)
      const options = Array.from({ length: 4 }, (_, index) => ({
        id: makeOptionId(question.id, `club-${index + 1}`),
        label: index === 0 && missing?.name ? missing.name : `Club ${index + 1}`,
        teamLogoUrl: index === 0 ? missing?.logoUrl : undefined,
      }))
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type: 'missing_club' as const,
              options,
              presentation: { ...(item.presentation ?? {}), layout: 'stack' },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: options[0]!.id,
        reveal: missing?.name || existing?.reveal || '',
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    const options = Array.from({ length: 4 }, (_, index) => ({
      id: makeOptionId(question.id, `option-${index + 1}`),
      label: `Option ${index + 1}`,
    }))
    const { p: curP, a: curA } = latestRef.current
    const nextQuestions = sortedQuestions(curP).map((item) =>
      item.id === question.id
        ? {
            ...item,
            type: 'odd_one_out' as const,
            options,
            presentation: { layout: 'grid' },
          }
        : item
    )
    const existing = curA.questions.find((item) => item.questionId === question.id)
    const nextRow: Ans = {
      ...(existing ?? { questionId: question.id }),
      questionId: question.id,
      correctOptionId: options[0]!.id,
      reveal: existing?.reveal ?? '',
    }
    const nextAnswers = existing
      ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
      : [...curA.questions, nextRow]
    commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
  }

  function setQuestionType(question: Q, type: QuestionType) {
    const defaultLayout: Record<QuestionType, string> = {
      higher_lower: 'two_up',
      career_path: 'stack',
      odd_one_out: 'grid',
      which_club: 'grid',
      image_badge: 'image_header',
      custom_image: 'image_header',
      missing_club: 'stack',
      custom_text: 'grid',
      custom_question: 'stack',
    }
    if (type === 'custom_question') {
      setAnswerFormat(question, 'search')
      return
    }
    if (type === 'custom_text') {
      const options = Array.from({ length: 4 }, (_, index) => {
        const existing = question.options[index]
        if (existing && hasPlayerOptionId(existing.id)) return { ...existing }
        return {
          id: makeOptionId(question.id, `player-${index + 1}`),
          label: `Player ${index + 1}`,
        }
      })
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type,
              options,
              presentation: { layout: 'grid' },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const keptCorrect =
        existing?.correctOptionId &&
        options.some((option) => option.id === existing.correctOptionId)
          ? existing.correctOptionId
          : options[0]!.id
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: keptCorrect,
        reveal: existing?.reveal ?? '',
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    if (type === 'missing_club') {
      const existingClubs = question.presentation?.careerClubs ?? []
      const clubs =
        existingClubs.length >= 3
          ? existingClubs.map((club, index) => ({
              ...club,
              missing: index === Math.floor((existingClubs.length - 1) / 2) ? true : undefined,
            }))
          : [{ name: '' }, { name: '', missing: true }, { name: '' }]
      const missing = missingClubFromPath(clubs)
      const options = Array.from({ length: 4 }, (_, index) => ({
        id: makeOptionId(question.id, `club-${index + 1}`),
        label: index === 0 && missing?.name ? missing.name : `Club ${index + 1}`,
        teamLogoUrl: index === 0 ? missing?.logoUrl : undefined,
      }))
      const { p: curP, a: curA } = latestRef.current
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type,
              prompt: item.prompt.trim() ? item.prompt : 'Guess the missing club',
              options,
              presentation: {
                layout: 'stack',
                careerClubs: clubs,
                careerPathVersion: 2 as const,
                cluePlayers: item.presentation?.cluePlayers,
              },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: options[0]!.id,
        reveal: missing?.name || existing?.reveal || '',
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    if (type === 'custom_image') {
      const { p: curP, a: curA } = latestRef.current
      const options = Array.from({ length: 4 }, (_, index) => ({
        id: makeOptionId(question.id, `custom-${index + 1}`),
        label: `Option ${index + 1}`,
      }))
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type,
              options,
              presentation: {
                layout: 'image_header',
                imageUrl: item.type === 'custom_image' ? item.presentation?.imageUrl : undefined,
                imageBlur: 0,
              },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: options[0]!.id,
        reveal: options[0]!.label,
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    updateQuestion(question.slot, {
      type,
      presentation: { ...(question.presentation ?? {}), layout: defaultLayout[type] },
    })
  }

  function updateCustomOption(question: Q, optionId: string, label: string) {
    const { p: curP, a: curA } = latestRef.current
    const previousLabel = question.options.find((option) => option.id === optionId)?.label
    const nextQuestions = sortedQuestions(curP).map((item) =>
      item.id === question.id
        ? {
            ...item,
            options: item.options.map((option) =>
              option.id === optionId
                ? { ...option, label, teamLogoUrl: undefined }
                : option
            ),
          }
        : item
    )
    const nextAnswers = curA.questions.map((answerRow) =>
      answerRow.questionId === question.id &&
      answerRow.correctOptionId === optionId &&
      (!answerRow.reveal || answerRow.reveal === previousLabel)
        ? { ...answerRow, reveal: label }
        : answerRow
    )
    commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
  }

  async function uploadCustomImage(question: Q, file: File) {
    setImageUpload({ slot: question.slot, state: 'preparing' })
    try {
      const prepared = await prepareImageUpload(file)
      setImageUpload({ slot: question.slot, state: 'uploading' })
      const uploaded = await api.uploadLmsImage({
        ...prepared,
        filename: file.name,
      })
      updateQuestion(question.slot, {
        presentation: {
          ...(latestRef.current.p.questions.find((item) => item.id === question.id)?.presentation ?? {}),
          layout: 'image_header',
          imageUrl: uploaded.url,
          imageBlur: 0,
        },
      })
      setImageUpload({ slot: question.slot, state: 'idle' })
    } catch (error) {
      setImageUpload({
        slot: question.slot,
        state: 'error',
        error: error instanceof Error ? error.message : 'Image upload failed.',
      })
    }
  }

  function addOption(question: Q) {
    const nextNumber = question.options.length + 1
    updateQuestion(question.slot, {
      options: [
        ...question.options,
        { id: makeOptionId(question.id, `option-${Date.now()}`), label: `Option ${nextNumber}` },
      ],
    })
  }

  function removeOption(question: Q, optionId: string) {
    if (question.options.length <= 2) return
    const { p: curP, a: curA } = latestRef.current
    const nextOptions = question.options.filter((option) => option.id !== optionId)
    const nextQuestions = sortedQuestions(curP).map((item) =>
      item.id === question.id ? { ...item, options: nextOptions } : item
    )
    const nextAnswers = curA.questions.map((item) =>
      item.questionId === question.id && item.correctOptionId === optionId
        ? {
            ...item,
            correctOptionId: nextOptions[0]?.id ?? '',
            reveal: nextOptions[0]?.label ?? item.reveal,
          }
        : item
    )
    commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
  }

  function replaceOption(
    questionId: string,
    oldOptId: string,
    nextOpt: Opt,
    extras?: {
      presentation?: Presentation
      answerPatch?: Partial<Ans>
    }
  ) {
    const { p: curP, a: curA } = latestRef.current
    const nextQs = sortedQuestions(curP).map((q) => {
      if (q.id !== questionId) return q
      return {
        ...q,
        options: q.options.map((o) => (o.id === oldOptId ? nextOpt : o)),
        ...(extras?.presentation ? { presentation: extras.presentation } : {}),
      }
    })
    const nextAns: Answer = {
      questions: curA.questions.map((ans) => {
        if (ans.questionId !== questionId) return ans
        const wasCorrect = ans.correctOptionId === oldOptId
        return {
          ...ans,
          ...(wasCorrect ? { correctOptionId: nextOpt.id } : {}),
          ...extras?.answerPatch,
        }
      }),
    }
    commit({ ...curP, questions: nextQs }, nextAns)
  }

  function setCorrectOption(question: Q, optionId: string) {
    const { p: curP, a: curA } = latestRef.current
    const opt = question.options.find((o) => o.id === optionId)
    const existing = curA.questions.find((ans) => ans.questionId === question.id)
    const nextRow: Ans = {
      ...(existing ?? { questionId: question.id }),
      correctOptionId: optionId,
      reveal: opt?.label ?? existing?.reveal,
    }
    const nextAns: Answer = {
      questions: existing
        ? curA.questions.map((ans) => (ans.questionId === question.id ? nextRow : ans))
        : [...curA.questions, nextRow],
    }

    // image_badge blurred header must track the correct club.
    if (question.type === 'image_badge' && opt) {
      const nextQs = sortedQuestions(curP).map((q) => {
        if (q.id !== question.id) return q
        return {
          ...q,
          presentation: {
            ...(q.presentation ?? {}),
            layout: q.presentation?.layout ?? 'image_header',
            imageUrl: opt.teamLogoUrl || q.presentation?.imageUrl,
            imageBlur: q.presentation?.imageBlur ?? 6,
          },
        }
      })
      commit({ ...curP, questions: nextQs }, nextAns)
    } else {
      commit(curP, nextAns)
    }
    void refreshReveal(question.id)
  }

  function updateAnswer(questionId: string, patch: Partial<Ans>) {
    const { p: curP, a: curA } = latestRef.current
    const existing = curA.questions.find((ans) => ans.questionId === questionId)
    const question = curP.questions.find((item) => item.id === questionId)
    const nextRow: Ans = {
      ...(existing ?? {
        questionId,
        correctOptionId: question?.options[0]?.id ?? '',
      }),
      ...patch,
      questionId,
    }
    commit(curP, {
      questions: existing
        ? curA.questions.map((ans) => (ans.questionId === questionId ? nextRow : ans))
        : [...curA.questions, nextRow],
    })
  }

  function correctFor(q: Q): Ans | undefined {
    return a.questions.find((x) => x.questionId === q.id)
  }

  async function pickPlayer(q: Q, oldOpt: Opt, hit: AdminPlayerHit) {
    const nextId = makeOptionId(q.id, hit.id)
    const { a: curA } = latestRef.current
    const ans = curA.questions.find((x) => x.questionId === q.id)
    const wasCorrect = ans?.correctOptionId === oldOpt.id
    // Optimistic: update name + photo from search hit immediately (fixes stale Raul thumb).
    replaceOption(
      q.id,
      oldOpt.id,
      {
        id: nextId,
        label: hit.name,
        headshotUrl: hit.headshotUrl,
        teamLogoUrl: hit.teamLogoUrl,
        nationality: hit.nationality,
        position: hit.position,
      },
      wasCorrect || q.type === 'custom_question' || isSearchQuestion(q) || q.type === 'higher_lower'
        ? {
            answerPatch: {
              ...(wasCorrect || q.type === 'custom_question' || isSearchQuestion(q)
                ? { correctOptionId: nextId }
                : {}),
              reveal: hit.name,
            },
          }
        : undefined
    )

    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as {
        id: string
        name: string
        nationality?: string
        position?: string
        headshotUrl?: string
        teamLogoUrl?: string
      }
      const resolvedId = makeOptionId(q.id, full.id || hit.id)
      const resolvedName = full.name || hit.name
      const stillCorrect =
        latestRef.current.a.questions.find((x) => x.questionId === q.id)?.correctOptionId === nextId
        || wasCorrect
      replaceOption(
        q.id,
        nextId,
        {
          id: resolvedId,
          label: resolvedName,
          headshotUrl: full.headshotUrl ?? hit.headshotUrl,
          teamLogoUrl: full.teamLogoUrl ?? hit.teamLogoUrl,
          nationality: full.nationality ?? hit.nationality,
          position: full.position ?? hit.position,
        },
        stillCorrect || q.type === 'custom_question' || isSearchQuestion(q) || q.type === 'higher_lower'
          ? {
              answerPatch: {
                ...(stillCorrect || q.type === 'custom_question' || isSearchQuestion(q)
                  ? { correctOptionId: resolvedId }
                  : {}),
                reveal: resolvedName,
              },
            }
          : undefined
      )
    } catch {
      // optimistic row is enough
    }
    await refreshReveal(q.id)
  }

  async function pickClub(q: Q, oldOpt: Opt, hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    const suffix = oldOpt.id.startsWith(`${q.id}-`) ? oldOpt.id.slice(q.id.length + 1) : oldOpt.id
    let optionKey = String(team.id)
    if (q.type === 'which_club' || (q.type === 'odd_one_out' && isClubQuestion(q))) {
      if (suffix === 'correct' || suffix === 'odd' || /^w\d+$/.test(suffix) || /^m\d+$/.test(suffix)) {
        optionKey = suffix
      }
    } else if (q.type === 'image_badge') {
      optionKey = String(team.id)
    }

    const nextOpt: Opt = {
      id: makeOptionId(q.id, optionKey),
      label: team.name,
      teamLogoUrl: team.logoUrl,
    }

    const { a: curA } = latestRef.current
    const ans = curA.questions.find((x) => x.questionId === q.id)
    const willBeCorrect =
      ans?.correctOptionId === oldOpt.id ||
      ans?.correctOptionId === nextOpt.id ||
      (q.type === 'missing_club' && q.options.length === 1)

    const presentation =
      q.type === 'image_badge' && willBeCorrect
        ? {
            ...(q.presentation ?? {}),
            layout: 'image_header' as const,
            imageUrl: team.logoUrl,
            imageBlur: q.presentation?.imageBlur ?? 6,
          }
        : undefined

    const answerPatch =
      willBeCorrect
        ? { reveal: team.name, correctOptionId: nextOpt.id }
        : undefined

    replaceOption(q.id, oldOpt.id, nextOpt, { presentation, answerPatch })
    if (q.type === 'missing_club' && willBeCorrect) {
      const latest = sortedQuestions(latestRef.current.p).find((item) => item.id === q.id) ?? q
      const clubs = [...(latest.presentation?.careerClubs ?? [])]
      const missingIndex = clubs.findIndex((club) => club.missing)
      if (missingIndex >= 0) {
        clubs[missingIndex] = {
          ...clubs[missingIndex],
          name: team.name,
          logoUrl: team.logoUrl,
          missing: true,
        }
        setCareerClubs(latest, clubs)
      }
    }
    await refreshReveal(q.id)
  }

  async function pickCareerClub(q: Q, clubIdx: number, hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    clubs[clubIdx] = { ...clubs[clubIdx], name: team.name, logoUrl: team.logoUrl }
    setCareerClubs(q, clubs)
    if (q.type === 'missing_club' && clubs[clubIdx]?.missing) {
      applyMissingClubAnswer(q, team)
    }
  }

  function markMissingClub(q: Q, clubIdx: number) {
    const clubs = (q.presentation?.careerClubs ?? []).map((club, index) => ({
      ...club,
      missing: index === clubIdx ? true : undefined,
    }))
    setCareerClubs(q, clubs)
    const selected = clubs[clubIdx]
    if (selected?.name) {
      applyMissingClubAnswer(q, {
        id: undefined,
        name: selected.name,
        logoUrl: selected.logoUrl,
      })
    }
  }

  function applyMissingClubAnswer(
    q: Q,
    team: { id?: number; name: string; logoUrl?: string }
  ) {
    const { p: curP, a: curA } = latestRef.current
    const current = sortedQuestions(curP).find((item) => item.id === q.id) ?? q
    const answerRow = curA.questions.find((item) => item.questionId === q.id)
    const targetId = answerRow?.correctOptionId ?? current.options[0]?.id
    if (!targetId) return
    const nextId = team.id != null ? makeOptionId(q.id, String(team.id)) : targetId
    const nextOpt: Opt = {
      id: nextId,
      label: team.name,
      teamLogoUrl: team.logoUrl,
    }
    replaceOption(q.id, targetId, nextOpt, {
      answerPatch: { correctOptionId: nextId, reveal: team.name },
    })
  }

  function pickSubjectPlayer(q: Q, hit: AdminPlayerHit) {
    updateQuestion(q.slot, {
      presentation: {
        ...(q.presentation ?? {}),
        cluePlayers: [
          {
            id: hit.id,
            name: hit.name,
            headshotUrl: hit.headshotUrl,
            nationality: hit.nationality,
            position: hit.position,
          },
        ],
      },
    })
  }

  function clearSubjectPlayer(q: Q) {
    updateQuestion(q.slot, {
      presentation: {
        ...(q.presentation ?? {}),
        cluePlayers: undefined,
      },
    })
  }

  function setCareerClubs(q: Q, clubs: NonNullable<Presentation['careerClubs']>) {
    const { p: currentPuzzle, a: currentAnswer } = latestRef.current
    const nextQuestions = sortedQuestions(currentPuzzle).map((question) =>
      question.slot === q.slot
        ? {
            ...question,
            presentation: {
              ...(question.presentation ?? {}),
              careerClubs: clubs,
              careerPathVersion: 2 as const,
            },
          }
        : question
    )
    const latestQuestion = sortedQuestions(currentPuzzle).find((item) => item.id === q.id) ?? q
    const currentQuestionAnswer = currentAnswer.questions.find((item) => item.questionId === q.id)
    const correctLabel = latestQuestion.options.find(
      (option) => option.id === currentQuestionAnswer?.correctOptionId
    )?.label
    const path = clubs
      .filter((club) => club.name.trim())
      .map((club) =>
        club.missing
          ? '???'
          : `${club.name}${club.note === 'loan' ? ' (loan)' : ''}`
      )
      .join(' → ')
    const nextAnswers = currentAnswer.questions.map((item) =>
      item.questionId === q.id && correctLabel
        ? { ...item, reveal: `${correctLabel} — ${path}` }
        : item
    )
    commit(
      { ...currentPuzzle, questions: nextQuestions },
      { ...currentAnswer, questions: nextAnswers }
    )
  }

  function addCareerClub(q: Q) {
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    if (clubs.length >= 6) return
    clubs.push({ name: '' })
    setCareerClubs(q, clubs)
  }

  function removeCareerClub(q: Q, index: number) {
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    if (clubs.length <= 3) return
    clubs.splice(index, 1)
    if (q.type === 'missing_club' && !clubs.some((club) => club.missing) && clubs[0]) {
      const mid = Math.floor((clubs.length - 1) / 2)
      clubs[mid] = { ...clubs[mid], missing: true }
    }
    setCareerClubs(q, clubs)
  }

  function moveCareerClub(q: Q, index: number, direction: -1 | 1) {
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    const target = index + direction
    if (target < 0 || target >= clubs.length) return
    ;[clubs[index], clubs[target]] = [clubs[target]!, clubs[index]!]
    setCareerClubs(q, clubs)
  }

  function toggleCareerLoan(q: Q, index: number) {
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    const club = clubs[index]
    if (!club) return
    clubs[index] = { ...club, note: club.note === 'loan' ? undefined : 'loan' }
    setCareerClubs(q, clubs)
  }

  return (
    <div className="lms-editor">
      <section className="q-card lms-overview">
        <label className="field">
          Title
          <input
            value={p.title ?? ''}
            disabled={locked}
            onChange={(e) => commit({ ...latestRef.current.p, title: e.target.value }, latestRef.current.a)}
          />
        </label>
        <p className="muted">{questions.length} questions</p>
      </section>

      <nav className="lms-question-nav" aria-label="Question navigator">
        {questions.map((question) => {
          const answerRow = correctFor(question)
          const hasCorrect = Boolean(
            answerRow && question.options.some((option) => option.id === answerRow.correctOptionId)
          )
          const complete = Boolean(question.prompt.trim() && hasCorrect)
          return (
            <button
              key={question.id}
              type="button"
              className={`lms-nav-button${question.slot === activeQuestion?.slot ? ' active' : ''}`}
              onClick={() => setActiveSlot(question.slot)}
              aria-current={question.slot === activeQuestion?.slot ? 'step' : undefined}
            >
              <span>Q{question.slot}</span>
              <span className={`lms-status-dot ${complete ? 'complete' : 'warning'}`} aria-label={complete ? 'Complete' : 'Needs attention'} />
            </button>
          )
        })}
      </nav>

      {activeQuestion ? (() => {
        const q = activeQuestion
        const ans = correctFor(q)
        const clubMode = isClubQuestion(q)
        const hasCorrect = Boolean(ans && q.options.some((option) => option.id === ans.correctOptionId))
        const expectedOptions = expectedOptionCount(q)
        const optionCountValid = q.options.length === expectedOptions
        const missingClubReady =
          q.type !== 'missing_club' ||
          Boolean(missingClubFromPath(q.presentation?.careerClubs)?.name.trim())
        const customTextReady =
          q.type !== 'custom_text' ||
          isSearchQuestion(q) ||
          q.options.every((option) => hasPlayerOptionId(option.id))
        const complete = Boolean(
          q.prompt.trim() &&
          hasCorrect &&
          optionCountValid &&
          hasSelectedSearchAnswer(q) &&
          missingClubReady &&
          customTextReady
        )
        return (
          <article key={q.id} className="q-card lms-question-card">
            <header className="lms-question-header">
              <div>
                <div className="lms-question-title">
                  <strong>Question {q.slot}</strong>
                  <span className="muted tiny">{friendlyType(q.type)}</span>
                  {q.signature && <span className="muted tiny">Signature question</span>}
                </div>
                <div className="lms-question-statuses">
                  <span className={complete ? 'editor-clean-status' : 'editor-clean-status warning'}>{complete ? 'Ready' : 'Needs attention'}</span>
                </div>
              </div>
              <div className="editor-icon-actions">
                <button type="button" className="ghost tiny-btn" disabled={q.slot === questions[0]?.slot} onClick={() => setActiveSlot(questions[Math.max(0, questions.findIndex((item) => item.slot === q.slot) - 1)]?.slot ?? q.slot)}>← Previous</button>
                <button type="button" className="ghost tiny-btn" disabled={q.slot === questions.at(-1)?.slot} onClick={() => setActiveSlot(questions[Math.min(questions.length - 1, questions.findIndex((item) => item.slot === q.slot) + 1)]?.slot ?? q.slot)}>Next →</button>
              </div>
            </header>

            <div className="lms-question-controls">
              <div className="field lms-answer-format">
                <span>Answer format</span>
                <div className="lms-format-toggle" role="group" aria-label="Answer format">
                  <button
                    type="button"
                    className={!isSearchQuestion(q) ? 'selected' : ''}
                    disabled={locked}
                    aria-pressed={!isSearchQuestion(q)}
                    onClick={() => setAnswerFormat(q, 'multiple_choice')}
                  >
                    Multiple choice
                  </button>
                  <button
                    type="button"
                    className={isSearchQuestion(q) ? 'selected' : ''}
                    disabled={locked}
                    aria-pressed={isSearchQuestion(q)}
                    onClick={() => setAnswerFormat(q, 'search')}
                  >
                    Type / search
                  </button>
                </div>
              </div>
              {!isSearchQuestion(q) && (
                <label className="field">
                  Question type
                  <select
                    value={isContentType(q.type) ? q.type : 'odd_one_out'}
                    disabled={locked}
                    onChange={(event) => {
                      if (isContentType(event.target.value)) setQuestionType(q, event.target.value)
                    }}
                  >
                    {!isContentType(q.type) && <option value={q.type}>{friendlyType(q.type)}</option>}
                    {CONTENT_TYPES.map((type) => <option key={type} value={type}>{FRIENDLY_TYPES[type]}</option>)}
                  </select>
                </label>
              )}
              <label className="lms-signature-control">
                <input type="checkbox" checked={q.signature ?? false} disabled={locked} onChange={(event) => updateQuestion(q.slot, { signature: event.target.checked })} />
                Signature question
              </label>
            </div>

            <label className="field">
              Question
              <textarea
                rows={2}
                value={q.prompt}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { prompt: e.target.value })}
              />
            </label>
            <label className="field">
              Extra context
              <input
                value={q.subPrompt ?? ''}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { subPrompt: e.target.value || undefined })}
              />
            </label>

            {q.type === 'image_badge' && (
              <div className="badge-preview">
                <div className="badge-preview-heading">
                  <div className="muted tiny">Preview shown to players</div>
                </div>
                {q.presentation?.imageUrl ? (
                  <img
                    key={q.presentation.imageUrl}
                    src={q.presentation.imageUrl}
                    alt="Badge preview"
                    className="badge-preview-img"
                    style={{ filter: `blur(${Math.max(2, (q.presentation.imageBlur ?? 6) / 2)}px)` }}
                  />
                ) : (
                  <p className="error tiny">Choose the correct club to create this preview.</p>
                )}
              </div>
            )}

            {q.type === 'custom_image' && (
              <div className="custom-image-panel">
                <div className="muted tiny">Question image</div>
                {q.presentation?.imageUrl ? (
                  <img src={q.presentation.imageUrl} alt="Question preview" className="custom-image-preview" />
                ) : (
                  <div className="custom-image-empty">Choose a kit, stadium, or football photo.</div>
                )}
                <div className="editor-icon-actions">
                  <label className={`ghost tiny-btn${locked ? ' disabled' : ''}`}>
                    {q.presentation?.imageUrl ? 'Replace image' : 'Choose image'}
                    <input
                      className="visually-hidden"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={locked || (imageUpload.slot === q.slot && imageUpload.state !== 'idle' && imageUpload.state !== 'error')}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadCustomImage(q, file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  {q.presentation?.imageUrl && (
                    <button
                      type="button"
                      className="ghost tiny-btn"
                      disabled={locked}
                      onClick={() => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageUrl: undefined, imageBlur: 0 },
                      })}
                    >
                      Clear image
                    </button>
                  )}
                </div>
                {imageUpload.slot === q.slot && imageUpload.state === 'preparing' && <p className="muted tiny">Preparing image…</p>}
                {imageUpload.slot === q.slot && imageUpload.state === 'uploading' && <p className="muted tiny">Uploading image…</p>}
                {imageUpload.slot === q.slot && imageUpload.state === 'error' && <p className="error tiny">{imageUpload.error}</p>}
              </div>
            )}

            {(q.type === 'career_path' || q.type === 'missing_club') && (
              <fieldset disabled={locked} className="options">
                <legend>
                  {q.type === 'missing_club' ? 'Career path with a missing club' : 'Career path'}
                  {' '}({q.presentation?.careerClubs?.length ?? 0}/6)
                </legend>
                {q.type === 'missing_club' && (
                  <>
                    <p className="muted tiny">
                      Show the path with one club blanked out. Mark the hidden club, then add
                      multiple-choice clubs or let players search for it.
                    </p>
                    <div className="lms-subject-player">
                      <EntityPicker
                        kind="player"
                        label="Player (optional)"
                        valueLabel={q.presentation?.cluePlayers?.[0]?.name}
                        imageUrl={q.presentation?.cluePlayers?.[0]?.headshotUrl}
                        nationality={q.presentation?.cluePlayers?.[0]?.nationality}
                        disabled={locked}
                        onPickPlayer={(hit) => pickSubjectPlayer(q, hit)}
                      />
                      {q.presentation?.cluePlayers?.[0] && (
                        <button
                          type="button"
                          className="ghost tiny-btn"
                          disabled={locked}
                          onClick={() => clearSubjectPlayer(q)}
                        >
                          Clear player
                        </button>
                      )}
                    </div>
                  </>
                )}
                {q.type === 'career_path' && (
                  <p className="muted tiny">Keep the clubs in chronological order. Mark temporary moves as loans.</p>
                )}
                {(q.presentation?.careerClubs ?? []).map((club, idx, clubs) => (
                  <div
                    className={`career-club-editor-row${club.missing ? ' missing' : ''}`}
                    key={`${q.id}-club-${idx}-${club.name}-${club.logoUrl ?? ''}`}
                  >
                    <EntityPicker
                      kind="team"
                      label={club.missing ? `Club ${idx + 1} (missing)` : `Club ${idx + 1}`}
                      valueLabel={club.name || undefined}
                      imageUrl={club.logoUrl}
                      disabled={locked}
                      onPickTeam={(hit) => pickCareerClub(q, idx, hit)}
                    />
                    {q.type === 'missing_club' && (
                      <label className="career-loan-toggle">
                        <input
                          type="radio"
                          name={`missing-club-${q.id}`}
                          checked={Boolean(club.missing)}
                          disabled={locked}
                          onChange={() => markMissingClub(q, idx)}
                        />
                        Missing
                      </label>
                    )}
                    <label className="career-loan-toggle">
                      <input
                        type="checkbox"
                        checked={club.note === 'loan'}
                        disabled={locked}
                        onChange={() => toggleCareerLoan(q, idx)}
                      />
                      Loan
                    </label>
                    <div className="editor-icon-actions">
                      <button type="button" className="ghost tiny-btn" disabled={locked || idx === 0} onClick={() => moveCareerClub(q, idx, -1)} aria-label={`Move club ${idx + 1} earlier`}>↑</button>
                      <button type="button" className="ghost tiny-btn" disabled={locked || idx === clubs.length - 1} onClick={() => moveCareerClub(q, idx, 1)} aria-label={`Move club ${idx + 1} later`}>↓</button>
                      <button type="button" className="danger tiny-btn" disabled={locked || clubs.length <= 3} onClick={() => removeCareerClub(q, idx)}>Remove</button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost"
                  disabled={locked || (q.presentation?.careerClubs?.length ?? 0) >= 6}
                  onClick={() => addCareerClub(q)}
                >
                  + Add club
                </button>
              </fieldset>
            )}

            {isSearchQuestion(q) && (
              <fieldset disabled={locked} className="options">
                <legend>Correct answer</legend>
                {q.type === 'missing_club' ? (
                  <>
                    <p className="muted tiny">
                      Players type a club name and search, like Target Man. Choose the missing club.
                    </p>
                    {q.options[0] && (
                      <EntityPicker
                        key={`custom-club-${q.options[0].id}-${q.options[0].label}`}
                        kind="team"
                        label="Club"
                        valueLabel={
                          hasSelectedSearchAnswer(q) ? q.options[0].label : undefined
                        }
                        imageUrl={q.options[0].teamLogoUrl}
                        disabled={locked}
                        onPickTeam={(hit) => pickClub(q, q.options[0]!, hit)}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <p className="muted tiny">
                      Players type a name and search, like Target Man. Choose the player that should
                      count as correct.
                    </p>
                    {q.options[0] && (
                      <EntityPicker
                        key={`custom-answer-${q.options[0].id}-${q.options[0].label}`}
                        kind="player"
                        label="Player"
                        valueLabel={
                          hasSelectedSearchAnswer(q) ? q.options[0].label : undefined
                        }
                        imageUrl={q.options[0].headshotUrl}
                        nationality={q.options[0].nationality}
                        disabled={locked}
                        onPickPlayer={(hit) => pickPlayer(q, q.options[0]!, hit)}
                      />
                    )}
                  </>
                )}
              </fieldset>
            )}

            {!isSearchQuestion(q) && <fieldset disabled={locked} className="options">
              <legend>Possible answers ({q.options.length}/{expectedOptions})</legend>
              {q.type === 'custom_text' && (
                <p className="muted tiny">
                  Search and select four players, then check the correct one.
                </p>
              )}
              {!optionCountValid && (
                <p className="editor-inline-warning">
                  {friendlyType(q.type)} requires exactly {expectedOptions} options. Add or remove options before saving.
                </p>
              )}
              {q.options.map((o) => (
                <div key={`${q.id}-${o.id}`} className="option-with-picker">
                  <div className="radio-col">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={ans?.correctOptionId === o.id}
                      onChange={() => setCorrectOption(q, o.id)}
                    />
                  </div>
                  {q.type === 'custom_image' ? (
                    <div className="custom-option-row">
                      {o.teamLogoUrl && (
                        <img src={o.teamLogoUrl} alt="" className="custom-option-badge" />
                      )}
                      <label className="field custom-option-input">
                        Answer {q.options.indexOf(o) + 1}
                        <input
                          value={o.label}
                          disabled={locked}
                          onChange={(event) => updateCustomOption(q, o.id, event.target.value)}
                        />
                      </label>
                    </div>
                  ) : clubMode ? (
                    <EntityPicker
                      key={`team-${o.id}-${o.teamLogoUrl ?? ''}-${o.label}`}
                      kind="team"
                      valueLabel={o.label}
                      imageUrl={o.teamLogoUrl}
                      disabled={locked}
                      onPickTeam={(hit) => pickClub(q, o, hit)}
                    />
                  ) : (
                    <EntityPicker
                      key={`player-${o.id}-${o.headshotUrl ?? ''}-${o.label}`}
                      kind="player"
                      valueLabel={o.label}
                      imageUrl={o.headshotUrl}
                      nationality={o.nationality}
                      disabled={locked}
                      onPickPlayer={(hit) => pickPlayer(q, o, hit)}
                    />
                  )}
                  {q.type !== 'custom_image' && q.type !== 'custom_text' && <button
                    type="button"
                    className="danger tiny-btn lms-remove-option"
                    disabled={locked || q.options.length <= 2}
                    onClick={() => removeOption(q, o.id)}
                    aria-label={`Remove ${o.label}`}
                  >
                    Remove
                  </button>}
                </div>
              ))}
              {q.type !== 'custom_image' && q.type !== 'custom_text' && (
                <button type="button" className="ghost" disabled={locked} onClick={() => addOption(q)}>+ Add option</button>
              )}
            </fieldset>}

            <label className="field">
              Answer explanation
              <textarea
                rows={2}
                value={ans?.reveal ?? ''}
                disabled={locked}
                onChange={(e) => updateAnswer(q.id, { reveal: e.target.value })}
              />
              <span className="muted tiny">
                {revealBusyFor === q.id
                  ? 'Updating explanation from the new answer…'
                  : 'Auto-updates when you change the answer (stats, career path, etc.).'}
              </span>
            </label>
            <details className="editor-advanced">
              <summary>Advanced</summary>
              <div className="advanced-grid">
                <label className="field">Display style<input value={q.presentation?.layout ?? ''} disabled={locked} onChange={(event) => updateQuestion(q.slot, { presentation: { ...(q.presentation ?? {}), layout: event.target.value } })} /></label>
                {q.presentation?.imageUrl && <label className="field">Image source<input value={q.presentation.imageUrl} disabled={locked} onChange={(event) => updateQuestion(q.slot, { presentation: { ...(q.presentation ?? {}), imageUrl: event.target.value } })} /></label>}
                {(q.type === 'image_badge' || q.type === 'custom_image') && (
                  <label className="field lms-blur-control">
                    Image blur
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={q.presentation?.imageBlur ?? (q.type === 'image_badge' ? 6 : 0)}
                      disabled={locked}
                      onChange={(event) => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageBlur: Number(event.target.value) },
                      })}
                    />
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={q.presentation?.imageBlur ?? (q.type === 'image_badge' ? 6 : 0)}
                      disabled={locked}
                      onChange={(event) => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageBlur: Number(event.target.value) },
                      })}
                    />
                  </label>
                )}
              </div>
            </details>
          </article>
        )
      })() : <p className="editor-inline-warning">No questions available.</p>}
    </div>
  )
}
