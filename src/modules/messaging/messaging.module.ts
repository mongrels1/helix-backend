import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MessagingController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingRepository } from './messaging.repository';
import { MessagingService } from './messaging.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? '',
      }),
    }),
  ],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingRepository, MessagingGateway],
  exports: [MessagingService, MessagingRepository],
})
export class MessagingModule {}
