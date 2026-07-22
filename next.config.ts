import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 standalone 输出，供 Dockerfile 多阶段构建生成精简运行时镜像
  output: "standalone",
};

export default nextConfig;
