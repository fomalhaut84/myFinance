'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatKRW } from '@/lib/format'
import type { AssetRow } from './AssetTable'

interface AssetDeleteModalProps {
  asset: AssetRow
  onClose: () => void
}

export default function AssetDeleteModal({ asset, onClose }: AssetDeleteModalProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })
      if (res.ok) {
        onClose()
        router.refresh()
      }
    } catch {
      // 무시
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[380px] bg-bg-raised border border-border rounded-[14px] z-50 p-6">
        <h3 className="text-[15px] font-bold text-bright mb-4">자산 삭제</h3>

        <div className="bg-card rounded-lg px-4 py-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-dim">자산명</span>
            <span className="text-[13px] text-bright font-medium">{asset.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dim">금액</span>
            <span className="text-[13px] font-semibold tabular-nums text-bright">
              {formatKRW(asset.value)}
            </span>
          </div>
        </div>

        <p className="text-[12px] text-red-400/80 leading-relaxed mb-5">
          이 자산을 삭제하면 복구할 수 없습니다.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-sub border border-border hover:bg-surface-dim transition-all">취소</button>
          <button onClick={handleDelete} disabled={isDeleting} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 disabled:opacity-40 transition-all">
            {isDeleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </>
  )
}
