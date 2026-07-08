export class FinixClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly version: string;
  
  constructor() {
    this.baseUrl = process.env.FINIX_BASE_URL || "https://api-sandbox.finix.com";
    const username = process.env.FINIX_USERNAME || "";
    const password = process.env.FINIX_PASSWORD || "";
    
    if (!username || !password) {
      console.warn("Finix credentials (FINIX_USERNAME or FINIX_PASSWORD) are missing!");
    }
    
    this.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    this.version = process.env.FINIX_VERSION || "2022-02-01";
  }

  private async fetchApi(path: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    
    const headers = {
      "Authorization": this.authHeader,
      "Accept": "application/hal+json",
      "Content-Type": "application/json",
      "Finix-Version": this.version,
      ...(options.headers || {})
    };

    const res = await fetch(url, { ...options, headers });
    
    // Parse response
    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = text;
    }

    if (!res.ok) {
      const errorStr = typeof data === 'object' ? JSON.stringify(data) : data;
      console.error(`Finix API Error [${res.status}] on ${url}: ${errorStr}`);
      const err: any = new Error(`Finix Error: ${errorStr}`);
      err.details = typeof data === 'object' ? data : null;
      err.status = res.status;
      throw err;
    }

    return data;
  }

  // ==========================================
  // Onboarding (Direct API)
  // ==========================================

  async createAssociatedIdentity(identityId: string, payload: any) {
    return this.fetchApi(`/identities/${identityId}/associated_identities`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async createMerchant(identityId: string, processor: string) {
    return this.fetchApi(`/identities/${identityId}/merchants`, {
      method: "POST",
      body: JSON.stringify({ processor })
    });
  }

  async getVerification(verificationId: string) {
    return this.fetchApi(`/verifications/${verificationId}`);
  }

  // ==========================================
  // Identities
  // ==========================================

  async createSellerIdentity(payload: any) {
    return this.fetchApi("/identities", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getIdentity(identityId: string) {
    return this.fetchApi(`/identities/${identityId}`);
  }

  async updateIdentity(identityId: string, payload: any) {
    return this.fetchApi(`/identities/${identityId}`, {
      method: "PUT", // or PATCH depending on Finix API version, generally PUT
      body: JSON.stringify(payload)
    });
  }

  async listIdentityMerchants(identityId: string) {
    return this.fetchApi(`/identities/${identityId}/merchants`);
  }

  async listIdentityPaymentInstruments(identityId: string) {
    return this.fetchApi(`/identities/${identityId}/payment_instruments`);
  }

  // Confirmed via Finix docs (docs.finix.com/api): GET /fees, filtered by
  // the Transfer or Authorization ID it's linked to.
  async listFeesForTransfer(transferId: string) {
    return this.fetchApi(`/fees?transfer=${transferId}`);
  }

  // ==========================================
  // Files and Evidence
  // ==========================================

  async createFileResource(payload: { display_name: string; linked_to: string; type: string }) {
    return this.fetchApi("/files", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async uploadFileContent(fileId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const url = `${this.baseUrl}/files/${fileId}/upload`;
    
    const headers = {
      "Authorization": this.authHeader,
      "Accept": "application/hal+json",
      "Finix-Version": this.version,
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: formData
    });

    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = text;
    }

    if (!res.ok) {
      const errorStr = typeof data === 'object' ? JSON.stringify(data) : data;
      console.error(`Finix API Error [${res.status}] on ${url}: ${errorStr}`);
      throw new Error(`Finix Error: ${errorStr}`);
    }

    return data;
  }

  async createVerification(identityId: string) {
    return this.fetchApi(`/identities/${identityId}/verifications`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  // ==========================================
  // Merchants
  // ==========================================

  async getMerchant(merchantId: string) {
    return this.fetchApi(`/merchants/${merchantId}`);
  }

  // ==========================================
  // Payment Instruments
  // ==========================================

  async createPaymentInstrument(payload: any) {
    return this.fetchApi("/payment_instruments", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getPaymentInstrument(instrumentId: string) {
    return this.fetchApi(`/payment_instruments/${instrumentId}`);
  }

  // ==========================================
  // Transfers (Payments)
  // ==========================================

  /**
   * Per Finix's request (docs.finix.com/guides/online-payments/idempotency
   * and .../fraud-and-risk/fraud-detection): every /transfers call must
   * include idempotency_id (a fresh UUID per request, protects against
   * duplicate charges on retry) and fraud_session_id (the session key
   * returned by Finix.js Auth on the buyer's checkout page — see
   * src/lib/finix/fraudSession.ts on the client side for how to obtain it).
   *
   * idempotency_id is auto-generated here if the caller doesn't supply one.
   * fraud_session_id is NOT auto-generated (it can only come from a real
   * buyer session) — this throws rather than silently omitting it, so a
   * future checkout integration can't accidentally ship without it.
   */
  async createTransfer(payload: { fraud_session_id: string; idempotency_id?: string; [key: string]: any }) {
    if (!payload.fraud_session_id) {
      throw new Error(
        "createTransfer requires fraud_session_id (from Finix.js Auth's getSessionKey() " +
          "on the buyer's checkout page). See src/lib/finix/fraudSession.ts."
      );
    }

    const body = {
      ...payload,
      idempotency_id: payload.idempotency_id ?? crypto.randomUUID(),
    };

    return this.fetchApi("/transfers", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async getTransfer(transferId: string) {
    return this.fetchApi(`/transfers/${transferId}`);
  }

  // ==========================================
  // Reversals (Refunds)
  // ==========================================

  async createTransferReversal(transferId: string, payload: any) {
    return this.fetchApi(`/transfers/${transferId}/reversals`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listTransferReversals(transferId: string) {
    return this.fetchApi(`/transfers/${transferId}/reversals`);
  }

  // ==========================================
  // Settlements / Payouts (Stubs)
  // ==========================================

  async listSettlements(merchantId?: string) {
    return this.fetchApi(merchantId ? `/settlements?merchant=${merchantId}` : "/settlements");
  }
  
  async getSettlement(settlementId: string) {
    return this.fetchApi(`/settlements/${settlementId}`);
  }

  // ==========================================
  // Disputes (Stubs)
  // ==========================================

  async listDisputes(merchantId?: string) {
    return this.fetchApi(merchantId ? `/disputes?merchant=${merchantId}` : "/disputes");
  }

  async getDispute(disputeId: string) {
    return this.fetchApi(`/disputes/${disputeId}`);
  }

  async listTransfersForMerchant(merchantId: string) {
    return this.fetchApi(`/transfers?merchant=${merchantId}`);
  }
}

// Export a singleton instance for ease of use
export const finixClient = new FinixClient();

