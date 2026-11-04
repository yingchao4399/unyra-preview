/**
 * PDF.js 6.5.438 eagerly fetches every top-level page dictionary, then validates
 * the last page before exposing the document. Flat scan books consequently read
 * almost every image chunk before page one. Keep traversal demand driven.
 *
 * Bounded lookahead overlaps dictionary I/O during distant jumps, while the
 * original traversal still counts every subtree. Never infer flatness from Count.
 * These exact, version-pinned edits affect scheduling only. Damaged xref recovery
 * still performs full validation; normal documents validate pages as requested.
 * Fail closed on an upstream change instead of silently shipping eager loading.
 */
export function demandDrivenPdfWorker(source: string): string {
  const edits = [
    ['n===this.toplevelPagesDict&&a instanceof Ref&&!o.has(a)&&o.put(a,s.fetchAsync(a))', ''],
    ['await this.ensureDoc("checkLastPage",[e])', 'e&&await this.ensureDoc("checkLastPage",[e])'],
    ['const c=await(o.get(n)||s.fetchAsync(n));', `
      if(e>l){
        const ahead=[n,...t.slice(-63).reverse()];
        for(const ref of ahead){
          if(ref instanceof Ref&&!o.has(ref)){
            const pending=s.fetchAsync(ref);
            pending.catch(()=>{});
            o.put(ref,pending);
          }
        }
      }
      const c=await(o.get(n)||s.fetchAsync(n));`],
  ] as const
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('PDF.js 版本不兼容，请更新按需加载补丁')
    source = source.replace(before, after)
  }
  return source
}
