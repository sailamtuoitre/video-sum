import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AskChatMessageDto } from './dto/ask-chat-message.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ListChatMemoryEmbeddingsQueryDto } from './dto/list-chat-memory-embeddings.query';
import { RebuildChatMemoryEmbeddingsDto } from './dto/rebuild-chat-memory-embeddings.dto';
import { UpdateChatMessageDto } from './dto/update-chat-message.dto';
import { ChatMessageService } from './chat-message.service';

@Controller('chat-messages')
export class ChatMessageController {
  constructor(private readonly chatMessageService: ChatMessageService) {}

  @Post()
  create(@Body() createChatMessageDto: CreateChatMessageDto) {
    return this.chatMessageService.create(createChatMessageDto);
  }

  // @Post('ask')
  // ask(@Body() askChatMessageDto: AskChatMessageDto) {
  //   return this.chatMessageService.ask(askChatMessageDto);
  // }

  // @Get('memory-embeddings')
  // listMemoryEmbeddings(@Query() query: ListChatMemoryEmbeddingsQueryDto) {
  //   return this.chatMessageService.listMemoryEmbeddings(query);
  // }

  // @Post('memory-embeddings/rebuild')
  // rebuildMemoryEmbeddings(
  //   @Body() rebuildChatMemoryEmbeddingsDto: RebuildChatMemoryEmbeddingsDto,
  // ) {
  //   return this.chatMessageService.rebuildMemoryEmbeddings(
  //     rebuildChatMemoryEmbeddingsDto,
  //   );
  // }

  @Get()
  findAll(@Query('sessionId') sessionId?: string) {
    return this.chatMessageService.findAll(sessionId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatMessageService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateChatMessageDto: UpdateChatMessageDto,
  ) {
    return this.chatMessageService.update(id, updateChatMessageDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatMessageService.remove(id);
  }
}
