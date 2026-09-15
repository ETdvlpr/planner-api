import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import {
  App,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

/**
 * Owns the single `firebase-admin` app instance.
 *
 * Token verification is deliberately **local**: `verifyIdToken` checks the JWT
 * signature against Google's public keys, which the SDK caches and refreshes on
 * its own schedule. We never pass `checkRevoked: true` on the request path — it
 * forces a network round trip per call, and this API shares one vCPU with six
 * other applications. Revocation is handled where it matters instead: the
 * account-deletion path deletes the Firebase user, and the ID token dies with
 * its refresh token within the hour.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app!: App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const existing = getApps();
    if (existing.length > 0) {
      this.app = existing[0];
      return;
    }

    const projectId = this.config.get<string>('firebase.projectId') ?? '';
    const credential = this.resolveCredential();

    this.app = credential
      ? initializeApp({ credential: cert(credential), projectId })
      : initializeApp({ projectId });

    if (!credential) {
      // Verification still works — it needs only the project id — but nothing
      // that acts *on* Firebase does, and GDPR erasure is one of those things.
      this.logger.warn(
        'Firebase initialised without service-account credentials: token ' +
          'verification works, but account deletion in Firebase will fail.',
      );
    }
  }

  /** Verifies an ID token and returns its claims. Throws on anything invalid. */
  verifyIdToken(token: string): Promise<DecodedIdToken> {
    return getAuth(this.app).verifyIdToken(token);
  }

  /**
   * Deletes the Firebase user. Account erasure spans two systems and this is
   * the half that must happen first — a deleted Postgres row with a live
   * Firebase user would be re-provisioned by the next request that arrives.
   */
  async deleteUser(firebaseUid: string): Promise<void> {
    await getAuth(this.app).deleteUser(firebaseUid);
  }

  private resolveCredential(): ServiceAccount | null {
    const path = this.config.get<string>('firebase.serviceAccountPath');
    if (path) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
      return null;
    }

    const clientEmail = this.config.get<string>('firebase.clientEmail');
    const privateKey = this.config.get<string>('firebase.privateKey');
    if (!clientEmail || !privateKey) return null;

    return {
      projectId: this.config.get<string>('firebase.projectId'),
      clientEmail,
      // .env files cannot hold real newlines, so the key arrives escaped.
      privateKey: privateKey.replace(/\\n/g, '\n'),
    };
  }
}
