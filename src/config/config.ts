import * as dotenv from "dotenv";

dotenv.config();

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  workerUrl?: string;
}

export const r2Config: R2Config = {
  accountId: process.env.R2_ACCOUNT_ID || "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  bucketName: process.env.R2_BUCKET_NAME || "",
  workerUrl: process.env.WORKER_URL || "",
};

const requiredKeys = ["accountId", "accessKeyId", "secretAccessKey", "bucketName"];
requiredKeys.forEach(key => {
  if (!r2Config[key as keyof R2Config]) {
    console.warn(`WARNING: Missing R2 config value for ${key}. Set ${key.toUpperCase()} in environment variables or .env file.`);
  }
});

if (!r2Config.workerUrl) {
  console.info("Worker URL not configured. Manual worker notification will be disabled.");
  console.info("Set WORKER_URL in your .env file if you want to manually notify the worker about uploads.");
}