import { IsIn } from 'class-validator';

export class CheckQuizQuestionAnswerDto {
  @IsIn(['A', 'B', 'C', 'D'])
  selectedOption: 'A' | 'B' | 'C' | 'D';
}
