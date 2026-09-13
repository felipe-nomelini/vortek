import "server-only";

import type { BvfAttemptStatus, BvfMoney } from "@/lib/video-factory/contracts";

export type VideoProviderGenerateRequest = {
  attemptId: string;
  idempotencyKey: string;
  prompt: string;
  model: string;
  referenceAssets: Array<{
    mimeType: string;
    signedUrl: string;
  }>;
  options: Record<string, unknown>;
};

export type VideoProviderGenerateResult = {
  externalOperationId: string;
  status: BvfAttemptStatus;
  rawResponse: Record<string, unknown>;
};

export type VideoProviderStatusResult = {
  status: BvfAttemptStatus;
  estimatedCost?: BvfMoney;
  actualCost?: BvfMoney;
  errorCode?: string;
  errorMessage?: string;
  rawResponse: Record<string, unknown>;
};

export type VideoProviderDownloadResult = {
  body: ReadableStream<Uint8Array>;
  mimeType: "video/mp4";
  contentLength?: number;
};

export interface VideoProvider {
  readonly code: string;

  estimateCost(request: VideoProviderGenerateRequest): Promise<BvfMoney>;
  generate(request: VideoProviderGenerateRequest): Promise<VideoProviderGenerateResult>;
  getStatus(externalOperationId: string): Promise<VideoProviderStatusResult>;
  download(externalOperationId: string): Promise<VideoProviderDownloadResult>;
}
