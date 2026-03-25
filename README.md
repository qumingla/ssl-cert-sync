# SSL 证书跨服务器自动申请分发系统
vibe coding产自用仓库
基于 acme.sh + OpenList(WebDAV) + Systemd 的 SSL 证书自动化管理方案，支持多域名、多节点，全程 Telegram 实时通知。


## 🏗 架构

```
Master VPS                          OpenList (WebDAV)              Node VPS × N
──────────────                      ─────────────────              ────────────
acme.sh (DNS API)                   /ssl/example.com/              systemd timer
  └→ 申请/续期证书         push →   ├── example.com.key      pull ← cert-node-pull.sh
  └→ 双重校验                       ├── example.com.cer             └→ SHA256 校验
  └→ 计算 SHA256           push →   └── example.com.sha256          └→ RSA/ECC 校验
cert-master-sync.sh                                                 └→ 原子部署
  └→ 判定有效期 (>7天则跳过)                                        └→ nginx reload
  └→ TG 汇总通知                                                    └→ TG 汇总通知
```

## 📁 文件说明

| 文件 | 部署路径 | 角色 |
|------|---------|------|
| `etc_default_acme-master.conf` | `/etc/default/acme-master` | Master 配置模板 |
| `cert-master-sync.sh` | `/usr/local/bin/cert-master-sync.sh` | Master 核心脚本 |
| `etc_default_cert-node.conf` | `/etc/default/cert-node` | Node 配置模板 |
| `cert-node-pull.sh` | `/usr/local/bin/cert-node-pull.sh` | Node 核心脚本 |
| `cert-puller.service` | `/etc/systemd/system/cert-puller.service` | Node Systemd 服务 |
| `cert-puller.timer` | `/etc/systemd/system/cert-puller.timer` | Node 定时触发器 |
| `install.sh` | 任意目录运行 | 一键安装/卸载脚本 |

## 🚀 快速部署

### 前置条件

- Debian 12（其他 systemd 发行版同理）
- Master: 已安装 [acme.sh](https://github.com/acmesh-official/acme.sh)，域名托管在 Cloudflare
- OpenList 实例，已开启 WebDAV
- Telegram Bot Token 和 Chat ID

### Master 端

```bash
# 1. 安装 acme.sh（跳过已安装的）
curl https://get.acme.sh | sh -s email=your@email.com

# 2. 切换默认 CA 为 Let's Encrypt（推荐）
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt

# 3. 克隆本仓库并安装（推荐使用交互式向导）
git clone https://github.com/yourname/ssl-cert-sync && cd ssl-cert-sync
bash install.sh
# （在菜单中选择 "1) 安装 Master 端"）

# 4. 填写配置
nano /etc/default/acme-master
# → CF_Token / CF_Key+CF_Email（二选一）
# → TG_BOT_TOKEN, TG_CHAT_ID
# → WEBDAV_URL, WEBDAV_AUTH（末尾不带斜杠）
# → DOMAINS=("example.com" "another.org" ...)
# → RENEW_DAYS_BEFORE=7（可选，证书剩余天数 ≤ 该值时才续签，防限流）

# 5. 首次手动运行
bash /usr/local/bin/cert-master-sync.sh

# 6. 设置定时（每天凌晨 2:30）
# 参考 README 定时配置部分
```

### Node 端（每台 VPS 重复此步骤）

```bash
# 1. 安装
cd ssl-cert-sync
bash install.sh
# （在菜单中选择 "2) 安装 Node 端"）

# 2. 填写配置
nano /etc/default/cert-node
# → DOMAINS=()（与 Master 一致）
# → WEBDAV_URL, WEBDAV_AUTH（只读账户）
# → TG_BOT_TOKEN, TG_CHAT_ID
# → CERT_BASE_DIR（末尾不带斜杠，如 /etc/nginx/ssl）
# → SERVICE_TEST_CMD / SERVICE_RELOAD_CMD

# 3. 立即测试
systemctl start cert-puller.service
journalctl -u cert-puller -f
```

### Nginx 证书路径配置

证书按域名命名并存放在子目录下：

```nginx
ssl_certificate     /etc/nginx/ssl/example.com/example.com.cer;
ssl_certificate_key /etc/nginx/ssl/example.com/example.com.key;
```

### 卸载系统

如果需要卸载系统，可重新运行脚本：

```bash
bash install.sh
# （在菜单中选择 3 或 4 进行卸载）

# 或者直接使用命令行：
bash install.sh uninstall master
bash install.sh uninstall node
```

---

## ⏰ 定时配置（Master）

```bash
# 方式 A: Cron（每天 2:30）
crontab -e
# 加入: 30 2 * * * /usr/local/bin/cert-master-sync.sh >> /var/log/cert-master-sync.log 2>&1

# 方式 B: Systemd Timer（推荐）
cat > /etc/systemd/system/cert-master-sync.service << 'EOF'
[Unit]
Description=SSL Cert Master Sync
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=-/etc/default/acme-master
ExecStart=/usr/local/bin/cert-master-sync.sh
SyslogIdentifier=cert-master-sync
EOF

cat > /etc/systemd/system/cert-master-sync.timer << 'EOF'
[Unit]
Description=SSL Cert Master Sync Timer
[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=10min
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload && systemctl enable --now cert-master-sync.timer
```

Node 端 Timer 由 `install.sh node` 自动安装启用（`cert-puller.timer`，每 24h + 随机 0~30min 偏移）。

---

## 🔐 安全特性

| 特性 | 实现方式 |
|------|---------|
| 密钥不泄露于进程列表 | `EnvironmentFile=-/etc/default/...` |
| 私钥权限 | `install -m 600` |
| 证书目录权限 | `chmod 700 ${CERT_BASE_DIR}` |
| 配置文件权限 | `chmod 600 /etc/default/...` |
| 临时文件安全擦除 | `shred -u` |
| 私有临时目录 | systemd `PrivateTmp=yes` |
| 写权限最小化 | systemd `ReadWritePaths` 白名单（含 `/run` 以支持 `nginx -t`） |
| 双重证书校验 | SHA256 完整性 + 公钥一致性（RSA/ECC 通用） |
| 自动回滚 | `nginx -t` 失败时恢复最新备份 |

---

## 🔧 常用命令

```bash
# Node: 查看服务日志
journalctl -u cert-puller -n 50 --no-pager

# Node: 查看 Timer 下次执行时间
systemctl list-timers cert-puller.timer

# Node: 手动触发拉取
systemctl start cert-puller.service

# Master: 查看日志
tail -n 50 /var/log/cert-master-sync.log

# 检查证书到期时间
openssl x509 -noout -enddate -in /etc/nginx/ssl/example.com/example.com.cer

# 切换 CA 后强制重新申请（临时）
# 在 /etc/default/acme-master 末尾加: FORCE_REISSUE="1"
# 完成后注释掉
```

---

## ⚠️ 注意事项

> [!IMPORTANT]
> **WEBDAV_URL** 和 **CERT_BASE_DIR** 末尾**不要带斜杠**，否则路径会出现双斜杠错误。

> [!IMPORTANT]
> Master 端会自动读取本地证书有效期，若**剩余时间 > 7 天**则完全跳过该域名（不调用 API），有效防止 Let's Encrypt 频率限制 (429 Rate Limited)。

> [!IMPORTANT]
> `<domain>.sha256` 最后上传，确保 Node 读到新 hash 时证书文件已就绪（防竞态）。

> [!TIP]
> Node 服务重载**仅在至少一个域名证书更新后**才执行，且只执行一次。无更新时完全静默退出，零 nginx 抖动。

> [!WARNING]
> Node 端 WebDAV 账户建议设置为**只读**权限，Master 端账户才需要写权限。

> [!NOTE]
> 证书校验使用 `openssl pkey -pubout` 提取公钥比对，兼容 RSA 和 ECC/ECDSA（acme.sh 默认 ECC）。
