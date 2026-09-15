import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SeqService } from '../common/crud/seq.service';

/**
 * Global: every feature module needs the client, and every write needs a
 * sequence number.
 */
@Global()
@Module({
  providers: [PrismaService, SeqService],
  exports: [PrismaService, SeqService],
})
export class DatabaseModule {}
