/**
 * 视频学习的**播放通道**：把插件解析出的流地址登记成 media-relay 中转地址。
 *
 * 解析本身（match → 插件 resolve → 归一校验）在 lib/videoPlugins——插件是外部文件、
 * 由用户安装，应用本体不认识任何平台。这个文件只剩下「流怎么进 <video>」这一件事：
 * `<video>` 发不出 Referer/Cookie（防盗链头），流由主进程带头转发；地址带签名会
 * 过期，所以每次播放前重新登记，URL 永不落盘。
 */

import { t } from '../i18n'
import { native } from '../lib/native'
import type { VideoSource } from './types'

/** 把插件的流地址登记成 media-relay 中转地址（每次播放前调用） */
export async function openRelayStream(source: VideoSource): Promise<string> {
  const stream = source.stream
  if (!stream) throw new Error(t('这个来源没有可播放的流'))
  if (stream.kind === 'file') throw new Error(t('本地文件流还没有接进播放通道'))
  const res = await native().video.openStream(stream.url, stream.headers)
  if (!res.ok) throw new Error(res.error)
  return res.relayUrl
}
