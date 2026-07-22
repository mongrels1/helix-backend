import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const KSPORTS_MODULES = ['addsub', 'times', 'fracdec', 'formula'] as const;
export type KSportsModule = (typeof KSPORTS_MODULES)[number];

export class RecordFactDto {
  @IsIn(KSPORTS_MODULES as unknown as string[])
  module!: KSportsModule;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  factKey!: string;
}
