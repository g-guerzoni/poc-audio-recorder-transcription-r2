import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as url from "url";
import { R2UploadService } from "./services/r2UploadService";
import { r2Config } from "./config/config";

if (process.env.NODE_ENV === "development") {
  require("electron-reload")(__dirname, {
    electron: path.join(__dirname, "../node_modules", ".bin", "electron"),
    hardResetMethod: "exit",
    watched: [path.join(__dirname, "../dist"), path.join(__dirname, "../index.html")],
  });
  console.log("Hot reloading enabled");
}

let mainWindow: BrowserWindow | null;
let r2UploadService: R2UploadService | null = null;

function initializeR2Service() {
  r2UploadService = new R2UploadService(r2Config);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "../index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", () => {
  initializeR2Service();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.on("audio-data", async (event, data) => {
  try {
    if (!data || !(data instanceof Uint8Array) || data.length === 0) {
      console.error("Invalid audio data received");
      event.sender.send("upload-status", "Error: Invalid audio data received");
      return;
    }

    if (!r2UploadService) {
      console.error("R2 upload service not initialized");
      event.sender.send("upload-status", "Error: R2 upload service not initialized");
      return;
    }

    const missingConfigValues = Object.entries(r2Config).filter(([key, value]) => {
      return key !== "workerUrl" && !value;
    });

    if (missingConfigValues.length > 0) {
      const missingKeys = missingConfigValues.map(([key]) => key).join(", ");
      const errorMessage = `Missing R2 configuration: ${missingKeys}. Please set these in .env file`;
      console.error(errorMessage);
      event.sender.send("upload-status", errorMessage);
      console.log("Received audio data of size:", data.length, "(Not uploading due to missing config)");
      return;
    }

    event.sender.send("upload-status", `Uploading audio (${formatBytes(data.length)})...`);

    try {
      console.log("Received audio data of size:", data.length);

      const progressCallback = (progressEvent: UploadProgressEvent) => {
        event.sender.send("upload-progress", progressEvent);
      };

      const key = await r2UploadService.uploadAudio(data, progressCallback);
      console.log("Uploaded audio to R2:", key);

      event.sender.send("upload-status", `Audio uploaded successfully: ${key}`);

      await sendAudioHistory(event.sender);
    } catch (uploadError) {
      let errorMessage = "Error uploading audio";

      if (uploadError instanceof Error) {
        if (uploadError.name === "NetworkError" || uploadError.message.includes("network")) {
          errorMessage = "Network error while uploading audio. Please check your internet connection.";
        } else if (uploadError.name === "TimeoutError" || uploadError.message.includes("timeout")) {
          errorMessage = "Upload timed out. Please try again later.";
        } else if (uploadError.message.includes("credentials") || uploadError.message.includes("authentication")) {
          errorMessage = "Authentication error. Please check your R2 credentials.";
        } else if (uploadError.message.includes("bucket")) {
          errorMessage = "R2 bucket error. Please verify your bucket name and permissions.";
        } else {
          errorMessage = `Error uploading audio: ${uploadError.message}`;
        }
      } else {
        errorMessage = `Error uploading audio: ${String(uploadError)}`;
      }

      console.error("Error uploading audio:", uploadError);
      event.sender.send("upload-status", errorMessage);
    }
  } catch (error) {
    console.error("Unexpected error handling audio data:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    event.sender.send("upload-status", `Unexpected error: ${errorMessage}`);
  }
});

ipcMain.on("get-audio-history", async (event) => {
  try {
    await sendAudioHistory(event.sender);
  } catch (error) {
    console.error("Error handling audio history request:", error);
    event.sender.send("upload-status", "Failed to retrieve audio history");
  }
});

ipcMain.on("delete-audio", async (event, key) => {
  try {
    if (!key) {
      throw new Error("No key provided for deletion");
    }

    if (!r2UploadService) {
      throw new Error("R2 upload service not initialized");
    }

    await r2UploadService.deleteAudio(key);

    event.sender.send("upload-status", `Audio file deleted successfully: ${key}`);

    await sendAudioHistory(event.sender);
  } catch (error) {
    console.error("Error deleting audio:", error);
    event.sender.send(
      "upload-status",
      `Error deleting audio: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

ipcMain.on("transcribe-audio", async (event, key) => {
  let progressInterval: NodeJS.Timeout | null = null;
  let progress = 0;

  const sendProgressUpdate = (progressValue: number, message: string) => {
    try {
      event.sender.send("transcription-progress", {
        key,
        progress: progressValue,
        message,
      });
    } catch (err) {
      console.error("Error sending progress update:", err);
    }
  };

  const clearProgressInterval = () => {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  };

  try {
    console.log(`Transcription requested for audio: ${key}`);

    if (!r2UploadService) {
      console.error("Transcription failed: R2 upload service not initialized");
      throw new Error("R2 upload service not initialized");
    }

    if (!r2Config.workerUrl) {
      console.error("Transcription failed: Worker URL not configured");
      throw new Error("Worker URL not configured. Please set R2_WORKER_URL in .env file");
    }

    console.log(`Using worker endpoint: ${r2Config.workerUrl}/transcribe`);

    sendProgressUpdate(0, "Initiating transcription request...");
    progress = 10;

    progressInterval = setInterval(() => {
      progress += 5;
      if (progress <= 95) {
        const progressMessage = progress < 50 ? "Transcribing audio..." : "Processing transcription results...";
        sendProgressUpdate(progress, progressMessage);
      }
    }, 3000);

    console.log(`Sending transcription request to worker for key: ${key}`);
    sendProgressUpdate(10, "Connecting to transcription service...");

    let response;
    try {
      response = await fetch(`${r2Config.workerUrl}/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });
    } catch (fetchError: unknown) {
      console.error("Network error during transcription request:", fetchError);
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(`Failed to connect to transcription service: ${errorMessage}`);
    }

    console.log(`Transcription worker responded with status: ${response.status}`);

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (jsonError) {
        console.error("Could not parse error response:", jsonError);
        throw new Error(`Transcription failed with status ${response.status}`);
      }

      const errorMessage = errorData.error || "Transcription failed";
      console.error(`Worker returned error response: ${errorMessage}`);

      if (
        errorMessage.includes("API key not configured") ||
        errorMessage.includes("Invalid API key") ||
        errorMessage.includes("Authentication")
      ) {
        throw new Error("OpenAI API key not configured or invalid. Please configure it in the Cloudflare worker.");
      }

      throw new Error(errorMessage);
    }

    sendProgressUpdate(100, "Finalizing transcription...");

    const result = await response.json();

    const transcriptionLength = result.transcription ? result.transcription.length : 0;
    const wordCount = result.transcription ? result.transcription.split(/\s+/).length : 0;
    console.log(
      `Transcription completed successfully for ${key}. Result length: ${transcriptionLength} characters, ${wordCount} words`
    );

    clearProgressInterval();

    event.sender.send("transcription-status", {
      success: true,
      key,
      transcription: result.transcription,
      wordCount,
      characterCount: transcriptionLength,
    });

    console.log("Refreshing audio history with new transcription data");
    await sendAudioHistory(event.sender);
  } catch (error) {
    clearProgressInterval();

    sendProgressUpdate(-1, "Transcription failed");

    console.error("Transcription error:", error);

    if (error instanceof Error) {
      if (error.message.includes("fetch") || error.message.includes("network")) {
        console.error(`Network error during transcription request: ${error.message}`);
      } else if (error.message.includes("timeout")) {
        console.error(`Transcription request timed out: ${error.message}`);
      } else if (error.message.includes("JSON")) {
        console.error(`Invalid JSON response from transcription service: ${error.message}`);
      }
    }

    event.sender.send("transcription-status", {
      success: false,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function sendAudioHistory(sender: Electron.WebContents) {
  if (!r2UploadService) {
    sender.send("upload-status", "R2 service not available");
    sender.send("audio-history", []);
    return;
  }

  try {
    let audioFiles = r2UploadService.getAudioHistory();

    if (audioFiles.length === 0) {
      console.log("No audio history in memory, attempting to load from R2...");
      try {
        audioFiles = await r2UploadService.loadHistory();
        console.log(`Loaded ${audioFiles.length} audio files from R2 storage`);
      } catch (loadError) {
        console.error("Error loading history from R2:", loadError);
      }
    }

    const checkedKeys = new Set();

    for (const file of audioFiles) {
      if (file.transcription || checkedKeys.has(file.key)) {
        continue;
      }

      checkedKeys.add(file.key);

      try {
        const filename = file.key.split("/").pop() || "";

        const R2_FOLDER_NAME = process.env.R2_FOLDER_NAME || "audio";

        let r2FolderName = R2_FOLDER_NAME;

        if (file.key.includes("/")) {
          const pathParts = file.key.split("/");
          if (pathParts.length > 1 && pathParts[0]) {
            r2FolderName = pathParts[0];
          }
        }

        console.log(`Looking for transcription in "${r2FolderName}/transcriptions/" folder`);

        const transcriptionKey = `${r2FolderName}/transcriptions/${filename}.json`;

        const transcriptionObj = await r2UploadService.s3Client
          .getObject({
            Bucket: r2UploadService.bucketName,
            Key: transcriptionKey,
          })
          .promise();

        if (transcriptionObj && transcriptionObj.Body) {
          const transcriptionData = transcriptionObj.Body.toString("utf-8");
          const parsedData = JSON.parse(transcriptionData);

          if (parsedData && parsedData.transcription) {
            file.transcription = parsedData.transcription;
            console.log(`Found transcription for ${file.key}`);
          }
        }
      } catch (err) {
        console.log(`No transcription found for ${file.key}`);
      }
    }

    const validatedFiles = audioFiles.filter((file) => {
      const isValid = file && typeof file.key === "string" && typeof file.timestamp === "string";
      if (!isValid) {
        console.warn("Filtered out invalid audio file entry:", file);
      }
      return isValid;
    });

    console.log(`Sending ${validatedFiles.length} validated audio files to renderer`);
    sender.send("audio-history", validatedFiles);
  } catch (error) {
    console.error("Error sending audio history:", error);
    sender.send("upload-status", "Error loading audio history");
    sender.send("audio-history", []);
  }
}

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
