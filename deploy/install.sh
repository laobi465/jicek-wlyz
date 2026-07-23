#!/usr/bin/env bash
# ============================================================================
# 网络验证 SaaS 系统 - SSH 一键安装脚本
# 脚本托管地址：https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh
# 使用方式：bash <(curl -sSL https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh)
# 子命令  ：install.sh update | reinstall | uninstall | --help
# 适用系统：Debian 11 / Debian 12
# ============================================================================

set -euo pipefail

# ---------- 全局配置 ----------
DEPLOY_DIR="/opt/jicek-wlyz"                       # 部署目录
DEPLOY_INFO_FILE="/root/jicek-wlyz-deploy.txt"     # 部署信息保存位置
COMPOSE_URL="https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/docker-compose.yml"
APP_IMAGE_DEFAULT="ghcr.io/laobi465/jicek-wlyz:latest"
SCRIPT_URL="https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh"
REPO_URL="https://github.com/laobi465/jicek-wlyz.git"

# ---------- 颜色输出 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[信息]${NC} $1"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $1"; }
error() { echo -e "${RED}[错误]${NC} $1" >&2; }
step()  { echo -e "${CYAN}${BOLD}[$1]${NC} $2"; }

# 失败时自动打印容器最近日志，便于排查
dump_logs() {
    error "执行失败，自动打印最近日志（--tail=50）："
    cd "${DEPLOY_DIR}" 2>/dev/null || return 0
    docker compose logs --tail=50 2>/dev/null || true
}

# ============================================================================
# 通用工具函数
# ============================================================================

# 检测是否已安装（.env + docker-compose.yml 同时存在）
is_installed() {
    [ -f "${DEPLOY_DIR}/.env" ] && [ -f "${DEPLOY_DIR}/docker-compose.yml" ]
}

# 检测 app 容器是否正在运行
is_running() {
    [ -f "${DEPLOY_DIR}/docker-compose.yml" ] || return 1
    local cid
    cid="$(cd "${DEPLOY_DIR}" && docker compose ps -q app 2>/dev/null)" || cid=""
    [ -n "$cid" ] && docker inspect --format='{{.State.Running}}' "$cid" 2>/dev/null | grep -q true
}

# 端口冲突检测：若被占用则自动 +1，直到找到空闲端口
find_free_port() {
    local port="$1"
    while true; do
        if ss -tuln | awk '{print $5}' | grep -qE ":${port}\$"; then
            port=$((port + 1))
        else
            echo "$port"
            return 0
        fi
    done
}

# 获取公网 IP（依次尝试多个服务，回退到内网 IP）
get_public_ip() {
    local ip
    ip="$(curl -sf --max-time 5 https://ifconfig.me 2>/dev/null || true)"
    if [ -z "$ip" ]; then
        ip="$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    fi
    if [ -z "$ip" ]; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    fi
    echo "${ip:-127.0.0.1}"
}

# 等待 db 容器健康（最多 90 秒）
wait_for_db_healthy() {
    info "等待数据库就绪（最多 90 秒）..."
    local deadline=$((SECONDS + 90))
    while [ "$SECONDS" -lt "$deadline" ]; do
        local cid
        cid="$(docker compose ps -q db 2>/dev/null || true)"
        if [ -n "$cid" ]; then
            local health
            health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid" 2>/dev/null || echo unknown)"
            if [ "$health" = "healthy" ]; then
                info "数据库就绪"
                return 0
            fi
        fi
        sleep 3
    done
    error "数据库在 90 秒内未就绪"
    dump_logs
    exit 1
}

# 等待 app 容器健康（最多 180 秒，无 healthcheck 时回退 HTTP 探测）
wait_for_app_healthy() {
    info "等待应用健康检查通过（最多 180 秒）..."
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
                if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
                    healthy=1
                    break
                fi
            fi
        fi
        sleep 5
    done
    if [ "$healthy" -ne 1 ]; then
        error "应用在 180 秒内未通过健康检查"
        dump_logs
        return 1
    fi
    info "应用健康检查通过"
}

# 创建数据库表结构（用 migrate 专用镜像执行 prisma db push）
# 前置条件：db 容器已启动且健康；migrate 镜像已构建
# 为什么用 migrate 镜像而非 app 镜像：app 是 Next.js standalone 精简镜像，
# 缺 prisma CLI 的传递依赖（effect 等），npx prisma 会报 Cannot find module 'effect'
create_db_schema() {
    info "创建数据库表结构（prisma db push）..."
    # 用 migrate 专用镜像（含完整 node_modules）通过 --profile migrate 运行
    # 捕获完整输出到日志文件——docker compose logs 看不到 run --rm 已删除容器的输出
    local schema_log="/tmp/jicek-schema.log"
    if docker compose --profile migrate run --rm migrate \
        > "${schema_log}" 2>&1; then
        info "数据库表结构创建成功"
        tail -3 "${schema_log}"
    else
        local rc=$?
        error "数据库表结构创建失败（退出码 ${rc}），prisma 完整输出："
        echo "----------------------------------------"
        cat "${schema_log}"
        echo "----------------------------------------"
        echo
        echo "db/redis 容器最近日志："
        dump_logs
        exit 1
    fi
}

# ============================================================================
# 环境准备函数
# ============================================================================

# 1. 检测操作系统（必须是 Debian 11/12）
detect_os() {
    step "1" "检测操作系统..."
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

# 2. 检测并安装宝塔面板
ensure_bt() {
    step "2" "检测宝塔面板..."
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

# 3. 检测并安装 Docker
ensure_docker() {
    step "3" "检测 Docker..."
    if command -v docker >/dev/null 2>&1; then
        info "Docker 已安装（$(docker --version)）"
    else
        warn "未检测到 Docker，通过官方脚本安装..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        info "Docker 安装完成"
    fi
    if ! docker compose version >/dev/null 2>&1; then
        warn "未检测到 docker compose 插件，安装中..."
        apt-get update
        apt-get install -y docker-compose-plugin
    fi
    info "docker compose 可用（$(docker compose version --short 2>/dev/null || echo unknown)）"
}

# 4. 计算各服务端口
compute_ports() {
    step "4" "检测可用端口..."
    if [ -f /www/server/panel/data/port.pl ]; then
        BT_PORT="$(tr -d '[:space:]' < /www/server/panel/data/port.pl)"
    else
        BT_PORT="$(find_free_port 8888)"
    fi
    APP_PORT="$(find_free_port 3000)"
    DB_PORT="$(find_free_port 5432)"
    REDIS_PORT="$(find_free_port 6379)"
    info "端口分配 -> 宝塔:${BT_PORT}  应用:${APP_PORT}  数据库:${DB_PORT}  Redis:${REDIS_PORT}"
}

# 5. 生成密钥与 .env
generate_env() {
    step "5" "生成密钥与配置文件..."
    DB_PASSWORD="$(openssl rand -hex 16)"
    REDIS_PASSWORD="$(openssl rand -hex 16)"
    BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
    FIELD_ENCRYPTION_KEY="$(openssl rand -hex 32)"
    DB_NAME="jicek_wlyz"
    APP_IMAGE="${APP_IMAGE_DEFAULT}"
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

# 6. 下载 docker-compose.yml
download_compose() {
    step "6" "下载 docker-compose.yml..."
    curl -fsSL "${COMPOSE_URL}" -o "${DEPLOY_DIR}/docker-compose.yml"
    info "docker-compose.yml 已下载至 ${DEPLOY_DIR}/docker-compose.yml"
}

# 7. 准备镜像（远程拉取优先，失败回退本地构建）
prepare_image() {
    step "7" "准备应用镜像..."
    cd "${DEPLOY_DIR}"

    if docker compose pull app 2>/dev/null; then
        info "远程 app 镜像拉取成功"
        docker compose pull db redis apk-injector 2>/dev/null || true
        # migrate 镜像不在 registry，必须本地构建（含完整 node_modules 供 prisma CLI 用）
        info "构建 migrate 建表镜像（含完整依赖）..."
        docker compose --profile migrate build migrate || { error "migrate 镜像构建失败"; exit 1; }
        return 0
    fi

    # 远程镜像不可用 → 回退到本地构建模式
    warn "远程镜像不可用（可能 CI 尚未构建），切换到本地构建模式..."
    prepare_local_build_source
    info "开始本地构建 app + migrate 镜像..."
    if ! docker compose build app; then
        error "app 镜像本地构建失败"
        exit 1
    fi
    if ! docker compose --profile migrate build migrate; then
        error "migrate 镜像本地构建失败"
        exit 1
    fi
    info "镜像构建完成"
}

# 准备本地构建所需源码（仅复制 Docker 构建相关文件）
prepare_local_build_source() {
    if [ -f "${DEPLOY_DIR}/Dockerfile" ]; then
        info "源码已就绪（Dockerfile 已存在）"
        return 0
    fi
    info "克隆源码仓库用于本地构建..."
    rm -rf /tmp/jicek-wlyz-build
    git clone --depth 1 "${REPO_URL}" /tmp/jicek-wlyz-build 2>/dev/null || true
    if [ ! -f /tmp/jicek-wlyz-build/Dockerfile ]; then
        error "源码克隆失败，请检查网络或手动 clone 仓库后执行 docker compose up -d --build"
        exit 1
    fi
    cp /tmp/jicek-wlyz-build/Dockerfile "${DEPLOY_DIR}/"
    cp -r /tmp/jicek-wlyz-build/src "${DEPLOY_DIR}/"
    cp -r /tmp/jicek-wlyz-build/public "${DEPLOY_DIR}/"
    cp /tmp/jicek-wlyz-build/package.json "${DEPLOY_DIR}/"
    cp /tmp/jicek-wlyz-build/package-lock.json "${DEPLOY_DIR}/" 2>/dev/null || true
    cp -r /tmp/jicek-wlyz-build/prisma "${DEPLOY_DIR}/"
    cp -r /tmp/jicek-wlyz-build/scripts "${DEPLOY_DIR}/" 2>/dev/null || true
    cp /tmp/jicek-wlyz-build/next.config.ts "${DEPLOY_DIR}/"
    cp /tmp/jicek-wlyz-build/tsconfig.json "${DEPLOY_DIR}/"
    rm -rf /tmp/jicek-wlyz-build
}

# 8. 启动服务（分步：数据层 → 建表 → 应用层）
start_services() {
    step "8" "启动服务..."

    # 8.1 先启动数据层
    info "启动数据库与 Redis..."
    docker compose up -d db redis

    # 8.2 等待数据库就绪
    wait_for_db_healthy

    # 8.3 创建数据库表结构（自动建表，恢复一键体验）
    create_db_schema

    # 8.4 启动应用层（表已存在，init-admin 会成功创建默认超管）
    info "启动应用与 APK 注入容器..."
    docker compose up -d app apk-injector
}

# 9. 输出并保存部署信息
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
    echo -e "${YELLOW}常用命令：${NC}"
    echo -e "  更新系统 : bash <(curl -sSL ${SCRIPT_URL}) update"
    echo -e "  卸载系统 : bash <(curl -sSL ${SCRIPT_URL}) uninstall"
    echo -e "  重装系统 : bash <(curl -sSL ${SCRIPT_URL}) reinstall"
    echo -e "  查看日志 : cd ${DEPLOY_DIR} && docker compose logs -f app"
    echo
    echo -e "${YELLOW}脚本托管地址：${NC}${SCRIPT_URL}"
    echo
}

# ============================================================================
# 子命令：install（幂等安装）
# ============================================================================
cmd_install() {
    echo -e "${CYAN}==============================${NC}"
    echo -e "${CYAN}  网络验证系统 一键安装${NC}"
    echo -e "${CYAN}==============================${NC}"

    # 幂等检测：已安装则提示
    if is_installed && is_running; then
        warn "系统已安装且正在运行（${DEPLOY_DIR}）"
        echo -e "  ${GREEN}更新${NC}  : bash <(curl -sSL ${SCRIPT_URL}) update"
        echo -e "  ${GREEN}重装${NC}  : bash <(curl -sSL ${SCRIPT_URL}) reinstall"
        echo -e "  ${GREEN}卸载${NC}  : bash <(curl -sSL ${SCRIPT_URL}) uninstall"
        exit 0
    fi

    detect_os
    ensure_bt
    ensure_docker
    compute_ports
    generate_env
    download_compose
    prepare_image
    start_services
    wait_for_app_healthy || exit 1
    save_and_print_deploy_info
}

# ============================================================================
# 子命令：update（更新镜像 + 同步表结构 + 重启）
# ============================================================================
cmd_update() {
    echo -e "${CYAN}==============================${NC}"
    echo -e "${CYAN}  网络验证系统 更新${NC}"
    echo -e "${CYAN}==============================${NC}"

    if ! is_installed; then
        error "系统未安装，请先执行安装：bash <(curl -sSL ${SCRIPT_URL})"
        exit 1
    fi

    cd "${DEPLOY_DIR}"

    step "1" "拉取最新镜像..."
    docker compose pull || true
    # 远程镜像不可用时尝试本地重新构建
    if ! docker image inspect "${APP_IMAGE:-${APP_IMAGE_DEFAULT}}" >/dev/null 2>&1 \
       && ! docker compose images app 2>/dev/null | grep -q app; then
        warn "远程镜像不可用，尝试本地构建..."
        prepare_local_build_source
        docker compose build app || { error "app 构建失败"; exit 1; }
    fi
    # migrate 镜像必须本地构建（含完整 node_modules 供 prisma CLI 用）
    info "构建 migrate 建表镜像..."
    docker compose --profile migrate build migrate || { error "migrate 构建失败"; exit 1; }

    step "2" "重启数据层..."
    docker compose up -d db redis
    wait_for_db_healthy

    step "3" "同步数据库表结构..."
    create_db_schema

    step "4" "重启应用..."
    docker compose up -d app apk-injector
    # 读取当前 APP_PORT（.env 可能被用户修改过）
    APP_PORT="$(grep '^APP_PORT=' "${DEPLOY_DIR}/.env" | cut -d= -f2)"
    wait_for_app_healthy || exit 1

    echo
    info "更新完成！应用已运行在端口 ${APP_PORT}"
}

# ============================================================================
# 子命令：uninstall（卸载：停止并删除容器，保留数据卷）
# ============================================================================
cmd_uninstall() {
    echo -e "${CYAN}==============================${NC}"
    echo -e "${CYAN}  网络验证系统 卸载${NC}"
    echo -e "${CYAN}==============================${NC}"

    if ! is_installed; then
        warn "系统未安装，无需卸载"
        exit 0
    fi

    cd "${DEPLOY_DIR}"
    step "1" "停止并删除容器..."
    docker compose down
    info "容器已停止并删除"

    echo
    warn "数据卷已保留（数据库 + Redis 数据未删除）："
    echo -e "  ${GREEN}查看${NC} : docker volume ls | grep jicek"
    echo -e "  ${GREEN}彻底删除数据${NC} : docker volume rm jicek-wlyz_db-data jicek-wlyz_redis-data jicek-wlyz_apk-work"
    echo
    info "如需彻底清理，可删除部署目录：rm -rf ${DEPLOY_DIR}"
    info "卸载完成"
}

# ============================================================================
# 子命令：reinstall（卸载后重装，保留数据卷）
# ============================================================================
cmd_reinstall() {
    echo -e "${CYAN}==============================${NC}"
    echo -e "${CYAN}  网络验证系统 重装${NC}"
    echo -e "${CYAN}==============================${NC}"

    if is_installed; then
        cd "${DEPLOY_DIR}"
        step "0" "停止并删除旧容器..."
        docker compose down || true
    fi

    # 重装时保留 .env（密码不变，避免无法登录），但重新下载 compose
    if [ -f "${DEPLOY_DIR}/.env" ]; then
        info "保留已有 .env（密码不变），如需全新配置请先 uninstall 再安装"
    fi

    ensure_docker
    # 若无 .env 则重新生成
    if [ ! -f "${DEPLOY_DIR}/.env" ]; then
        compute_ports
        generate_env
    else
        # 读取已有端口用于健康检查
        APP_PORT="$(grep '^APP_PORT=' "${DEPLOY_DIR}/.env" | cut -d= -f2)"
        DB_PORT="$(grep '^DB_PORT=' "${DEPLOY_DIR}/.env" | cut -d= -f2)"
        REDIS_PORT="$(grep '^REDIS_PORT=' "${DEPLOY_DIR}/.env" | cut -d= -f2)"
        BT_PORT="$(grep '^BT_PORT=' "${DEPLOY_DIR}/.env" | cut -d= -f2)"
    fi
    download_compose
    prepare_image
    start_services
    wait_for_app_healthy || exit 1
    save_and_print_deploy_info
}

# ============================================================================
# 帮助
# ============================================================================
show_help() {
    cat <<EOF
网络验证 SaaS 系统 - 一键安装脚本

用法：
  bash <(curl -sSL ${SCRIPT_URL}) [子命令]

子命令：
  install     全新安装（默认，幂等：已安装则提示）
  update      更新镜像 + 同步表结构 + 重启
  uninstall   卸载（停止删除容器，保留数据卷）
  reinstall   重装（保留 .env 与数据卷）
  --help      显示此帮助

示例：
  # 全新安装
  bash <(curl -sSL ${SCRIPT_URL})

  # 更新到最新版本
  bash <(curl -sSL ${SCRIPT_URL}) update

  # 卸载（保留数据）
  bash <(curl -sSL ${SCRIPT_URL}) uninstall

部署目录：${DEPLOY_DIR}
部署信息：${DEPLOY_INFO_FILE}
脚本托管：${SCRIPT_URL}
EOF
}

# ============================================================================
# 主入口
# ============================================================================
main() {
    local cmd="${1:-install}"
    case "$cmd" in
        install|"")  cmd_install ;;
        update)      cmd_update ;;
        uninstall)   cmd_uninstall ;;
        reinstall)   cmd_reinstall ;;
        --help|-h)   show_help ;;
        *)
            error "未知命令: $cmd"
            echo
            show_help
            exit 1
            ;;
    esac
}

main "$@"
