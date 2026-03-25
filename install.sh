#!/usr/bin/env bash
################################################################################
# install.sh
# SSL 证书自动分发系统 - 一键安装/卸载脚本
# 用法:
#   交互式: bash install.sh               （推荐）
#   安装:   bash install.sh <master|node>
#   卸载:   bash install.sh uninstall <master|node>
################################################################################

set -euo pipefail

ACTION="${1:-}"
ROLE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}${BOLD}$*${NC}"; }

if [[ ${EUID} -ne 0 ]]; then
    error "请以 root 权限运行此脚本"
    exit 1
fi

# 兼容旧的单参数用法 (bash install.sh master|node)
if [[ "${ACTION}" == "master" || "${ACTION}" == "node" ]]; then
    ROLE="${ACTION}"; ACTION="install"
fi

# ── 交互式菜单（无参数时显示）────────────────────────────────────────────────
if [[ -z "${ACTION}" ]]; then
    echo -e "\n${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║   SSL 证书自动分发系统 - 安装/卸载向导   ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}\n"
    echo -e "  ${GREEN}1)${NC} 安装 Master 端（申请证书 + 上传 WebDAV）"
    echo -e "  ${GREEN}2)${NC} 安装 Node   端（拉取证书 + 自动重载 Nginx）"
    echo -e "  ${RED}3)${NC} 卸载 Master 端"
    echo -e "  ${RED}4)${NC} 卸载 Node   端"
    echo -e "  ${YELLOW}5)${NC} 退出\n"
    read -r -p "请输入选项 [1-5]: " choice
    case "${choice}" in
        1) ACTION="install";   ROLE="master" ;;
        2) ACTION="install";   ROLE="node"   ;;
        3) ACTION="uninstall"; ROLE="master" ;;
        4) ACTION="uninstall"; ROLE="node"   ;;
        5) echo "已退出。"; exit 0 ;;
        *) error "无效选项: ${choice}"; exit 1 ;;
    esac
    echo ""
fi

if [[ "${ACTION}" != "install" && "${ACTION}" != "uninstall" ]] || \
   [[ "${ROLE}"   != "master"  && "${ROLE}"   != "node"     ]]; then
    echo -e "用法:"
    echo -e "  交互式: $0"
    echo -e "  安装:   $0 <master|node>"
    echo -e "  卸载:   $0 uninstall <master|node>"
    exit 1
fi

info "==== ${ACTION^^} 角色: ${ROLE} ===="

# ── 安装依赖（仅安装时执行）─────────────────────────────────────────────────
if [[ "${ACTION}" == "install" ]]; then
    info "检查并安装依赖 (curl, openssl)..."
    apt-get update -qq
    apt-get install -y -qq curl openssl
fi

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

# ── Master 卸载 ───────────────────────────────────────────────────────────────
uninstall_master() {
    warn "即将卸载 Master 端组件..."

    # 停止并移除 systemd 服务（master 一般无 timer，但保险起见）
    for unit in cert-master-sync.service cert-master-sync.timer; do
        if systemctl list-unit-files "${unit}" &>/dev/null; then
            systemctl disable --now "${unit}" 2>/dev/null || true
            rm -f "/etc/systemd/system/${unit}"
            info "已移除: /etc/systemd/system/${unit}"
        fi
    done
    systemctl daemon-reload

    # 脚本
    rm -f /usr/local/bin/cert-master-sync.sh
    info "已移除: /usr/local/bin/cert-master-sync.sh"

    # 配置文件（保留备份，仅删除主配置）
    if [[ -f /etc/default/acme-master ]]; then
        rm -f /etc/default/acme-master
        info "已移除: /etc/default/acme-master"
    fi

    # 日志
    rm -f /var/log/cert-master-sync.log
    info "已移除: /var/log/cert-master-sync.log"

    success "✅ Master 端卸载完成"
    warn "acme.sh 本体及证书文件未删除，如需清理请手动执行:"
    warn "  ~/.acme.sh/acme.sh --uninstall"
}

# ── Node 卸载 ─────────────────────────────────────────────────────────────────
uninstall_node() {
    warn "即将卸载 Node 端组件..."

    # 停止并禁用 systemd timer / service
    for unit in cert-puller.timer cert-puller.service; do
        if systemctl list-unit-files "${unit}" &>/dev/null; then
            systemctl disable --now "${unit}" 2>/dev/null || true
            rm -f "/etc/systemd/system/${unit}"
            info "已移除: /etc/systemd/system/${unit}"
        fi
    done
    systemctl daemon-reload

    # 脚本
    rm -f /usr/local/bin/cert-node-pull.sh
    info "已移除: /usr/local/bin/cert-node-pull.sh"

    # 配置文件
    if [[ -f /etc/default/cert-node ]]; then
        rm -f /etc/default/cert-node
        info "已移除: /etc/default/cert-node"
    fi

    # 日志
    rm -f /var/log/cert-node-pull.log
    info "已移除: /var/log/cert-node-pull.log"

    # 可选：询问是否删除已部署的证书目录
    local cert_base="/etc/ssl/certs/acme"
    if [[ -d "${cert_base}" ]]; then
        warn "证书目录 ${cert_base} 仍然存在"
        read -r -p "是否删除证书目录 ${cert_base}? [y/N] " confirm
        if [[ "${confirm,,}" == "y" ]]; then
            find "${cert_base}" -type f -exec shred -u {} \; 2>/dev/null || true
            rm -rf "${cert_base}"
            info "已安全擦除并删除: ${cert_base}"
        else
            warn "已跳过，证书文件保留在 ${cert_base}"
        fi
    fi

    success "✅ Node 端卸载完成"
}

# ── 分发 ─────────────────────────────────────────────────────────────────────
case "${ACTION}" in
    install)
        case "${ROLE}" in
            master) install_master ;;
            node)   install_node   ;;
        esac
        ;;
    uninstall)
        case "${ROLE}" in
            master) uninstall_master ;;
            node)   uninstall_node   ;;
        esac
        ;;
esac
