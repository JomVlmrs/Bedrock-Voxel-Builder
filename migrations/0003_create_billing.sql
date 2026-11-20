CREATE TABLE billing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  paypal_order_id text UNIQUE,
  tier text NOT NULL CHECK (tier IN ('builder_plus', 'pro', 'studio')),
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  status text NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING', 'CREATED', 'COMPLETED', 'FAILED')),
  capture_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz
);

CREATE INDEX idx_billing_orders_user_created
  ON billing_orders (user_id, created_at DESC);

CREATE TABLE user_entitlements (
  user_id text PRIMARY KEY,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'builder_plus', 'pro', 'studio')),
  tier_rank integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  order_id uuid REFERENCES billing_orders(id),
  purchased_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);