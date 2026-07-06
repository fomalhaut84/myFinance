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

echo "=== 6. PM2 — MCP 먼저 + health 검증 ==="
# MCP 서버를 먼저 재시작하고 health 를 확인한 뒤 웹/봇 을 재시작.
# 순서 이유: 웹/봇 은 mcp-config.json 이 http://127.0.0.1:4200/mcp 를 가리키므로
# MCP endpoint 가 준비되기 전에 재시작하면 AI tool 호출이 조용히 실패한 채 노출됨.
# MCP 실패 시 abort → 이전 (구) 웹/봇 은 그대로 유지되어 서비스 안전.
#
# startOrReload (graceful) 대신 startOrRestart (hard) 사용 이유:
# 고정 포트 (127.0.0.1:4200) 를 잡는 fork 단일 프로세스라 old 가 살아있는 상태에서
# 새 인스턴스가 뜨면 EADDRINUSE. reload 는 replacement 를 먼저 스폰해서 이 상황을 유발.
# hard restart = stop old → spawn new 순서라 안전. 봇 (myfinance-bot) 도 동일 패턴 (#356 참조).
pm2 startOrRestart ecosystem.config.js --only myfinance-mcp

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
    echo "ERROR: MCP health check 실패 — 웹/봇 재시작 X (구 인스턴스 유지). 배포 abort."
    pm2 logs myfinance-mcp --lines 50 --nostream || true
    exit 1
fi

echo "=== 7. PM2 — 웹/봇 재시작 ==="
# 웹: stateless → graceful reload (zero-downtime)
pm2 startOrReload ecosystem.config.js --only myfinance
# 봇: 텔레그램 long polling 은 토큰당 1 인스턴스만 허용 → reload 시 두 봇이 겹치면
# 409 Conflict. fork 단일 인스턴스라 hard restart 가 안전 (옛 인스턴스 stop 후 새로 spawn).
# docs/specs/356-bot-409-conflict-fix.md 참조.
pm2 startOrRestart ecosystem.config.js --only myfinance-bot

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://finance.starryjeju.net"
