import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request })

  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url)
    signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * 아래 경로를 제외한 모든 요청에 미들웨어 적용:
     * - /auth/* (로그인 페이지)
     * - /api/auth/* (NextAuth API)
     * - /_next/* (Next.js 내부)
     * - /favicon.ico, /icons/*, /manifest.json (정적 리소스)
     */
    '/((?!auth|api/auth|_next|favicon\\.ico|icons|manifest\\.json).*)',
  ],
}
