/**
 * 节点宇宙新手教学假数据：
 * 仅在新手教学模式开启时注入画布展示，教学结束后立即清除并恢复用户真实数据。
 * 展示核心学习网络全貌：入口文档、大纲知识树、子文档、试卷测验、便笺笔记及实况视频。
 */

import { CARD_H, type HeightOf } from '../../../learn/structure'
import type { CanvasEdge, CanvasView, CardView } from './structureView'
import { DOC_BODY_H, examCardHeight, outlineCardHeight } from './structureView'

export const TOUR_MOCK_CARDS: CardView[] = [
  {
    uuid: 'tour-mock-entry-doc',
    kind: 'doc',
    title: '计算机网络核心导学',
    subtitle: '1,420 字',
    excerpt: '本课程涵盖从物理层到应用层的核心协议体系，重点掌握 TCP/IP 握手、DNS 递归解析与 HTTP/3 演进历程。',
    entry: true,
    x: 240,
    y: 180,
  },
  {
    uuid: 'tour-mock-outline',
    kind: 'outline',
    title: '传输层核心大纲',
    subtitle: '3 个目标项',
    slots: [
      { key: 'tcp-handshake', title: 'TCP 三次握手与状态流转', index: 0, childId: 'tour-mock-child-doc' },
      { key: 'flow-control', title: '滑动窗口与拥塞控制算法', index: 1, childId: null },
      { key: 'udp-protocol', title: 'UDP 协议与 QUIC / HTTP3 特性', index: 2, childId: null },
    ],
    x: 580,
    y: 100,
  },
  {
    uuid: 'tour-mock-child-doc',
    kind: 'doc',
    title: 'TCP 三次握手与状态流转',
    subtitle: '2,890 字',
    excerpt: 'SYN 发起、SYN+ACK 确认与 ACK 回复的完整时序分析，以及服务端与客户端在各阶段的状态转换机。',
    x: 920,
    y: 80,
  },
  {
    uuid: 'tour-mock-exam',
    kind: 'exam',
    title: 'TCP 专项随堂测验',
    subtitle: '10 道题 · 已答 1 次',
    attempts: [{ n: 1, label: '已判分 · 95 分', attemptId: 'att-mock-1' }],
    x: 1260,
    y: 60,
  },
  {
    uuid: 'tour-mock-superdoc',
    kind: 'superdoc',
    title: 'TCP 握手时序交互仿真',
    subtitle: '富交互仿真实验 · 1,560 字符',
    x: 1260,
    y: 200,
  },
  {
    uuid: 'tour-mock-note',
    kind: 'note',
    title: '三次握手常见面试必背',
    subtitle: '便签笔记',
    excerpt: 'Q: 为什么两次握手不行？A: 防止已失效的连接请求报文段突然又传送到了服务端，从而产生错误连接。',
    x: 920,
    y: 260,
  },
  {
    uuid: 'tour-mock-video',
    kind: 'video',
    title: '网络协议动画全解实况',
    subtitle: '共 18 讲 · P1~P6',
    x: 580,
    y: 360,
  },
]

export const TOUR_MOCK_EDGES: CanvasEdge[] = [
  { from: 'tour-mock-entry-doc', to: 'tour-mock-outline' },
  { from: 'tour-mock-outline', to: 'tour-mock-child-doc' },
  { from: 'tour-mock-child-doc', to: 'tour-mock-exam' },
  { from: 'tour-mock-child-doc', to: 'tour-mock-superdoc' },
  { from: 'tour-mock-child-doc', to: 'tour-mock-note' },
  { from: 'tour-mock-entry-doc', to: 'tour-mock-video' },
]

const mockCardMap = new Map<string, CardView>(TOUR_MOCK_CARDS.map((c) => [c.uuid, c]))

export const tourMockHeightOf: HeightOf = (node: { uuid: string; kind: string }): number => {
  const card = mockCardMap.get(node.uuid)
  if (!card) return CARD_H
  if (card.kind === 'outline') {
    return outlineCardHeight(card.slots?.length ?? 0)
  }
  if (card.kind === 'exam') {
    return examCardHeight(card.attempts?.length ?? 0)
  }
  if (card.kind === 'doc' && card.excerpt) {
    return DOC_BODY_H
  }
  return CARD_H
}

/** 获取教学假数据画布视图 */
export function getTourMockCanvas(): CanvasView {
  return {
    cards: TOUR_MOCK_CARDS,
    edges: TOUR_MOCK_EDGES,
    heightOf: tourMockHeightOf,
  }
}

/** 教学开启时计算的最佳居中相机视角 */
export function getTourCamera(
  containerW: number,
  containerH: number,
): { x: number; y: number; zoom: number } {
  const w = containerW || 1200
  const h = containerH || 700
  const zoom = Math.min(Math.max(w / 1750, 0.58), 0.85)
  // 假数据中心大致在 x: 880, y: 240
  return {
    x: Math.round(w / 2 - 880 * zoom),
    y: Math.round(h / 2 - 240 * zoom),
    zoom,
  }
}
