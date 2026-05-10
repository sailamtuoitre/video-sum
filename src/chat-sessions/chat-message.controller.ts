import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ChatSessionService } from './chat-session.service';

@Controller('chat-messages')
export class ChatMessageController {
  constructor(private readonly chatSessionService: ChatSessionService) {}

  @Get()
  findAll(@Query('sessionId') sessionId: string) {
    return this.chatSessionService.findMessages(sessionId);
  }

  @Post('ask')
  ask(@Body() body: { sessionId: string; content: string }) {
    return this.chatSessionService.ask(body.sessionId, body.content);
  }
}
