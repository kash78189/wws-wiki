/**
 * 生成后台的密码哈希，用于 Cloudflare Worker 的 ADMIN_USERS 机密
 *
 *   node tools/passwd.mjs kash "你的密码"
 *   node tools/passwd.mjs kash "密码A"  -> 与已有 ADMIN_USERS 合并见 README
 *
 * 输出一行 JSON，直接作为 ADMIN_USERS 的值：
 *   wrangler secret put ADMIN_USERS
 */
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 150000;
const [, , user, password] = process.argv;

if (!user || !password) {
  console.error("用法：node tools/passwd.mjs <用户名> <密码>");
  process.exit(1);
}

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);

console.log(JSON.stringify({ [user]: { salt: hex(salt), hash: hex(bits), iterations: ITERATIONS } }));
