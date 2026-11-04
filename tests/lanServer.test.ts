import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLanIpList } from '../electron/lan/netInfo'
import { getMobileHtml } from '../electron/lan/mobileHtml'
import { lanServer } from '../electron/lan/server'
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'

describe('局域网服务器与文件传输系统', () => {
  beforeEach(async () => {
    await lanServer.stop()
  })

  afterEach(async () => {
    await lanServer.stop()
  })

  it('网卡扫描智能识别局域网 IP', () => {
    const net = getLanIpList()
    expect(net.defaultIp).toBeDefined()
    expect(net.allIps.length).toBeGreaterThan(0)
    // 不应该包含 127.0.0.1 除非实在找不到其它 IP
    if (net.allIps.length > 1) {
      expect(net.defaultIp).not.toBe('127.0.0.1')
    }
  })

  it('移动端 H5 模版包含必需的 WebSocket 连接与意图响应逻辑', () => {
    const html = getMobileHtml('归一测试')
    expect(html).toContain('归一测试')
    expect(html).toContain('/ws')
    expect(html).toContain('/api/upload')
    expect(html).toContain('request_file')
    expect(html).toContain('intent_rejected')
  })

  it('局域网服务器启动、获取状态与停止', async () => {
    const status = await lanServer.start(58999)
    expect(status.running).toBe(true)
    expect(status.port).toBeGreaterThanOrEqual(58999)
    expect(status.qrUrl).toContain(`http://`)

    const qrData = await lanServer.getQrDataUrl()
    expect(qrData).toContain('data:image/png;base64,')

    const stopped = await lanServer.stop()
    expect(stopped).toBe(true)
    expect(lanServer.getStatus().running).toBe(false)
  })

  it('HTTP 上传文件并落盘，返回文件元数据', async () => {
    const status = await lanServer.start(59001)
    const port = status.port

    const fileContent = 'Hello LAN Transfer File Content'
    const filename = 'test_note.txt'

    // 发起 HTTP POST 上传
    const res = await new Promise<{ status?: number; data: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/upload?filename=${encodeURIComponent(filename)}&deviceId=dev_mock&deviceName=MockPhone`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': Buffer.byteLength(fileContent),
          },
        },
        (response) => {
          let chunks = ''
          response.on('data', (c) => (chunks += c))
          response.on('end', () => resolve({ status: response.statusCode, data: chunks }))
        },
      )
      req.on('error', reject)
      req.write(fileContent)
      req.end()
    })

    expect(res.status).toBe(200)
    const json = JSON.parse(res.data)
    expect(json.ok).toBe(true)
    expect(json.file.name).toContain('test_note')
    expect(json.file.size).toBe(Buffer.byteLength(fileContent))
    expect(fs.existsSync(json.file.path)).toBe(true)

    // 清理测试生成的文件
    try {
      fs.unlinkSync(json.file.path)
    } catch {}
  })

  it('意图发布与文件上传闭环（核心 API: requestDeviceFile）', async () => {
    const status = await lanServer.start(59002)
    const port = status.port

    // 1. 无设备时调用 requestDeviceFile 应当友好报错
    const noDeviceRes = await lanServer.requestDeviceFile({ prompt: '无设备测试' })
    expect(noDeviceRes.ok).toBe(false)
    expect(noDeviceRes.error).toContain('没有手机设备连接')

    // 2. 模拟手机端建立 WebSocket 连接
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'device_join',
            deviceId: 'dev_mock_phone_1',
            deviceName: 'iPhone 15 Pro',
            userAgent: 'Mozilla/5.0 (iPhone)',
          }),
        )
      })

      ws.on('message', (msg) => {
        const data = JSON.parse(msg.toString())
        if (data.type === 'device_welcome') {
          resolve()
        }
      })
    })

    // 此时已有 1 台设备连接
    expect(lanServer.getStatus().devices.length).toBe(1)

    // 3. 准备接收 request_file 意图并执行上传
    let capturedRequestId = ''
    ws.on('message', (msg) => {
      const data = JSON.parse(msg.toString())
      if (data.type === 'request_file') {
        capturedRequestId = data.requestId
        expect(data.prompt).toBe('请拍照上传手写数学题')

        // 模拟手机端在收到意图后，上传对应文件（携带 requestId）
        const testUpload = 'Binary Mock Image Data'
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: `/api/upload?filename=math.jpg&requestId=${capturedRequestId}&deviceId=dev_mock_phone_1`,
            method: 'POST',
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': Buffer.byteLength(testUpload),
            },
          },
          (res) => {
            res.resume()
          },
        )
        req.write(testUpload)
        req.end()
      }
    })

    // 4. 服务端调用 API 发起意图获取文件
    const apiResult = await lanServer.requestDeviceFile({
      prompt: '请拍照上传手写数学题',
      accept: 'image/*',
      timeoutMs: 5000,
    })

    expect(apiResult.ok).toBe(true)
    expect(apiResult.file).toBeDefined()
    expect(apiResult.file?.name).toContain('math')
    expect(apiResult.file?.requestId).toBe(capturedRequestId)
    expect(fs.existsSync(apiResult.file!.path)).toBe(true)

    // 清理文件与连接
    try {
      fs.unlinkSync(apiResult.file!.path)
    } catch {}
    ws.close()
  })
  it('未连接设备时先保留请求，连接后自动发出保留的请求', async () => {
    const status = await lanServer.start(59003)
    const port = status.port

    // 1. 无设备时发起 waitForDevice 的请求，此时应当保留在 pendingRequests 中
    const reqPromise = lanServer.requestDeviceFile({
      prompt: '考试手写答卷',
      accept: 'image/*',
      waitForDevice: true,
      timeoutMs: 5000,
    })

    // 2. 模拟随后手机扫码接入
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    let receivedPrompt = ''
    let receivedRequestId = ''

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'device_join',
          deviceId: 'dev_mock_exam_phone',
          deviceName: 'Xiaomi 14',
        }),
      )
    })

    ws.on('message', (msg) => {
      const data = JSON.parse(msg.toString())
      if (data.type === 'request_file') {
        receivedPrompt = data.prompt
        receivedRequestId = data.requestId

        // 模拟手机上传
        const testUpload = 'Exam Answer Sheet Bytes'
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: `/api/upload?filename=exam_sheet.jpg&requestId=${receivedRequestId}&deviceId=dev_mock_exam_phone`,
            method: 'POST',
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': Buffer.byteLength(testUpload),
            },
          },
          (res) => res.resume(),
        )
        req.write(testUpload)
        req.end()
      }
    })

    const result = await reqPromise
    expect(result.ok).toBe(true)
    expect(result.file).toBeDefined()
    expect(result.file?.name).toContain('exam_sheet')
    expect(receivedPrompt).toBe('考试手写答卷')

    try {
      if (result.file?.path) fs.unlinkSync(result.file.path)
    } catch {}
    ws.close()
  })
})