#!/bin/bash
# myFinance 배포 스크립트
# 사용: ./deploy/deploy.sh [branch|tag]
# 예시: ./deploy/deploy.sh main
#       ./deploy/deploy.sh v0.1.0
#       ./deploy/deploy.sh dev
#
# 호출 시 cwd 자동 처리:
# - cwd 가 myFinance 루트면 그대로 (deploy.sh 가 직접 호출됨)
# - 그 외엔 스크립트 위치 기준 상위 디렉토리 (CI workflow 에서 임의 cwd 호출 호환)
set -e

TARGET="${1:-main}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

echo "=== 1. Fetch latest ==="
git fetch origin --tags

echo "=== 2. Checkout: $TARGET ==="
git checkout "$TARGET"

# 브랜치인 경우 pull, 태그인 경우 이미 detached HEAD
if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    git pull origin "$TARGET"
fi

echo "=== 3. Install dependencies ==="
npm ci

echo "=== 4. DB Migrate ==="
npx prisma migrate deploy

echo "=== 5. Build ==="
npm run build

echo "=== 6. PM2 Restart ==="
# MCP 서버 먼저 (봇/웹이 붙기 전에 tool endpoint 준비). HTTP 서버라 graceful reload 가능.
pm2 startOrReload ecosystem.config.js --only myfinance-mcp
# 웹: stateless → graceful reload (zero-downtime)
pm2 startOrReload ecosystem.config.js --only myfinance
# 봇: 텔레그램 long polling 은 토큰당 1 인스턴스만 허용 → reload 시 두 봇이 겹치면
# 409 Conflict. fork 단일 인스턴스라 hard restart 가 안전 (옛 인스턴스 stop 후 새로 spawn).
# docs/specs/356-bot-409-conflict-fix.md 참조.
pm2 startOrRestart ecosystem.config.js --only myfinance-bot

echo "=== 7. MCP health check ==="
# 첫 배포는 startOrReload 가 pm2 start 로 동작 — bundle load + prisma init 지연 대응 위해 최대 20s retry.
MCP_HEALTHY=0
for i in {1..20}; do
    if curl -sS -f -o /dev/null http://127.0.0.1:4200/health; then
        MCP_HEALTHY=1
        echo "MCP server healthy (after ${i}s)"
        break
    fi
    sleep 1
done
if [ "$MCP_HEALTHY" != "1" ]; then
    echo "ERROR: MCP health check 실패 — 봇 AI 도구가 동작 안 함. 배포 abort."
    pm2 logs myfinance-mcp --lines 50 --nostream || true
    exit 1
fi

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://finance.starryjeju.net"
