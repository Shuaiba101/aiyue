// Next.js 客户端/服务端统一从 .ts 入口 re-export，避免 webpack 直接加载 .mjs 报错。
export * from "./core.mjs";
