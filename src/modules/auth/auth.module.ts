import { Global, Module } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';

/**
 * Global because the auth guard is global: every request needs the Firebase app
 * before any feature module is reached.
 */
@Global()
@Module({
  providers: [FirebaseAdminService],
  exports: [FirebaseAdminService],
})
export class AuthModule {}
