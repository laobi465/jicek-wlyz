#!/usr/bin/env bash
# ============================================================================
# 网络验证 SaaS 系统 - SSH 一键安装脚本
# 脚本托管地址：https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh
# 使用方式：bash <(curl -sSL https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh)
# 适用系统：Debian 11 / Debian 12
# ============================================================================

set -e

# ---------- 全局配置 ----------
DEPLOY_DIR="/opt/jicek-wlyz"                       # 部署目录
DEPLOY_INFO_FILE="/root/jicek-wlyz-deploy.txt"     # 部署信息保存位置
COMPOSE_URL="https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/docker-compose.yml"
APP_IMAGE_DEFAULT="ghcr.io/laobi465/jicek-wlyz:latest"
SCRIPT_URL="https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh"

# ---------- 颜色输出 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[信息]${NC} $1"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $1"; }
error() { echo -e "${RED}[错误]${NC} $1" >&2; }

# ---------- 1. 检测操作系统（必须是 Debian 11/12）----------
detect_os() {
    info "检测操作系统..."
    if [ ! -f /etc/os-release ]; then
        error "无法检测操作系统，仅支持 Debian 11/12"
        exit 1
    fi
    . /etc/os-release
    if [ "$ID" != "debian" ]; then
        error "当前系统为 ${ID}，仅支持 Debian 11/12"
        exit 1
    fi
    case "$VERSION_ID" in
        11|12) ;;
        *)
            error "Debian 版本 ${VERSION_ID} 不受支持，仅支持 11/12"
            exit 1
            ;;
    esac
    info "检测到系统：${PRETTY_NAME}"
}

# ---------- 2. 检测并安装宝塔面板 ----------
ensure_bt() {
    info "检测宝塔面板..."
    if command -v bt >/dev/null 2>&1; then
        info "宝塔面板已安装"
        return 0
    fi
    warn "未检测到宝塔面板，开始安装（官方 LTS 安装脚本）..."
    cd /tmp
    curl -sSO https://download.bt.cn/install/install_lts.sh
    bash install_lts.sh ed8484bec
    rm -f install_lts.sh
    info "宝塔面板安装完成"
}

# ---------- 3. 检测并安装 Docker ----------
ensure_docker() {
    info "检测 Docker..."
    if command -v docker >/dev/null 2>&1; then
        info "Docker 已安装（$(docker --version)）"
    else
        warn "未检测到 Docker，通过官方脚本安装..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        info "Docker 安装完成"
    fi
    # 确保 docker compose 插件可用
    if ! docker compose version >/dev/null 2>&1; then
        warn "未检测到 docker compose 插件，安装中..."
        apt-get update
        apt-get install -y docker-compose-plugin
    fi
    info "docker compose 可用（$(docker compose version --short 2>/dev/null || echo unknown)）"
}

# ---------- 4. 端口冲突检测函数 ----------
# 使用 ss -tuln 检测端口占用，若被占用则自动 +1
find_free_port() {
    local port="$1"
    while true; do
        # 提取监听套接字的本地地址列，判断是否以 :port 结尾
        if ss -tuln | awk '{print $5}' | grep -qE ":${port}\$"; then
            port=$((port + 1))
        else
            echo "$port"
            return 0
        fi
    done
}

# ---------- 5. 计算各服务端口 ----------
compute_ports() {
    info "检测可用端口..."
    # 宝塔面板端口：若已安装则读取实际端口，否则从 8888 起寻找空闲端口
    if [ -f /www/server/panel/data/port.pl ]; then
        BT_PORT="$(cat /www/server/panel/data/port.pl | tr -d '[:space:]')"
    else
        BT_PORT="$(find_free_port 8888)"
    fi
    APP_PORT="$(find_free_port 3000)"
    DB_PORT="$(find_free_port 5432)"
    REDIS_PORT="$(find_free_port 6379)"
    info "端口分配 -> 宝塔:${BT_PORT}  应用:${APP_PORT}  数据库:${DB_PORT}  Redis:${REDIS_PORT}"
}

# ---------- 6. 生成密钥与 .env ----------
generate_env() {
    info "生成密钥与配置文件..."
    # 密码用 openssl rand -hex 16，认证密钥用 openssl rand -hex 32
    DB_PASSWORD="$(openssl rand -hex 16)"
    REDIS_PASSWORD="$(openssl rand -hex 16)"
    BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
    FIELD_ENCRYPTION_KEY="$(openssl rand -hex 32)"
    DB_NAME="jicek_wlyz"
    APP_IMAGE="${APP_IMAGE_DEFAULT}"
    # 应用外部访问地址（用户部署后可在 .env 中改为实际域名）
    BETTER_AUTH_URL="http://localhost:${APP_PORT}"

    mkdir -p "${DEPLOY_DIR}"
    cat > "${DEPLOY_DIR}/.env" <<EOF
# ===== 网络验证系统环境变量（由安装脚本自动生成，请勿泄露）=====
# 应用镜像
APP_IMAGE=${APP_IMAGE}
# 应用端口
APP_PORT=${APP_PORT}
# 数据库配置
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_PASSWORD=${DB_PASSWORD}
# Redis 配置
REDIS_PORT=${REDIS_PORT}
REDIS_PASSWORD=${REDIS_PASSWORD}
# Better Auth 鉴权（auth.ts 读取）
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
# 敏感字段加密密钥（crypto-field.ts 读取）
FIELD_ENCRYPTION_KEY=${FIELD_ENCRYPTION_KEY}
# 宝塔面板端口（仅记录用）
BT_PORT=${BT_PORT}
EOF
    chmod 600 "${DEPLOY_DIR}/.env"
    info ".env 已生成：${DEPLOY_DIR}/.env"
}

# ---------- 7. 下载 docker-compose.yml ----------
download_compose() {
    info "下载 docker-compose.yml..."
    curl -fsSL "${COMPOSE_URL}" -o "${DEPLOY_DIR}/docker-compose.yml"
    info "docker-compose.yml 已下载至 ${DEPLOY_DIR}/docker-compose.yml"
}

# ---------- 8. 拉取镜像并启动 ----------
start_services() {
    cd "${DEPLOY_DIR}"

    # 尝试拉取远程镜像（CI 构建推送的）
    info "尝试拉取远程镜像..."
    if docker compose pull app 2>/dev/null; then
        info "远程镜像拉取成功，启动服务..."
        # 拉取其他服务镜像（db/redis/apk-injector）
        docker compose pull
        docker compose up -d
        return 0
    fi

    # 远程镜像不可用 → 回退到本地构建模式
    warn "远程镜像不可用（可能 CI 尚未构建），切换到本地构建模式..."
    if [ ! -f "${DEPLOY_DIR}/Dockerfile" ]; then
        info "克隆源码仓库用于本地构建..."
        git clone --depth 1 https://github.com/laobi465/jicek-wlyz.git /tmp/jicek-wlyz-build 2>/dev/null
        if [ ! -f /tmp/jicek-wlyz-build/Dockerfile ]; then
            error "源码克隆失败，请检查网络或手动 clone 仓库后执行 docker compose up -d --build"
            exit 1
        fi
        # 仅复制 Docker 构建所需的文件（保持部署目录整洁）
        cp /tmp/jicek-wlyz-build/Dockerfile "${DEPLOY_DIR}/"
        cp -r /tmp/jicek-wlyz-build/src "${DEPLOY_DIR}/"
        cp -r /tmp/jicek-wlyz-build/public "${DEPLOY_DIR}/"
        cp /tmp/jicek-wlyz-build/package.json "${DEPLOY_DIR}/"
        cp /tmp/jicek-wlyz-build/package-lock.json "${DEPLOY_DIR}/" 2>/dev/null || true
        cp -r /tmp/jicek-wlyz-build/prisma "${DEPLOY_DIR}/"
        cp /tmp/jicek-wlyz-build/next.config.ts "${DEPLOY_DIR}/"
        cp /tmp/jicek-wlyz-build/tsconfig.json "${DEPLOY_DIR}/"
        rm -rf /tmp/jicek-wlyz-build
        info "源码已就绪，开始本地构建..."
    fi

    # 本地构建并启动
    docker compose up -d --build
    if [ $? -ne 0 ]; then
        error "本地构建失败，请查看上方错误信息"
        exit 1
    fi
}

# ---------- 9. 等待健康检查通过 ----------
wait_for_healthy() {
    info "等待应用健康检查通过（最多 180 秒）..."
    info "提示：首次启动需先手动创建数据库表（docker compose exec app npx prisma db push），否则 init-admin 会失败"
    local deadline=$((SECONDS + 180))
    local healthy=0
    while [ "$SECONDS" -lt "$deadline" ]; do
        local cid
        cid="$(docker compose ps -q app 2>/dev/null || true)"
        if [ -n "$cid" ]; then
            local health
            health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid" 2>/dev/null || echo unknown)"
            if [ "$health" = "healthy" ]; then
                healthy=1
                break
            fi
            if [ "$health" = "no-healthcheck" ] || [ "$health" = "unknown" ]; then
                # 无健康检查时回退到 HTTP 探测
                if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
                    healthy=1
                    break
                fi
            fi
        fi
        sleep 5
    done
    if [ "$healthy" -ne 1 ]; then
        warn "应用在 180 秒内未通过健康检查，请查看日志：docker compose logs"
    else
        info "应用健康检查通过"
    fi
}

# ---------- 10. 获取公网 IP ----------
get_public_ip() {
    local ip
    ip="$(curl -sf --max-time 5 https://ifconfig.me 2>/dev/null || true)"
    if [ -z "$ip" ]; then
        ip="$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    fi
    if [ -z "$ip" ]; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    fi
    echo "${ip}"
}

# ---------- 11. 输出并保存部署信息 ----------
save_and_print_deploy_info() {
    local public_ip now
    public_ip="$(get_public_ip)"
    now="$(date '+%Y-%m-%d %H:%M:%S')"

    cat > "${DEPLOY_INFO_FILE}" <<EOF
============================================
  网络验证 SaaS 系统 - 部署信息
============================================
部署目录     : ${DEPLOY_DIR}
部署时间     : ${now}
--------------------------------------------
应用镜像     : ${APP_IMAGE}
应用端口     : ${APP_PORT}
数据库端口   : ${DB_PORT}
数据库名称   : ${DB_NAME}
数据库密码   : ${DB_PASSWORD}
Redis 端口   : ${REDIS_PORT}
Redis 密码   : ${REDIS_PASSWORD}
BETTER_AUTH_SECRET : ${BETTER_AUTH_SECRET}
宝塔面板端口 : ${BT_PORT}
--------------------------------------------
访问地址     : http://${public_ip}:${APP_PORT}
超管账号     : admin@example.com
超管密码     : admin123
宝塔面板     : http://${public_ip}:${BT_PORT}
============================================
⚠️ 默认密码较弱，请登录后立即在「安全」页面修改密码！
EOF
    chmod 600 "${DEPLOY_INFO_FILE}"

    echo
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}  部署完成！${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo -e "${GREEN}访问地址 :${NC} http://${public_ip}:${APP_PORT}"
    echo -e "${GREEN}超管账号 :${NC} admin@example.com"
    echo -e "${GREEN}超管密码 :${NC} admin123"
    echo -e "${GREEN}宝塔面板 :${NC} http://${public_ip}:${BT_PORT}"
    echo -e "${GREEN}部署信息 :${NC} 已保存至 ${DEPLOY_INFO_FILE}"
    echo -e "${GREEN}部署目录 :${NC} ${DEPLOY_DIR}"
    echo
    echo -e "${YELLOW}提示：${NC}默认密码较弱，请登录后立即修改！${DEPLOY_INFO_FILE} 包含数据库与 Redis 密码等敏感信息，请妥善保管。"
    echo
    echo -e "${YELLOW}脚本托管地址：${NC}${SCRIPT_URL}"
    echo
}

# ---------- 主流程 ----------
main() {
    echo -e "${CYAN}==============================${NC}"
    echo -e "${CYAN}  网络验证系统 一键安装${NC}"
    echo -e "${CYAN}==============================${NC}"
    detect_os
    ensure_bt
    ensure_docker
    compute_ports
    generate_env
    download_compose
    start_services
    wait_for_healthy
    save_and_print_deploy_info
}

main "$@"
