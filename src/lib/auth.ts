import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000 // 5분
const MAX_ENTRIES = 1000

const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

function pruneExpired(): void {
  if (failedAttempts.size <= MAX_ENTRIES) return
  const now = Date.now()
  // 만료된 엔트리 정리
  failedAttempts.forEach((record, key) => {
    if (now - record.lastAttempt > LOCKOUT_MS) {
      failedAttempts.delete(key)
    }
  })
  // 하드 캡: 여전히 초과 시 가장 오래된 엔트리 제거
  if (failedAttempts.size > MAX_ENTRIES) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    failedAttempts.forEach((record, key) => {
      if (record.lastAttempt < oldestTime) {
        oldestTime = record.lastAttempt
        oldestKey = key
      }
    })
    if (oldestKey) failedAttempts.delete(oldestKey)
  }
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const record = failedAttempts.get(key)

  if (!record) return true

  if (now - record.lastAttempt > LOCKOUT_MS) {
    failedAttempts.delete(key)
    return true
  }

  return record.count < MAX_ATTEMPTS
}

function recordFailure(key: string): void {
  const now = Date.now()
  const record = failedAttempts.get(key)

  if (!record || now - record.lastAttempt > LOCKOUT_MS) {
    failedAttempts.set(key, { count: 1, lastAttempt: now })
  } else {
    failedAttempts.set(key, { count: record.count + 1, lastAttempt: now })
  }

  pruneExpired()
}

function clearFailures(key: string): void {
  failedAttempts.delete(key)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // v5: AUTH_SECRET 환경변수 자동 사용. NEXTAUTH_SECRET 후방 호환은 v5가 처리하지 않으므로
  // 배포 시 .env에 AUTH_SECRET 설정 필요. NEXTAUTH_SECRET이 있으면 fallback.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Credentials({
      name: 'PIN',
      credentials: {
        pin: { label: 'PIN', type: 'password' },
      },
      async authorize(credentials, request) {
        const pin = process.env.AUTH_PIN
        if (!pin) {
          throw new Error('AUTH_PIN 환경변수가 설정되지 않았습니다')
        }

        // v5에서는 Request 객체로 헤더 접근 (next-auth v4는 NodeJS req였음)
        const forwarded = request.headers.get('x-forwarded-for')
        const rateLimitKey = forwarded?.split(',')[0]?.trim() || 'unknown'

        if (!checkRateLimit(rateLimitKey)) {
          throw new Error('너무 많은 시도입니다. 5분 후 다시 시도하세요.')
        }

        if (credentials?.pin === pin) {
          clearFailures(rateLimitKey)
          return { id: 'admin', name: '세진', role: 'admin' }
        }

        recordFailure(rateLimitKey)
        return null
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30일
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
})
