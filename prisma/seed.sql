-- ============================================================================
-- CCOFACT PRO - SEED OFICIAL PARA BASE DE DATOS POSTGRESQL (UBUNTU / CLOUD)
-- Contenido: Únicamente el Usuario Administrador Maestro del Sistema.
-- Las empresas emisoras, certificados y series se crean desde el panel web.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabla de Usuarios y Accesos Multi-Tenant (si no existe)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Garantizar existencia de columna company_id en bases de datos existentes
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "IDX_users_company_id" ON users (company_id);

-- 2. Insertar o Actualizar Únicamente al Administrador Maestro
-- Clave por defecto: admin123 (hasheada con scrypt)
INSERT INTO users (
  id,
  email,
  password_hash,
  name,
  role,
  company_id,
  is_active,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'admin@ccoplex.com',
  'd0e7b8ed71ba8886a55227b08be14632:95f1cd3861a352e4a5ecad38007997488f833724794ea7f20b9ab9fca0693e0fb22d06a78a1f2ae108fcade62afbb32a8c4797cc1f0c7fece4fea6bc575c9424',
  'Administrador Maestro Ccoplex',
  'SUPER_ADMIN',
  NULL,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = 'SUPER_ADMIN',
  is_active = true,
  updated_at = NOW();
