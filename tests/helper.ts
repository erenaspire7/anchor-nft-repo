import fs from "fs";
import { Keypair } from "@solana/web3.js";

export const loadKeyPair = (filename) => {
  const decodedKey = new Uint8Array(
    JSON.parse(fs.readFileSync(`${__dirname}/${filename}`).toString())
  );

  let keyPair = Keypair.fromSecretKey(decodedKey);

  return keyPair;
};
