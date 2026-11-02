// Scans a QR code with the camera (laptop webcam or phone camera).
// Uses the small open-source jsQR library to read the code from video frames.
import { html, icon, openDialog } from './ui.js';

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/jsQR.js';
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => reject(new Error('Could not load the QR scanner.'));
    document.head.append(script);
  });
}

export function openScanner({ onResult }) {
  let stream = null;
  let stopped = false;

  const dialog = openDialog({
    title: 'Scan loyalty card',
    body: html`
      <div class="scanner">
        <video playsinline muted></video>
        <div class="scanner-frame" aria-hidden="true"></div>
      </div>
      <p class="small muted scanner-msg" style="margin-top:12px">Hold the QR code on the card (or on the customer's phone) in front of the camera.</p>`,
    onClose: stop,
  });
  const video = dialog.querySelector('video');
  const message = dialog.querySelector('.scanner-msg');

  function stop() {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  }

  function showProblem(text) {
    dialog.querySelector('.scanner').classList.add('hidden');
    message.innerHTML = html`${icon('camera', 'icon')} <span>${text}</span>`;
    message.classList.remove('muted');
    message.classList.add('scanner-problem');
  }

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showProblem('The camera only works when Looply is opened as https or on localhost. Type the card code or mobile number instead.');
      return;
    }
    try {
      const [jsQR, media] = await Promise.all([
        loadJsQR(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
      ]);
      stream = media;
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (stopped) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            dialog.close();
            onResult(code.data);
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      showProblem(
        err.name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow the camera in the browser, or type the card code instead.'
          : err.name === 'NotFoundError'
            ? 'No camera was found on this device. Type the card code or mobile number instead.'
            : err.message
      );
    }
  })();
}
