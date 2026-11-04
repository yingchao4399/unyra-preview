import { describe, expect, it } from 'vitest'
import { pdfIndex } from '../src/learn/pdfIndex'
describe('incremental PDF index', () => {
  it('searches only completed pages and ranks matches', () => {
    pdfIndex.register('book', '/book.pdf', 686)
    expect(pdfIndex.search({ documentId: 'book', query: '实验' })).toEqual([])
    pdfIndex.add('book', 500, '实验心理学中的随机实验设计')
    pdfIndex.add('book', 2, '心理学概论')
    expect(pdfIndex.search({ documentId: 'book', query: '实验 心理学', limit: 1 })).toEqual([
      { pageNumber: 500, text: '实验心理学中的随机实验设计', score: 1 },
    ])
    expect(pdfIndex.list().find(d => d.documentId === 'book')?.indexed).toBe(2)
  })
})
