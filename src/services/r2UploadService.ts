import * as AWS from "aws-sdk";
import { v4 as uuidv4 } from "uuid";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  workerUrl?: string;
}

export interface AudioFile {
  key: string;
  timestamp: string;
  size: number;
  url?: string;
  transcription?: string;
}

export class R2UploadService {
  public readonly s3Client: AWS.S3;
  public readonly bucketName: string;
  private workerUrl: string | undefined;
  private uploadHistory: AudioFile[] = [];

  constructor(config: R2Config) {
    try {
      if (!config) {
        throw new Error("R2 configuration is missing");
      }

      ["accountId", "accessKeyId", "secretAccessKey", "bucketName"].forEach((field) => {
        const key = field as keyof R2Config;
        if (!config[key]) {
          throw new Error(`R2 configuration is missing ${field}`);
        }
      });

      this.bucketName = config.bucketName;
      this.workerUrl = config.workerUrl;

      this.s3Client = new AWS.S3({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        signatureVersion: "v4",
        region: "auto",
        s3ForcePathStyle: true,
        httpOptions: {
          timeout: 30000,
          connectTimeout: 5000,
        },
        maxRetries: 3,
      });

      this.testConnection()
        .then((success) => {
          if (success) {
            console.log("Successfully connected to R2 bucket");
            return this.loadHistory();
          } else {
            console.error("Failed to connect to R2 bucket, history loading skipped");
            return Promise.resolve([]);
          }
        })
        .catch((err) => {
          console.error("Failed to load initial history:", err);
        });
    } catch (err) {
      console.error("Failed to initialize R2 upload service:", err);
      throw new Error(`R2 service initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async loadHistory(): Promise<AudioFile[]> {
    try {
      const params = {
        Bucket: this.bucketName,
        Prefix: `${process.env.R2_FOLDER_NAME}/`,
        MaxKeys: 100,
      };

      const response = await this.s3Client.listObjectsV2(params).promise();

      if (response.Contents) {
        const audioFiles = response.Contents.filter((obj) => {
          const key = obj.Key || "";
          return key.endsWith(".webm") && !key.includes("/transcriptions/");
        });

        this.uploadHistory = await Promise.all(
          audioFiles.map(async (obj) => {
            const key = obj.Key || "";
            const timestamp = this.extractTimestampFromKey(key);
            const size = obj.Size || 0;

            return {
              key,
              timestamp,
              size,
              url: await this.getSignedUrl(key),
            };
          })
        );

        this.uploadHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      return this.uploadHistory;
    } catch (error) {
      console.error("Error loading audio history:", error);
      return this.uploadHistory;
    }
  }

  private extractTimestampFromKey(key: string): string {
    try {
      const match = key.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z)-[a-z0-9]+/);
      if (!match) {
        console.log(`No timestamp pattern found in key: ${key}`);
        throw new Error("Invalid key format");
      }

      const timestampStr = match[1];
      console.log(`Extracted timestamp string: ${timestampStr}`);

      const [datePart, timePart] = timestampStr.split("T");
      if (!datePart || !timePart) {
        throw new Error("Invalid timestamp format");
      }

      let formattedTime;
      if (timePart.includes("-")) {
        const timeComponents = timePart.split("-");

        if (timeComponents.length > 3) {
          formattedTime = `${timeComponents[0]}:${timeComponents[1]}:${timeComponents[2]}.${timeComponents[3].replace(
            "Z",
            ""
          )}Z`;
        } else {
          formattedTime = `${timeComponents[0]}:${timeComponents[1]}:${timeComponents[2]}`;
        }
      } else {
        formattedTime = timePart;
      }

      const isoTimestamp = `${datePart}T${formattedTime}`;
      console.log(`Formatted ISO timestamp: ${isoTimestamp}`);

      const date = new Date(isoTimestamp);
      if (isNaN(date.getTime())) {
        console.error(`Invalid date created from: ${isoTimestamp}`);
        throw new Error("Invalid date");
      }

      return isoTimestamp;
    } catch (e) {
      console.warn("Error extracting timestamp from key:", key, e);
      return new Date().toISOString();
    }
  }

  getAudioHistory(): AudioFile[] {
    return this.uploadHistory;
  }

  async deleteAudio(key: string): Promise<void> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      await this.s3Client.deleteObject(params).promise();
      this.uploadHistory = this.uploadHistory.filter((file) => file.key !== key);
      console.log(`Successfully deleted audio file: ${key}`);
    } catch (error) {
      console.error(`Error deleting audio file ${key}:`, error);
      throw new Error(`Failed to delete audio file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Expires: 3600,
      };

      return await this.s3Client.getSignedUrlPromise("getObject", params);
    } catch (error) {
      console.error("Error generating signed URL:", error);
      return "";
    }
  }

  async uploadAudio(audioData: Uint8Array, progressCallback?: (event: UploadProgressEvent) => void): Promise<string> {
    if (!audioData || audioData.length === 0) {
      throw new Error("Empty audio data provided");
    }

    if (!this.s3Client) {
      throw new Error("R2 client not initialized");
    }

    if (!this.bucketName) {
      throw new Error("R2 bucket name not configured");
    }

    if (progressCallback) {
      progressCallback({
        stage: "preparing",
        progress: 0,
        message: "Preparing audio for upload...",
      });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const uniqueId = uuidv4().substring(0, 8);
    const key = `${process.env.R2_FOLDER_NAME}/${timestamp}-${uniqueId}.webm`;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(audioData);
      if (buffer.length === 0) {
        throw new Error("Created buffer is empty");
      }

      if (progressCallback) {
        progressCallback({
          stage: "preparing",
          progress: 25,
          message: "Audio prepared successfully",
          key,
        });
      }
    } catch (bufferError) {
      throw new Error(
        `Failed to convert audio data to buffer: ${
          bufferError instanceof Error ? bufferError.message : String(bufferError)
        }`
      );
    }

    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: "audio/webm",
    };

    try {
      console.log(`Attempting to upload to bucket: ${this.bucketName}, key: ${key}, size: ${buffer.length} bytes`);

      if (progressCallback) {
        progressCallback({
          stage: "uploading",
          progress: 25,
          message: "Starting upload to R2...",
          key,
        });
      }

      const uploadPromise = this.s3Client.putObject(params).promise();

      const progressUpdates = new Promise<void>((resolve) => {
        let progress = 25;

        const interval = setInterval(() => {
          if (progress < 50) {
            progress += 5;
            if (progressCallback) {
              progressCallback({
                stage: "uploading",
                progress,
                message: `Uploading to R2... (${progress}%)`,
                key,
              });
            }
          }
        }, 500);

        uploadPromise
          .then(() => {
            clearInterval(interval);
            if (progressCallback) {
              progressCallback({
                stage: "uploading",
                progress: 50,
                message: "Upload to R2 completed",
                key,
              });
            }
            console.log(`Upload to ${key} completed successfully`);
            resolve();
          })
          .catch((err) => {
            clearInterval(interval);
            console.error(`Upload promise rejected with error:`, err);
            resolve();
          });
      });

      const uploadTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          console.error(`Upload timed out for key: ${key}`);
          reject(new Error("Upload timed out after 60 seconds"));
        }, 60000);
      });

      console.log(`Waiting for upload to complete for key: ${key}`);
      await Promise.race([uploadPromise, progressUpdates, uploadTimeout]);

      if (progressCallback) {
        progressCallback({
          stage: "processing",
          progress: 50,
          message: "Generating signed URL...",
          key,
        });
      }

      let url = "";
      try {
        url = await this.getSignedUrl(key);

        if (progressCallback) {
          progressCallback({
            stage: "processing",
            progress: 75,
            message: "URL generation complete",
            key,
          });
        }
      } catch (urlError) {
        console.warn("Failed to generate signed URL, continuing without it:", urlError);

        if (progressCallback) {
          progressCallback({
            stage: "processing",
            progress: 75,
            message: "Continuing without URL generation",
            key,
          });
        }
      }

      const newAudioFile: AudioFile = {
        key,
        timestamp: now.toISOString(),
        size: buffer.length,
        url,
      };

      this.uploadHistory.unshift(newAudioFile);

      if (progressCallback) {
        progressCallback({
          stage: "processing",
          progress: 85,
          message: "Added to audio history",
          key,
        });
      }

      if (this.workerUrl) {
        if (progressCallback) {
          progressCallback({
            stage: "processing",
            progress: 90,
            message: "Starting automatic transcription...",
            key,
          });
        }

        try {
          const transcriptionResponse = await fetch(`${this.workerUrl}/transcribe`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ key }),
          });

          if (transcriptionResponse.ok) {
            if (progressCallback) {
              progressCallback({
                stage: "processing",
                progress: 95,
                message: "Transcription in progress",
                key,
              });
            }
            console.log(`Transcription started successfully for ${key}`);
          } else {
            console.warn("Failed to start transcription, continuing:", await transcriptionResponse.text());
            if (progressCallback) {
              progressCallback({
                stage: "processing",
                progress: 95,
                message: "Transcription skipped",
                key,
              });
            }
          }
        } catch (transcriptionError) {
          console.warn("Failed to initiate transcription, continuing:", transcriptionError);
          if (progressCallback) {
            progressCallback({
              stage: "processing",
              progress: 95,
              message: "Transcription skipped due to error",
              key,
            });
          }
        }
      } else {
        if (progressCallback) {
          progressCallback({
            stage: "processing",
            progress: 95,
            message: "Processing completed",
            key,
          });
        }
      }

      if (progressCallback) {
        progressCallback({
          stage: "complete",
          progress: 100,
          message: "Upload successfully completed",
          key,
        });
      }

      return key;
    } catch (error) {
      console.error("Raw upload error:", error);

      let enhancedError: Error;

      if (error instanceof Error) {
        if (error.message.includes("AccessDenied")) {
          enhancedError = new Error(
            `Access denied to R2 bucket '${this.bucketName}'. Check your credentials and permissions.`
          );
          console.error("This is likely an authentication issue. Check your API tokens.");
        } else if (error.message.includes("NoSuchBucket")) {
          enhancedError = new Error(`Bucket '${this.bucketName}' does not exist. Please verify the bucket name.`);
          console.error(`Attempted to upload to bucket '${this.bucketName}' but it doesn't exist.`);
        } else if (error.message.includes("timeout") || error.message.includes("timed out")) {
          enhancedError = new Error(`Upload timed out. Please check your network connection.`);
          console.error("The request took too long. Check your network connection or R2 service status.");
        } else if (error.message.includes("network") || error.message.includes("ENOTFOUND")) {
          enhancedError = new Error(`Network error. Please check your internet connection.`);
          console.error("This appears to be a network connectivity issue.");
        } else if (error.message.includes("CORS") || error.message.includes("cors")) {
          enhancedError = new Error(`CORS error. Your R2 bucket may need CORS configuration.`);
          console.error("This appears to be a CORS issue. Make sure your R2 bucket has CORS configured.");
        } else {
          enhancedError = new Error(`Failed to upload audio to R2: ${error.message}`);
          console.error(`Unclassified error: ${error.message}`);
        }

        if (error.stack) {
          enhancedError.stack = error.stack;
        }
      } else {
        enhancedError = new Error(`Unknown error uploading to R2: ${String(error)}`);
      }

      console.error("Error uploading to R2:", enhancedError);
      throw enhancedError;
    }
  }

  private async testConnection(): Promise<boolean> {
    try {
      console.log(`Testing connection to R2 bucket '${this.bucketName}'...`);

      const params = {
        Bucket: this.bucketName,
        MaxKeys: 1,
      };

      const result = await this.s3Client.listObjectsV2(params).promise();
      console.log(`Connection test successful. Bucket exists and is accessible.`);
      return true;
    } catch (error) {
      console.error(`R2 connection test failed:`, error);

      if (error instanceof Error) {
        if (error.message.includes("AccessDenied")) {
          console.error("Access denied. Check your R2 credentials and bucket permissions.");
        } else if (error.message.includes("NoSuchBucket")) {
          console.error(`Bucket '${this.bucketName}' does not exist.`);
        } else if (error.message.includes("ENOTFOUND") || error.message.includes("connect")) {
          console.error("Network error. Check your internet connection and endpoint URL.");
        }
      }

      return false;
    }
  }

  private async notifyWorker(key: string, throwOnError = false): Promise<void> {
    if (!this.workerUrl) {
      console.warn("Worker URL not configured, skipping notification");
      return;
    }

    if (!key) {
      const error = new Error("Cannot notify worker: Invalid file key");
      console.error(error);
      if (throwOnError) throw error;
      return;
    }

    try {
      let audioUrl = "";
      try {
        const params = {
          Bucket: this.bucketName,
          Key: key,
          Expires: 3600,
        };

        audioUrl = await this.s3Client.getSignedUrlPromise("getObject", params);
      } catch (urlError) {
        console.warn("Failed to generate signed URL for worker notification:", urlError);
      }

      const controller = new AbortController();
      const signal = controller.signal;

      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key, audioUrl }),
          signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          let errorText = "";
          try {
            errorText = await response.text();
          } catch (textError) {
            console.warn("Failed to read error response text:", textError);
          }

          const error = new Error(
            `Worker notification failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
          );
          console.error(error);

          if (throwOnError) throw error;
        } else {
          console.log("Worker notified successfully");
        }
      } catch (unknownError) {
        clearTimeout(timeout);

        const fetchError = unknownError as Error;

        if (fetchError && fetchError.name === "AbortError") {
          const error = new Error("Worker notification timed out after 10 seconds");
          console.error(error);
          if (throwOnError) throw error;
        } else {
          const error = new Error(
            `Worker notification failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
          );
          console.error(error);
          if (throwOnError) throw error;
        }
      }
    } catch (error) {
      console.error("Error notifying worker:", error);
      if (throwOnError) throw error;
    }
  }
}
