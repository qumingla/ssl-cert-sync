#!/usr/bin/env bash
################################################################################
# install.sh
# SSL 证书自动分发系统 - 一键安装脚本
# 用法:
#   Master 端: bash install.sh master
#   Node  端:  bash install.sh node
################################################################################

set -euo pipefail

ROLE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

if [[ ${EUID} -ne 0 ]]; then
    error "请以 root 权限运行此脚本"
    exit 1
fi

if [[ "${ROLE}" != "master" && "${ROLE}" != "node" ]]; then
    echo "用法: $0 <master|node>"
    exit 1
fi

info "==== 安装角色: ${ROLE} ===="

# ── 安装依赖 ──────────────────────────────────────────────────────────────────
info "检查并安装依赖 (curl, openssl)..."
apt-get update -qq
apt-get install -y -qq curl openssl

# ── Master 安装 ───────────────────────────────────────────────────────────────
install_master() {
    # 脚本
    install -m 750 "${SCRIPT_DIR}/cert-master-sync.sh" /usr/local/bin/cert-master-sync.sh
    info "脚本已安装: /usr/local/bin/cert-master-sync.sh"

    # 配置文件（始终覆盖；如旧文件存在则先备份）
    if [[ -f /etc/default/acme-master ]]; then
        cp /etc/default/acme-master "/etc/default/acme-master.bak.$(date '+%Y%m%d_%H%M%S')"
        warn "旧配置已备份，现在覆盖..."
    fi
    install -m 600 "${SCRIPT_DIR}/etc_default_acme-master.conf" /etc/default/acme-master
    warn "请编辑配置文件填写真实凭证: /etc/default/acme-master"

    # 日志文件
    install -m 640 /dev/null /var/log/cert-master-sync.log
    info "日志文件: /var/log/cert-master-sync.log"

    # 安装 acme.sh 提示
    if [[ ! -f /root/.acme.sh/acme.sh ]]; then
        warn "acme.sh 未检测到，请手动安装:"
        warn "  curl https://get.acme.sh | sh -s email=your@email.com"
    fi

    info "✅ Master 安装完成"
    info "下一步: 编辑 /etc/default/acme-master，然后运行:"
    info "  bash /usr/local/bin/cert-master-sync.sh"
}

# ── Node 安装 ─────────────────────────────────────────────────────────────────
install_node() {
    # 脚本
    install -m 750 "${SCRIPT_DIR}/cert-node-pull.sh" /usr/local/bin/cert-node-pull.sh
    info "脚本已安装: /usr/local/bin/cert-node-pull.sh"

    # 配置文件（始终覆盖；如旧文件存在则先备份）
    if [[ -f /etc/default/cert-node ]]; then
        cp /etc/default/cert-node "/etc/default/cert-node.bak.$(date '+%Y%m%d_%H%M%S')"
        warn "旧配置已备份，现在覆盖..."
    fi
    install -m 600 "${SCRIPT_DIR}/etc_default_cert-node.conf" /etc/default/cert-node
    warn "请编辑配置文件填写真实凭证: /etc/default/cert-node"

    # 从已安装的配置中读取 CERT_BASE_DIR 并自动创建（去除末尾斜杠）
    local cert_base
    cert_base="$(bash -c 'source /etc/default/cert-node 2>/dev/null; printf "%s" "${CERT_BASE_DIR:-/etc/ssl/certs/acme}"')"
    cert_base="${cert_base%/}"
    mkdir -p "${cert_base}"
    chmod 700 "${cert_base}"
    info "证书目录: ${cert_base} (700)"

    # 日志文件
    install -m 640 /dev/null /var/log/cert-node-pull.log
    info "日志文件: /var/log/cert-node-pull.log"

    # Systemd units
    install -m 644 "${SCRIPT_DIR}/cert-puller.service" /etc/systemd/system/cert-puller.service
    install -m 644 "${SCRIPT_DIR}/cert-puller.timer"   /etc/systemd/system/cert-puller.timer
    info "Systemd units 已安装"

    systemctl daemon-reload
    systemctl enable --now cert-puller.timer
    info "cert-puller.timer 已启用并启动"

    systemctl list-timers cert-puller.timer --no-pager

    info "✅ Node 安装完成"
    info "下一步: 编辑 /etc/default/cert-node，然后运行:"
    info "  systemctl start cert-puller.service  # 立即测试"
    info "  journalctl -u cert-puller -f          # 查看日志"
}

case "${ROLE}" in
    master) install_master ;;
    node)   install_node   ;;
esac
