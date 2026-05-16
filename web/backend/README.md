# SSL Sync Master Backend

`web/backend` 是 Master Web 控制台的后端，基于 FastAPI + SQLite。

## 当前后端能力

- JWT 登录认证
- 域名、DNS 渠道、节点、任务、事件、分配关系持久化
- 真实执行链路：
  - DNS 渠道测试
  - WebDAV 测试
  - Telegram 测试
  - 域名申请 / 续签 / 同步
- Node API 模式：
  - 心跳
  - assignments 下发
  - command queue 轮询
  - 执行结果 ACK / report
- 配置备份导出与恢复

## 本地启动

```bash
cd web/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

默认文档地址：

- `/api/docs`
- `/api/redoc`

## 默认登录

- Username: `admin`
- Password: `admin`

生产环境请通过环境变量覆盖。

## 关键环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SSL_SYNC_DATA_DIR` | `web/backend/.data` | SQLite 数据目录 |
| `SSL_SYNC_DB_PATH` | `$SSL_SYNC_DATA_DIR/ssl-sync.db` | SQLite 文件路径 |
| `SSL_SYNC_LOG_DIR` | `web/backend/.logs` | 日志目录 |
| `SSL_SYNC_FRONTEND_DIST` | `web/frontend/dist` | 前端构建产物目录 |
| `SSL_SYNC_SECRET_KEY` | `change-me-before-production` | JWT / token 签名密钥 |
| `SSL_SYNC_ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `SSL_SYNC_ADMIN_PASSWORD` | `admin` | 管理员密码 |
| `SSL_SYNC_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 本地开发 CORS |
| `SSL_SYNC_MASTER_SCRIPT` | `/usr/local/bin/cert-master-sync.sh` | Master 脚本路径 |
| `SSL_SYNC_RUNTIME_CONFIG_DIR` | `/etc/ssl-cert-sync` | 运行时域名配置目录 |
| `SSL_SYNC_RUNTIME_TMP_DIR` | `/tmp/ssl-sync-runtime` | 临时目录 |
| `SSL_SYNC_BUNDLED_ACME_HOME` | `/opt/acme.sh` | 内置 acme.sh 目录 |

## Node 相关接口

Node 轮询模式接口如下：

- `POST /api/node/v1/heartbeat`
- `GET /api/node/v1/assignments`
- `GET /api/node/v1/commands`
- `POST /api/node/v1/reports`
- `POST /api/node/v1/commands/{command_id}/ack`

Web 控制台通过后台接口向节点排队命令：

- `POST /api/admin/nodes/{node_id}/run-now`
- `POST /api/admin/nodes/{node_id}/deploy`
- `POST /api/admin/nodes/{node_id}/delete-certs`

## 说明

- 后端镜像会在构建时克隆官方 `acme.sh` 到 `/opt/acme.sh`
- 如果运行时 `ACME Home` 目录为空，系统会自动补齐
- Node API 模式下，节点执行摘要会回传给 Master，由 Master 统一写任务日志并推送 Telegram
