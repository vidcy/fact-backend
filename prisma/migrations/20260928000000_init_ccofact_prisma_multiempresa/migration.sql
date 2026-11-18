-- ============================================================================
-- CCOFACT PRO - MIGRACIÓN INICIAL PRISMA ORM (CORPORACIÓN CCOPLEX)
-- ============================================================================
-- Arquitectura Multi-Empresas para Facturación Electrónica SUNAT UBL 2.1
-- Base de Datos: PostgreSQL 18
-- ============================================================================

-- 1. Habilitar extensión UUID para generación criptográfica de identificadores
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla de Empresas Emisoras (Multi-Tenant)
CREATE TABLE IF NOT EXISTS "companies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "ruc" VARCHAR(11) NOT NULL,
    "razon_social" VARCHAR(255) NOT NULL,
    "nombre_comercial" VARCHAR(255),
    "direccion" VARCHAR(255) NOT NULL,
    "ubigeo" VARCHAR(6) NOT NULL DEFAULT '150101',
    "departamento" VARCHAR(100) NOT NULL DEFAULT 'LIMA',
    "provincia" VARCHAR(100) NOT NULL DEFAULT 'LIMA',
    "distrito" VARCHAR(100) NOT NULL DEFAULT 'LIMA',
    "urbanizacion" VARCHAR(100) DEFAULT '-',
    "email" VARCHAR(150),
    "telefono" VARCHAR(50),
    "logo_url" TEXT,
    "sol_user" VARCHAR(100) NOT NULL DEFAULT 'MODDATOS',
    "sol_pass" VARCHAR(100) NOT NULL DEFAULT 'moddatos',
    "certificate_pfx_base64" TEXT,
    "certificate_password" VARCHAR(255),
    "env_mode" VARCHAR(20) NOT NULL DEFAULT 'BETA',
    "api_key" VARCHAR(128) NOT NULL,
    "webhook_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_companies" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_companies_ruc" UNIQUE ("ruc"),
    CONSTRAINT "UQ_companies_api_key" UNIQUE ("api_key")
);

-- 3. Tabla de Establecimientos Anexos / Sucursales
CREATE TABLE IF NOT EXISTS "branches" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL DEFAULT '0000',
    "name" VARCHAR(150) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "ubigeo" VARCHAR(6) NOT NULL DEFAULT '150101',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_branches" PRIMARY KEY ("id"),
    CONSTRAINT "FK_branches_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE
);

-- 4. Tabla de Series y Correlativos Atómicos (Garantía Cero Duplicados)
CREATE TABLE IF NOT EXISTS "series" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "document_type" VARCHAR(2) NOT NULL,
    "series" VARCHAR(4) NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_series" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_series_company_doc_series" UNIQUE ("company_id", "document_type", "series"),
    CONSTRAINT "FK_series_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_series_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL
);

-- 5. Tabla Principal de Comprobantes de Pago Electrónicos (CPE)
CREATE TABLE IF NOT EXISTS "documents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "idempotency_key" VARCHAR(100),
    "document_type" VARCHAR(2) NOT NULL,
    "series" VARCHAR(4) NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" VARCHAR(20) NOT NULL,
    "issue_date" VARCHAR(10) NOT NULL,
    "issue_time" VARCHAR(8) NOT NULL,
    "due_date" VARCHAR(10),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PEN',
    "operation_type" VARCHAR(4) NOT NULL DEFAULT '0101',
    "payment_type" VARCHAR(20) NOT NULL DEFAULT 'Contado',
    "payment_terms" JSONB,
    "client_doc_type" VARCHAR(1) NOT NULL,
    "client_doc_number" VARCHAR(15) NOT NULL,
    "client_name" VARCHAR(255) NOT NULL,
    "client_address" VARCHAR(255),
    "client_email" VARCHAR(150),
    "total_gravada" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_exonerada" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_inafecta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_gratuita" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_igv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_isc" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_icbper" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_descuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_cargos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ref_document_type" VARCHAR(2),
    "ref_series" VARCHAR(4),
    "ref_number" INTEGER,
    "ref_reason_code" VARCHAR(2),
    "ref_reason_desc" VARCHAR(255),
    "xml_digest_value" VARCHAR(64),
    "xml_signature_value" TEXT,
    "qr_data" TEXT,
    "xml_content" TEXT,
    "cdr_xml" TEXT,
    "cdr_zip_base64" TEXT,
    "status" VARCHAR(25) NOT NULL DEFAULT 'DRAFT',
    "sunat_response_code" VARCHAR(20),
    "sunat_description" TEXT,
    "sunat_notes" JSONB,
    "sunat_sent_at" TIMESTAMPTZ(6),
    "sunat_response_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_documents" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_documents_company_doc_series_num" UNIQUE ("company_id", "document_type", "series", "number"),
    CONSTRAINT "UQ_documents_company_idempotency" UNIQUE ("company_id", "idempotency_key"),
    CONSTRAINT "FK_documents_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_documents_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL
);

-- 6. Tabla de Líneas de Detalle del Comprobante
CREATE TABLE IF NOT EXISTS "document_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "document_id" UUID NOT NULL,
    "item_order" INTEGER NOT NULL,
    "code" VARCHAR(50),
    "description" VARCHAR(500) NOT NULL,
    "unit_measure" VARCHAR(5) NOT NULL DEFAULT 'NIU',
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit_value" DECIMAL(12,4) NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "igv_affectation_type" VARCHAR(2) NOT NULL DEFAULT '10',
    "igv_percentage" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "igv_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "PK_document_items" PRIMARY KEY ("id"),
    CONSTRAINT "FK_document_items_document" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);

-- 7. Tabla de Colas Transaccionales (PostgreSQL SKIP LOCKED)
CREATE TABLE IF NOT EXISTS "invoice_jobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "job_type" VARCHAR(30) NOT NULL DEFAULT 'SEND_BILL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(100),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_invoice_jobs" PRIMARY KEY ("id"),
    CONSTRAINT "FK_invoice_jobs_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_invoice_jobs_document" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);

-- Índices de alto rendimiento
CREATE INDEX IF NOT EXISTS "IDX_documents_company_status" ON "documents" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "IDX_documents_company_date" ON "documents" ("company_id", "issue_date");
CREATE INDEX IF NOT EXISTS "IDX_document_items_doc_id" ON "document_items" ("document_id");
CREATE INDEX IF NOT EXISTS "IDX_invoice_jobs_status_run" ON "invoice_jobs" ("status", "next_run_at");
