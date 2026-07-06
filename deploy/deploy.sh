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

# 이전 배포가 실패해 mcp-config.json 이 tracked 이지만 modified 상태로 남았을 수 있음.
# 그대로 두면 이후 checkout / pull 이 local changes 로 abort → 복구 불가.
# 다음 checkout 이 어차피 target 내용으로 덮으므로 여기서 강제 리셋.
MCP_CONFIG_REL="src/lib/ai/mcp-config.json"
if ! git diff --quiet -- "$MCP_CONFIG_REL" 2>/dev/null; then
    echo "WARN: mcp-config.json 이 dirty (이전 배포 실패 흔적). HEAD 로 리셋."
    git checkout HEAD -- "$MCP_CONFIG_REL"
fi

# claude-advisor.ts 는 매번 src/lib/ai/mcp-config.json 을 읽어 Claude CLI 에
# --mcp-config 로 넘김. 이 파일이 HTTP url 로 바뀌는 순간 실행 중인 web/bot 은
# 즉시 새 config 를 참조하므로, MCP HTTP 서버가 뜨기 전에 checkout 하면 배포
# 소요 시간 (수분) 동안 AI 기능이 다운됨.
# 대응: checkout 전 old config 백업 → checkout 후 즉시 복원 → MCP HTTP 검증
# 완료 후에만 최종 swap. 배포 중 서비스 무중단.
MCP_CONFIG_BACKUP=""
if [ -f "$MCP_CONFIG_REL" ]; then
    MCP_CONFIG_BACKUP=$(mktemp -t mcp-config.old.XXXXXX.json)
    cp "$MCP_CONFIG_REL" "$MCP_CONFIG_BACKUP"
    echo "backed up existing mcp-config to $MCP_CONFIG_BACKUP"
fi

# 실패 시: backup 을 tracked file 로 복원 (실행 중 web/bot 이 계속 old config 로 동작)
# DIST_MCP_BACKUP 은 개별 failure branch 에서 이미 처리하지만 남아있으면 정리.
cleanup_on_error() {
    if [ -n "$MCP_CONFIG_BACKUP" ] && [ -f "$MCP_CONFIG_BACKUP" ]; then
        cp "$MCP_CONFIG_BACKUP" "$MCP_CONFIG_REL" 2>/dev/null || true
        rm -f "$MCP_CONFIG_BACKUP"
        echo "restored mcp-config from backup after failure (worktree may be dirty; next deploy 초입에서 자동 리셋)"
    fi
    if [ -n "$DIST_MCP_BACKUP" ] && [ -f "$DIST_MCP_BACKUP" ]; then
        rm -f "$DIST_MCP_BACKUP"
    fi
}
trap cleanup_on_error EXIT

echo "=== 2. Checkout: $TARGET ==="
git checkout "$TARGET"

# 브랜치인 경우 pull, 태그인 경우 이미 detached HEAD
if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    git pull origin "$TARGET"
fi

# TARGET 이 HTTP MCP transport 를 지원하는지 감지.
# HTTP config 는 { "type":"http", "url":"..." } 형태, stdio 는 { "command":"...", "args":[...] }.
# 이 감지는 checkout 직후 (아직 원상복원 전) 새로 반영된 config 를 대상으로 함.
# 이유: rollback 시나리오 대비 — pre-HTTP tag (v0.11.0 이하) 로 배포하면
# dist/mcp/server.cjs 가 stdio-only 라 HTTP pre-flight 무한 hang → abort.
IS_HTTP_MCP=0
if grep -q '"url"' "$MCP_CONFIG_REL" 2>/dev/null; then
    IS_HTTP_MCP=1
    echo "target uses HTTP MCP transport"
else
    echo "target uses stdio MCP transport (rollback or pre-HTTP version)"
fi

if [ "$IS_HTTP_MCP" = "1" ]; then
    # HTTP 경로: checkout 이 mcp-config.json 을 새 (HTTP) 로 바꿨다면 즉시 old (stdio 또는
    # 이전 HTTP) 로 되돌림. 실행 중인 web/bot 은 계속 old config 로 동작 → 배포 소요 시간
    # 동안 AI 무중단. MCP HTTP 서버 준비 완료 후 (step 7 통과) 최종 swap 진행.
    if [ -n "$MCP_CONFIG_BACKUP" ] && [ -f "$MCP_CONFIG_BACKUP" ]; then
        cp "$MCP_CONFIG_BACKUP" "$MCP_CONFIG_REL"
        echo "restored old mcp-config for during-deploy AI availability"
    fi
else
    # stdio 경로 (rollback): target 의 stdio config 가 우리가 원하는 최종 상태.
    # backup 을 지우고 trap 도 해제 → checkout 이후 상태 유지.
    if [ -n "$MCP_CONFIG_BACKUP" ]; then
        rm -f "$MCP_CONFIG_BACKUP"
        MCP_CONFIG_BACKUP=""
    fi
    trap - EXIT
fi

echo "=== 3. Install dependencies ==="
npm ci

echo "=== 4. DB Migrate ==="
npx prisma migrate deploy

# build 는 dist/mcp/server.cjs 를 덮어씀. MCP restart 실패 (health 미통과) 시
# rollback 을 위해 build 전 old dist 를 백업. 성공적으로 새 MCP 가 health 통과
# 하면 백업 삭제.
DIST_MCP_BACKUP=""
if [ -f dist/mcp/server.cjs ]; then
    DIST_MCP_BACKUP=$(mktemp -t mcp-dist.old.XXXXXX.cjs)
    cp dist/mcp/server.cjs "$DIST_MCP_BACKUP"
    echo "backed up existing dist/mcp/server.cjs to $DIST_MCP_BACKUP"
fi

echo "=== 5. Build ==="
npm run build

if [ "$IS_HTTP_MCP" = "1" ]; then
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
            # dist 롤백 — 이후 PM2 auto-restart 가 broken build 를 픽업하지 않도록.
            if [ -n "$DIST_MCP_BACKUP" ] && [ -f "$DIST_MCP_BACKUP" ]; then
                cp "$DIST_MCP_BACKUP" dist/mcp/server.cjs
                echo "restored old dist/mcp/server.cjs (subsequent auto-restart 안전)"
            fi
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
        if [ -n "$DIST_MCP_BACKUP" ] && [ -f "$DIST_MCP_BACKUP" ]; then
            cp "$DIST_MCP_BACKUP" dist/mcp/server.cjs
            echo "restored old dist/mcp/server.cjs"
        fi
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

        # No-downtime rollback 유지: 새 dist 로 restart 했더니 health 실패 →
        # old dist 로 되돌리고 pm2 restart 로 이전 프로세스 복구 시도.
        if [ -n "$DIST_MCP_BACKUP" ] && [ -f "$DIST_MCP_BACKUP" ]; then
            echo "attempting rollback: restore old dist/mcp/server.cjs + pm2 restart"
            cp "$DIST_MCP_BACKUP" dist/mcp/server.cjs
            pm2 restart myfinance-mcp --update-env 2>&1 | tail -5 || true
            for i in {1..10}; do
                if curl -sS -f -o /dev/null http://127.0.0.1:4200/health; then
                    echo "old MCP 복구 성공 (after ${i}s) — 웹/봇 은 old 상태 유지 (재시작 skip)"
                    break
                fi
                sleep 1
            done
        fi
        echo "웹/봇 재시작 X. 배포 abort. mcp-config trap 이 old 로 복원."
        exit 1
    fi

    # health 성공 → 새 MCP 정상. old dist 백업 삭제.
    if [ -n "$DIST_MCP_BACKUP" ]; then
        rm -f "$DIST_MCP_BACKUP"
        DIST_MCP_BACKUP=""
    fi

    # 첫 배포에서 새 앱을 추가한 뒤 pm2 save 를 하지 않으면 host reboot 후
    # pm2 resurrect 가 이전 저장된 프로세스 목록만 복원 → myfinance-mcp 실종.
    # 매 배포마다 save 로 최신 프로세스 목록 동기화. save 실패 (권한/PM2_HOME 등)
    # 시 조용히 넘어가면 reboot 후 MCP 실종 위험 → set -e 로 abort.
    pm2 save --force

    # MCP HTTP 서버가 검증 완료된 지금 시점에 mcp-config.json 을 최종 swap.
    # git tree 의 새 config (HTTP url) 로 되돌려 이후 AI 호출이 HTTP 로 라우팅.
    # 실행 중인 old web/bot 도 (재시작 전에도) 다음 AI 호출부터 즉시 새 config 사용.
    if [ -n "$MCP_CONFIG_BACKUP" ]; then
        git checkout HEAD -- "$MCP_CONFIG_REL"
        rm -f "$MCP_CONFIG_BACKUP"
        MCP_CONFIG_BACKUP=""
        echo "swapped mcp-config to new HTTP config"
    fi
    # 이 지점 이후 배포 실패 시 config 롤백 불필요 (MCP HTTP 는 running, 새 config 는 정합).
    trap - EXIT
else
    echo "=== 6-7. skipped MCP HTTP steps (stdio target) ==="
    # rollback 경로: target 의 dist/mcp/server.cjs 는 stdio-only 라 HTTP pre-flight/restart
    # 필요 없음. 기존 myfinance-mcp PM2 app 이 running 중이면 stop + delete → 이후 pm2 save
    # 로 프로세스 목록에서도 제거. bot/web 은 stdio config 로 서브프로세스 spawn 하여 tool 호출.
    if pm2 describe myfinance-mcp >/dev/null 2>&1; then
        echo "stopping/deleting myfinance-mcp (stdio target 은 standalone MCP 불사용)"
        pm2 delete myfinance-mcp || true
        pm2 save --force
    fi
    # stdio path 는 dist rollback 이 불필요 → 백업 정리.
    if [ -n "$DIST_MCP_BACKUP" ]; then
        rm -f "$DIST_MCP_BACKUP"
        DIST_MCP_BACKUP=""
    fi
fi

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
