# Audio Recorder with Transcription and R2 Storage

A **POC** using Electron that provides audio recording capabilities with integration to Cloudflare R2 storage and automatic transcription services. This application allows users to record audio, store it securely in Cloudflare R2, and automatically transcribe the content using OpenAI's Whisper model through a Cloudflare Worker.

![image](https://github.com/user-attachments/assets/5ebcbca3-0b0d-43ed-8419-99b8ee77c733)

## Features

- **Audio Recording**: Record high-quality audio from your computer's microphone
- **Cloud Storage**: Automatic upload to Cloudflare R2 storage
- **Transcription**: Automatic audio-to-text transcription using OpenAI's Whisper model
- **History**: View and manage your recorded audio files
- **Real-time Progress**: Live upload and transcription progress tracking
- **Error Handling**: Robust error handling and user feedback

## Prerequisites

- Node.js (>= 14.x)
- npm or yarn
- Cloudflare account with:
  - R2 Storage enabled
  - Workers enabled
  - API tokens with appropriate permissions

## Installation

1. Clone the repository:

   ```bash
   git clone [repository-url]
   cd poc-audio-recorder-transcription-r2
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your credentials (see Configuration section below)

5. Build the application:

   ```bash
   npm run build
   ```

6. Start the application:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

The following environment variables need to be set in your `.env` file:

| Variable               | Description                                   | Required |
| ---------------------- | --------------------------------------------- | -------- |
| `R2_ACCOUNT_ID`        | Your Cloudflare account ID                    | Yes      |
| `R2_ACCESS_KEY_ID`     | R2 API access key ID                          | Yes      |
| `R2_SECRET_ACCESS_KEY` | R2 API secret access key                      | Yes      |
| `R2_BUCKET_NAME`       | Name of your R2 bucket                        | Yes      |
| `R2_FOLDER_NAME`       | Folder name within the bucket for audio files | Yes      |
| `WORKER_URL`           | URL of your deployed Cloudflare Worker        | Yes      |

### Cloudflare Worker Configuration

The Worker requires additional configuration in the Cloudflare dashboard:

1. Set the following environment variables in your Worker:

   - `OPENAI_API_KEY`: Your OpenAI API key for transcription
   - `POC_AUDIO_RECORDER_TRANSCRIPTION_R2_FOLDER_NAME`: Folder name in R2 bucket

2. Configure R2 bucket binding in `wrangler.toml`:
   ```toml
   [[r2_buckets]]
   binding = "AUDIO_BUCKET"
   bucket_name = "your-bucket-name"
   ```

## Worker Integration

The project includes a Cloudflare Worker that handles:

1. **Audio Processing**: Receives uploaded audio files from the Electron app
2. **Transcription**: Uses OpenAI's Whisper model to transcribe audio to text
3. **Storage Management**: Stores transcription results back in R2

### Worker Endpoints

- `/transcribe`: POST endpoint that accepts audio file keys and initiates transcription

### Worker Deployment

1. Navigate to the worker directory:

   ```bash
   cd external/cloudflare/worker
   ```

2. Install worker dependencies:

   ```bash
   npm install
   ```

3. Deploy the worker:

   ```bash
   npm run deploy
   ```

4. Update your `.env` file with the deployed worker URL:
   ```
   WORKER_URL=https://audio-processor-worker.[your-account].workers.dev
   ```

## R2 Integration

The application uses Cloudflare R2 for secure and scalable storage of audio files. The integration includes:

1. **Direct Upload**: Audio files are uploaded directly to R2 from the Electron app
2. **Signed URLs**: Secure access to audio files using signed URLs
3. **Folder Structure**:
   - `/audio`: Raw audio recordings
   - `/audio/transcriptions`: Transcription results

### R2 Setup

1. Create a new R2 bucket in your Cloudflare dashboard
2. Create API tokens with the following permissions:
   - Object Read
   - Object Write
   - Bucket Read
   - Bucket Write
3. Configure the bucket name and credentials in your `.env` file

## Development

### Running in Development Mode

```bash
# Start with hot reloading
npm run dev

# Watch for TypeScript changes
npm run watch
```

### Building for Production

```bash
# Build the application
npm run build

# Create distributable
npm run dist
```

### Project Structure

```
├── src/
│   ├── main.ts              # Main Electron process
│   ├── services/
│   │   └── r2UploadService.ts  # R2 integration service
│   └── config/
│       └── config.ts        # Configuration management
├── external/
│   └── cloudflare/
│       └── worker/          # Cloudflare Worker code
└── dist/                    # Compiled files
```

## Error Handling

The application includes comprehensive error handling for:

- Network connectivity issues
- R2 authentication failures
- Worker communication errors
- Transcription service errors
- Invalid configurations

## Troubleshooting

### Common Issues

1. **Upload Failures**

   - Check R2 credentials and permissions
   - Verify network connectivity
   - Ensure bucket exists and is accessible

2. **Transcription Errors**

   - Verify OpenAI API key in Worker configuration
   - Check Worker logs for detailed error messages
   - Ensure audio file format is supported

3. **Worker Connection Issues**
   - Verify Worker URL in `.env` file
   - Check Worker deployment status
   - Confirm Worker has necessary R2 permissions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
