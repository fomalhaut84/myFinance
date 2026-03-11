/**
 * 2차원 배열을 CSV 문자열로 변환한다.
 * BOM 포함하여 Excel에서 한글이 깨지지 않도록 한다.
 */
export function toCSV(headers: string[], rows: string[][]): string {
  const BOM = '\uFEFF'
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ]

  return BOM + lines.join('\n')
}

/**
 * CSV Response를 생성한다.
 */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
