/** 让浏览器下载一段文本（导出备份、损坏副本） */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 会让 iOS Safari 下载失败；延后释放
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
