let micStream: MediaStream | null = null;

const root = document.getElementById('root');

if (root) {
  root.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;">
      <h1 style="margin: 0 0 12px; font-size: 18px;">Enable Microphone</h1>
      <p style="margin: 0 0 16px; color: #555;">
        Click the button to allow microphone access for MENTORA.
      </p>
      <button id="enable-mic" style="padding: 10px 14px; font-weight: 600;">Allow Microphone</button>
      <p id="status" style="margin: 12px 0 0; color: #0f766e;"></p>
    </div>
  `;

  const button = document.getElementById('enable-mic');
  const status = document.getElementById('status');

  button?.addEventListener('click', async () => {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (status) {
        status.textContent =
          'Microphone active. Do NOT close this tab while recording — it will close automatically when you stop.';
      }
      if (button) {
        (button as HTMLButtonElement).disabled = true;
        (button as HTMLButtonElement).textContent = 'Microphone Active';
      }
      chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED', target: 'background' });
    } catch (error) {
      if (status) status.textContent = `Failed to enable microphone: ${String(error)}`;
    }
  });
}

// Listen for stop signal from background to close this tab and release the mic
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLOSE_MIC_TAB') {
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    window.close();
  }
});
