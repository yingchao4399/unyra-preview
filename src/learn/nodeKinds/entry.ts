/**
 * 入口节点：一张图有且只有一个的「从这里开始」。
 *
 * uuid 是 `entry:{根文档id}`，与目标的根文档一对一——**它不是存储出来的实体**，
 * 而是目标绑定（goals.rootNodeId）的图形投影：目标在它就在，根换了它的连线跟着换。
 * 没有内容、不能连、不能删；画布把它排在最左列，读图方向由此定。
 */
import { docIdOfEntryUuid, GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class EntryGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'entry' {
    return 'entry'
  }

  protected get kindLabel(): string {
    return '入口'
  }

  /** 根文档 id（目标还在它就在） */
  get rootDocId(): string {
    return docIdOfEntryUuid(this.uuid) ?? ''
  }

  exists(): boolean {
    const root = this.rootDocId
    if (!root) return false
    return this.ctx.store().goals.some((g) => g.rootNodeId === root)
  }

  get title(): string {
    return '入口'
  }

  get relations(): NodeRelation[] {
    return this.exists() ? [{ id: this.rootDocId, type: 'down' }] : []
  }

  get content(): unknown {
    return {}
  }

  editContent(_next: unknown): NodeResult {
    return { error: '入口没有内容——它是读图的起点，不是内容载体' }
  }

  help(): NodeHelp {
    return {
      description: '入口节点——这门课从这里开始。它由目标绑定自动生成（下游就是目标的根文档），不是内容载体。',
      edit: '没有内容，也没有可编辑的东西。',
      connection: '与根文档的连线由目标绑定自动生成：换根是「改目标的 rootNodeId」，不是在图上拉线。',
    }
  }

  onDownstream(_node: GNode): ConnectFilter {
    return '入口与根文档的连线由目标绑定自动生成，不能手工连'
  }
}
