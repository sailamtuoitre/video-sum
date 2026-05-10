import { Global, Module } from '@nestjs/common';
import { GroqGatewayService } from './groq-gateway.service';

@Global()
@Module({
  providers: [GroqGatewayService],
  exports: [GroqGatewayService],
})
export class GroqGatewayModule {}
