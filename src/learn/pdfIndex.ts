export interface PdfSearchHit { pageNumber: number; text: string; score: number }
interface IndexedDocument { documentId: string; path: string; total: number; pages: Map<number, string> }
const documents = new Map<string, IndexedDocument>()

export const pdfIndex = {
  register(documentId: string, path: string, total: number) {
    const existing = documents.get(documentId)
    documents.delete(documentId)
    documents.set(documentId, existing ?? { documentId, path, total, pages: new Map() })
    while (documents.size > 3) documents.delete(documents.keys().next().value!)
  },
  add(documentId: string, pageNumber: number, text: string) {
    documents.get(documentId)?.pages.set(pageNumber, text.slice(0, 100000))
  },
  list() {
    return [...documents.values()].map(d => ({ documentId: d.documentId, path: d.path, total: d.total, indexed: d.pages.size }))
  },
  search({ documentId, query, limit = 5 }: { documentId: string; query: string; limit?: number }): PdfSearchHit[] {
    const doc = documents.get(documentId)
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 32)
    if (!doc || !words.length) return []
    const hits: PdfSearchHit[] = []
    for (const [pageNumber, text] of doc.pages) {
      const lower = text.toLocaleLowerCase()
      const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0) / words.length
      if (score) hits.push({ pageNumber, text, score })
    }
    return hits.sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber).slice(0, Math.max(1, Math.min(20, Math.floor(limit) || 5)))
  },
}
