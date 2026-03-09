'use client'

import { useState, useEffect, useCallback } from 'react'
import StepUpload from './StepUpload'
import StepMapping from './StepMapping'
import StepValidation from './StepValidation'
import StepResult from './StepResult'
import type { ValidatedRow, ImportResult } from '@/types/csv-import'

interface Account {
  id: string
  name: string
}

interface ImportWizardProps {
  accounts: Account[]
}

const STEP_LABELS = ['업로드', '컬럼 매핑', '검증', '결과']

export default function ImportWizard({ accounts }: ImportWizardProps) {
  const [step, setStep] = useState(0)

  // Step 1 → 2 data
  const [uploadData, setUploadData] = useState<{
    accountId: string
    market: 'US' | 'KR'
    currency: 'USD' | 'KRW'
    headers: string[]
    rows: Record<string, string>[]
    fileName: string
  } | null>(null)

  // Step 2 → 3 data
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([])

  // Existing trades for duplicate detection
  const [existingTrades, setExistingTrades] = useState<
    Array<{ ticker: string; type: string; tradedAt: string; shares: number; price: number }>
  >([])

  // Step 3 → 4 data
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Fetch all existing trades for account (paginated)
  const fetchExistingTrades = useCallback(async (accountId: string) => {
    try {
      const allTrades: Array<{ ticker: string; type: string; tradedAt: string; shares: number; price: number }> = []
      let offset = 0
      const limit = 200
      let hasMore = true
      while (hasMore) {
        const res = await fetch(`/api/trades?accountId=${accountId}&limit=${limit}&offset=${offset}`)
        const data = await res.json()
        if (data.trades && data.trades.length > 0) {
          for (const t of data.trades as Array<{ ticker: string; type: string; tradedAt: string; shares: number; price: number }>) {
            allTrades.push({
              ticker: t.ticker,
              type: t.type,
              tradedAt: t.tradedAt.slice(0, 10),
              shares: t.shares,
              price: t.price,
            })
          }
          offset += limit
          hasMore = data.trades.length === limit
        } else {
          hasMore = false
        }
      }
      setExistingTrades(allTrades)
    } catch {
      setExistingTrades([])
    }
  }, [])

  useEffect(() => {
    if (uploadData?.accountId) {
      fetchExistingTrades(uploadData.accountId)
    }
  }, [uploadData?.accountId, fetchExistingTrades])

  return (
    <div className="max-w-[640px] mx-auto">
      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-1 mb-6">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  i < step
                    ? 'bg-sejin/20 text-sejin'
                    : i === step
                    ? 'bg-sodam/20 text-sodam border border-sodam/30'
                    : 'bg-white/[0.04] text-dim'
                }`}
              >
                {i < step ? '\u2713' : i + 1}
              </div>
              <span
                className={`text-[11px] truncate ${
                  i === step ? 'text-bright font-medium' : 'text-dim'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`h-px flex-1 mx-2 ${
                  i < step ? 'bg-sejin/30' : 'bg-white/[0.06]'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* 스텝 콘텐츠 */}
      {step === 0 && (
        <StepUpload
          accounts={accounts}
          onNext={(data) => {
            setUploadData(data)
            setStep(1)
          }}
        />
      )}

      {step === 1 && uploadData && (
        <StepMapping
          headers={uploadData.headers}
          rows={uploadData.rows}
          currency={uploadData.currency}
          existingTrades={existingTrades}
          onNext={(rows) => {
            setValidatedRows(rows)
            setStep(2)
          }}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && uploadData && (
        <StepValidation
          validatedRows={validatedRows}
          accountId={uploadData.accountId}
          market={uploadData.market}
          currency={uploadData.currency}
          onNext={(result) => {
            setImportResult(result)
            setStep(3)
          }}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && importResult && (
        <StepResult result={importResult} />
      )}
    </div>
  )
}
