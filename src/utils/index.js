// ------------------------------ RSA 密钥对生成 ------------------------------
// 生成 RSA-OAEP 密钥对（2048 位，用于加密）
async function generateRsaKeyPair() {
  return window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048, // 密钥长度（推荐 2048+）
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 固定为 0x10001
      hash: { name: "SHA-256" }, // 哈希算法（推荐 SHA-256）
    },
    true, // 可导出（根据需求调整）
    ["encrypt", "decrypt"], // 密钥用途
  );
}

// ------------------------------ RSA 加密 AES 密钥 ------------------------------
// 用公钥加密 AES 密钥（原始字节）
async function encryptAesKeyWithRsa(aesKeyBytes, publicKey) {
  return window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    aesKeyBytes,
  );
}

// ------------------------------ AES-GCM 加密数据 ------------------------------
// 生成 AES-GCM 密钥并加密数据
async function encryptDataWithAes(plaintext, aesKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 字节 IV（推荐）
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 }, // tagLength 可选 128/120/112/104/96
    aesKey,
    plaintextBytes,
  );

  return { iv, ciphertext }; // iv 需传输给接收方
}

// ------------------------------ 使用示例 ------------------------------
async function main() {
  // 1. 生成 RSA 密钥对（公钥给客户端，私钥留服务端）
  const rsaKeyPair = await generateRsaKeyPair();
  const publicKey = rsaKeyPair.publicKey;
  const privateKey = rsaKeyPair.privateKey;

  // 2. 客户端生成 AES 密钥
  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, // 256 位 AES
    true, // 可导出（用于 RSA 加密）
    ["encrypt", "decrypt"],
  );

  // 3. 导出 AES 密钥原始字节（用于 RSA 加密）
  const aesKeyBytes = await window.crypto.subtle.exportKey("raw", aesKey);

  // 4. 用 RSA 公钥加密 AES 密钥
  const encryptedAesKey = await encryptAesKeyWithRsa(aesKeyBytes, publicKey);

  // 5. 用 AES 加密业务数据
  const plaintext = "敏感数据：用户密码 123456";
  const { iv, ciphertext } = await encryptDataWithAes(plaintext, aesKey);

  // 6. 发送 encryptedAesKey（ArrayBuffer）、iv（ArrayBuffer）、ciphertext（ArrayBuffer）到服务端
}

main();
