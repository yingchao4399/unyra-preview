import { describe, expect, it } from 'vitest'
import { normalizeCropRect, rotateBitmap, drawBoundingBoxBitmap } from '../electron/exam/imageCrop'
import { hasAnswerValue } from '../src/learn/exam/grade'
import { recordInput, newAttempt } from '../src/learn/examRecords'
import {
  attachCroppedAnswerImage,
  attachHandwrittenImages,
  updateHandwrittenImage,
  applyGradeResult,
  submitAttempt,
  upsertAttempt,
} from '../src/learn/graph/exams'
import type { Exam, ExamAttempt } from '../src/learn/exam/types'
import type { LearnStore } from '../src/learn/types'

const T0 = 1_700_000_000_000

const mockExam: Exam = {
  id: 'e_crop_test',
  nodeId: 'node_1',
  goalId: 'goal_1',
  title: '手写答案考试',
  kind: 'exam',
  level: 'hard',
  minutes: 60,
  createdAt: T0,
  attempts: [],
  questions: [
    {
      id: 'q1',
      type: 'short',
      stem: '简述微积分基本定理的几何意义',
      points: 10,
    },
    {
      id: 'q2',
      type: 'fill',
      stem: '导数的物理意义是______',
      points: 5,
    },
    {
      id: 'q3',
      type: 'truefalse',
      stem: '极限存在则唯一',
      answer: ['true'],
      points: 2,
    },
  ],
}

function makeInitialStore(): LearnStore {
  const node = {
    id: 'node_1',
    goalId: 'goal_1',
    title: '微积分',
    key: '微积分',
    description: '',
    docs: { teaching: '微积分正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    createdAt: T0,
    updatedAt: T0,
  }
  return {
    version: 2,
    nodes: [node],
    edges: [],
    goals: [
      {
        id: 'goal_1',
        rootNodeId: 'node_1',
        question: '学微积分',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    exams: [mockExam],
    conversations: [],
  } as unknown as LearnStore
}

describe('手写答案坐标换算与归一化 (normalizeCropRect)', () => {
  it('大模型标准 0~1000 范围 [ymin, xmin, ymax, xmax] 自适应换算', () => {
    const imgWidth = 2000
    const imgHeight = 1000
    // [ymin: 100, xmin: 200, ymax: 600, xmax: 800]
    const rect = normalizeCropRect([100, 200, 600, 800], imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 400, // (200 / 1000) * 2000 = 400
      y: 100, // (100 / 1000) * 1000 = 100
      width: 1200, // ((800 - 200) / 1000) * 2000 = 1200
      height: 500, // ((600 - 100) / 1000) * 1000 = 500
    })
  })

  it('0~1 比例范围 [ymin, xmin, ymax, xmax] 自适应换算', () => {
    const imgWidth = 1920
    const imgHeight = 1080
    const rect = normalizeCropRect([0.1, 0.2, 0.6, 0.7], imgWidth, imgHeight)

    expect(rect.x).toBe(Math.round(0.2 * 1920))
    expect(rect.y).toBe(Math.round(0.1 * 1080))
    expect(rect.width).toBe(Math.round((0.7 - 0.2) * 1920))
    expect(rect.height).toBe(Math.round((0.6 - 0.1) * 1080))
  })

  it('像素级对象 { x, y, width, height } 原样保留并进行边界约束', () => {
    const imgWidth = 800
    const imgHeight = 600
    const rect = normalizeCropRect({ x: 50, y: 60, width: 300, height: 400 }, imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 50,
      y: 60,
      width: 300,
      height: 400,
    })

    // 超出边界约束
    const outRect = normalizeCropRect({ x: 700, y: 500, width: 500, height: 500 }, imgWidth, imgHeight)
    expect(outRect.x).toBe(700)
    expect(outRect.y).toBe(500)
    expect(outRect.width).toBe(100) // 800 - 700
    expect(outRect.height).toBe(100) // 600 - 500
  })

  it('结构化对象 { ymin, xmin, ymax, xmax } 转换', () => {
    const imgWidth = 1000
    const imgHeight = 1000
    const rect = normalizeCropRect({ ymin: 150, xmin: 50, ymax: 450, xmax: 950 }, imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 50,
      y: 150,
      width: 900,
      height: 300,
    })
  })
})

describe('手写答案判分有效性与输入记录流 (hasAnswerValue & recordInput)', () => {
  it('只要附带手写答案图片即判定为已作答', () => {
    expect(hasAnswerValue({ questionId: 'q1', value: [] })).toBe(false)
    expect(hasAnswerValue({ questionId: 'q1', value: [], text: '   ' })).toBe(false)
    expect(hasAnswerValue({ questionId: 'q1', value: [], image: 'data:image/png;base64,...' })).toBe(true)
    expect(hasAnswerValue({ questionId: 'q1', value: [], image: 'C:/transfers/shot1.png' })).toBe(true)
  })

  it('recordInput 记录手写答案图片并汇总到全卷 handwrittenImages', () => {
    let attempt = newAttempt('att_1', T0, false)
    attempt = recordInput(attempt, mockExam, {
      questionId: 'q1',
      value: [],
      text: '见手写计算过程',
      image: 'C:/transfers/q1_handwritten.png',
      rawImage: 'C:/transfers/sheet_raw_1.png',
      at: T0 + 1000,
    })

    expect(attempt.answers).toHaveLength(1)
    expect(attempt.answers[0].questionId).toBe('q1')
    expect(attempt.answers[0].text).toBe('见手写计算过程')
    expect(attempt.answers[0].image).toBe('C:/transfers/q1_handwritten.png')
    expect(attempt.answers[0].rawImage).toBe('C:/transfers/sheet_raw_1.png')

    // 自动追加至 handwrittenImages
    expect(attempt.handwrittenImages).toContain('C:/transfers/sheet_raw_1.png')
  })
})

describe('手写答卷非机械化判题与 Agent 亲自介入 (submitAttempt & applyGradeResult)', () => {
  it('submitAttempt 在包含手写图片时不进行机械式客观题判分', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_sub_1',
      startedAt: T0,
      status: 'ongoing',
      answers: [{ questionId: 'q3', value: ['false'] }], // 界面上可能误点了错误选项
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      handwrittenImages: ['sheet_1.png'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)
    const nextStore = submitAttempt(store, mockExam.id, 'att_sub_1', T0 + 10000)
    const settled = nextStore.exams[0].attempts[0]
    expect(settled.status).toBe('submitted')
    // 因为有手写图片，绝不进行机械判断！
    expect(settled.results).toBeUndefined()
  })

  it('applyGradeResult 在有手写答卷时，客观题完全采信 Agent 亲自判定的分数与识别的作答', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_sub_2',
      startedAt: T0,
      status: 'submitted',
      answers: [{ questionId: 'q3', value: ['false'] }], // 界面上误点的
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      handwrittenImages: ['sheet_1.png'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    // Agent 审阅手写答卷后，识别出学生在纸上写的是对的（比如 "true" / "对"），并给了满分 2 分
    const res = applyGradeResult(store, mockExam.id, 'att_sub_2', {
      passed: true,
      summary: '审阅了手写答卷',
      results: [
        {
          questionId: 'q3',
          correct: true,
          score: 2,
          comment: '手写答案为对，理解准确',
          userAnswer: ['true'],
        },
      ],
    })

    const graded = res.store.exams[0].attempts[0]
    expect(graded.status).toBe('graded')
    const q3Result = graded.results?.find((r) => r.questionId === 'q3')
    expect(q3Result?.by).toBe('agent')
    expect(q3Result?.correct).toBe(true)
    expect(q3Result?.score).toBe(2)
    // 学习者实际作答更新为 Agent 从手写纸上识别的内容
    const q3Ans = graded.answers.find((a) => a.questionId === 'q3')
    expect(q3Ans?.value).toEqual(['true'])
  })
})

describe('Agent 裁切工具与试卷回看贴题关联 (attachCroppedAnswerImage & attachHandwrittenImages)', () => {
  it('attachCroppedAnswerImage 将裁剪后的手写图片精准绑定至题目结果与答案', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_crop_1',
      startedAt: T0,
      status: 'submitted',
      answers: [{ questionId: 'q1', value: [] }],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      results: [
        {
          questionId: 'q1',
          correct: true,
          score: 10,
          maxScore: 10,
          by: 'agent',
        },
      ],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const croppedPath = 'C:/Users/test/exam-crops/crop_q1_math.png'
    const nextStore = attachCroppedAnswerImage(store, mockExam.id, 'att_crop_1', 'q1', croppedPath)

    const updatedAttempt = nextStore.exams[0].attempts[0]
    expect(updatedAttempt.results?.[0].croppedAnswerImage).toBe(croppedPath)
    expect(updatedAttempt.answers[0].image).toBe(croppedPath)
  })

  it('attachHandwrittenImages 支持多次追加且自动去重', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_handwritten_1',
      startedAt: T0,
      status: 'submitted',
      answers: [],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      handwrittenImages: ['img_a.png'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const nextStore = attachHandwrittenImages(store, mockExam.id, 'att_handwritten_1', ['img_b.png', 'img_a.png', 'img_c.png'])
    const updated = nextStore.exams[0].attempts[0]

    expect(updated.handwrittenImages).toEqual(['img_a.png', 'img_b.png', 'img_c.png'])
  })

  it('applyGradeResult 支持直接写入 croppedAnswerImage', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_grade_1',
      startedAt: T0,
      status: 'submitted',
      answers: [{ questionId: 'q1', value: [], image: 'raw.png' }],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const croppedAnswerImage = 'C:/userData/exam-crops/q1_crop.png'
    const res = applyGradeResult(store, mockExam.id, 'att_grade_1', {
      passed: true,
      summary: '全部正确',
      results: [
        {
          questionId: 'q1',
          correct: true,
          score: 10,
          comment: '推导步骤清晰完备',
          croppedAnswerImage,
        },
      ],
    })

    expect(res.ok).toBe(true)
    const graded = res.store.exams[0].attempts[0]
    expect(graded.status).toBe('graded')
    expect(graded.results?.[0].croppedAnswerImage).toBe(croppedAnswerImage)
  })

  it('rotateBitmap 像素级顺时针旋转测试 (90°, 180°, 270°)', () => {
    // 构造 2x2 图像缓冲区，4 个不同颜色的像素
    // (0,0): 红色 (255, 0, 0, 255)
    // (1,0): 绿色 (0, 255, 0, 255)
    // (0,1): 蓝色 (0, 0, 255, 255)
    // (1,1): 白色 (255, 255, 255, 255)
    const buf = Buffer.from([
      255, 0, 0, 255,   0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 255, 255,
    ])

    // 顺时针旋转 90 度
    const r90 = rotateBitmap(buf, 2, 2, 90)
    expect(r90.width).toBe(2)
    expect(r90.height).toBe(2)
    // 旋转后：
    // (0,0) 应该是原来的 (0,1) 蓝色
    // (1,0) 应该是原来的 (0,0) 红色
    // (0,1) 应该是原来的 (1,1) 白色
    // (1,1) 应该是原来的 (1,0) 绿色
    expect(r90.buffer.slice(0, 4)).toEqual(Buffer.from([0, 0, 255, 255]))
    expect(r90.buffer.slice(4, 8)).toEqual(Buffer.from([255, 0, 0, 255]))
    expect(r90.buffer.slice(8, 12)).toEqual(Buffer.from([255, 255, 255, 255]))
    expect(r90.buffer.slice(12, 16)).toEqual(Buffer.from([0, 255, 0, 255]))

    // 旋转 180 度
    const r180 = rotateBitmap(buf, 2, 2, 180)
    expect(r180.buffer.slice(0, 4)).toEqual(Buffer.from([255, 255, 255, 255])) // 原来 (1,1)
    expect(r180.buffer.slice(12, 16)).toEqual(Buffer.from([255, 0, 0, 255])) // 原来 (0,0)

    // 旋转 270 度
    const r270 = rotateBitmap(buf, 2, 2, 270)
    expect(r270.buffer.slice(0, 4)).toEqual(Buffer.from([0, 255, 0, 255])) // 原来 (1,0)
  })

  it('先裁剪后评分时，已裁切的图片能稳妥保留并落入题目回看', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      ...newAttempt('att_pre_crop', T0, false),
      status: 'submitted',
      answers: [],
      handwrittenImages: ['C:/photos/sheet1.jpg'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    // 先调用 attachCroppedAnswerImage 贴图
    store = attachCroppedAnswerImage(store, mockExam.id, 'att_pre_crop', 'q1', 'C:/crops/q1.png')

    // 接着 Agent 进行判分（payload 里未重复提供 croppedAnswerImage）
    const res = applyGradeResult(store, mockExam.id, 'att_pre_crop', {
      passed: true,
      summary: '通过',
      results: [{ questionId: 'q1', correct: true, score: 10, comment: '好' }],
    })

    expect(res.ok).toBe(true)
    const graded = res.store.exams[0].attempts[0]
    expect(graded.results?.[0].croppedAnswerImage).toBe('C:/crops/q1.png')
  })

  it('drawBoundingBoxBitmap 绘制醒目红框用于大模型裁切预检', () => {
    // 创建一个 10x10 的全黑测试图像（RGBA 格式）
    const width = 10
    const height = 10
    const buf = Buffer.alloc(width * height * 4, 0)
    // 全部设为不透明黑色 (R:0, G:0, B:0, A:255)
    for (let i = 0; i < width * height; i++) {
      buf[i * 4 + 3] = 255
    }

    // 在 x:2, y:2, width:6, height:6 绘制红框，线宽 1，指定 RGBA 模式
    const marked = drawBoundingBoxBitmap(
      buf,
      width,
      height,
      { x: 2, y: 2, width: 6, height: 6 },
      {
        borderWidth: 1,
        borderColor: { r: 255, g: 0, b: 50, a: 255 },
        fillColor: { r: 255, g: 0, b: 0, a: 51 }, // 20%
        isBgra: false,
      },
    )

    // 1. 矩形外边的像素应该保持纯黑 (0,0)
    const outPixel = (y: number, x: number) => {
      const idx = (y * width + x) * 4
      return [marked[idx], marked[idx + 1], marked[idx + 2], marked[idx + 3]]
    }

    expect(outPixel(0, 0)).toEqual([0, 0, 0, 255])
    expect(outPixel(1, 1)).toEqual([0, 0, 0, 255])
    expect(outPixel(8, 8)).toEqual([0, 0, 0, 255])

    // 2. 边框上的像素应该是纯红 (255, 0, 50, 255)
    // 上边框 (y:2, x:2..7)
    expect(outPixel(2, 2)).toEqual([255, 0, 50, 255])
    expect(outPixel(2, 5)).toEqual([255, 0, 50, 255])
    expect(outPixel(2, 7)).toEqual([255, 0, 50, 255])
    // 下边框 (y:7, x:2..7)
    expect(outPixel(7, 2)).toEqual([255, 0, 50, 255])
    expect(outPixel(7, 7)).toEqual([255, 0, 50, 255])
    // 左边框 (y:4, x:2)
    expect(outPixel(4, 2)).toEqual([255, 0, 50, 255])
    // 右边框 (y:4, x:7)
    expect(outPixel(4, 7)).toEqual([255, 0, 50, 255])

    // 3. 内部像素应该有半透明红底填充 (alpha blend: 0 * 0.8 + 255 * 0.2 = 51)
    const inner = outPixel(4, 4)
    expect(inner[0]).toBe(51) // R blended
    expect(inner[1]).toBe(0) // G
    expect(inner[2]).toBe(0) // B
    expect(inner[3]).toBe(255) // A
  })

  it('updateHandwrittenImage 顺时针旋转答卷后更新 store 中的手写图片与答案引用', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      ...newAttempt('att_rotate_test', T0, false),
      status: 'submitted',
      answers: [
        {
          questionId: 'q1',
          value: ['微积分'],
          rawImage: 'C:/photos/orig_sheet1.jpg',
        },
        {
          questionId: 'q2',
          value: ['变化率'],
          rawImage: 'C:/photos/sheet2.jpg',
        },
      ],
      handwrittenImages: ['C:/photos/orig_sheet1.jpg', 'C:/photos/sheet2.jpg'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    // 顺时针旋转第 0 页后，调用 updateHandwrittenImage
    const updated = updateHandwrittenImage(
      store,
      mockExam.id,
      'att_rotate_test',
      0,
      'C:/photos/rotated_sheet1.png',
    )

    const att = updated.exams[0].attempts.find((a) => a.id === 'att_rotate_test')!
    expect(att.handwrittenImages).toEqual(['C:/photos/rotated_sheet1.png', 'C:/photos/sheet2.jpg'])
    // 题目 q1 的 rawImage 应该同步更新为旋转后的新图
    expect(att.answers[0].rawImage).toBe('C:/photos/rotated_sheet1.png')
    // 题目 q2 的 rawImage 应该保持不变
    expect(att.answers[1].rawImage).toBe('C:/photos/sheet2.jpg')
  })
})
