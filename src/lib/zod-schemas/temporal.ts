/**
 * GET 쿼리 파라미터 — 시간/날짜 공통 schema.
 * year/month 범위 검증, date range from <= to 교차 검증.
 */

import { z } from 'zod'

const YEAR_MIN = 2000
const YEAR_MAX = 2100

/**
 * 연도 schema. null/빈 문자열 입력 시 undefined 로 normalize (호출 측이 기본값 처리).
 * 명시적으로 값이 들어오면 2000~2100 정수만 허용.
 */
export const yearSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v === '' ? undefined : Number(v)))
  .pipe(
    z
      .number({ message: 'year 은 2000~2100 정수여야 합니다.' })
      .int({ message: 'year 은 2000~2100 정수여야 합니다.' })
      .min(YEAR_MIN, { message: `year 은 ${YEAR_MIN} 이상이어야 합니다.` })
      .max(YEAR_MAX, { message: `year 은 ${YEAR_MAX} 이하여야 합니다.` })
      .optional(),
  )

/**
 * 월 schema. null/빈 문자열 입력 시 undefined.
 * 명시적으로 값이 들어오면 1~12 정수만 허용.
 */
export const monthSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v === '' ? undefined : Number(v)))
  .pipe(
    z
      .number({ message: 'month 은 1~12 정수여야 합니다.' })
      .int({ message: 'month 은 1~12 정수여야 합니다.' })
      .min(1, { message: 'month 은 1 이상이어야 합니다.' })
      .max(12, { message: 'month 은 12 이하이어야 합니다.' })
      .optional(),
  )

export const yearMonthSchema = z.object({
  year: yearSchema,
  month: monthSchema,
})

/**
 * 날짜 범위 schema. from/to 각각 ISO 문자열 파싱 가능해야 하고, from <= to 보장.
 * 둘 다 optional.
 */
export const dateRangeSchema = z
  .object({
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.from && d.from !== '' && isNaN(Date.parse(d.from))) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: '유효한 시작일을 입력해주세요.',
      })
    }
    if (d.to && d.to !== '' && isNaN(Date.parse(d.to))) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: '유효한 종료일을 입력해주세요.',
      })
    }
    if (
      d.from &&
      d.to &&
      !isNaN(Date.parse(d.from)) &&
      !isNaN(Date.parse(d.to)) &&
      Date.parse(d.from) > Date.parse(d.to)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: '시작일이 종료일보다 뒤일 수 없습니다.',
      })
    }
  })
