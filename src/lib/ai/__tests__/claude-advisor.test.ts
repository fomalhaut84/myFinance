/**
 * Phase 40-B (#469) — AdvisorError code 판정 + fallback 메시지 unit tests.
 *
 * askAdvisor 자체는 subprocess 를 spawn 하는 통합 성격이라 unit 커버 대상 아님.
 * pure 함수 (classifyAdvisorError, describeAdvisorError) 와 AdvisorError.code
 * 계약만 여기서 검증.
 */

import { describe, expect, it } from 'vitest'
import {
  AdvisorError,
  AdvisorTimeoutError,
  classifyAdvisorError,
  countMcpMyFinanceCalls,
  countSuccessfulMcpMyFinanceCalls,
  describeAdvisorError,
  extractAdvisorErrorText,
  hasNoToolResponse,
  parseClaudeStreamJson,
} from '../claude-advisor'

describe('classifyAdvisorError', () => {
  it('빈 stderr → unknown', () => {
    expect(classifyAdvisorError('')).toBe('unknown')
    expect(classifyAdvisorError(undefined)).toBe('unknown')
  })

  it('인증 만료 계열 → auth_expired', () => {
    expect(classifyAdvisorError('Error: not logged in')).toBe('auth_expired')
    expect(classifyAdvisorError('401 Unauthorized')).toBe('auth_expired')
    expect(classifyAdvisorError('Invalid credentials')).toBe('auth_expired')
    expect(classifyAdvisorError('Please login first')).toBe('auth_expired')
    expect(classifyAdvisorError('Session expired, please re-authenticate')).toBe('auth_expired')
    expect(classifyAdvisorError('Authentication failed')).toBe('auth_expired')
  })

  it('쿼터 초과 계열 → quota_exceeded', () => {
    expect(classifyAdvisorError('Daily quota exceeded')).toBe('quota_exceeded')
    expect(classifyAdvisorError('Rate limit reached')).toBe('quota_exceeded')
    expect(classifyAdvisorError('Usage limit exceeded')).toBe('quota_exceeded')
    expect(classifyAdvisorError('Too many requests')).toBe('quota_exceeded')
    expect(classifyAdvisorError('HTTP 429 Too Many Requests')).toBe('quota_exceeded')
  })

  it('MCP 서버 실패 계열 → server_down', () => {
    expect(classifyAdvisorError('connect ECONNREFUSED 127.0.0.1:4210')).toBe('server_down')
    expect(classifyAdvisorError('Error: connection refused')).toBe('server_down')
    expect(classifyAdvisorError('MCP server timeout at connect')).toBe('server_down')
    expect(classifyAdvisorError('MCP connect failed')).toBe('server_down')
    expect(classifyAdvisorError('server not responding')).toBe('server_down')
  })

  it('알려지지 않은 stderr → unknown', () => {
    expect(classifyAdvisorError('Random error message')).toBe('unknown')
    expect(classifyAdvisorError('SyntaxError: unexpected token')).toBe('unknown')
  })

  it('대소문자 무관 매치', () => {
    expect(classifyAdvisorError('NOT LOGGED IN')).toBe('auth_expired')
    expect(classifyAdvisorError('QUOTA EXCEEDED')).toBe('quota_exceeded')
  })

  // Codex #479 P2 회귀 방지 — Claude API status code 매칭 (명시적 토큰만)
  it('HTTP status code 매칭 (api_error_status / HTTP / status: / reason phrase)', () => {
    // Claude JSON 형식
    expect(classifyAdvisorError('api_error_status=401')).toBe('auth_expired')
    expect(classifyAdvisorError('api_error_status=403')).toBe('auth_expired')
    expect(classifyAdvisorError('api_error_status=429')).toBe('quota_exceeded')
    // colon 형식
    expect(classifyAdvisorError('api_error_status:401')).toBe('auth_expired')
    // HTTP prefix (with or without protocol version)
    expect(classifyAdvisorError('Error: HTTP 401 from Claude API')).toBe('auth_expired')
    expect(classifyAdvisorError('HTTP/1.1 429 Too Many Requests')).toBe('quota_exceeded')
    // Codex #479 P2 (3차): 버전 있는 curl-style 도 (reason phrase 없이) 매칭
    expect(classifyAdvisorError('response: HTTP/1.1 401')).toBe('auth_expired')
    expect(classifyAdvisorError('got HTTP/2 403 from server')).toBe('auth_expired')
    expect(classifyAdvisorError('HTTP/1.1 429')).toBe('quota_exceeded')
    // status: prefix
    expect(classifyAdvisorError('response status: 403')).toBe('auth_expired')
    // Reason phrase
    expect(classifyAdvisorError('got 429 Too Many Requests')).toBe('quota_exceeded')
    expect(classifyAdvisorError('401 Unauthorized')).toBe('auth_expired')
  })

  // Codex #479 P2 재수정 회귀 방지 — bare digit substring false positive 방지
  it('unrelated 401/403/429 숫자 sequence 는 매칭 안 함', () => {
    // 포트 번호에 4030
    expect(classifyAdvisorError('bind ECONNREFUSED 127.0.0.1:4030')).toBe('server_down')
    // 라인 번호 401 (stack trace)
    expect(classifyAdvisorError('SyntaxError at line 401 col 12')).toBe('unknown')
    // request id 안 429
    expect(classifyAdvisorError('request_id=abc429def')).toBe('unknown')
    // 파일 경로 안 403
    expect(classifyAdvisorError('cannot read /home/user/403-config.json')).toBe('unknown')
  })

  it('여러 패턴 매치 시 우선순위 (auth > quota > server)', () => {
    // 인증 문구가 있으면 다른 것보다 우선
    expect(classifyAdvisorError('unauthorized quota exceeded')).toBe('auth_expired')
    // 인증 없고 quota + server 동시 → quota 우선
    expect(classifyAdvisorError('rate limit and connection refused')).toBe('quota_exceeded')
  })
})

describe('describeAdvisorError', () => {
  it('auth_expired → 관리자 문의 안내', () => {
    const err = new AdvisorError('x', undefined, 'auth_expired')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('인증 갱신')
    expect(msg).toContain('관리자')
    // stderr detail 이 노출되면 안 됨
    expect(msg).not.toContain('stderr')
  })

  it('quota_exceeded → 사용량 초과 안내', () => {
    const err = new AdvisorError('x', undefined, 'quota_exceeded')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('사용량 초과')
    expect(msg).toContain('관리자')
  })

  it('server_down → 서버 접근 실패', () => {
    const err = new AdvisorError('x', undefined, 'server_down')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('서버 접근 실패')
  })

  it('timeout → 시간 초과', () => {
    const err = new AdvisorTimeoutError(60_000)
    const msg = describeAdvisorError(err)
    expect(msg).toContain('시간 초과')
    expect(msg).toContain('다시 시도')
  })

  it('parse_error → 응답 처리 실패', () => {
    const err = new AdvisorError('x', undefined, 'parse_error')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('처리할 수 없습니다')
  })

  it('unknown (기본) → 일시 중단', () => {
    const err = new AdvisorError('x')
    expect(err.code).toBe('unknown')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('일시 중단')
    expect(msg).toContain('관리자')
  })

  // #483 회귀 방지 — MCP 도구 미호출 감지 fallback 메시지
  it('no_tool_used → 도구 미호출 안내 (관리자 문의)', () => {
    const err = new AdvisorError('x', undefined, 'no_tool_used')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('데이터 도구를 호출하지 않았습니다')
    expect(msg).toContain('관리자')
    // detail (num_turns, stop_reason 등) 은 사용자에게 노출되지 않아야
    expect(msg).not.toContain('num_turns')
    expect(msg).not.toContain('stop_reason')
  })

  it('AdvisorError/Timeout 이 아닌 일반 Error → unknown 처리', () => {
    const err = new Error('random')
    const msg = describeAdvisorError(err)
    expect(msg).toContain('일시 중단')
  })

  // Codex #473 P2 pattern — stderr detail 은 사용자 노출 금지 원칙 재확인
  it('detail 이 있어도 fallback 메시지에는 노출 안 됨', () => {
    const err = new AdvisorError(
      'Claude CLI 종료 코드: 1',
      'stderr: 401 Unauthorized - credentials expired at line ...',
      'auth_expired',
    )
    const msg = describeAdvisorError(err)
    expect(msg).not.toContain('stderr')
    expect(msg).not.toContain('401')
    expect(msg).not.toContain('credentials')
  })
})

describe('AdvisorError.code 계약', () => {
  it('기본값 unknown', () => {
    expect(new AdvisorError('x').code).toBe('unknown')
  })

  it('detail 만 지정해도 code 는 기본값', () => {
    expect(new AdvisorError('x', 'stderr').code).toBe('unknown')
  })

  it('code 명시 시 그대로', () => {
    for (const c of ['auth_expired', 'quota_exceeded', 'server_down', 'parse_error', 'no_tool_used'] as const) {
      expect(new AdvisorError('x', undefined, c).code).toBe(c)
    }
  })
})

describe('AdvisorTimeoutError.code', () => {
  it('항상 timeout', () => {
    expect(new AdvisorTimeoutError(30_000).code).toBe('timeout')
    expect(new AdvisorTimeoutError(180_000).code).toBe('timeout')
  })
})

// Codex #479 P2 회귀 방지 — Claude JSON 에서 classify 대상 문자열 조립.
describe('extractAdvisorErrorText', () => {
  it('result 만 있으면 그대로', () => {
    expect(extractAdvisorErrorText({ result: 'Not logged in' })).toBe('Not logged in')
  })

  it('result 비고 api_error_status 만 있으면 status 만 리턴', () => {
    // Claude 최종 API 실패 (rate limit 등) 시 result 는 비고 status 만 채워짐
    expect(extractAdvisorErrorText({ result: '', api_error_status: 429 }))
      .toBe('api_error_status=429')
  })

  it('result + api_error_status 결합', () => {
    const text = extractAdvisorErrorText({ result: 'Some error', api_error_status: 401 })
    expect(text).toContain('Some error')
    expect(text).toContain('api_error_status=401')
  })

  it('errors 필드도 stringify 후 결합', () => {
    const text = extractAdvisorErrorText({ result: 'X', errors: [{ type: 'ratelimit' }] })
    expect(text).toContain('X')
    expect(text).toContain('ratelimit')
  })

  it('빈 output → 빈 문자열', () => {
    expect(extractAdvisorErrorText({})).toBe('')
    expect(extractAdvisorErrorText({ result: '' })).toBe('')
  })

  it('classify 와 결합해 rate-limit (429 only) 정확 분류', () => {
    // Codex #479 P2 시나리오 — Claude API 429 는 result 없이 api_error_status 만 채워짐
    const text = extractAdvisorErrorText({ result: '', api_error_status: 429 })
    expect(classifyAdvisorError(text)).toBe('quota_exceeded')
  })
})

// Codex PR #484 P1 회귀 방지 — 응답 텍스트 fingerprint 로 도구 미사용 감지.
// num_turns 만으로는 부정확 (Claude 가 WebSearch 만 부르고 MCP tool skip 해도
// num_turns >= 2). semantic 검증 fallback.
describe('hasNoToolResponse', () => {
  it('실제 발송된 실패 응답 (2026-08-18 브리핑) 감지', () => {
    const actual = `⚠️ 도구 연결 문제 안내

죄송하지만 현재 세션에서 myFinance 데이터 도구(포트폴리오, 전략, 기술적분석 등)가 연결되지 않아 아래 항목을 확인할 수 없었습니다:

- 📊 get_all_strategies (전체 종목 전략)
- 💼 get_portfolio (계좌별 보유 현황)`
    expect(hasNoToolResponse(actual)).toBe(true)
  })

  it('다양한 실패 pattern 변형 감지', () => {
    expect(hasNoToolResponse('도구가 연결되지 않아서')).toBe(true)
    expect(hasNoToolResponse('데이터 도구가 연결되지 않았습니다')).toBe(true)
    expect(hasNoToolResponse('도구 연결 문제로')).toBe(true)
    expect(hasNoToolResponse('도구 연결 불가')).toBe(true)
    expect(hasNoToolResponse('MCP 연결 실패')).toBe(true)
    expect(hasNoToolResponse('도구 접근 불가')).toBe(true)
    expect(hasNoToolResponse('MCP 접근 문제')).toBe(true)
  })

  it('정상 응답은 false (false positive 방지)', () => {
    // 실제 정상 브리핑에 나올 수 있는 문구들
    expect(hasNoToolResponse('AAPL 현재가는 $180 입니다.')).toBe(false)
    expect(hasNoToolResponse('세진 계좌 총 평가금 3,200만원')).toBe(false)
    expect(hasNoToolResponse('RSI 65, MACD 상승 전환')).toBe(false)
    expect(hasNoToolResponse('오늘 시장 하락. 관망 권장.')).toBe(false)
    // 도구 이름이 언급되더라도 "연결 문제" 서술이 없으면 통과
    expect(hasNoToolResponse('get_portfolio 결과: 3개 계좌')).toBe(false)
  })

  it('빈 입력 → false', () => {
    expect(hasNoToolResponse('')).toBe(false)
    expect(hasNoToolResponse(undefined)).toBe(false)
  })
})

// Codex PR #484 P1 (3차) 회귀 방지 — stream-json 파싱 + mcp tool 카운트.
// tool_use event 를 정확히 추출해 WebSearch-only 우회 케이스도 감지 가능해야.
describe('parseClaudeStreamJson', () => {
  it('assistant tool_use + user tool_result 를 id 로 correlate (is_error 반영)', () => {
    // Codex PR #484 P1 4차 시나리오: tool_use.id ↔ tool_result.tool_use_id
    // 매칭 → 각 호출의 실제 성공 여부까지 파악.
    const stream = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__myfinance__get_all_strategies"}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"[...]","is_error":false}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"mcp__myfinance__get_portfolio"}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"MCP error","is_error":true}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t3","name":"WebSearch"}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t3","content":"..."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"브리핑..."}]}}',
      '{"type":"result","is_error":false,"result":"브리핑...","num_turns":7,"session_id":"abc","duration_ms":12000,"total_cost_usd":0.5}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.toolCalls).toEqual([
      { id: 't1', name: 'mcp__myfinance__get_all_strategies', isError: false },
      { id: 't2', name: 'mcp__myfinance__get_portfolio', isError: true },
      // WebSearch tool_result 는 is_error 없음 → undefined
      { id: 't3', name: 'WebSearch', isError: undefined },
    ])
    expect(parsed.finalResult?.is_error).toBe(false)
    expect(parsed.finalResult?.num_turns).toBe(7)
    expect(parsed.finalResult?.result).toBe('브리핑...')
    expect(parsed.finalResult?.session_id).toBe('abc')
  })

  it('assistant event 안에 tool_use 가 없는 (thinking/text 만) 케이스 = 빈 배열', () => {
    const stream = [
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}',
      '{"type":"result","is_error":false,"result":"OK","num_turns":1}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.toolCalls).toEqual([])
    expect(parsed.finalResult?.num_turns).toBe(1)
  })

  it('malformed 라인은 skip, 빈 라인/공백 라인도 skip', () => {
    const stream = [
      '',
      '   ',
      'not json at all',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x1","name":"X"}]}}',
      '{ broken json',
      '{"type":"result","is_error":false,"result":"","num_turns":2}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.toolCalls).toEqual([{ id: 'x1', name: 'X', isError: undefined }])
    expect(parsed.finalResult?.num_turns).toBe(2)
  })

  it('tool_use id 없어도 name 은 수집 (id 없으면 tool_result 매칭 안 됨)', () => {
    const stream = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"NoId"}]}}',
      '{"type":"result","is_error":false,"result":"","num_turns":1}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.toolCalls).toEqual([{ id: undefined, name: 'NoId', isError: undefined }])
  })

  it('tool_result 가 없는 tool_use → isError undefined (엄격 판정으로 실패 취급)', () => {
    // Claude subprocess 이상 종료 시나리오 — tool_use 는 emit 됐지만 result 못 받음
    const stream = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"orphan","name":"mcp__myfinance__get_portfolio"}]}}',
      '{"type":"result","is_error":false,"result":"","num_turns":1}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.toolCalls[0].isError).toBeUndefined()
    // countSuccessfulMcpMyFinanceCalls 는 undefined 를 성공으로 안 봄 (fail-closed)
    expect(countSuccessfulMcpMyFinanceCalls(parsed.toolCalls)).toBe(0)
    expect(countMcpMyFinanceCalls(parsed.toolCalls)).toBe(1)
  })

  it('result event 없으면 finalResult undefined', () => {
    const stream = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[]}}',
    ].join('\n')
    const parsed = parseClaudeStreamJson(stream)
    expect(parsed.finalResult).toBeUndefined()
    expect(parsed.toolCalls).toEqual([])
  })

  it('빈 stdout → 빈 결과', () => {
    const parsed = parseClaudeStreamJson('')
    expect(parsed.toolCalls).toEqual([])
    expect(parsed.finalResult).toBeUndefined()
  })
})

describe('countMcpMyFinanceCalls (시도 카운트)', () => {
  it('mcp__myfinance__* prefix 만 카운트 (WebSearch/WebFetch 등 제외)', () => {
    const calls = [
      { name: 'mcp__myfinance__get_portfolio', isError: false },
      { name: 'WebSearch' },
      { name: 'mcp__myfinance__get_all_strategies', isError: true },  // 실패해도 시도로 카운트
      { name: 'WebFetch' },
      { name: 'mcp__myfinance__get_technical_analysis', isError: false },
      { name: 'Read' },
    ]
    expect(countMcpMyFinanceCalls(calls)).toBe(3)
  })

  it('다른 MCP 서버 tool 은 제외', () => {
    expect(countMcpMyFinanceCalls([{ name: 'mcp__other__foo' }, { name: 'mcp__external__bar' }])).toBe(0)
  })

  it('WebSearch-only (Codex 3차 시나리오) = 0', () => {
    expect(countMcpMyFinanceCalls([{ name: 'WebSearch' }, { name: 'WebSearch' }, { name: 'WebFetch' }])).toBe(0)
  })

  it('빈 배열 → 0', () => {
    expect(countMcpMyFinanceCalls([])).toBe(0)
  })
})

// Codex PR #484 P1 4차 회귀 방지 — 성공 카운트는 isError === false 만.
describe('countSuccessfulMcpMyFinanceCalls (성공 카운트)', () => {
  it('mcp__myfinance__* 중 isError === false 만 카운트', () => {
    const calls = [
      { name: 'mcp__myfinance__get_portfolio', isError: false },
      { name: 'mcp__myfinance__get_all_strategies', isError: true },  // 실패
      { name: 'mcp__myfinance__get_technical_analysis', isError: false },
      { name: 'WebSearch', isError: false },  // 성공이어도 mcp 아니라 제외
    ]
    expect(countSuccessfulMcpMyFinanceCalls(calls)).toBe(2)
  })

  it('4차 시나리오: tool_use 는 있지만 모두 tool_result is_error=true = 0', () => {
    // Codex 지적: tool_use 카운트만 하면 통과. 성공 카운트로 정확 감지.
    const calls = [
      { name: 'mcp__myfinance__get_portfolio', isError: true },
      { name: 'mcp__myfinance__get_all_strategies', isError: true },
    ]
    expect(countMcpMyFinanceCalls(calls)).toBe(2)  // 시도는 있음
    expect(countSuccessfulMcpMyFinanceCalls(calls)).toBe(0)  // 하지만 성공 0
  })

  it('isError undefined (매칭 실패/이상 상태) 는 성공으로 카운트 안 함 (fail-closed)', () => {
    const calls = [
      { name: 'mcp__myfinance__get_portfolio', isError: undefined },
      { name: 'mcp__myfinance__get_portfolio' },  // undefined 와 동일
    ]
    expect(countSuccessfulMcpMyFinanceCalls(calls)).toBe(0)
  })

  it('일부 성공 + 일부 실패 = 성공만 카운트', () => {
    const calls = [
      { name: 'mcp__myfinance__get_portfolio', isError: false },
      { name: 'mcp__myfinance__get_all_strategies', isError: true },
      { name: 'mcp__myfinance__get_prices', isError: false },
    ]
    expect(countSuccessfulMcpMyFinanceCalls(calls)).toBe(2)
  })
})
