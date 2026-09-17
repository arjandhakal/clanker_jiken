export const SERVICE = 'pi-typesafe-guard';
export const ACCOUNT = 'typesafe-api-key';
export interface SecretStore {
  getPassword(signal?: AbortSignal): Promise<string | undefined>;
  setPassword(key: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}
export async function systemStore(): Promise<SecretStore> {
  // Lazy import: unavailable native binaries/keychains must not disable the gate.
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(SERVICE, ACCOUNT, { linux: { store: 'secret-service' } });
}
export function validKey(value: string): boolean {
  return value.length >= 8 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
}
export class Credentials {
  private key?: string;
  private generation = 0;
  source: 'none' | 'session' | 'keychain' = 'none';
  constructor(private store = systemStore) {}
  get value(): string | undefined { return this.key; }
  clear(): void { this.generation++; this.key = undefined; this.source = 'none'; }
  async load(): Promise<void> {
    const generation = ++this.generation;
    const value = await (await this.store()).getPassword(AbortSignal.timeout(5000));
    if (generation !== this.generation) return;
    if (value && !validKey(value)) throw new Error('Stored key is invalid');
    this.key = value; this.source = value ? 'keychain' : 'none';
  }
  async set(value: string, persistent: boolean): Promise<void> {
    if (!validKey(value)) throw new Error('Invalid key format');
    const generation = ++this.generation;
    // Do not pretend storage succeeded or silently fall back to plaintext.
    if (persistent) await (await this.store()).setPassword(value);
    if (generation !== this.generation) return;
    this.key = value; this.source = persistent ? 'keychain' : 'session';
  }
  async remove(): Promise<boolean> {
    this.clear(); // Even failed OS deletion disables use in this process.
    return (await this.store()).deletePassword();
  }
}
