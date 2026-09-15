import { Module } from '@nestjs/common';
import { VoiceNotesController } from './voice-notes.controller';
import { VoiceNotesService } from './voice-notes.service';

@Module({
  controllers: [VoiceNotesController],
  providers: [VoiceNotesService],
  exports: [VoiceNotesService],
})
export class VoiceNotesModule {}
