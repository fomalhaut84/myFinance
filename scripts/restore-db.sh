#!/usr/bin/env bash
#
# PostgreSQL 백업 복원 스크립트
# 사용법: ./scripts/restore-db.sh [백업파일경로]
# 예시: ./scripts/restore-db.sh backups/myfinance_20260311_030000.sql.gz
#

set -euo pipefail

BACKUP_FILE="${1:-}"
DB_NAME="${DB_NAME:-myfinance}"

if [ -z "$BACKUP_FILE" ]; then
    echo "사용법: $0 <백업파일경로>"
    echo ""
    echo "사용 가능한 백업:"
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
    if [ -d "$BACKUP_DIR" ]; then
        ls -lh "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null || echo "  (백업 없음)"
    else
        echo "  (백업 디렉토리 없음)"
    fi
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: 파일을 찾을 수 없습니다: $BACKUP_FILE" >&2
    exit 1
fi

echo "경고: $DB_NAME 데이터베이스의 모든 데이터가 백업 파일로 교체됩니다."
read -r -p "계속하시겠습니까? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "취소되었습니다."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 복원 시작: $BACKUP_FILE → $DB_NAME"

gunzip -c "$BACKUP_FILE" | psql "$DB_NAME"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 복원 완료"
