import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNewBytes, splitLinesWithCarryover } from '../tail'

describe('splitLinesWithCarryover', () => {
  it('완결된 여러 라인 → 모두 방출, carry 는 빈 문자열', () => {
    const r = splitLinesWithCarryover('a\nb\nc\n', '')
    expect(r.lines).toEqual(['a', 'b', 'c'])
    expect(r.carry).toBe('')
  })

  it('마지막 라인이 `\\n` 으로 안 끝나면 carry 로 보존', () => {
    const r = splitLinesWithCarryover('a\nb\npartial', '')
    expect(r.lines).toEqual(['a', 'b'])
    expect(r.carry).toBe('partial')
  })

  it('이전 carry 와 결합해 완결된 라인 방출', () => {
    const first = splitLinesWithCarryover('{"level":"in', '')
    expect(first.lines).toEqual([])
    expect(first.carry).toBe('{"level":"in')
    const second = splitLinesWithCarryover('fo","msg":"ok"}\n', first.carry)
    expect(second.lines).toEqual(['{"level":"info","msg":"ok"}'])
    expect(second.carry).toBe('')
  })

  it('빈 라인 (`\\n\\n`) 은 skip', () => {
    const r = splitLinesWithCarryover('a\n\nb\n', '')
    expect(r.lines).toEqual(['a', 'b'])
    expect(r.carry).toBe('')
  })

  it('빈 chunk 는 lines 없음 + carry 유지', () => {
    const r = splitLinesWithCarryover('', 'leftover')
    expect(r.lines).toEqual([])
    expect(r.carry).toBe('leftover')
  })

  it('carry 만 있는 상태에서 다음 chunk 가 오면 이어붙임', () => {
    const r1 = splitLinesWithCarryover('half', '')
    const r2 = splitLinesWithCarryover('-line\nnext\n', r1.carry)
    expect(r2.lines).toEqual(['half-line', 'next'])
    expect(r2.carry).toBe('')
  })
})

describe('readNewBytes', () => {
  let tmpFile: string
  let fd: number

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tail-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
    fs.writeFileSync(tmpFile, 'hello world\n')
    fd = fs.openSync(tmpFile, 'r')
  })

  afterEach(() => {
    try { fs.closeSync(fd) } catch { /* already closed */ }
    try { fs.unlinkSync(tmpFile) } catch { /* deleted */ }
  })

  it('offset 부터 지정 길이만큼 UTF-8 문자열 반환 + bytesRead', () => {
    // "hello world\n" 12바이트 중 [6, 11) → "world"
    const r = readNewBytes(fd, 6, 11)
    expect(r.text).toBe('world')
    expect(r.bytesRead).toBe(5)
  })

  it('to <= from → 빈 결과 (bytesRead=0)', () => {
    expect(readNewBytes(fd, 5, 5)).toEqual({ text: '', bytesRead: 0 })
    expect(readNewBytes(fd, 5, 0)).toEqual({ text: '', bytesRead: 0 })
  })

  it('파일에 append 후 새 offset 부터 읽으면 신규 바이트만 반환', () => {
    const beforeSize = fs.statSync(tmpFile).size
    fs.appendFileSync(tmpFile, 'appended\n')
    const afterSize = fs.statSync(tmpFile).size
    const r = readNewBytes(fd, beforeSize, afterSize)
    expect(r.text).toBe('appended\n')
    expect(r.bytesRead).toBe(afterSize - beforeSize)
  })

  // Codex #454 P1 회귀 방지 — 요청 범위가 실제 파일 크기를 초과하면 short-read.
  // 이전에는 요청 size 만큼 무조건 전진해 유실됐다. 이제는 bytesRead 로 정확 소비량 노출.
  it('요청 범위가 파일보다 크면 실제 읽은 바이트만 반환 (short-read)', () => {
    const size = fs.statSync(tmpFile).size
    // "hello world\n" = 12 바이트. from=6, to=100 → 실제 파일 잔량 (12-6=6) 만 읽힘.
    const r = readNewBytes(fd, 6, 100)
    expect(r.text).toBe('world\n')
    expect(r.bytesRead).toBe(size - 6)
    expect(r.bytesRead).toBeLessThan(100 - 6) // 요청보다 작음
  })
})
