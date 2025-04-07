# Audio Capture Electron Application

This is an Electron application that captures audio from the user's microphone and uploads it to Cloudflare R2 storage. Uploaded files can be processed by a Cloudflare Worker.

## Prerequisites

- Node.js (>= 14.x)
- npm
- Cloudflare account with R2 and Workers enabled

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```

## Configuration

1. Create a Cloudflare R2 bucket
2. Create R2 API tokens with appropriate permissions
3. Create a `.env` file in the project root:

```bash
# Copy the example file
cp .env.example .env

# Edit the .env file with your credentials
nano .env
```

4. Fill in your R2 credentials in the `.env` file:

```
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_NAME="your-r2-bucket-name"
```

The application uses dotenv to load these environment variables at runtime.

## Development

Build the TypeScript code:
```
npm run build
```

Start the application:
```
npm start
```

Watch for changes during development:
```
npm run watch
```

### Hot Reloading

For a better development experience with hot reloading:

```bash
# For macOS/Linux
npm run dev

# For Windows
npm run dev:win
```

This will:
1. Watch for changes in your TypeScript files and recompile them automatically
2. Reload the Electron application when changes are detected
3. Restart the application when necessary

## Cloudflare Worker Deployment

### Prerequisites

1. A Cloudflare account with Workers and R2 enabled
2. Cloudflare R2, Workers, and API Token permissions

### Setting Up Cloudflare R2

1. Log in to your Cloudflare dashboard
2. Navigate to R2 > Create bucket
3. Create a bucket named `audios` (or your preferred name)
4. Note your bucket name for later configuration

### Creating R2 API Tokens

1. Go to your Cloudflare dashboard > Account Home > R2
2. Click on "Manage R2 API Tokens"
3. Create a new API token with the following permissions:
   - "Object Read" - Allows reading objects from the bucket
   - "Object Write" - Allows writing objects to the bucket
   - "Bucket Read" - Allows reading bucket metadata
   - "Bucket Write" - Allows creating and deleting buckets
4. Note your Access Key ID and Secret Access Key
5. Add these credentials to your `.env` file:
   ```
   R2_ACCOUNT_ID="your-cloudflare-account-id"
   R2_ACCESS_KEY_ID="your-access-key-id"
   R2_SECRET_ACCESS_KEY="your-secret-access-key"
   R2_BUCKET_NAME="audios"
   WORKER_URL="https://audio-processor-worker.your-account.workers.dev"
   ```

### Deploying the Worker

1. Install Wrangler CLI globally:
   ```
   npm install -g wrangler
   ```

2. Navigate to the worker directory:
   ```
   cd src/external/cloudflare/worker
   ```

3. Update the `wrangler.toml` file with your information:
   - Replace the empty `account_id` with your Cloudflare account ID
   - Replace the empty `bucket_name` with your R2 bucket name
   - Replace the empty `bucket` in the triggers section with your bucket name

4. Login to Cloudflare:
   ```
   wrangler login
   ```

5. Install worker dependencies:
   ```
   npm install
   ```

6. Deploy the worker:
   ```
   npm run deploy
   ```

7. Test your worker locally before deployment (optional):
   ```
   npm run dev
   ```

### Using Direct Worker Notification

Since R2 event notifications require Cloudflare Queues (which may not be available on all accounts), our application uses a direct notification approach:

1. When audio is uploaded to R2, the Electron app directly calls the Worker's API endpoint
2. The WORKER_URL environment variable in your .env file specifies the URL of your deployed Worker
3. For this project, your worker URL is: `https://audio-processor-worker.guerzoni-guilherme.workers.dev`

If you want to use R2 event notifications instead (requires Enterprise plan or add-on):

1. Create a Cloudflare Queue: `wrangler queues create audio-events`
2. Configure R2 notifications: `wrangler r2 bucket notification create audios --event-type=object-create --queue=audio-events`
3. Set up your Worker to consume events from the queue

### Verifying Worker Deployment

Once deployed, you can monitor your worker's activity:

1. In the Cloudflare dashboard, go to Workers & Pages > audio-processor-worker
2. Navigate to Logs to view worker activity
3. After uploading an audio file from the Electron application, you should see logs indicating that the worker processed the file
4. You can also check your R2 bucket to see the uploaded audio files and any metadata files the worker might have created

### Testing the Complete Integration

To test the full integration between your Electron app, R2, and Workers:

1. Ensure your `.env` file contains all the necessary credentials
2. Start the Electron application with `npm start`
3. Click "Start Recording" to begin capturing audio
4. Speak into your microphone for a few seconds
5. Click "Stop Recording" to end the recording session
6. The app will automatically upload the audio to your R2 bucket
7. If you've set the `WORKER_URL` correctly, the app will also notify your worker about the uploaded file
8. Check the Cloudflare Worker logs to verify that the worker processed the file
9. Check your R2 bucket to see the uploaded audio files

Troubleshooting tips:
- If uploads fail, check your R2 credentials and permissions
- If the worker isn't processing files, check the worker logs for errors
- Enable developer tools in the Electron app (already enabled by default) to see console messages
- Make sure your Cloudflare Worker is published and active

## Building Distributable

To build distributables for your platform:
```
npm run dist
```

Output will be in the `release` folder.

## Architecture

- **Electron App**: Captures audio from the microphone in chunks
- **R2 Storage Service**: Uploads audio chunks to Cloudflare R2
- **Cloudflare Worker**: Processes audio files when uploaded to R2

## Security Notes

- In a production environment, never hard-code API keys or secrets
- Use secure methods to store and retrieve credentials
- Consider implementing additional authentication mechanisms
- Encrypt sensitive data in transit and at rest

## License

[MIT](LICENSE)