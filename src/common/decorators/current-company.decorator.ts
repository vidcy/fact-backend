import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Company } from '@prisma/client';

export const CurrentCompany = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Company => {
    const request = ctx.switchToHttp().getRequest();
    return request.company;
  },
);
