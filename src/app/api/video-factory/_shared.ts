import { NextResponse } from "next/server";

import { BvfWorkflowError } from "@/services/video-factory/workflow";

export const bvfJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.message} ${errorText(error.cause)}`;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "";
}

export function bvfErrorResponse(error: unknown) {
  const text = errorText(error);
  const workflow = error instanceof BvfWorkflowError ? error : null;
  const context = workflow?.context ?? {};
  if (workflow?.code === "BVF_WORKFLOW_BRIEF_PREPARATION_FAILED") {
    return bvfJson({ error: "O pedido foi criado, mas o briefing não pôde ser preparado", code: workflow.code, ...context }, 503);
  }
  if (/NOT_FOUND|P0002/.test(text)) {
    return bvfJson({ error: "Registro não encontrado", code: "BVF_NOT_FOUND", ...context }, 404);
  }
  if (/PERMISSION_DENIED|42501/.test(text)) {
    return bvfJson({ error: "Seu cargo não permite esta operação", code: "BVF_PERMISSION_DENIED" }, 403);
  }
  if (/IDEMPOTENCY_CONFLICT/.test(text)) {
    return bvfJson({ error: "Esta solicitação já foi usada para outro pedido", code: "BVF_IDEMPOTENCY_CONFLICT" }, 409);
  }
  if (/QUOTE_REQUIRED/.test(text)) {
    return bvfJson({ error: "A cotação da geração ainda não está disponível", code: "BVF_GENERATION_QUOTE_REQUIRED" }, 409);
  }
  if (/BRIEF_CHANGED|QUOTE_CHANGED|NOT_WAITING|NOT_EDITABLE|NOT_CANCELLABLE|REANALYSIS_REQUIRED|ANALYSIS_REQUIRED|STATE/.test(text)) {
    return bvfJson({ error: "O pedido mudou ou não permite esta ação agora", code: "BVF_STATE_CONFLICT" }, 409);
  }
  if (/REQUIRED|INVALID|MISMATCH|VIDEO_TYPE|SINGLE_TARGET/.test(text)) {
    return bvfJson({ error: "Dados inválidos para esta operação", code: "BVF_INVALID_COMMAND" }, 422);
  }
  return bvfJson({ error: "Video Factory temporariamente indisponível", code: "BVF_UNAVAILABLE" }, 503);
}
