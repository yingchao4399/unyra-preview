import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { getUserDataDir } from '../storage/userData'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type CropBoxInput =
  | [number, number, number, number]
  | { x: number; y: number; width: number; height: number }
  | { ymin: number; xmin: number; ymax: number; xmax: number }

export interface CropImageResult {
  ok: boolean
  croppedPath?: string
  dataUrl?: string
  error?: string
}

export interface PreviewCropResult {
  ok: boolean
  previewPath?: string
  dataUrl?: string
  rect?: CropRect
  box?: [number, number, number, number]
  error?: string
}

export interface RotateImageResult {
  ok: boolean
  rotatedPath?: string
  dataUrl?: string
  error?: string
}

export interface BoundingBoxOptions {
  borderWidth?: number
  borderColor?: { r: number; g: number; b: number; a?: number }
  fillColor?: { r: number; g: number; b: number; a?: number }
  isBgra?: boolean
}

/**
 * 将任意格式的 box 转换为图像像素级别的 { x, y, width, height }
 * 兼容：
 * - [ymin, xmin, ymax, xmax] (0~1000 范围，大模型常用格式)
 * - [ymin, xmin, ymax, xmax] (0~1 比例)
 * - [x, y, width, height] (绝对像素)
 * - { x, y, width, height }
 * - { ymin, xmin, ymax, xmax }
 */
export function normalizeCropRect(
  box: CropBoxInput,
  imgWidth: number,
  imgHeight: number,
): CropRect {
  let x = 0
  let y = 0
  let width = imgWidth
  let height = imgHeight

  if (Array.isArray(box)) {
    const [a, b, c, d] = box
    const maxVal = Math.max(a, b, c, d)

    if (maxVal <= 1) {
      // 0~1 比例的 [ymin, xmin, ymax, xmax]
      const ymin = Math.max(0, a * imgHeight)
      const xmin = Math.max(0, b * imgWidth)
      const ymax = Math.min(imgHeight, c * imgHeight)
      const xmax = Math.min(imgWidth, d * imgWidth)
      x = xmin
      y = ymin
      width = Math.max(1, xmax - xmin)
      height = Math.max(1, ymax - ymin)
    } else if (maxVal <= 1000) {
      // 0~1000 范围的 [ymin, xmin, ymax, xmax] (大模型通用视觉检测格式)
      const ymin = Math.max(0, (a / 1000) * imgHeight)
      const xmin = Math.max(0, (b / 1000) * imgWidth)
      const ymax = Math.min(imgHeight, (c / 1000) * imgHeight)
      const xmax = Math.min(imgWidth, (d / 1000) * imgWidth)
      x = xmin
      y = ymin
      width = Math.max(1, xmax - xmin)
      height = Math.max(1, ymax - ymin)
    } else {
      // 认为是 [x, y, width, height] 或 [xmin, ymin, xmax, ymax]
      if (c > a && d > b && c <= imgWidth && d <= imgHeight) {
        // [xmin, ymin, xmax, ymax]
        x = a
        y = b
        width = Math.max(1, c - a)
        height = Math.max(1, d - b)
      } else {
        // [x, y, width, height]
        x = a
        y = b
        width = c
        height = d
      }
    }
  } else if ('ymin' in box && 'xmin' in box) {
    const maxVal = Math.max(box.ymin, box.xmin, box.ymax, box.xmax)
    const scale = maxVal <= 1 ? 1 : maxVal <= 1000 ? 1000 : imgWidth
    const ymin = (box.ymin / scale) * imgHeight
    const xmin = (box.xmin / scale) * imgWidth
    const ymax = (box.ymax / scale) * imgHeight
    const xmax = (box.xmax / scale) * imgWidth
    x = Math.max(0, xmin)
    y = Math.max(0, ymin)
    width = Math.max(1, Math.min(imgWidth - x, xmax - xmin))
    height = Math.max(1, Math.min(imgHeight - y, ymax - ymin))
  } else if ('x' in box && 'width' in box) {
    x = box.x
    y = box.y
    width = box.width
    height = box.height
  }

  // 边界约束
  x = Math.max(0, Math.min(imgWidth - 1, Math.round(x)))
  y = Math.max(0, Math.min(imgHeight - 1, Math.round(y)))
  width = Math.max(1, Math.min(imgWidth - x, Math.round(width)))
  height = Math.max(1, Math.min(imgHeight - y, Math.round(height)))

  return { x, y, width, height }
}

/**
 * 旋转 32 位 RGBA/BGRA 像素缓冲区（顺时针 90°、180°、270°）
 */
export function rotateBitmap(
  buffer: Buffer,
  width: number,
  height: number,
  degrees: number,
): { buffer: Buffer; width: number; height: number } {
  const norm = ((degrees % 360) + 360) % 360
  if (norm === 0) return { buffer, width, height }

  if (norm === 90) {
    const newWidth = height
    const newHeight = width
    const out = Buffer.alloc(buffer.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4
        const dstX = height - 1 - y
        const dstY = x
        const dstIdx = (dstY * newWidth + dstX) * 4
        out[dstIdx] = buffer[srcIdx]
        out[dstIdx + 1] = buffer[srcIdx + 1]
        out[dstIdx + 2] = buffer[srcIdx + 2]
        out[dstIdx + 3] = buffer[srcIdx + 3]
      }
    }
    return { buffer: out, width: newWidth, height: newHeight }
  }

  if (norm === 180) {
    const out = Buffer.alloc(buffer.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4
        const dstX = width - 1 - x
        const dstY = height - 1 - y
        const dstIdx = (dstY * width + dstX) * 4
        out[dstIdx] = buffer[srcIdx]
        out[dstIdx + 1] = buffer[srcIdx + 1]
        out[dstIdx + 2] = buffer[srcIdx + 2]
        out[dstIdx + 3] = buffer[srcIdx + 3]
      }
    }
    return { buffer: out, width, height }
  }

  if (norm === 270) {
    const newWidth = height
    const newHeight = width
    const out = Buffer.alloc(buffer.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4
        const dstX = y
        const dstY = width - 1 - x
        const dstIdx = (dstY * newWidth + dstX) * 4
        out[dstIdx] = buffer[srcIdx]
        out[dstIdx + 1] = buffer[srcIdx + 1]
        out[dstIdx + 2] = buffer[srcIdx + 2]
        out[dstIdx + 3] = buffer[srcIdx + 3]
      }
    }
    return { buffer: out, width: newWidth, height: newHeight }
  }

  return { buffer, width, height }
}

/**
 * 在 32 位位图像素缓冲区上绘制醒目的矩形红框，用于大模型视觉裁切预检
 * 兼容 BGRA (Windows/macOS) 与 RGBA (Linux)
 */
export function drawBoundingBoxBitmap(
  buffer: Buffer,
  width: number,
  height: number,
  rect: CropRect,
  options: BoundingBoxOptions = {},
): Buffer {
  const out = Buffer.from(buffer)
  const isBgra = options.isBgra ?? (process.platform !== 'linux')
  const rIdx = isBgra ? 2 : 0
  const gIdx = 1
  const bIdx = isBgra ? 0 : 2
  const aIdx = 3

  // 默认醒目红框：RGB(255, 0, 51)
  const borderColor = options.borderColor ?? { r: 255, g: 0, b: 51, a: 255 }
  // 内部微弱半透明淡红高亮：RGB(255, 0, 51)，透明度约 15%
  const fillColor = options.fillColor ?? { r: 255, g: 0, b: 51, a: 38 }

  // 线宽按图像尺寸自适应，最小 3px，最大 10px
  const bw =
    options.borderWidth ??
    Math.max(3, Math.min(10, Math.round(Math.min(width, height) / 250)))

  const rx = Math.max(0, Math.min(width - 1, rect.x))
  const ry = Math.max(0, Math.min(height - 1, rect.y))
  const rw = Math.max(1, Math.min(width - rx, rect.width))
  const rh = Math.max(1, Math.min(height - ry, rect.height))

  const xEnd = rx + rw
  const yEnd = ry + rh

  const fillAlpha = (fillColor.a ?? 0) / 255

  for (let y = ry; y < yEnd; y++) {
    const isYBorder = y < ry + bw || y >= yEnd - bw
    for (let x = rx; x < xEnd; x++) {
      const isXBorder = x < rx + bw || x >= xEnd - bw
      const idx = (y * width + x) * 4

      if (isYBorder || isXBorder) {
        out[idx + rIdx] = borderColor.r
        out[idx + gIdx] = borderColor.g
        out[idx + bIdx] = borderColor.b
        out[idx + aIdx] = borderColor.a ?? 255
      } else if (fillAlpha > 0) {
        const srcR = out[idx + rIdx]
        const srcG = out[idx + gIdx]
        const srcB = out[idx + bIdx]
        out[idx + rIdx] = Math.min(255, Math.round(srcR * (1 - fillAlpha) + fillColor.r * fillAlpha))
        out[idx + gIdx] = Math.max(0, Math.round(srcG * (1 - fillAlpha) + fillColor.g * fillAlpha))
        out[idx + bIdx] = Math.max(0, Math.round(srcB * (1 - fillAlpha) + fillColor.b * fillAlpha))
      }
    }
  }

  return out
}

/**
 * 顺时针旋转整张手写答卷图片（90°、180°、270°）并保存
 */
export async function rotateExamSheet(
  imagePath: string,
  degrees: number,
): Promise<RotateImageResult> {
  try {
    let image: Electron.NativeImage
    if (imagePath.startsWith('data:')) {
      image = nativeImage.createFromDataURL(imagePath)
    } else {
      if (!fs.existsSync(imagePath)) {
        return { ok: false, error: '源图片不存在: ' + imagePath }
      }
      image = nativeImage.createFromPath(imagePath)
    }
    if (image.isEmpty()) {
      return { ok: false, error: '无法读取源图片或图片已损坏' }
    }

    const norm = ((degrees % 360) + 360) % 360
    if (norm === 0) {
      return {
        ok: true,
        rotatedPath: imagePath.startsWith('data:') ? undefined : imagePath,
        dataUrl: image.toDataURL(),
      }
    }

    const size = image.getSize()
    const rawBmp = image.toBitmap()
    const rotated = rotateBitmap(rawBmp, size.width, size.height, norm)
    const finalImage = nativeImage.createFromBitmap(rotated.buffer, {
      width: rotated.width,
      height: rotated.height,
    })

    const targetDir = path.join(getUserDataDir(), 'exam-crops')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const fileName = `rotated_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    const targetPath = path.join(targetDir, fileName)

    const pngBuffer = finalImage.toPNG()
    fs.writeFileSync(targetPath, pngBuffer)
    const dataUrl = finalImage.toDataURL()

    return {
      ok: true,
      rotatedPath: targetPath,
      dataUrl,
    }
  } catch (err: unknown) {
    return { ok: false, error: `旋转图片失败: ${String(err)}` }
  }
}

/**
 * 生成带红色边框的裁切预检图，交由大模型审视是否存在截断或偏差
 */
export async function previewExamCropBox(
  imagePath: string,
  box: CropBoxInput,
  options?: {
    rotate?: number
    sheetRotate?: number
  },
): Promise<PreviewCropResult> {
  try {
    let image: Electron.NativeImage
    if (imagePath.startsWith('data:')) {
      image = nativeImage.createFromDataURL(imagePath)
    } else {
      if (!fs.existsSync(imagePath)) {
        return { ok: false, error: '源图片不存在: ' + imagePath }
      }
      image = nativeImage.createFromPath(imagePath)
    }
    if (image.isEmpty()) {
      return { ok: false, error: '无法读取源图片或图片已损坏' }
    }

    // 若需要先旋转整张图（例如横置拍照转正）
    const rotation = (options?.sheetRotate || options?.rotate || 0) % 360
    if (rotation !== 0) {
      const size = image.getSize()
      const rawBmp = image.toBitmap()
      const rotated = rotateBitmap(rawBmp, size.width, size.height, rotation)
      image = nativeImage.createFromBitmap(rotated.buffer, {
        width: rotated.width,
        height: rotated.height,
      })
    }

    const size = image.getSize()
    const rect = normalizeCropRect(box, size.width, size.height)

    const rawBmp = image.toBitmap()
    const withBoxBmp = drawBoundingBoxBitmap(rawBmp, size.width, size.height, rect)
    let markedImage = nativeImage.createFromBitmap(withBoxBmp, {
      width: size.width,
      height: size.height,
    })

    // 若图像长边超过 1600px，进行等比压缩，防止大模型视觉上下文超限
    const maxEdge = Math.max(size.width, size.height)
    if (maxEdge > 1600) {
      const scale = 1600 / maxEdge
      markedImage = markedImage.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'better',
      })
    }

    const targetDir = path.join(getUserDataDir(), 'exam-crops')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const fileName = `preview_crop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    const targetPath = path.join(targetDir, fileName)

    const pngBuffer = markedImage.toPNG()
    fs.writeFileSync(targetPath, pngBuffer)

    const dataUrl = markedImage.toDataURL()

    // 换算回标准 0~1000 范围的 [ymin, xmin, ymax, xmax] 供模型精细调优参考
    const ymin = Math.round((rect.y / size.height) * 1000)
    const xmin = Math.round((rect.x / size.width) * 1000)
    const ymax = Math.round(((rect.y + rect.height) / size.height) * 1000)
    const xmax = Math.round(((rect.x + rect.width) / size.width) * 1000)

    return {
      ok: true,
      previewPath: targetPath,
      dataUrl,
      rect,
      box: [ymin, xmin, ymax, xmax],
    }
  } catch (err: unknown) {
    return { ok: false, error: `生成裁切预检图失败: ${String(err)}` }
  }
}

/**
 * 裁剪手写答案图片并存储到用户数据目录（支持顺时针旋转修正）
 */
export async function cropExamAnswerImage(
  imagePath: string,
  box: CropBoxInput,
  rotate = 0,
  options?: {
    sheetRotate?: number
  },
): Promise<CropImageResult> {
  try {
    let image: Electron.NativeImage
    if (imagePath.startsWith('data:')) {
      image = nativeImage.createFromDataURL(imagePath)
    } else {
      if (!fs.existsSync(imagePath)) {
        return { ok: false, error: '源图片不存在: ' + imagePath }
      }
      image = nativeImage.createFromPath(imagePath)
    }
    if (image.isEmpty()) {
      return { ok: false, error: '无法读取源图片或图片已损坏' }
    }

    // 若指定了先旋转整图
    if (options?.sheetRotate && options.sheetRotate % 360 !== 0) {
      const initialSize = image.getSize()
      const raw = image.toBitmap()
      const rotatedSrc = rotateBitmap(raw, initialSize.width, initialSize.height, options.sheetRotate)
      image = nativeImage.createFromBitmap(rotatedSrc.buffer, {
        width: rotatedSrc.width,
        height: rotatedSrc.height,
      })
    }

    const size = image.getSize()
    const rect = normalizeCropRect(box, size.width, size.height)

    const cropped = image.crop(rect)
    if (cropped.isEmpty()) {
      return { ok: false, error: '裁切失败，区域为空' }
    }

    let finalImage = cropped
    if (rotate && rotate % 360 !== 0) {
      const croppedSize = cropped.getSize()
      const rawBmp = cropped.toBitmap()
      const rotated = rotateBitmap(rawBmp, croppedSize.width, croppedSize.height, rotate)
      finalImage = nativeImage.createFromBitmap(rotated.buffer, {
        width: rotated.width,
        height: rotated.height,
      })
    }

    const targetDir = path.join(getUserDataDir(), 'exam-crops')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const fileName = `crop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    const targetPath = path.join(targetDir, fileName)

    const pngBuffer = finalImage.toPNG()
    fs.writeFileSync(targetPath, pngBuffer)

    const dataUrl = finalImage.toDataURL()

    return {
      ok: true,
      croppedPath: targetPath,
      dataUrl,
    }
  } catch (err: unknown) {
    return { ok: false, error: `裁剪图片失败: ${String(err)}` }
  }
}
