CREATE TABLE IF NOT EXISTS contacts (
  id            SERIAL PRIMARY KEY,
  phone_number  VARCHAR(20),
  email         VARCHAR(255),
  linked_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  link_precedence VARCHAR(10) NOT NULL CHECK (link_precedence IN ('primary', 'secondary')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linked_id ON contacts(linked_id);
