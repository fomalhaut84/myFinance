/**
 * vest_rsu: RSU 베스팅 처리 (종가 자동 조회 + Trade/Holding 자동 반영).
 *
 * 사용자 확인 후 호출. 한 번 호출 시:
 *   1. yahoo finance 로 베스팅일 종가 자동 조회
 *   2. BUY Trade + (autoSell=true 면 SELL Trade) 생성
 *   3. Holding 재계산
 *   4. RSUSchedule.status='vested'
 */

import {
  getRsuVestPreview,
  processRsuVest,
  RsuVestError,
} from '@/lib/rsu-vest-service'
import { toolResult, toolError } from '../utils'

export async function vestRsu(args: {
  id: string
  autoSell?: boolean
}) {
  try {
    if (!args.id || typeof args.id !== 'string') {
      return toolError('id (RSU 스케줄 ID) 가 필요합니다.')
    }

    // preview 로 최신 종가 + autoSell 기본값 조회 + 상태 검증
    const preview = await getRsuVestPreview(args.id)
    if (preview.vestPrice == null) {
      return toolError(
        '베스팅일 종가 자동 조회 실패. 베스팅일이 오늘/과거가 아닌 경우 historical 데이터가 없을 수 있습니다. 웹 페이지에서 직접 종가를 입력해주세요.',
      )
    }

    const autoSell = args.autoSell ?? preview.autoSellDefault
    const result = await processRsuVest(args.id, preview.vestPrice, autoSell)

    const lines = [
      `✅ RSU 베스팅 처리 완료`,
      `- 종목: ${preview.displayName} (${preview.ticker})`,
      `- 계좌: ${preview.accountName}`,
      `- 종가: ₩${result.vestPrice.toLocaleString('ko-KR')} (${preview.vestPriceSource})`,
      `- BUY Trade: ${result.buyShares}주`,
    ]
    if (result.sellShares > 0) lines.push(`- SELL Trade: ${result.sellShares}주`)
    if (result.holding) {
      lines.push(`- 보유: ${result.holding.shares}주 (평단 ₩${Math.round(result.holding.avgPrice).toLocaleString('ko-KR')})`)
    } else {
      lines.push(`- 보유: 0주 (전량 매도)`)
    }
    return toolResult(lines.join('\n'))
  } catch (error) {
    if (error instanceof RsuVestError) {
      if (error.code === 'NOT_FOUND') return toolError('RSU 스케줄을 찾을 수 없습니다.')
      if (error.code === 'ALREADY_VESTED') return toolError('이미 베스팅 처리된 스케줄입니다.')
      if (error.code === 'INVALID_SELL_SHARES') return toolError('매도 수량이 베스팅 수량을 초과합니다.')
      if (error.code === 'INVALID_PRICE') return toolError('베스팅일 종가는 0보다 큰 숫자여야 합니다.')
    }
    return toolError(error)
  }
}
