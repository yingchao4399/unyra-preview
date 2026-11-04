import { describe, expect, it } from 'vitest'
import { normalizeAskForm } from '../src/agent/sandbox/askForm'

describe('normalizeAskForm', () => {
  it('正确归一化单选题与简答题', () => {
    const res = normalizeAskForm({
      title: '调查问卷',
      questions: [
        { type: 'single', prompt: '你喜欢编程吗？', options: ['喜欢', '不喜欢'] },
        { type: 'short', prompt: '你最喜欢的语言是？' },
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.form.title).toBe('调查问卷')
    expect(res.form.questions).toHaveLength(2)
    expect(res.form.questions[0].type).toBe('single')
    expect(res.form.questions[0].options).toHaveLength(2)
    expect(res.form.questions[1].type).toBe('short')
  })

  it('支持单滑块 (slider / range)', () => {
    const res = normalizeAskForm({
      questions: [
        {
          type: 'slider',
          prompt: '你的熟练度打分',
          min: 10,
          max: 90,
          step: 5,
          unit: '分',
          defaultValue: 60,
        },
        {
          type: 'range', // 别名支持
          prompt: '满意度',
        },
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.form.questions[0].type).toBe('slider')
    expect(res.form.questions[0].min).toBe(10)
    expect(res.form.questions[0].max).toBe(90)
    expect(res.form.questions[0].step).toBe(5)
    expect(res.form.questions[0].unit).toBe('分')
    expect(res.form.questions[0].defaultValue).toBe(60)

    // 默认回落
    expect(res.form.questions[1].type).toBe('slider')
    expect(res.form.questions[1].min).toBe(0)
    expect(res.form.questions[1].max).toBe(100)
    expect(res.form.questions[1].step).toBe(1)
  })

  it('支持双滑块 (dual_slider / dual_range)', () => {
    const res = normalizeAskForm({
      questions: [
        {
          type: 'dual_slider',
          prompt: '期望薪资范围',
          min: 5000,
          max: 50000,
          step: 1000,
          unit: '元',
          defaultValue: [15000, 25000],
        },
        {
          type: 'dual_range', // 别名支持
          prompt: '工作年限区间',
        },
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.form.questions[0].type).toBe('dual_slider')
    expect(res.form.questions[0].min).toBe(5000)
    expect(res.form.questions[0].max).toBe(50000)
    expect(res.form.questions[0].defaultValue).toEqual([15000, 25000])

    // 默认回落
    expect(res.form.questions[1].type).toBe('dual_slider')
    expect(res.form.questions[1].min).toBe(0)
    expect(res.form.questions[1].max).toBe(100)
    expect(res.form.questions[1].defaultValue).toEqual([0, 100])
  })

  it('支持附件上传 (upload / file)', () => {
    const res = normalizeAskForm({
      questions: [
        {
          type: 'upload',
          prompt: '请上传你的设计稿或文档',
          accept: 'image/*,.pdf',
          multipleFiles: true,
          maxSizeMb: 50,
        },
        {
          type: 'file', // 别名支持
          prompt: '上传个人简历',
        },
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.form.questions[0].type).toBe('upload')
    expect(res.form.questions[0].accept).toBe('image/*,.pdf')
    expect(res.form.questions[0].multipleFiles).toBe(true)
    expect(res.form.questions[0].maxSizeMb).toBe(50)

    // 默认回落
    expect(res.form.questions[1].type).toBe('upload')
    expect(res.form.questions[1].multipleFiles).toBe(false)
    expect(res.form.questions[1].maxSizeMb).toBe(32)
  })

  it('未知类型给出明确报错引导', () => {
    const res = normalizeAskForm({
      questions: [{ type: 'unknown_type', prompt: 'test' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.content).toContain('只认')
      expect(res.content).toContain('slider')
      expect(res.content).toContain('dual_slider')
      expect(res.content).toContain('upload')
    }
  })
})
