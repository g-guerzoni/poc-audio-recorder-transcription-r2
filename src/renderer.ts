interface AudioFile {
  key: string;
  timestamp: string;
  size: number;
  url?: string;
  transcription?: string;
}

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;
  const uploadIndicator = document.getElementById('uploadIndicator') as HTMLDivElement;
  const uploadStatus = document.getElementById('uploadStatus') as HTMLDivElement;
  const audioHistoryContainer = document.getElementById('audioHistory') as HTMLDivElement;
  const emptyHistoryMessage = document.getElementById('emptyHistory') as HTMLDivElement;
  const notificationSound = document.getElementById('notificationSound') as HTMLAudioElement;

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  const CHUNK_INTERVAL = 2000;
  const TIME_SLICE = 500;
  let intervalId: number | null = null;
  let isUploading = false;
  let isRecording = false;
  
  const recordingIndicator = document.getElementById('recordingIndicator') as HTMLDivElement;

  function showRecordingIndicator(): void {
    isRecording = true;
    recordingIndicator.classList.remove('hidden');
  }
  
  function hideRecordingIndicator(): void {
    isRecording = false;
    recordingIndicator.classList.add('hidden');
  }
  
  function updateStatus(message: string, isError = false, isRecordingState = false): void {
    statusDiv.textContent = message;
    statusDiv.classList.remove('hidden');
    
    statusDiv.classList.remove('error', 'recording');
    
    if (isError) {
      statusDiv.classList.add('error');
    } else if (isRecordingState) {
      statusDiv.classList.add('recording');
    }
  }

  function showUploadIndicator(message: string): void {
    isUploading = true;
    uploadStatus.textContent = message;
    uploadIndicator.classList.remove('hidden');
    
    resetUploadProgress();
  }

  function hideUploadIndicator(): void {
    isUploading = false;
    uploadIndicator.classList.add('hidden');
  }
  
  function resetUploadProgress(): void {
    const progressBar = document.getElementById('uploadProgress') as HTMLDivElement;
    progressBar.style.width = '0%';
    
    const stagesProgress = document.getElementById('stagesProgress') as HTMLDivElement;
    stagesProgress.style.width = '0%';
    
    const stages = ['stagePrep', 'stageUpload', 'stageProcessing', 'stageComplete'];
    stages.forEach(stageId => {
      const stage = document.getElementById(stageId) as HTMLDivElement;
      stage.classList.remove('active', 'completed');
    });
  }
  
  function updateUploadProgress(progressEvent: UploadProgressEvent): void {
    if (!isUploading) return;
    
    const progressBar = document.getElementById('uploadProgress') as HTMLDivElement;
    progressBar.style.width = `${progressEvent.progress}%`;
    
    const stagesProgress = document.getElementById('stagesProgress') as HTMLDivElement;
    
    let stagesWidth = 0;
    
    if (progressEvent.stage === 'preparing') {
      stagesWidth = progressEvent.progress / 25 * 33.3;
    } else if (progressEvent.stage === 'uploading') {
      stagesWidth = 33.3 + (progressEvent.progress - 25) / 25 * 33.3;
    } else if (progressEvent.stage === 'processing') {
      stagesWidth = 66.6 + (progressEvent.progress - 50) / 50 * 33.3;
    } else if (progressEvent.stage === 'complete') {
      stagesWidth = 100;
    }
    
    stagesProgress.style.width = `${stagesWidth}%`;
    
    uploadStatus.textContent = progressEvent.message;
    
    const stageMap = {
      'preparing': 'stagePrep',
      'uploading': 'stageUpload',
      'processing': 'stageProcessing',
      'complete': 'stageComplete'
    };
    
    let currentStageFound = false;
    Object.entries(stageMap).forEach(([stageName, stageId]) => {
      const stage = document.getElementById(stageId) as HTMLDivElement;
      
      if (stageName === progressEvent.stage) {
        stage.classList.add('active');
        stage.classList.remove('completed');
        currentStageFound = true;
      } else if (!currentStageFound) {
        stage.classList.add('completed');
        stage.classList.remove('active');
      } else {
        stage.classList.remove('active', 'completed');
      }
    });
  }

  async function startRecording(): Promise<void> {
    try {
      updateStatus('Requesting microphone access...');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Audio recording is not supported in this browser');
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(error => {
          if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            throw new Error('Microphone access denied. Please allow microphone access to record audio.');
          } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            throw new Error('No microphone detected. Please connect a microphone and try again.');
          } else {
            throw error;
          }
        });
      
      audioChunks = [];
      console.log("Cleared existing audio chunks before starting new recording");
      
      try {
        const options = { 
          audioBitsPerSecond: 128000,
          mimeType: 'audio/webm' 
        };
        mediaRecorder = new MediaRecorder(stream, options);
        console.log("Created media recorder with options:", options);
      } catch (mediaError) {
        console.error("MediaRecorder initialization error:", mediaError);
        throw new Error(`Failed to create media recorder: ${mediaError instanceof Error ? mediaError.message : String(mediaError)}`);
      }
      
      mediaRecorder.onerror = (event) => {
        const error = event.error || new Error('Unknown recording error');
        console.error('MediaRecorder error:', error);
        updateStatus(`Recording error: ${error.message}`, true);
      };
      
      mediaRecorder.ondataavailable = (event) => {
        console.log(`Data available event fired with data size: ${event.data.size} bytes`);
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          console.log(`Added chunk, now have ${audioChunks.length} chunks`);
        } else {
          console.warn("Received empty data chunk from MediaRecorder");
        }
      };
      
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped event fired");
        console.log(`Final audio chunks count: ${audioChunks.length}`);
        
        setTimeout(() => {
          const totalChunks = audioChunks.length;
          console.log(`Processing ${totalChunks} total audio chunks after stop event`);
          if (totalChunks > 0) {
            processAudioChunks();
          } else {
            console.log("No audio chunks to process after stopping");
            updateStatus("No audio data captured", true);
          }
        }, 200);
      };
      
      try {
        console.log(`Starting MediaRecorder with ${TIME_SLICE}ms time slices`);
        mediaRecorder.start(TIME_SLICE);
        
        console.log(`Media recorder state after start: ${mediaRecorder.state}`);
      } catch (startError) {
        console.error("Error starting MediaRecorder:", startError);
        throw new Error(`Failed to start recording: ${startError instanceof Error ? startError.message : String(startError)}`);
      }
      
      intervalId = window.setInterval(() => {
        const chunkCount = audioChunks.length;
        console.log(`Interval check: ${chunkCount} chunks available`);
        if (chunkCount > 0 && chunkCount % 4 === 0) {
          processAudioChunks();
        }
      }, CHUNK_INTERVAL);
      
      startButton.disabled = true;
      stopButton.disabled = false;
      updateStatus('Recording audio in progress...', false, true);
      showRecordingIndicator();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      stopMediaTracks();
      hideRecordingIndicator();
      updateStatus(`Microphone error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }
  
  function stopMediaTracks(): void {
    if (mediaRecorder && mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }

  function stopRecording(): void {
    try {
      if (!mediaRecorder) {
        updateStatus('No active recording to stop', true);
        return;
      }
      
      if (mediaRecorder.state === 'inactive') {
        updateStatus('Recording already stopped');
        return;
      }
      
      updateStatus('Stopping recording and finalizing audio...');
      
      console.log(`Stopping recording. Current state: ${mediaRecorder.state}`);
      console.log(`Current audio chunks before stop: ${audioChunks.length}`);
      
      if (intervalId !== null) {
        console.log("Clearing processing interval");
        clearInterval(intervalId);
        intervalId = null;
      }
      
      try {
        mediaRecorder.stop();
        console.log("Called mediaRecorder.stop()");
      } catch (stopError) {
        console.error('Error stopping recording:', stopError);
        updateStatus(`Error stopping recording: ${stopError instanceof Error ? stopError.message : String(stopError)}`, true);
        
        if (audioChunks.length > 0) {
          console.log(`Attempting to process ${audioChunks.length} chunks despite stop error`);
          processAudioChunks();
        }
      }
      
      try {
        stopMediaTracks();
      } catch (trackError) {
        console.error('Error stopping media tracks:', trackError);
      }
      
      startButton.disabled = false;
      stopButton.disabled = true;
      
      hideRecordingIndicator();
      
      if (!statusDiv.classList.contains('error')) {
        updateStatus('Recording stopped. Processing audio...');
      }
    } catch (err) {
      console.error('Error in stopRecording:', err);
      hideRecordingIndicator();
      updateStatus(`Error stopping recording: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function processAudioChunks(): void {
    try {
      if (audioChunks.length === 0) {
        console.log('No audio chunks to process');
        return;
      }
      
      const totalChunkSize = audioChunks.reduce((total, chunk) => total + chunk.size, 0);
      console.log(`Processing ${audioChunks.length} audio chunks (Total size: ${formatFileSize(totalChunkSize)})`);
      
      if (totalChunkSize < 100) {
        console.warn(`Audio data too small (${totalChunkSize} bytes), might be empty recording`);
      }
      
      updateStatus(`Processing ${audioChunks.length} audio chunks...`);
      
      const chunksToProcess = [...audioChunks];
      
      let audioBlob: Blob;
      try {
        audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });
        
        console.log(`Created audio blob of size: ${formatFileSize(audioBlob.size)}`);
        
        if (audioBlob.size === 0) {
          throw new Error('Created audio blob is empty');
        }
        
        updateStatus(`Audio captured: ${formatFileSize(audioBlob.size)}`);
      } catch (blobError) {
        console.error("Error creating audio blob:", blobError);
        throw new Error(`Failed to create audio blob: ${blobError instanceof Error ? blobError.message : String(blobError)}`);
      }
      
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        console.log("Recording stopped, clearing processed chunks");
        audioChunks = [];
      } else {
        console.log("Recording still active, keeping chunks for continuous recording");
      }
      
      updateStatus(`Preparing to upload ${formatFileSize(audioBlob.size)}...`);
      
      const reader = new FileReader();
      
      reader.onerror = (event) => {
        console.error('FileReader error:', event);
        updateStatus('Error reading audio data', true);
      };
      
      reader.onload = () => {
        try {
          const arrayBuffer = reader.result;
          if (!arrayBuffer) {
            throw new Error('Failed to read audio data');
          }
          
          const audioData = new Uint8Array(arrayBuffer as ArrayBuffer);
          console.log(`Sending audio data of size: ${formatFileSize(audioData.length)} to main process for R2 upload`);
          
          if (audioData.length === 0) {
            throw new Error('Audio data is empty after conversion');
          }
          
          const displaySize = formatFileSize(audioData.length);
          showUploadIndicator(`Initiating upload to R2: ${displaySize}`);
          
          setTimeout(() => {
            window.api.send('audio-data', audioData);
            console.log('Audio data sent to main process');
          }, 100);
        } catch (sendError) {
          console.error('Error sending audio data:', sendError);
          updateStatus(`Error uploading audio: ${sendError instanceof Error ? sendError.message : String(sendError)}`, true);
          hideUploadIndicator();
        }
      };
      
      reader.readAsArrayBuffer(audioBlob);
    } catch (err) {
      console.error('Error processing audio chunks:', err);
      updateStatus(`Error processing audio: ${err instanceof Error ? err.message : String(err)}`, true);
      hideUploadIndicator();
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch (e) {
      return timestamp;
    }
  }

  function getFilenameFromKey(key: string): string {
    return key.split('/').pop() || key;
  }

  function renderAudioHistory(audioFiles: AudioFile[]): void {
    audioHistoryContainer.innerHTML = '';
    
    const emptyHistoryClone = emptyHistoryMessage.cloneNode(true) as HTMLElement;
    
    if (!Array.isArray(audioFiles) || audioFiles.length === 0) {
      if (!Array.isArray(audioFiles)) {
        emptyHistoryClone.textContent = "Failed to load audio history.";
      } else {
        emptyHistoryClone.textContent = "No audio recordings found. Record and upload audio to see it here.";
      }
      
      audioHistoryContainer.appendChild(emptyHistoryClone);
      return;
    }
    
    audioFiles.forEach(file => {
      const audioFile = document.createElement('div');
      audioFile.className = 'audio-file';
      
      const fileInfo = document.createElement('div');
      fileInfo.className = 'audio-file-info';
      
      const fileDetails = document.createElement('div');
      fileDetails.className = 'audio-file-details';
      
      const fileName = document.createElement('div');
      fileName.className = 'audio-file-name';
      fileName.textContent = getFilenameFromKey(file.key);
      fileDetails.appendChild(fileName);
      
      const fileMeta = document.createElement('div');
      fileMeta.className = 'audio-file-meta';
      fileMeta.textContent = `Recorded: ${formatTimestamp(file.timestamp)} • Size: ${formatFileSize(file.size)}`;
      fileDetails.appendChild(fileMeta);
      
      fileInfo.appendChild(fileDetails);
      
      const buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'audio-file-buttons';
      
      const transcribeButton = document.createElement('button');
      transcribeButton.className = 'transcribe-button';
      
      transcribeButton.setAttribute('data-key', file.key);
      
      const transcriptionContainer = document.createElement('div');
      transcriptionContainer.className = 'transcription-container';
      transcriptionContainer.style.display = 'none';
      
      if (file.transcription) {
        transcribeButton.textContent = 'Show Transcription';
        transcribeButton.title = 'Toggle transcription display';
        
        const transcriptionText = document.createElement('div');
        transcriptionText.className = 'transcription-text';
        transcriptionText.textContent = file.transcription;
        transcriptionContainer.appendChild(transcriptionText);
        
        transcribeButton.addEventListener('click', () => {
          const isVisible = transcriptionContainer.style.display !== 'none';
          transcriptionContainer.style.display = isVisible ? 'none' : 'block';
          transcribeButton.textContent = isVisible ? 'Show Transcription' : 'Hide Transcription';
        });
      } else {
        transcribeButton.textContent = 'Transcribe';
        transcribeButton.title = 'Generate transcription for this audio';
        
        const progressIndicator = document.createElement('div');
        progressIndicator.className = 'transcription-progress';
        
        const progressText = document.createElement('div');
        progressText.className = 'progress-text';
        progressText.textContent = 'Click the Transcribe button to generate a transcription';
        progressIndicator.appendChild(progressText);
        
        transcriptionContainer.appendChild(progressIndicator);
        
        transcribeButton.addEventListener('click', async () => {
          try {
            console.log(`Initiating transcription for file: ${file.key}`);
            transcribeButton.disabled = true;
            transcribeButton.textContent = 'Transcribing...';
            progressText.textContent = 'Transcription in progress...';
            transcriptionContainer.style.display = 'block';
            
            console.log(`Requesting transcription for file: ${getFilenameFromKey(file.key)}, size: ${formatFileSize(file.size)}`);
            
            updateStatus(`Transcribing ${getFilenameFromKey(file.key)}...`);
            
            window.api.send('transcribe-audio', file.key);
            console.log('Transcription request sent to main process');
          } catch (error) {
            console.error('Error initiating transcription:', error);
            updateStatus('Failed to initiate transcription', true);
            transcribeButton.disabled = false;
            transcribeButton.textContent = 'Transcribe';
            progressText.textContent = 'Transcription failed. Please try again.';
          }
        });
      }
      
      buttonsContainer.appendChild(transcribeButton);
      
      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.title = 'Delete audio';
      deleteButton.addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete "${getFilenameFromKey(file.key)}"?`)) {
          updateStatus(`Deleting ${getFilenameFromKey(file.key)}...`);
          deleteButton.disabled = true;
          window.api.send('delete-audio', file.key);
        }
      });
      buttonsContainer.appendChild(deleteButton);
      
      fileInfo.appendChild(buttonsContainer);
      
      audioFile.appendChild(fileInfo);
      
      if (file.url) {
        const audioElement = document.createElement('audio');
        audioElement.className = 'audio-player';
        audioElement.controls = true;
        audioElement.src = file.url;
        audioFile.appendChild(audioElement);
      }
      
      audioFile.appendChild(transcriptionContainer);
      
      audioHistoryContainer.appendChild(audioFile);
    });
  }

  function playNotificationSound(): void {
    try {
      notificationSound.currentTime = 0;
      notificationSound.play().catch(error => {
        console.warn('Could not play notification sound:', error);
      });
    } catch (err) {
      console.warn('Error playing notification sound:', err);
    }
  }

  function getFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      return pathname.split('/').pop() || 'audio file';
    } catch (e) {
      return 'audio file';
    }
  }

  startButton.addEventListener('click', () => {
    try {
      startRecording();
    } catch (err) {
      console.error('Error in startRecording click handler:', err);
      updateStatus(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });
  
  stopButton.addEventListener('click', () => {
    try {
      stopRecording();
    } catch (err) {
      console.error('Error in stopRecording click handler:', err);
      updateStatus(`Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });

  window.api.receive('upload-status', (message: string) => {
    try {
      const isError = message.toLowerCase().includes('error') || 
                      message.toLowerCase().includes('failed') ||
                      message.toLowerCase().includes('missing');
      
      updateStatus(message, isError);
      
      if (message.includes('uploaded successfully') || message.includes('deleted successfully')) {
        window.api.send('get-audio-history', null);
        hideUploadIndicator();
        
        if (message.includes('uploaded successfully')) {
          playNotificationSound();
        }
      } else if (isError) {
        hideUploadIndicator();
      }
    } catch (err) {
      console.error('Error processing upload status:', err);
      updateStatus('Error updating status', true);
      hideUploadIndicator();
    }
  });
  
  window.api.receive('upload-progress', (progressEvent: UploadProgressEvent) => {
    try {
      updateUploadProgress(progressEvent);
      
      if (progressEvent.stage === 'complete' && progressEvent.progress === 100) {
        playNotificationSound();
        
        window.api.send('get-audio-history', null);
        
        setTimeout(() => {
          hideUploadIndicator();
        }, 2000);
      }
    } catch (err) {
      console.error('Error processing upload progress:', err);
      updateStatus('Error updating upload progress', true);
    }
  });

  window.api.receive('audio-history', (audioFiles: AudioFile[]) => {
    try {
      if (!Array.isArray(audioFiles)) {
        console.error('Received invalid audio history format:', audioFiles);
        updateStatus('Failed to load audio history: Invalid data format', true);
        return;
      }
      
      renderAudioHistory(audioFiles);
    } catch (err) {
      console.error('Error rendering audio history:', err);
      updateStatus(`Failed to load audio history: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });
  
  window.api.receive('transcription-progress', (data: { key: string; progress: number; message: string }) => {
    try {
      console.log(`Transcription progress for ${data.key}: ${data.progress}% - ${data.message}`);
      
      const audioFile = audioHistoryContainer.querySelector(`.audio-file:has([data-key="${data.key}"])`) as HTMLElement | null;
      if (!audioFile) {
        console.warn(`Could not find audio file element for key: ${data.key}`);
        return;
      }
      
      const transcribeButton = audioFile.querySelector(`.transcribe-button[data-key="${data.key}"]`) as HTMLButtonElement | null;
      if (!transcribeButton) {
        console.warn(`Could not find transcribe button for key: ${data.key}`);
        return;
      }
      
      let transcriptionContainer = audioFile.querySelector('.transcription-container') as HTMLElement | null;
      if (!transcriptionContainer) {
        transcriptionContainer = document.createElement('div');
        transcriptionContainer.className = 'transcription-container';
        audioFile.appendChild(transcriptionContainer);
      }
      
      let progressIndicator = transcriptionContainer.querySelector('.transcription-progress') as HTMLElement | null;
      if (!progressIndicator) {
        progressIndicator = document.createElement('div');
        progressIndicator.className = 'transcription-progress';
        transcriptionContainer.appendChild(progressIndicator);
        
        const progressText = document.createElement('div');
        progressText.className = 'progress-text';
        progressIndicator.appendChild(progressText);
      }
      
      const progressText = progressIndicator.querySelector('.progress-text') as HTMLElement;
      if (progressText) {
        progressText.textContent = `${data.message} (${data.progress}%)`;
      }
      
      transcribeButton.disabled = true;
      
      if (data.progress >= 100) {
        transcribeButton.textContent = "Processing...";
      } else if (data.progress < 0) {
        transcribeButton.disabled = false;
        transcribeButton.textContent = "Refresh";
        updateStatus(`Transcription error: ${data.message}`, true);
        
        transcribeButton.onclick = () => {
          window.api.send('get-audio-history', null);
        };
      } else {
        transcribeButton.textContent = "Transcribing...";
      }
    } catch (err) {
      console.error('Error updating transcription progress:', err);
    }
  });

  window.api.receive('transcription-status', (response: { success: boolean; key: string; transcription?: string; error?: string }) => {
    try {
      console.log(`Received transcription status update for key: ${response.key}, success: ${response.success}`);
      
      if (response.success) {
        console.log('Transcription completed successfully, requesting audio history refresh');
        window.api.send('get-audio-history', null);
        
        playNotificationSound();
        
        const wordCount = response.transcription ? response.transcription.split(/\s+/).length : 0;
        updateStatus(`Transcription complete: ${wordCount} words`);
      } else {
        const errorMessage = response.error || 'Unknown error';
        console.error(`Transcription failed for ${response.key}: ${errorMessage}`);
        
        let userFriendlyError = errorMessage;
        
        if (errorMessage.includes("OpenAI API key") || errorMessage.includes("Authentication") || errorMessage.includes("401")) {
          userFriendlyError = "The OpenAI API key is missing or invalid. Please set it up in the Cloudflare worker configuration.";
        } else if (errorMessage.includes("network") || errorMessage.includes("connect") || errorMessage.includes("ENOTFOUND")) {
          userFriendlyError = "Network error connecting to the transcription service. Check your internet connection.";
        } else if (errorMessage.includes("not found") || errorMessage.includes("404")) {
          userFriendlyError = "The audio file could not be found on the storage server.";
        } else if (errorMessage.includes("Invalid JSON") || errorMessage.includes("Unexpected token")) {
          userFriendlyError = "Error processing the transcription request. Please try again.";
        } else if (errorMessage.includes("timed out") || errorMessage.includes("timeout")) {
          userFriendlyError = "The transcription request timed out. The audio might be too large or the service is currently overloaded.";
        } else if (errorMessage.includes("cors") || errorMessage.includes("CORS")) {
          userFriendlyError = "CORS error. Please check the worker configuration.";
        } else if (errorMessage.includes("format") || errorMessage.includes("unsupported")) {
          userFriendlyError = "Unsupported audio format. Please ensure the audio is in a valid format.";
        }
        
        updateStatus(`Transcription failed: ${userFriendlyError}`, true);
        
        window.api.send('get-audio-history', null);
      }
    } catch (err) {
      console.error('Error handling transcription status:', err);
      console.error(`Details: ${err instanceof Error ? err.message : String(err)}`);
      updateStatus('Error updating transcription status', true);
      
      window.api.send('get-audio-history', null);
    }
  });

  window.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      console.error('Global error:', event.error);
      updateStatus(`Application error: ${event.error?.message || 'Unknown error occurred'}`, true);
    } else {
      console.error('Unknown global error event:', event);
      updateStatus('An unexpected error occurred', true);
    }
  });

  try {
    window.api.send('get-audio-history', null);
  } catch (err) {
    console.error('Error requesting audio history:', err);
    updateStatus(`Failed to request audio history: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  
  updateStatus('Ready to record. Click "Start Recording" to begin.');
});