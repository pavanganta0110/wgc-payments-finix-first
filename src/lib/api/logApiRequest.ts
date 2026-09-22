import { prisma } from "@/lib/prisma";

/** Fire-and-forget usage log — never blocks or fails the actual response. */
export function logApiRequest(params: {
  apiKeyId: string;
  churchId: string;
  method: string;
  path: string;
  statusCode: number;
  requestId: string;
  idempotencyKey?: string | null;
}): void {
  prisma.apiRequestLog
    .create({
      data: {
        apiKeyId: params.apiKeyId,
        churchId: params.churchId,
        method: params.method,
        path: params.path,
        statusCode: params.statusCode,
        requestId: params.requestId,
        idempotencyKey: params.idempotencyKey ?? null,
      },
    })
    .catch((err) => console.error("Failed to write API request log:", err));
}
