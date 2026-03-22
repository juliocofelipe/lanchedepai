#!/usr/bin/env node

const bcrypt = require("bcryptjs");

const [, , password] = process.argv;

if (!password) {
  console.error("Usage: npm run hash-password -- <senha>");
  process.exit(1);
}

const saltRounds = Number(process.env.HASH_ROUNDS ?? 12);

const hash = bcrypt.hashSync(password, saltRounds);
console.log(hash);
