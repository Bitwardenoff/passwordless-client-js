import { AtLeast, RegisterBeginResponse, RegisterCompleteResponse, SigninBeginResponse, SigninCompleteResponse, SigninMethod } from './types';

export interface Config {
  apiUrl: string;
  apiKey: string;
  origin: string;
  rpid: string;
}

export class Client {
  private config: Config = {
    apiUrl: 'https://v3.passwordless.dev',
    apiKey: '',
    origin: window.location.origin,
    rpid: window.location.hostname,
  }

  constructor(config: AtLeast<Config, 'apiKey'>) {
    Object.assign(this.config, config);
  }

  /**
   * Register a new credential to a user
   * 
   * @param {string} token Token generated by your backend and the Passwordless API
   */
  public async register(token: string, credentialNickname: string): Promise<void> {
    this.assertBrowserSupported();

    try {
      const registration = await this.registerBegin(token);

      registration.data.challenge = this.coerceToArrayBuffer(registration.data.challenge);
      registration.data.user.id = this.coerceToArrayBuffer(registration.data.user.id);
      registration.data.excludeCredentials?.forEach((cred) => {
        cred.id = this.coerceToArrayBuffer(cred.id);
      });

      const credential = await navigator.credentials.create({
        publicKey: registration.data,
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create credential (navigator.credentials.create)');
      }

      await this.registerComplete(credential, registration.sessionId, credentialNickname);
    } catch (error:any) {
      console.error(error);
      throw new Error(`Passwordless register failed: ${error.message}`);
    }
  }

  private async registerBegin(token: string): Promise<RegisterBeginResponse> {
    const response = await fetch(`${this.config.apiUrl}/register/begin`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        token,
        RPID: this.config.rpid,
        Origin: this.config.origin,
      }),
    });

    return response.json();
  }

  private async registerComplete(
    credential: PublicKeyCredential,
    sessionId: string,
    credentialNickname: string,
  ): Promise<RegisterCompleteResponse> {
    const attestationResponse = credential.response as AuthenticatorAttestationResponse;

    const response = await fetch(`${this.config.apiUrl}/register/complete`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        sessionId,
        response: {
          id: credential.id,
          rawId: this.coerceToBase64Url(new Uint8Array(credential.rawId)),
          type: credential.type,
          extensions: credential.getClientExtensionResults(),
          response: {
            AttestationObject: this.coerceToBase64Url(
              new Uint8Array(attestationResponse.attestationObject),
            ),
            clientDataJson: this.coerceToBase64Url(
              new Uint8Array(attestationResponse.clientDataJSON),
            ),
          },
        },
        nickname: credentialNickname,
        RPID: this.config.rpid,
        Origin: this.config.origin,
      }),
    });

    return response.json();
  }

  /**
   * Sign in a user using the userid
   * @param {string} userId 
   * @returns 
   */
  public async signinWithId(userId: string): Promise<string> {
    return this.signin({userId})
  }

  /**
   * Sign in a user using an alias
   * @param {string} alias 
   * @returns 
   */
  public async signinWithAlias(alias: string): Promise<string> {
    return this.signin({alias})
  }

  /**
   * Sign in a user
   *
   * @param {SigninMethod} Object containing either UserID or Alias
   * @returns
   */
  private async signin(signinMethod: SigninMethod): Promise<string> {
    this.assertBrowserSupported();

    try {
      const signin = await this.signinBegin(signinMethod);

      signin.data.challenge = this.coerceToArrayBuffer(signin.data.challenge);
      signin.data.allowCredentials?.forEach((cred) => {
        cred.id = this.coerceToArrayBuffer(cred.id);
      });

      const credential = await navigator.credentials.get({
        publicKey: signin.data,
      }) as PublicKeyCredential;

      const response = await this.signinComplete(credential, signin.sessionId);
      return response.data;
    } catch (error:any) {
      console.error(error);
      throw new Error(`Passwordless signin failed: ${error.message}`);
    }
  }

  private async signinBegin(signinMethod: SigninMethod): Promise<SigninBeginResponse> {
    const response = await fetch(`${this.config.apiUrl}/signin/begin`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        userId: "userId" in signinMethod ? signinMethod.userId : undefined,
        alias: "alias" in signinMethod ? signinMethod.alias : undefined,
        RPID: this.config.rpid,
        Origin: this.config.origin,
      }),
    });

    return response.json();
  }

  private async signinComplete(
    credential: PublicKeyCredential,
    sessionId: string,
  ): Promise<SigninCompleteResponse> {
    const assertionResponse = credential.response as AuthenticatorAssertionResponse;

    const response = await fetch(`${this.config.apiUrl}/signin/complete`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        sessionId,
        response: {
          id: credential.id,
          rawId: this.coerceToBase64Url(new Uint8Array(credential.rawId)),
          type: credential.type,
          extensions: credential.getClientExtensionResults(),
          response: {
            authenticatorData: this.coerceToBase64Url(
              new Uint8Array(assertionResponse.authenticatorData),
            ),
            clientDataJson: this.coerceToBase64Url(
              new Uint8Array(assertionResponse.clientDataJSON),
            ),
            signature: this.coerceToBase64Url(
              new Uint8Array(assertionResponse.signature),
            ),
          },
        },
        RPID: this.config.rpid,
        Origin: this.config.origin,
      }),
    });

    return response.json();
  }

  private assertBrowserSupported(): void {
    if (!isBrowserSupported()) {
      throw new Error('WebAuthn and PublicKeyCredentials are not supported on this browser/device');
    }
  }

  private createHeaders(): Record<string, string> {
    return {
      ApiKey: this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private coerceToArrayBuffer(value: unknown): ArrayBuffer {
    if (typeof value === 'string') {
      const base64 = this.base64UrlToBase64(value);
      const string = atob(base64);
      const bytes = new Uint8Array(string.length);
      for (let i = 0; i < string.length; i++) {
        bytes[i] = string.charCodeAt(i);
      }

      return bytes;
    }

    console.warn('Could not coerce to string:', value);
    throw new TypeError('Could not coerce to ArrayBuffer');
  }

  private coerceToBase64Url(value: unknown): string {
    const uint8Array = (() => {
      if (Array.isArray(value)) return Uint8Array.from(value);
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (value instanceof Uint8Array) return value;
      console.warn('Could not coerce to string:', value);
      throw new Error('Could not coerce to string');
    })();
    
    let string = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      string += String.fromCharCode(uint8Array[i]);
    }

    const base64String = btoa(string);
    return this.base64ToBase64Url(base64String);
  }

  private base64ToBase64Url(base64: string): string {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=*$/g, '');
  }

  private base64UrlToBase64(base64Url: string): string {
    return base64Url.replace(/-/g, '+').replace(/_/g, '/');
  }
}

export async function isPlatformSupported(): Promise<boolean> {
  if (!isBrowserSupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

export function isBrowserSupported(): boolean {
  return window.PublicKeyCredential !== undefined && typeof window.PublicKeyCredential === 'function';
}
