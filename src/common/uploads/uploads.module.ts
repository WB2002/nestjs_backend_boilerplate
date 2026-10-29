import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { FILE_SCANNER } from './scanners/file-scanner';
import { NoopFileScanner } from './scanners/noop-file-scanner';
import { ClamAvFileScanner } from './scanners/clamav-file-scanner';

@Module({
  imports: [ConfigModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: FILE_SCANNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isEnabled = config.get<string>('UPLOAD_VIRUS_SCAN') === 'true';
        if (!isEnabled) {
          return new NoopFileScanner();
        }
        const host = config.get<string>('CLAMAV_HOST') ?? 'clamav';
        const port = Number.parseInt(
          config.get<string>('CLAMAV_PORT') ?? '3310',
          10,
        );
        return new ClamAvFileScanner({
          host,
          port: Number.isFinite(port) ? port : 3310,
        });
      },
    },
  ],
  exports: [UploadsService, FILE_SCANNER],
})
export class UploadsModule {}
