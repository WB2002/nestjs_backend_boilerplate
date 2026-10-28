import { IsString, MaxLength } from 'class-validator';

export class ExampleRealtimeMessageDto {
  @IsString()
  @MaxLength(500)
  text!: string;
}
