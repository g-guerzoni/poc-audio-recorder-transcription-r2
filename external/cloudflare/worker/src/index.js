/**
 * Audio Processor Worker
 * Processes audio files uploaded to R2 storage
 */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/transcribe") {
        console.log("Received transcription request");

        try {
          let requestData;
          try {
            requestData = await request.json();
            console.log(`Transcription request for key: ${requestData.key}`);
          } catch (parseError) {
            console.error("Error parsing request JSON:", parseError);
            return new Response(
              JSON.stringify({
                success: false,
                error: "Invalid JSON in request body",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const { key } = requestData;

          if (!key) {
            console.error("Missing key in transcription request");
            return new Response(
              JSON.stringify({
                success: false,
                error: "Missing required parameter: key",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log(`Fetching audio file from R2: ${key}`);
          const audioFile = await env.AUDIO_BUCKET.get(key);
          if (!audioFile) {
            console.error(`Audio file not found in R2: ${key}`);
            return new Response(
              JSON.stringify({
                success: false,
                error: "Audio file not found",
              }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log(`Reading audio data for ${key}, size: ${audioFile.size} bytes`);
          const audioData = await audioFile.arrayBuffer();
          console.log(`Successfully loaded audio data: ${audioData.byteLength} bytes`);

          console.log("Sending audio to transcription service");
          const startTime = Date.now();
          const transcriptionResult = await sendToTranscriptionService(audioData, env);
          const duration = Date.now() - startTime;
          console.log(`Transcription service completed in ${duration}ms`);

          const transcriptionPreview = transcriptionResult.text.substring(0, 50);
          console.log(
            `Transcription result: "${transcriptionPreview}${transcriptionResult.text.length > 50 ? "..." : ""}" (${
              transcriptionResult.text.length
            } characters)`
          );

          const filename = key.split("/").pop();

          let r2FolderName = env.POC_AUDIO_RECORDER_TRANSCRIPTION_R2_FOLDER_NAME;

          if (!r2FolderName) {
            const pathParts = key.split("/");
            if (pathParts.length > 1) {
              r2FolderName = pathParts[0];
            } else {
              r2FolderName = "audio";
            }
            console.log(`R2_FOLDER_NAME not set in environment, using "${r2FolderName}" from path`);
          }

          console.log(`Using folder name "${r2FolderName}" for transcription storage`);

          const transcriptionKey = `${r2FolderName}/transcriptions/${filename}.json`;
          console.log(`Storing transcription result in R2: ${transcriptionKey}`);

          await env.AUDIO_BUCKET.put(
            transcriptionKey,
            JSON.stringify({
              transcription: transcriptionResult.text,
              processedAt: new Date().toISOString(),
            })
          );
          console.log("Transcription result stored successfully");

          return new Response(
            JSON.stringify({
              success: true,
              transcription: transcriptionResult.text,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Transcription error:", error);

          if (error.name === "TypeError" || error.name === "SyntaxError") {
            console.error("Data parsing error:", error.message);
          } else if (error.message && error.message.includes("network")) {
            console.error("Network error during transcription:", error.message);
          } else if (error.message && error.message.includes("timeout")) {
            console.error("Timeout error during transcription:", error.message);
          }

          return new Response(
            JSON.stringify({
              success: false,
              error: error.message || "Transcription failed",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      } else {
        const { key, audioUrl } = await request.json();

        if (!key) {
          return new Response("Missing key parameter", { status: 400 });
        }

        console.log(`Processing audio file: ${key}`);

        const object = await env.AUDIO_BUCKET.get(key);

        if (!object) {
          return new Response(`Object ${key} not found`, { status: 404 });
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: `Successfully processed audio file: ${key}`,
            size: object.size,
            uploaded: object.uploaded,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }
    } catch (error) {
      console.error("Error processing request:", error);

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Unknown error",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  },

  async r2ObjectCreated(event, env, ctx) {
    const object = event.object;

    console.log(`Object created in R2 bucket: ${object.key}`);

    try {
      const r2Object = await env.AUDIO_BUCKET.get(object.key);
      if (!r2Object) {
        console.error(`Could not get object ${object.key} from R2 bucket`);
        return;
      }

      const data = await r2Object.arrayBuffer();

      console.log(`Successfully processed ${object.key}, size: ${data.byteLength} bytes`);
    } catch (error) {
      console.error(`Error processing ${object.key}:`, error);
    }
  },
};

/**
 * Function for sending audio to OpenAI's transcription service
 */
async function sendToTranscriptionService(audioData, env) {
  try {
    console.log(`Preparing audio data for transcription, size: ${audioData.byteLength} bytes`);

    if (!env.OPENAI_API_KEY) {
      console.error("Missing OpenAI API key in environment variables");
      throw new Error("API key not configured. Please set OPENAI_API_KEY in worker environment");
    }

    const formData = new FormData();
    console.log("Creating audio blob with type: audio/webm");
    const audioBlob = new Blob([audioData], { type: "audio/webm" });
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "en");

    console.log("Sending request to OpenAI transcription API");
    const startTime = Date.now();

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const requestDuration = Date.now() - startTime;
    console.log(`OpenAI API response received in ${requestDuration}ms, status: ${response.status}`);

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
        console.error(`API error response: ${errorBody}`);
      } catch (readError) {
        console.error("Could not read error response body:", readError);
      }

      if (response.status === 401) {
        console.error("Authentication error: Invalid API key or token");
      } else if (response.status === 429) {
        console.error("Rate limit exceeded or quota reached");
      } else if (response.status >= 500) {
        console.error("OpenAI server error");
      }

      throw new Error(
        `Transcription API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`
      );
    }

    console.log("Parsing JSON response from transcription API");
    const result = await response.json();

    if (!result.text) {
      console.error("Invalid response format from OpenAI API:", result);
      throw new Error("Invalid response format from transcription service");
    }

    const wordCount = result.text.split(/\s+/).length;
    console.log(`Transcription completed successfully: ${wordCount} words, ${result.text.length} characters`);

    return result;
  } catch (error) {
    console.error("Transcription service error:", error);

    if (error.name === "TypeError") {
      console.error("API request format error:", error.message);
    } else if (error.name === "SyntaxError") {
      console.error("JSON parsing error:", error.message);
    } else if (error.message && error.message.includes("fetch")) {
      console.error("Network error during API request:", error.message);
    } else if (error.message && error.message.includes("timeout")) {
      console.error("Request timeout:", error.message);
    }

    throw error;
  }
}
