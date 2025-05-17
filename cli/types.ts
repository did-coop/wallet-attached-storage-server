/**
 * Digital Signature Algorithm implementation.
 */
export interface ISigner {
  /**
   * id of verification method for verifying signatures by this signer.
   * e.g. a public key or other key id
   */
  id: string
  /**
   * sign some data to produce a signature.
   * Should be compatible with signer objects from https://github.com/digitalbazaar/zcap and related libraries.
   * @param signable - what to sign
   * @param signable.data - binary data to be signed
   */
  sign(signable: { data: Uint8Array }): Promise<Uint8Array>
}
