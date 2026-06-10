const crypto = require("crypto");

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  const bytes = crypto.randomBytes(8);
  let code = "TG-";
  for (let i = 0; i < 8; i++) {
    code += CHARS[bytes[i] % CHARS.length];
  }
  return code;
}

function codeExpiryDate(plan) {
  const d = new Date();
  if (plan === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString();
}

module.exports = { generateCode, codeExpiryDate };
