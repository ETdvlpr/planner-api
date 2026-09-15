import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncRegistry } from './sync-registry';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncRegistry],
  exports: [SyncRegistry],
})
export class SyncModule {}
