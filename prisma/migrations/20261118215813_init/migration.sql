-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "email" VARCHAR(150) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
    "company_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
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
    "certificate_filename" VARCHAR(500),
    "certificate_url" VARCHAR(1000),
    "certificate_expires_at" TIMESTAMPTZ(6),
    "certificate_subject" TEXT,
    "certificate_issuer" TEXT,
    "env_mode" VARCHAR(20) NOT NULL DEFAULT 'BETA',
    "api_key" VARCHAR(128) NOT NULL,
    "webhook_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_d4c3e047360e4f2042211910cf3" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL DEFAULT '0000',
    "name" VARCHAR(150) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "ubigeo" VARCHAR(6) NOT NULL DEFAULT '150101',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "document_type" VARCHAR(2) NOT NULL,
    "series" VARCHAR(4) NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_e725676647382eb54540d7128ba" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
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

    CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_items" (
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

    CONSTRAINT "PK_09473d260190ca635dbe2bc5a98" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_jobs" (
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

    CONSTRAINT "PK_1912e8716c7c300d7e0e429e974" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "IDX_users_company_id" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_ruc_key" ON "companies"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_143c7390478a2c2de3ee21bed0" ON "companies"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_bdc811820134900859ef243d6d" ON "series"("company_id", "document_type", "series");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_009cb4855f6ace7dc0b3f4f53e" ON "documents"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_d1e42394011a043d2c12d82a66" ON "documents"("company_id", "document_type", "series", "number");

-- CreateIndex
CREATE INDEX "IDX_914af31366f94d9e241b25622a" ON "document_items"("document_id");

-- CreateIndex
CREATE INDEX "IDX_5b7a62f93812c5c9169420c2bd" ON "invoice_jobs"("status", "next_run_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_jobs" ADD CONSTRAINT "invoice_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_jobs" ADD CONSTRAINT "invoice_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
