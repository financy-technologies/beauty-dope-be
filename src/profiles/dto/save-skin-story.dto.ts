import { IsIn, IsObject, IsOptional } from 'class-validator';
import { QuizSectionId } from '../entities/profile.entity';

const VALID_SECTIONS: QuizSectionId[] = ['biology', 'skin', 'hair', 'makeup'];

export class SaveSkinStorySectionDto {
  @IsIn(VALID_SECTIONS)
  section: QuizSectionId;

  /** Raw answers map: questionId → value(s) */
  @IsObject()
  answers: Record<string, string | string[]>;

  /** Client-computed insights — only sent when all 4 sections are done */
  @IsOptional()
  @IsObject()
  insights?: Record<string, unknown>;
}
