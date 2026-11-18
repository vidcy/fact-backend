import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Company } from '../../entities/company.entity';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];
    const bearerToken =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.split(' ')[1]
        : null;

    const apiKey =
      request.headers['x-api-key'] ||
      request.headers['X-API-KEY'] ||
      request.headers['X-Api-Key'] ||
      request.headers['x_api_key'] ||
      bearerToken ||
      request.query?.['x-api-key'] ||
      request.query?.['X-API-KEY'] ||
      request.query?.apiKey ||
      request.query?.api_key ||
      request.query?.token ||
      request.query?.key;

    if (!apiKey) {
      throw new UnauthorizedException(
        'Falta la cabecera de autenticación X-API-Key o Bearer Token',
      );
    }

    const companyRepo = this.dataSource.getRepository(Company);
    const company = await companyRepo.findOne({
      where: { api_key: apiKey, is_active: true },
    });

    if (!company) {
      throw new UnauthorizedException(
        'API Key inválida o empresa inactiva en el sistema',
      );
    }

    // Tenant isolation: assign company context
    request.company = company;
    return true;
  }
}
