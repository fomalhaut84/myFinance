#!/usr/bin/env bash
#
# PostgreSQL 자동 백업 스크립트
# 사용법: ./scripts/backup-db.sh
# cron 예시: 0 3 * * * /path/to/myFinance/scripts/backup-db.sh >> /path/to/myFinance/logs/backup.log 2>&1
#

set -euo pipefail

# 설정
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DB_NAME="${DB_NAME:-myfinance}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

# 로그 디렉토리 생성
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# 백업 디렉토리 생성
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 시작: $DB_NAME"

# pg_dump 실행 (gzip 압축)
if pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"; then
    FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 완료: $BACKUP_FILE ($FILESIZE)"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: 백업 실패!" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 오래된 백업 삭제
DELETED_COUNT=0
while IFS= read -r old_file; do
    rm -f "$old_file"
    DELETED_COUNT=$((DELETED_COUNT + 1))
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 삭제: $old_file"
done < <(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" 2>/dev/null)

if [ "$DELETED_COUNT" -gt 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${DELETED_COUNT}개 오래된 백업 삭제 (${RETENTION_DAYS}일 초과)"
fi

# 현재 백업 현황
TOTAL_COUNT=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 현황: ${TOTAL_COUNT}개, 총 ${TOTAL_SIZE}"
