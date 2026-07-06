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

echo "=== 6. MCP — pre-flight check (old 인스턴스 유지 상태에서 새 빌드 검증) ==="
# 목적: pm2 hard restart 로 old MCP 를 죽이기 전에 new dist/mcp/server.cjs 가
# 실제로 부팅 + health 응답하는지 확인. 크래시 (환경변수 누락 / 스키마 오류 등) 를
# 사전에 잡아 old healthy 인스턴스가 유지된 채로 abort → 서비스 무중단.
#
# 프로덕션 포트 4200 은 old 인스턴스가 잡고 있을 수 있으므로 임시 포트 4299 사용.
PREFLIGHT_PORT=4299
PREFLIGHT_LOG=$(mktemp -t mcp-preflight-XXXXXX.log)
MCP_TRANSPORT=http MCP_PORT="$PREFLIGHT_PORT" node dist/mcp/server.cjs > "$PREFLIGHT_LOG" 2>&1 &
PREFLIGHT_PID=$!

PREFLIGHT_OK=0
for i in {1..20}; do
    if curl -sS -f -o /dev/null "http://127.0.0.1:${PREFLIGHT_PORT}/health"; then
        PREFLIGHT_OK=1
        echo "pre-flight OK (after ${i}s)"
        break
    fi
    # 프로세스가 이미 죽었는지 확인 (early exit 감지)
    if ! kill -0 "$PREFLIGHT_PID" 2>/dev/null; then
        echo "ERROR: pre-flight 프로세스가 조기 종료. 스택 트레이스:"
        cat "$PREFLIGHT_LOG" || true
        rm -f "$PREFLIGHT_LOG"
        echo "old MCP 는 그대로 유지 (서비스 무중단). 배포 abort."
        exit 1
    fi
    sleep 1
done

# pre-flight 프로세스 정리 (성공 여부 무관)
kill -TERM "$PREFLIGHT_PID" 2>/dev/null || true
wait "$PREFLIGHT_PID" 2>/dev/null || true

if [ "$PREFLIGHT_OK" != "1" ]; then
    echo "ERROR: pre-flight health 실패. 로그:"
    cat "$PREFLIGHT_LOG" || true
    rm -f "$PREFLIGHT_LOG"
    echo "old MCP 는 그대로 유지 (서비스 무중단). 배포 abort."
    exit 1
fi
rm -f "$PREFLIGHT_LOG"

echo "=== 7. PM2 — MCP 재시작 + health 재확인 ==="
# pre-flight 통과 후에만 실제 서비스 포트 (4200) 인스턴스 교체.
# startOrRestart (hard restart) 사용 이유:
# 고정 포트 (127.0.0.1:4200) 를 잡는 fork 단일 프로세스라 old 가 살아있는 상태에서
# 새 인스턴스가 뜨면 EADDRINUSE. reload 는 replacement 를 먼저 스폰해서 이 상황을 유발.
# hard restart = stop old → spawn new 순서라 안전. 봇 (myfinance-bot) 도 동일 패턴 (#356 참조).
pm2 startOrRestart ecosystem.config.js --only myfinance-mcp

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
    echo "ERROR: MCP restart 후 health 실패 (pre-flight 는 통과했지만 실서비스 포트 문제 가능)."
    pm2 logs myfinance-mcp --lines 50 --nostream || true
    echo "웹/봇 재시작 X (구 인스턴스 유지). 배포 abort."
    exit 1
fi

# 첫 배포에서 새 앱을 추가한 뒤 pm2 save 를 하지 않으면 host reboot 후
# pm2 resurrect 가 이전 저장된 프로세스 목록만 복원 → myfinance-mcp 실종.
# 매 배포마다 save 로 최신 프로세스 목록 동기화. save 실패 (권한/PM2_HOME 등)
# 시 조용히 넘어가면 reboot 후 MCP 실종 위험 → set -e 로 abort.
pm2 save --force

echo "=== 8. PM2 — 웹/봇 재시작 ==="
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
