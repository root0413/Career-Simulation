/**
 * 安全 UUID 生成器（全局唯一入口）——修复手机 HTTP（非 HTTPS）访问时
 * Web Crypto API 不可用导致 `crypto.randomUUID is not a function` 白屏崩溃：
 *   1. 优先使用浏览器原生 window.crypto.randomUUID（安全上下文）
 *   2. 不可用时回退到基于 Math.random + 时间戳的 v4 风格 UUID 算法
 */
export function generateUUID(): string {
  if (
    typeof window !== "undefined"
    && window.crypto
    && typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }
  // 非安全上下文兜底（HTTP IP 直连手机 / 旧浏览器）
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
