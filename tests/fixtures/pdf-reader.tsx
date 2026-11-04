import { createRoot } from 'react-dom/client'
import PdfDocView from '../../src/components/learn/pdf/PdfDocView'
import { refreshPlugins } from '../../src/lib/plugins'
import { pdfIndex } from '../../src/learn/pdfIndex'

const sample = new URLSearchParams(location.search).get('sample')!
async function main() {
  const stages: Array<{ name: string; ms: number }> = []
  const mark = (name: string) => stages.push({ name, ms: Math.round(performance.now()) })
  mark('fixture:module')
  await refreshPlugins()
  mark('fixture:plugins')
  const OriginalWorker = window.Worker
  window.Worker = class extends OriginalWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      mark('worker:create')
      super(url, options)
      this.addEventListener('message', event => mark(`worker:${event.data?.action ?? 'message'}`), { once: true })
    }
  }
  const network = { ranges: [] as string[], urls: [] as string[], requestedBytes: 0, fullRequests: 0,
    timings: [] as Array<{ range: string | null; start: number; headers?: number; end?: number }> }
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    let timing: (typeof network.timings)[number] | undefined
    if (String(input).startsWith('unyra-pdf:')) {
      network.urls.push(String(input))
      const range = new Headers(init?.headers).get('Range')
      timing = { range, start: Math.round(performance.now()) }
      network.timings.push(timing)
      if (range) {
        network.ranges.push(range)
        const match = /bytes=(\d+)-(\d+)/.exec(range)!
        network.requestedBytes += Number(match[2]) - Number(match[1]) + 1
      } else network.fullRequests++
    }
    const response = await originalFetch(input, init)
    if (timing) {
      timing.headers = Math.round(performance.now())
      const read = response.arrayBuffer.bind(response)
      response.arrayBuffer = async () => {
        const bytes = await read()
        timing!.end = Math.round(performance.now())
        return bytes
      }
    }
    return response
  }
  const root = createRoot(document.getElementById('root')!)
  const render = (path: string) => root.render(<PdfDocView path={path} />)
  render(sample)
  mark('fixture:render')
  Object.assign(window, { pdfTestIndex: pdfIndex, pdfTestSwitch: render, pdfTestNetwork: network, pdfTestStages: stages })
}
void main()
