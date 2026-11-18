import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * ============================================================================
 * CCOFACT PRO - CORPORACIÓN CCOPLEX
 * SERVIDOR PRINCIPAL Y MOTOR DE FACTURACIÓN ELECTRÓNICA SUNAT UBL 2.1
 * ============================================================================
 */
async function bootstrap() {
  const logger = new Logger('CCOFACT-Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Habilitar CORS para permitir integraciones seguras desde Vercel, Control Finanzas y cualquier cliente
  app.enableCors({
    origin: true, // Refleja dinámicamente el origen solicitante (Vercel, localhost, etc.)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Authorization,x-api-key,Accept,Origin,X-Requested-With',
  });

  // Validación rigurosa de entradas y payloads DTO con transformación automática
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Configuración de la Documentación Interactiva Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('CCOFACT PRO - API de Facturación Electrónica SUNAT UBL 2.1')
    .setDescription(
      'Documentación Oficial de Integración para Empresas y Desarrolladores.\n\n' +
      'Desarrollado por Corporación Ccoplex.\n\n' +
      'Motor soberano y de alto rendimiento para emisión, firma digital X.509 C14N, ' +
      'comunicación directa SOAP con SUNAT, generación de QR oficial, representación impresa (A4 y Ticket POS 80mm) ' +
      'y arquitectura a prueba de errores con colas transaccionales PostgreSQL (SKIP LOCKED).'
    )
    .setVersion('2.0.0-ENTERPRISE')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: 'Clave de API única de su empresa (emitida por Corporación Ccoplex)',
      },
      'api-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'CCOFACT PRO API Docs | Corporación Ccoplex',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  const port = process.env.PORT || 4001;
  await app.listen(port);

  logger.log(`====================================================================`);
  logger.log(`CCOFACT PRO - CORPORACION CCOPLEX - MOTOR SUNAT UBL 2.1 INICIADO`);
  logger.log(`Servidor API escuchando en:        http://localhost:${port}`);
  logger.log(`Portal Swagger / OpenAPI en:      http://localhost:${port}/api/docs`);
  logger.log(`Endpoint Principal de Emision:    POST http://localhost:${port}/api/v1/ccofact/emitir`);
  logger.log(`Base de Datos:                    PostgreSQL 18 (localhost:5432/fact)`);
  logger.log(`Modo de Aislamiento Concurrente:  SELECT FOR UPDATE (Cero Doble Facturacion)`);
  logger.log(`====================================================================`);
}
bootstrap();
