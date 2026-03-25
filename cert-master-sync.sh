#!/usr/bin/env bash
################################################################################
# cert-master-sync.sh
# SSL 证书自动分发系统 - Master 端核心脚本（多域名版）
# 功能: 循环处理每个域名: 申请 → 校验 → SHA256 → 上传至 WebDAV → TG 通知
#
# 部署路径: /usr/local/bin/cert-master-sync.sh
# 配置加载: /etc/default/acme-master
# 权限:     chmod 750 /usr/local/bin/cert-master-sync.sh
################################################################################

set -euo pipefail
IFS=$'\n\t'

# ── 0. 加载配置 ───────────────────────────────────────────────────────────────
CONFIG_FILE="/etc/default/acme-master"
if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "[FATAL] 配置文件不存在: ${CONFIG_FILE}" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "${CONFIG_FILE}"

# 检查必要变量（CF 凭证二选一，不强制 :?）
: "${TG_BOT_TOKEN:?}" "${TG_CHAT_ID:?}" \
  "${WEBDAV_URL:?}" "${WEBDAV_AUTH:?}" \
  "${ACME_HOME:=/root/.acme.sh}" \
  "${STAGING_BASE:=/tmp/acme_staging}" \
  "${LOG_FILE:=/var/log/cert-master-sync.log}"

# 确保至少填写了一种 Cloudflare 认证方式
if [[ -z "${CF_Token:-}" && -z "${CF_Key:-}" ]]; then
    echo "[FATAL] Cloudflare 认证未配置: 请在配置文件中填写 CF_Token 或 CF_Key+CF_Email" >&2
    exit 1
fi

# 检查 DOMAINS 数组
if [[ ${#DOMAINS[@]} -eq 0 ]]; then
    echo "[FATAL] DOMAINS 数组为空，请在配置文件中至少填写一个域名" >&2
    exit 1
fi

# ── 1. 日志函数 ───────────────────────────────────────────────────────────────
log() {
    local level="$1"; shift
    local msg="$*"
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[${ts}] [${level}] ${msg}" | tee -a "${LOG_FILE}"
}

# ── 2. Telegram 通知函数 ──────────────────────────────────────────────────────
# HTML 实体转义（防止日志中的 <>& 导致 TG HTTP 400）
html_escape() {
    local s="$1"
    s="${s//&/&amp;}"
    s="${s//</&lt;}"  
    s="${s//>/&gt;}"
    printf '%s' "${s}"
}

# 用法: send_tg_msg "❤️ 标题" "正文"
send_tg_msg() {
    local title="$1"
    local body="${2:-}"
    local safe_title safe_body text
    safe_title="$(html_escape "${title}")"
    safe_body="$(html_escape "${body}")"
    text="$(printf '<b>%s</b>\n<pre>%s</pre>' "${safe_title}" "${safe_body}")"

    local http_code
    # 全部参数均用 --data-urlencode，避免混用 -d/-–data-urlencode 导致编码不一致引发 HTTP 400
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 15 \
        "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${TG_CHAT_ID}" \
        --data-urlencode "parse_mode=HTML" \
        --data-urlencode "text=${text}" 2>/dev/null) || true

    if [[ "${http_code}" == "200" ]]; then
        log "INFO" "TG 通知已发送: ${title}"
    else
        log "WARN" "TG 通知发送失败, HTTP ${http_code:-err}"
    fi
}

# ── 3. 上传至 OpenList (WebDAV) ───────────────────────────────────────────────
# 用法: push_to_openlist <local_file> <remote_subpath>
# remote_subpath 示例: "example.com/privkey.pem"
push_to_openlist() {
    local local_file="$1"
    local remote_subpath="$2"
    local remote_url="${WEBDAV_URL}/${remote_subpath}"

    if [[ ! -f "${local_file}" ]]; then
        log "ERROR" "待上传文件不存在: ${local_file}"
        return 1
    fi

    log "INFO" "上传 → ${remote_url}"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 60 \
        --retry 3 \
        --retry-delay 5 \
        --retry-connrefused \
        -u "${WEBDAV_AUTH}" \
        -T "${local_file}" \
        "${remote_url}")

    case "${http_code}" in
        200|201|204)
            log "INFO" "✅ 上传成功: ${remote_subpath} (HTTP ${http_code})"
            return 0
            ;;
        401|403)
            log "ERROR" "❌ WebDAV 鉴权失败 (HTTP ${http_code}): ${remote_subpath}"
            return 1
            ;;
        *)
            log "ERROR" "❌ 上传失败 (HTTP ${http_code}): ${remote_subpath}"
            return 1
            ;;
    esac
}

# ── 4. 确保 WebDAV 目录存在（MKCOL）──────────────────────────────────────────
ensure_webdav_dir() {
    local dir_path="$1"
    local remote_url="${WEBDAV_URL}/${dir_path}/"
    # WebDAV MKCOL 创建目录，忽略 405(已存在)
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 15 \
        -u "${WEBDAV_AUTH}" \
        -X MKCOL "${remote_url}" 2>/dev/null) || true
    log "INFO" "MKCOL ${remote_url} → HTTP ${http_code}"
}

# ── 5. 环境预检（全局执行一次）────────────────────────────────────────────────
pre_check() {
    log "INFO" "======== 开始证书同步任务（共 ${#DOMAINS[@]} 个域名）========"

    local acme_bin="${ACME_HOME}/acme.sh"
    if [[ ! -x "${acme_bin}" ]]; then
        log "ERROR" "acme.sh 未找到: ${acme_bin}"
        send_tg_msg "🚨 [FATAL] Master 任务失败" "acme.sh 未安装或路径错误: ${acme_bin}"
        exit 1
    fi
    log "INFO" "acme.sh: $("${acme_bin}" --version 2>&1 | head -1)"
    log "INFO" "OpenSSL: $(openssl version)"

    command -v curl &>/dev/null || { log "ERROR" "curl 未安装"; exit 1; }
    install -d -m 700 "${STAGING_BASE}"
}

# ── 6. 处理单个域名（申请 → 提取 → 上传）────────────────────────────────────
process_domain() {
    local domain="$1"
    local staging_dir="${STAGING_BASE}/${domain}"
    install -d -m 700 "${staging_dir}"

    log "INFO" "---- 处理域名: *.${domain} ----"

    # 6a-pre. 本地证书有效期预检（剩余 > 7 天则跳过，避免频繁调用 Let's Encrypt）
    local renew_days="${RENEW_DAYS_BEFORE:-7}"
    # acme.sh 为通配符证书创建的目录名带星号前缀: *.domain_ecc 或 domain_ecc（RSA）
    # 必须用 glob 扫描，不能直接拼字符串路径
    local acme_cert=""
    local _f
    for _f in \
        "${ACME_HOME}/"*".${domain}_ecc/fullchain.cer" \
        "${ACME_HOME}/${domain}_ecc/fullchain.cer" \
        "${ACME_HOME}/${domain}/fullchain.cer"; do
        [[ -f "${_f}" ]] && { acme_cert="${_f}"; break; }
    done
    if [[ -n "${acme_cert}" ]]; then
        local expire_epoch now_epoch days_left
        expire_epoch=$(openssl x509 -noout -enddate -in "${acme_cert}" 2>/dev/null \
            | cut -d= -f2 | xargs -I{} date -d '{}' '+%s' 2>/dev/null || echo 0)
        now_epoch=$(date '+%s')
        days_left=$(( (expire_epoch - now_epoch) / 86400 ))
        if (( days_left > renew_days )); then
            log "INFO" "[${domain}] 证书剩余 ${days_left} 天 > ${renew_days} 天，跳过申请"
            return 2  # 2 = 跳过（未调用 LE，无需通知）
        fi
        log "INFO" "[${domain}] 证书剩余 ${days_left} 天 ≤ ${renew_days} 天，触发续签"
    else
        log "INFO" "[${domain}] 本地无证书缓存，首次申请"
    fi

    # 导出 Cloudflare 凭证（acme.sh 自动选择 CF_Token 或 CF_Key+CF_Email）
    [[ -n "${CF_Token:-}"  ]] && export CF_Token
    [[ -n "${CF_Key:-}"   ]] && export CF_Key
    [[ -n "${CF_Email:-}" ]] && export CF_Email
    local acme_bin="${ACME_HOME}/acme.sh"
    local acme_log="${staging_dir}/acme_issue.log"

    "${acme_bin}" \
        --issue \
        ${FORCE_REISSUE:+--force} \
        --dns dns_cf \
        -d "*.${domain}" \
        -d "${domain}" \
        --home "${ACME_HOME}" \
        --log "${acme_log}" \
        --log-level 2 \
        2>&1 | tee -a "${LOG_FILE}" || {
        local exit_code=$?
        if [[ ${exit_code} -eq 2 ]]; then
            log "INFO" "[${domain}] 证书未到期，跳过申请 (acme.sh exit 2)"
            # 仍继续提取+上传，确保 OpenList 有最新文件
        else
            log "ERROR" "[${domain}] acme.sh 申请失败 (exit ${exit_code})"
            local err_summary
            err_summary="$(tail -20 "${acme_log}" 2>/dev/null || echo '无法读取日志')"
            send_tg_msg "🚨 [ERROR] 证书申请失败: ${domain}" \
                "退出码: ${exit_code}\n日志摘要:\n${err_summary}"
            return 1
        fi
    }

    # 6b. 提取证书
    local key_file="${staging_dir}/privkey.pem"
    local chain_file="${staging_dir}/fullchain.pem"

    "${acme_bin}" \
        --install-cert \
        -d "*.${domain}" \
        --home "${ACME_HOME}" \
        --key-file   "${key_file}" \
        --fullchain-file "${chain_file}" 2>&1 | tee -a "${LOG_FILE}"

    if [[ ! -s "${key_file}" ]] || [[ ! -s "${chain_file}" ]]; then
        log "ERROR" "[${domain}] 证书文件提取失败或为空"
        send_tg_msg "🚨 [ERROR] 证书提取失败: ${domain}" "key 或 fullchain 文件为空"
        return 1
    fi
    chmod 600 "${key_file}"; chmod 644 "${chain_file}"

    # 6c. 私钥与证书一致性校验（兼容 RSA 和 ECC/ECDSA）
    # 注意: openssl pkey 不加 -noout，否则 -noout 会抑制 -pubout 的输出
    local key_pub cert_pub
    key_pub="$(openssl pkey -pubout -in "${key_file}"    2>/dev/null | sha256sum | awk '{print $1}')"
    cert_pub="$(openssl x509 -pubkey -noout -in "${chain_file}" 2>/dev/null | sha256sum | awk '{print $1}')"
    if [[ -z "${key_pub}" ]] || [[ "${key_pub}" != "${cert_pub}" ]]; then
        log "ERROR" "[${domain}] 私钥与证书公钥不匹配，禁止上传 (key=${key_pub:0:12}... cert=${cert_pub:0:12}...)"
        send_tg_msg "🚨 [ERROR] 证书一致性校验失败: ${domain}" "私钥与证书公钥不匹配，已中止上传"
        return 1
    fi
    log "INFO" "[${domain}] ✅ 私钥与证书一致性校验通过"

    local cert_expiry
    cert_expiry="$(openssl x509 -noout -enddate -in "${chain_file}" | cut -d= -f2)"

    # 6d. 计算 SHA256（对 fullchain.pem 计算）
    local sha256_file="${staging_dir}/cert.sha256"
    sha256sum "${chain_file}" | awk '{print $1}' > "${sha256_file}"
    log "INFO" "[${domain}] SHA256: $(cat "${sha256_file}")"

    # 6e. 确保 WebDAV 子目录存在，再上传（sha256 最后，防竞态）
    ensure_webdav_dir "${domain}"
    local upload_failed=0
    push_to_openlist "${key_file}"    "${domain}/${domain}.key"    || upload_failed=1
    push_to_openlist "${chain_file}"  "${domain}/${domain}.cer"    || upload_failed=1
    push_to_openlist "${sha256_file}" "${domain}/${domain}.sha256" || upload_failed=1

    if [[ ${upload_failed} -eq 1 ]]; then
        log "ERROR" "[${domain}] 部分文件上传失败"
        send_tg_msg "🚨 [ERROR] 上传失败: ${domain}" "WebDAV: ${WEBDAV_URL}/${domain}/"
        return 1
    fi

    # 6f. 安全擦除暂存文件
    find "${staging_dir}" -type f -exec shred -u {} \; 2>/dev/null || \
        rm -f "${staging_dir}"/*.pem "${staging_dir}"/*.sha256 2>/dev/null || true

    # 6g. 成功通知
    send_tg_msg "✅ [SUCCESS] 证书同步: ${domain}" \
        "到期: ${cert_expiry}
SHA256: $(cat "${sha256_file}" 2>/dev/null || echo N/A)
上传: ${WEBDAV_URL}/${domain}/
时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"

    log "INFO" "[${domain}] ---- 处理完成 ----"
    return 0
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
    install -m 640 /dev/null "${LOG_FILE}" 2>/dev/null || true
    pre_check

    local updated_domains=()
    local skipped_domains=()
    local failed_domains=()

    for domain in "${DOMAINS[@]}"; do
        local rc=0
        process_domain "${domain}" || rc=$?
        case ${rc} in
            0) updated_domains+=("${domain}") ;;
            2) skipped_domains+=("${domain}")  ;;
            *) failed_domains+=("${domain}")   ;;
        esac
    done

    log "INFO" "======== 任务结束: 更新 ${#updated_domains[@]} 跳过 ${#skipped_domains[@]} 失败 ${#failed_domains[@]} ========"

    # 仅在有更新或失败时发 TG，全部跳过则静默退出
    if [[ ${#updated_domains[@]} -gt 0 || ${#failed_domains[@]} -gt 0 ]]; then
        local summary="更新: ${#updated_domains[@]} | 跳过: ${#skipped_domains[@]} | 失败: ${#failed_domains[@]}"
        [[ ${#updated_domains[@]} -gt 0 ]] && \
            summary+="\n\n已续签:\n$(printf '  • %s\n' "${updated_domains[@]}")"
        [[ ${#failed_domains[@]} -gt 0 ]] && \
            summary+="\n\n失败:\n$(printf '  • %s\n' "${failed_domains[@]}")"
        local icon="✅"; [[ ${#failed_domains[@]} -gt 0 ]] && icon="⚠️"
        send_tg_msg "${icon} [SUMMARY] 证书同步汇总" "${summary}"
    else
        log "INFO" "所有域名证书均在有效期内，无需续签，不发送 TG 通知"
    fi

    # 若有失败域名，以非零退出让 systemd 记录错误
    [[ ${#failed_domains[@]} -eq 0 ]] || exit 1
}

trap 'log "ERROR" "脚本意外退出 (line ${LINENO})"; \
      send_tg_msg "🚨 [FATAL] cert-master-sync 意外退出" "行号: ${LINENO}"' ERR

main "$@"
