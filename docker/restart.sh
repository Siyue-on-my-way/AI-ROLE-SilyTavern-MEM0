#!/bin/bash

# 切换到脚本所在目录
cd "$(dirname "$0")"

echo "正在停止服务..."
docker-compose down

echo "正在构建服务..."
docker-compose build

echo "正在启动服务..."
docker-compose up -d

# 配置参数
MAX_RETRIES=8
INTERVAL=15
SERVICES=("ai-role-sillytavern" "ai-role-mem0" "ai-role-mem0-postgres" "ai-role-mem0-neo4j")

echo "开始检查服务状态 (最大尝试次数: $MAX_RETRIES, 间隔: ${INTERVAL}秒)..."

for ((i=1; i<=MAX_RETRIES; i++)); do
    echo "尝试 #$i / $MAX_RETRIES - 等待 ${INTERVAL} 秒..."
    sleep $INTERVAL
    
    ALL_UP=true
    FAILED_SERVICES=()
    
    for SERVICE in "${SERVICES[@]}"; do
        # 获取容器状态
        # docker-compose ps -q returns container ID
        CONTAINER_ID=$(docker-compose ps -q "$SERVICE")
        
        if [ -z "$CONTAINER_ID" ]; then
            ALL_UP=false
            FAILED_SERVICES+=("$SERVICE (未创建)")
            continue
        fi
        
        # 检查运行状态
        STATE=$(docker inspect --format '{{.State.Status}}' "$CONTAINER_ID")
        
        # 检查健康状态 (如果配置了健康检查)
        HEALTH=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER_ID")
        
        if [ "$STATE" != "running" ]; then
            ALL_UP=false
            FAILED_SERVICES+=("$SERVICE (状态: $STATE)")
        elif [ "$HEALTH" != "none" ] && [ "$HEALTH" != "healthy" ]; then
            ALL_UP=false
            FAILED_SERVICES+=("$SERVICE (健康状态: $HEALTH)")
        fi
    done
    
    if [ "$ALL_UP" = true ]; then
        echo "✅ 所有服务已成功启动并正常运行！"
        docker-compose ps
        exit 0
    fi
    
    echo "⚠️  当前未就绪服务: ${FAILED_SERVICES[*]}"
done

echo "❌ 错误: 达到最大重试次数，以下服务未能正常启动:"
for SERVICE in "${FAILED_SERVICES[@]}"; do
    echo " - $SERVICE"
done

echo "正在显示相关容器日志..."
for SERVICE in "${SERVICES[@]}"; do
    echo "--- Log for $SERVICE ---"
    docker-compose logs --tail=20 "$SERVICE"
done

exit 1