// Keep one client key for one invoice draft until the draft content changes.
// An unchanged draft after a network error therefore keeps the same key.
export function createInvoiceIssueKeyManager(initialSignature: string) {
  let signature = initialSignature;
  let key = globalThis.crypto.randomUUID();
  return {
    forSignature(nextSignature: string) {
      if (nextSignature !== signature) {
        signature = nextSignature;
        key = globalThis.crypto.randomUUID();
      }
      return key;
    },
  };
}
