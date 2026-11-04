import os from 'node:os'

const VIRTUAL_ADAPTER_KEYWORDS = [
  'virtual',
  'vethernet',
  'vmware',
  'virtualbox',
  'vbox',
  'docker',
  'wsl',
  'hyper-v',
  'tap',
  'tun',
  'loopback',
  'bluetooth',
  'tailscale',
  'zerotier',
]

/** 判断是否为局域网私网 IP (RFC 1918) */
function isPrivateIpv4(ip: string): boolean {
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('10.')) return true
  const match = /^172\.(\d+)\./.exec(ip)
  if (match) {
    const octet = Number.parseInt(match[1], 10)
    return octet >= 16 && octet <= 31
  }
  return false
}

export interface LanNetInfo {
  defaultIp: string
  allIps: string[]
}

/**
 * 扫描本机网卡并返回局域网 IPv4 地址。
 * 智能过滤回环网卡与各种虚拟网卡，优先返回物理局域网 IP（192.168.x.x / 10.x.x.x 等）。
 */
export function getLanIpList(): LanNetInfo {
  const interfaces = os.networkInterfaces()
  const physicalIps: string[] = []
  const virtualIps: string[] = []

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue
    const lowerName = name.toLowerCase()
    const isVirtual = VIRTUAL_ADAPTER_KEYWORDS.some((kw) => lowerName.includes(kw))

    for (const addr of addrs) {
      // 仅检查 IPv4 且非回环
      if (addr.family !== 'IPv4' && (addr as { family: number | string }).family !== 4) continue
      if (addr.internal || addr.address === '127.0.0.1' || addr.address === '0.0.0.0') continue
      // 排除 169.254.x.x 链路本地地址
      if (addr.address.startsWith('169.254.')) continue

      if (isVirtual) {
        virtualIps.push(addr.address)
      } else {
        physicalIps.push(addr.address)
      }
    }
  }

  // 物理网卡中优先排序私网 IP
  const sortedPhysical = physicalIps.sort((a, b) => {
    const aPri = isPrivateIpv4(a) ? 1 : 0
    const bPri = isPrivateIpv4(b) ? 1 : 0
    return bPri - aPri
  })

  const allIps = [...sortedPhysical, ...virtualIps]
  const defaultIp = sortedPhysical[0] || allIps[0] || '127.0.0.1'

  return {
    defaultIp,
    allIps: allIps.length > 0 ? allIps : ['127.0.0.1'],
  }
}
