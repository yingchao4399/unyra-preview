/**
 * 考试窗口「滚到某一题」的位置计算（components/exam/scroll）。
 *
 * 这里钉的是那个 bug 的行为边界：选择答案后自动翻到下一题，滚动**只能发生在题目流里**。
 * 位置算错的代价不是「差几个像素」——算到容器外面就会把整页顶上去，卷面底下空一大块
 * （用户报的那个现象）。所以刚好可见、在上方、在下方、比可视区还高、顶到内容两端，
 * 一条条钉住。
 */
import { describe, expect, it } from 'vitest'

import { nearestScrollTop } from '../src/components/exam/scroll'

const box = (scrollTop = 0, clientHeight = 500, scrollHeight = 2000) => ({ scrollTop, clientHeight, scrollHeight })

describe('nearestScrollTop', () => {
  it('已经完整可见时原地不动', () => {
    expect(nearestScrollTop(box(), { contentTop: 100, height: 100 })).toBe(0)
  })

  it('留白之内也算可见：不为了几像素的 margin 抖一下', () => {
    expect(nearestScrollTop(box(0), { contentTop: 4, height: 100 }, 12)).toBe(0)
  })

  it('在可视区下方：只滚到刚好露出底边（含留白）', () => {
    expect(nearestScrollTop(box(), { contentTop: 900, height: 100 }, 12)).toBe(512)
  })

  it('在可视区上方：顶部对齐', () => {
    expect(nearestScrollTop(box(600), { contentTop: 200, height: 100 }, 12)).toBe(188)
  })

  it('比可视区还高时对顶：否则题目开头被切掉，得自己往上找', () => {
    expect(nearestScrollTop(box(), { contentTop: 300, height: 700 }, 12)).toBe(288)
  })

  it('已经在内容底部时不会滚过头', () => {
    expect(nearestScrollTop(box(1500), { contentTop: 1900, height: 100 }, 12)).toBe(1500)
  })

  it('已经在内容顶部时不会滚成负数', () => {
    expect(nearestScrollTop(box(0), { contentTop: 2, height: 100 }, 12)).toBe(0)
  })

  it('内容不足一屏时永远停在 0（没有可滚的区间）', () => {
    expect(nearestScrollTop(box(0, 500, 420), { contentTop: 480, height: 100 }, 12)).toBe(0)
  })
})
