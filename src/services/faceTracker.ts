import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export interface HeadPosition {
  id: number;
  /** Center X in pixels relative to the stage container (already mirrored to match scaleX(-1)) */
  x: number;
  /** Top-of-head Y in pixels relative to the stage container */
  y: number;
  /** Estimated face box width in display pixels */
  faceWidth: number;
  confidence: number;
}

const BLAZEFACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export class HeadTrackerService {
  private detector: FaceDetector | null = null;
  private isInitializing = false;
  private lastVideoTime = -1;

  public async init(): Promise<boolean> {
    if (this.detector) return true;
    if (this.isInitializing) return false;
    this.isInitializing = true;

    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm-vision');
      try {
        this.detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: BLAZEFACE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        });
      } catch {
        // Fallback to CPU delegate if WebGL/GPU delegate isn't available
        this.detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: BLAZEFACE_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        });
      }
      return true;
    } catch {
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  public isReady(): boolean {
    return this.detector !== null;
  }

  /**
   * Detects faces in the current video frame and maps them into mirrored
   * object-cover container pixel coordinates.
   */
  public detectHeads(
    video: HTMLVideoElement,
    containerWidth: number,
    containerHeight: number
  ): HeadPosition[] | null {
    if (
      !this.detector ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0 ||
      containerWidth === 0 ||
      containerHeight === 0
    ) {
      return null;
    }

    // Only run inference when a new video frame arrives
    if (video.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = video.currentTime;

    const result = this.detector.detectForVideo(video, performance.now());
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Match CSS `object-cover` + `scale-x-[-1]` geometry
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const renderedWidth = vw * scale;
    const renderedHeight = vh * scale;
    const offsetX = (renderedWidth - containerWidth) / 2;
    const offsetY = (renderedHeight - containerHeight) / 2;

    return result.detections
      .filter((det) => Boolean(det.boundingBox))
      .slice(0, 3)
      .map((det, idx) => {
        const box = det.boundingBox!;
        const rawCenterX = box.originX + box.width / 2;
        // Mirror horizontally because video has CSS `scale-x-[-1]`
        const mirroredCenterX = vw - rawCenterX;
        const displayX = mirroredCenterX * scale - offsetX;
        const displayTopY = box.originY * scale - offsetY;
        const displayFaceWidth = box.width * scale;
        const confidence = det.categories?.[0]?.score ?? 0.5;

        return {
          id: idx,
          x: displayX,
          y: displayTopY,
          faceWidth: displayFaceWidth,
          confidence,
        };
      });
  }

  public dispose(): void {
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
  }
}
