const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 本地日历日 'YYYY-MM-DD'。日期由调用方传入——本模块不读时钟 */
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function utcDays(local: string): number {
  const m = DATE_RE.exec(local)
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD，收到 ${local}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000
}

/** 两个本地日历日之差（天）。与掌握度模型、仿真里的 day 同义（P-3 spec §3.1） */
export function dayIndex(createdAtLocalDate: string, todayLocalDate: string): number {
  return Math.round(utcDays(todayLocalDate) - utcDays(createdAtLocalDate))
}

/** FNV-1a 32 位：由 (profileId, day, sessionNo) 确定性派生会话 seed */
export function sessionSeed(profileId: string, day: number, sessionNo: number): number {
  const text = `${profileId}|${day}|${sessionNo}`
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
