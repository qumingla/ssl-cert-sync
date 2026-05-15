#!/usr/bin/env bash
################################################################################
# cert-node-agent.sh
# API-aware wrapper for cert-node-pull.sh
# 功能:
#   - API 模式: 心跳 -> 拉取分配/命令 -> 调用 puller -> 回报状态 -> ACK 命令
#   - 兼容模式: 未配置 MASTER_URL / NODE_TOKEN 时，退回旧版 puller 直连 WebDAV
################################################################################

set -euo pipefail
IFS=$'\n\t'

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:${PATH}}"

CONFIG_FILE="/etc/default/cert-node"
PULL_SCRIPT="/usr/local/bin/cert-node-pull.sh"
TMP_ROOT="/tmp/ssl-node-agent"
NODE_API_BASE_SUFFIX="/api/node/v1"
AGENT_VERSION="2026.05.15"

usage() {
    cat >&2 <<'EOF'
Usage: cert-node-agent.sh [--config /etc/default/cert-node] [--pull-script /usr/local/bin/cert-node-pull.sh]
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config)
            CONFIG_FILE="${2:?missing config path}"
            shift 2
            ;;
        --pull-script)
            PULL_SCRIPT="${2:?missing pull-script path}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[FATAL] 未知参数: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "[FATAL] 配置文件不存在: ${CONFIG_FILE}" >&2
    exit 1
fi
if [[ ! -x "${PULL_SCRIPT}" ]]; then
    echo "[FATAL] puller 脚本不存在或不可执行: ${PULL_SCRIPT}" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "${CONFIG_FILE}"
if ! declare -p DOMAINS >/dev/null 2>&1; then
    DOMAINS=()
fi

MASTER_URL="${MASTER_URL:-}"
NODE_TOKEN="${NODE_TOKEN:-}"
WEBDAV_URL="${WEBDAV_URL:-}"
WEBDAV_AUTH="${WEBDAV_AUTH:-}"
TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"
TG_CHAT_ID="${TG_CHAT_ID:-}"
CERT_BASE_DIR="${CERT_BASE_DIR:-/etc/ssl/certs/acme}"
TMP_BASE="${TMP_BASE:-/tmp/ssl_update}"
LOG_FILE="${LOG_FILE:-/var/log/cert-node-pull.log}"
SERVICE_TEST_CMD="${SERVICE_TEST_CMD:-nginx -t}"
SERVICE_RELOAD_CMD="${SERVICE_RELOAD_CMD:-systemctl reload nginx}"
NODE_NAME="${NODE_NAME:-$(hostname -s)}"

mkdir -p "$(dirname "${LOG_FILE}")"

log() {
    local level="$1"; shift
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[${ts}] [${level}] [${NODE_NAME}] [agent] $*" | tee -a "${LOG_FILE}" >&2
}

shell_quote() {
    local value="$1"
    value="${value//\'/\'\"\'\"\'}"
    printf "'%s'" "${value}"
}

if [[ -z "${MASTER_URL}" || -z "${NODE_TOKEN}" ]]; then
    log "INFO" "未检测到 MASTER_URL/NODE_TOKEN，退回传统 WebDAV 模式"
    exec "${PULL_SCRIPT}" --config "${CONFIG_FILE}"
fi

MASTER_URL="${MASTER_URL%/}"
NODE_API_BASE="${MASTER_URL}${NODE_API_BASE_SUFFIX}"
STATE_DIR="$(mktemp -d "${TMP_ROOT}.XXXXXX")"
ASSIGNMENTS_JSON="${STATE_DIR}/assignments.json"
ASSIGNMENTS_TSV="${STATE_DIR}/assignments.tsv"
COMMANDS_JSON="${STATE_DIR}/commands.json"
REPORT_JSON="${STATE_DIR}/report.json"
RUNTIME_CONFIG="${STATE_DIR}/cert-node-runtime.conf"

cleanup() {
    rm -rf "${STATE_DIR}"
}
trap cleanup EXIT

curl_node_api() {
    local method="$1"
    local path="$2"
    local body="${3:-}"
    local output_file="${4:?missing output file}"
    local http_code
    if [[ -n "${body}" ]]; then
        http_code="$(curl -sS -o "${output_file}" -w "%{http_code}" \
            -X "${method}" \
            -H "Authorization: Bearer ${NODE_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "${body}" \
            "${NODE_API_BASE}${path}")"
    else
        http_code="$(curl -sS -o "${output_file}" -w "%{http_code}" \
            -X "${method}" \
            -H "Authorization: Bearer ${NODE_TOKEN}" \
            "${NODE_API_BASE}${path}")"
    fi

    if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
        local detail=""
        if [[ -s "${output_file}" ]]; then
            detail="$(tr '\n' ' ' < "${output_file}")"
        fi
        log "ERROR" "Node API ${method} ${path} 失败 (HTTP ${http_code}) ${detail}"
        return 1
    fi
}

node_heartbeat() {
    local body
    body="$(python3 - "${AGENT_VERSION}" "${CERT_BASE_DIR}" <<'PY'
import json, socket, sys
print(json.dumps({
    "hostname": socket.gethostname(),
    "ip": "",
    "version": sys.argv[1],
    "certDir": sys.argv[2],
}, ensure_ascii=False))
PY
)"
    curl_node_api "POST" "/heartbeat" "${body}" "${STATE_DIR}/heartbeat.json"
}

load_assignments() {
    curl_node_api "GET" "/assignments" "" "${ASSIGNMENTS_JSON}"
    python3 - "${ASSIGNMENTS_JSON}" "${ASSIGNMENTS_TSV}" <<'PY'
import json, sys
source = json.load(open(sys.argv[1], encoding="utf-8"))
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    for item in source.get("assignments", []):
        fields = [
            item.get("domainId") or "",
            item.get("domainName") or "",
            item.get("desiredSha256") or "",
            item.get("expiresAt") or "",
        ]
        fh.write("\t".join(fields) + "\n")
PY
    WEBDAV_URL="$(python3 - "${ASSIGNMENTS_JSON}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print((data.get("webdav") or {}).get("url") or "")
PY
)"
    WEBDAV_AUTH="$(python3 - "${ASSIGNMENTS_JSON}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print((data.get("webdav") or {}).get("auth") or "")
PY
)"

    DOMAINS=()
    declare -gA DOMAIN_IDS=()
    declare -gA DOMAIN_DESIRED_SHA=()
    while IFS=$'\t' read -r domain_id domain_name desired_sha _expires_at; do
        [[ -n "${domain_name}" ]] || continue
        DOMAINS+=("${domain_name}")
        DOMAIN_IDS["${domain_name}"]="${domain_id}"
        DOMAIN_DESIRED_SHA["${domain_name}"]="${desired_sha}"
    done < "${ASSIGNMENTS_TSV}"
}

load_commands() {
    curl_node_api "GET" "/commands" "" "${COMMANDS_JSON}"
    mapfile -t COMMAND_IDS < <(python3 - "${COMMANDS_JSON}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for item in data.get("commands", []):
    print(item.get("id") or "")
PY
)
}

write_runtime_config() {
    if [[ -z "${WEBDAV_URL}" || -z "${WEBDAV_AUTH}" ]]; then
        log "ERROR" "Master 未返回 WebDAV 配置，无法执行同步"
        return 1
    fi

    {
        printf "DOMAINS=("
        for domain in "${DOMAINS[@]}"; do
            printf "%s " "$(shell_quote "${domain}")"
        done
        printf ")\n"
        printf "WEBDAV_URL=%s\n" "$(shell_quote "${WEBDAV_URL}")"
        printf "WEBDAV_AUTH=%s\n" "$(shell_quote "${WEBDAV_AUTH}")"
        printf "CERT_BASE_DIR=%s\n" "$(shell_quote "${CERT_BASE_DIR}")"
        printf "TMP_BASE=%s\n" "$(shell_quote "${TMP_BASE}")"
        printf "TG_BOT_TOKEN=%s\n" "$(shell_quote "${TG_BOT_TOKEN}")"
        printf "TG_CHAT_ID=%s\n" "$(shell_quote "${TG_CHAT_ID}")"
        printf "SERVICE_TEST_CMD=%s\n" "$(shell_quote "${SERVICE_TEST_CMD}")"
        printf "SERVICE_RELOAD_CMD=%s\n" "$(shell_quote "${SERVICE_RELOAD_CMD}")"
        printf "LOG_FILE=%s\n" "$(shell_quote "${LOG_FILE}")"
        printf "NODE_NAME=%s\n" "$(shell_quote "${NODE_NAME}")"
    } > "${RUNTIME_CONFIG}"
    chmod 600 "${RUNTIME_CONFIG}"
}

build_report() {
    local pull_exit_code="$1"
    python3 - "${ASSIGNMENTS_TSV}" "${CERT_BASE_DIR}" "${pull_exit_code}" > "${REPORT_JSON}" <<'PY'
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

assignments_path = Path(sys.argv[1])
cert_base_dir = Path(sys.argv[2])
pull_exit_code = int(sys.argv[3])

items = []
for raw_line in assignments_path.read_text(encoding="utf-8").splitlines():
    if not raw_line.strip():
        continue
    domain_id, domain_name, desired_sha, _expires_at = (raw_line.split("\t") + ["", "", "", ""])[:4]
    cert_dir = cert_base_dir / domain_name
    sha_file = cert_dir / "cert.sha256"
    chain_file = cert_dir / f"{domain_name}.cer"

    deployed_sha = sha_file.read_text(encoding="utf-8").strip() if sha_file.exists() else None
    local_expiry = None
    if chain_file.exists():
        completed = subprocess.run(
            ["openssl", "x509", "-noout", "-enddate", "-in", str(chain_file)],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode == 0 and "=" in completed.stdout:
            raw_expiry = completed.stdout.strip().split("=", 1)[1].strip()
            local_expiry = datetime.strptime(raw_expiry, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

    if deployed_sha and (not desired_sha or deployed_sha == desired_sha):
        status = "synced"
        last_error = None
    elif deployed_sha:
        status = "error" if pull_exit_code != 0 else "pending"
        last_error = "Desired certificate SHA is not deployed on this node yet."
    else:
        status = "error"
        last_error = "Certificate files are missing locally."

    items.append(
        {
            "domainId": domain_id,
            "deployedSha256": deployed_sha,
            "status": status,
            "expiresAt": local_expiry,
            "lastError": last_error,
        }
    )

print(json.dumps({"items": items}, ensure_ascii=False))
PY
}

submit_report() {
    curl_node_api "POST" "/reports" "$(cat "${REPORT_JSON}")" "${STATE_DIR}/report-response.json"
}

ack_commands() {
    local pull_exit_code="$1"
    local ack_status="completed"
    local ack_error=""

    if [[ "${pull_exit_code}" -ne 0 ]]; then
        ack_status="failed"
        ack_error="Node synchronization failed. Check ${LOG_FILE} for details."
    fi

    local payload
    payload="$(python3 - "${ack_status}" "${ack_error}" <<'PY'
import json
import sys
print(json.dumps({"status": sys.argv[1], "error": sys.argv[2] or None}, ensure_ascii=False))
PY
)"
    for command_id in "${COMMAND_IDS[@]:-}"; do
        [[ -n "${command_id}" ]] || continue
        curl_node_api "POST" "/commands/${command_id}/ack" "${payload}" "${STATE_DIR}/ack-${command_id}.json"
    done
}

main() {
    log "INFO" "开始 API 模式节点同步"
    node_heartbeat
    load_assignments
    load_commands

    if [[ ${#DOMAINS[@]} -eq 0 ]]; then
        log "INFO" "当前节点没有分配任何域名"
        ack_commands 0
        return 0
    fi

    write_runtime_config

    local pull_exit_code=0
    "${PULL_SCRIPT}" --config "${RUNTIME_CONFIG}" || pull_exit_code=$?

    build_report "${pull_exit_code}"
    submit_report
    ack_commands "${pull_exit_code}"

    if [[ "${pull_exit_code}" -ne 0 ]]; then
        log "ERROR" "节点同步失败，退出码 ${pull_exit_code}"
    else
        log "INFO" "节点同步完成"
    fi
    return "${pull_exit_code}"
}

main "$@"
