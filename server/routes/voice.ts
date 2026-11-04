import { Hono } from 'hono'
import {
  detectGpu,
  removeModel,
  statusOf,
  transcribe,
} from '../../electron/voice'
import type { VoiceTranscribeRequest } from '../../shared/ipc'

export const voiceRouter = new Hono()

voiceRouter.get('/status', async (c) => {
  const res = await statusOf()
  return c.json(res)
})

voiceRouter.get('/gpuInfo', async (c) => {
  const res = await detectGpu()
  return c.json(res)
})

voiceRouter.post('/remove', async (c) => {
  const res = await removeModel()
  return c.json(res)
})

voiceRouter.post('/transcribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as VoiceTranscribeRequest
  // samples 数组需还原为 Float32Array 格式供推理引擎使用
  if (Array.isArray(body.samples)) {
    body.samples = new Float32Array(body.samples)
  }
  const res = await transcribe(body)
  return c.json(res)
})
