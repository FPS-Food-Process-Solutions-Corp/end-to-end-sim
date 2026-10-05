import * as THREE from '../vendor/three.module.js';
import {withWebMDuration} from './webm-duration.js';

export function supportedVideoType() {
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find(type => MediaRecorder.isTypeSupported(type)) || null;
}

/** A separate renderer keeps exported dimensions and camera independent of the UI. */
export class OrderRecorder {
  constructor(view, onChange) {
    this.view = view;
    this.onChange = onChange;
    this.mimeType = supportedVideoType();
    this.state = 'idle';
    this.url = null;
  }

  get active() { return ['recording', 'stopping'].includes(this.state); }

  start(height = 720) {
    if (!this.mimeType) throw new Error('Video recording is unavailable in this browser.');
    if (this.active) throw new Error('A recording is already running.');
    this.releaseVideo();
    const width = height === 1080 ? 1920 : 1280;
    this.canvas = document.createElement('canvas');
    try {
      this.renderer = new THREE.WebGLRenderer({canvas: this.canvas, antialias: true, preserveDrawingBuffer: true});
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      const source = this.view.renderer;
      this.renderer.outputColorSpace = source.outputColorSpace;
      this.renderer.toneMapping = source.toneMapping;
      this.renderer.toneMappingExposure = source.toneMappingExposure;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = source.shadowMap.type;
      this.camera = this.view.camera.clone();
      // Preserve the entire selected view; letterbox it if the viewport is not 16:9.
      const aspect = this.camera.aspect;
      const w = Math.min(width, height * aspect), h = w / aspect;
      this.renderer.setViewport((width-w)/2, (height-h)/2, w, h);
      this.renderer.setClearColor(0x222e37, 1);
      this.capture();
      this.stream = this.canvas.captureStream(30);
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType, videoBitsPerSecond: height === 1080 ? 10000000 : 6000000,
      });
      this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.onerror = event => {
        this.error = event.error?.message || 'Video encoding failed.';
        this.stop('Recording interrupted');
      };
      this.recorder.onstop = async () => {
        this.blob = await withWebMDuration(new Blob(this.chunks, {type: this.mimeType}), this.wallSeconds);
        this.state = this.error || !this.blob.size ? 'error' : 'ready';
        if (this.state === 'ready') this.url = URL.createObjectURL(this.blob);
        this.disposeCapture();
        this.onChange();
      };
      this.error = null;
      this.reason = '';
      this.state = 'recording';
      this.startedAt = performance.now();
      this.recorder.start(250);
      this.onChange();
    } catch (error) {
      this.state = 'error';
      this.error = error.message;
      this.disposeCapture();
      throw error;
    }
  }

  capture() {
    if (!this.renderer) return;
    this.renderer.render(this.view.scene, this.camera);
  }

  stop(reason = 'Complete order') {
    if (this.state !== 'recording') return;
    this.reason = reason;
    this.wallSeconds = (performance.now()-this.startedAt)/1000;
    this.state = 'stopping';
    this.recorder.stop();
    this.onChange();
  }

  disposeCapture() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.canvas = null;
  }

  releaseVideo() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.blob = null;
  }

  save() {
    if (!this.url) return;
    const partial = this.reason !== 'Complete order' ? '-partial' : '';
    const extension = this.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const link = document.createElement('a');
    link.href = this.url;
    link.download = 'bread-and-coffee-order' + partial + '.' + extension;
    link.click();
  }
}
