-- 建库与选库交给 scripts/migrate-database.mjs 按 DB_NAME 环境变量动态执行，
-- 这样部署方可以用任意库名（不强制叫 aeranexa），这里只保留纯表结构。

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  avatar VARCHAR(255) NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  email_verified_at DATETIME NULL,
  transfer_enable BIGINT UNSIGNED NOT NULL DEFAULT 0,
  upload_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  download_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  balance BIGINT NOT NULL DEFAULT 0,
  commission_balance BIGINT NOT NULL DEFAULT 0,
  plan_id BIGINT UNSIGNED NULL,
  device_limit_override INT UNSIGNED NULL COMMENT '单用户覆盖套餐设备数，NULL 跟随套餐，0 表示不限',
  expired_at BIGINT NULL,
  remind_expire TINYINT(1) NOT NULL DEFAULT 1,
  remind_traffic TINYINT(1) NOT NULL DEFAULT 1,
  telegram_id BIGINT NULL,
  uuid CHAR(36) NOT NULL,
  subscription_token CHAR(32) NOT NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_uuid_unique (uuid),
  UNIQUE KEY users_subscription_token_unique (subscription_token),
  KEY users_role_index (role),
  KEY users_active_index (is_active),
  KEY users_plan_id_index (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY auth_sessions_user_id_index (user_id),
  KEY auth_sessions_expires_at_index (expires_at),
  CONSTRAINT auth_sessions_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 套餐与访问分组
CREATE TABLE IF NOT EXISTS access_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY access_groups_name_unique (name),
  KEY access_groups_active_index (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  content TEXT NULL,
  transfer_enable BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '套餐流量，单位 GB',
  speed_limit INT UNSIGNED NULL COMMENT 'Mbps，NULL 表示不限速',
  device_limit INT UNSIGNED NULL COMMENT '设备数上限（limitIp + 订阅 HWID），NULL 或 0 表示不限',
  month_price BIGINT UNSIGNED NULL COMMENT '金额单位：分',
  quarter_price BIGINT UNSIGNED NULL,
  half_year_price BIGINT UNSIGNED NULL,
  year_price BIGINT UNSIGNED NULL,
  two_year_price BIGINT UNSIGNED NULL,
  three_year_price BIGINT UNSIGNED NULL,
  onetime_price BIGINT UNSIGNED NULL,
  reset_price BIGINT UNSIGNED NULL,
  reset_traffic_method TINYINT UNSIGNED NULL,
  capacity_limit INT UNSIGNED NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  is_renewable TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY plans_group_id_index (group_id),
  KEY plans_visible_sort_index (is_visible, sort_order),
  CONSTRAINT plans_group_id_foreign
    FOREIGN KEY (group_id) REFERENCES access_groups (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 支付渠道、订单与支付审计
CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(32) NOT NULL,
  provider VARCHAR(50) NOT NULL COMMENT '例如 epay、stripe',
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(255) NULL,
  config JSON NOT NULL COMMENT '敏感配置写入前应由应用层加密',
  notify_domain VARCHAR(255) NULL,
  handling_fee_fixed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  handling_fee_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_methods_uuid_unique (uuid),
  KEY payment_methods_enabled_sort_index (is_enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  discount_type TINYINT UNSIGNED NOT NULL COMMENT '1 固定金额，2 百分比',
  discount_value BIGINT UNSIGNED NOT NULL,
  max_uses INT UNSIGNED NULL,
  max_uses_per_user INT UNSIGNED NULL,
  plan_ids JSON NULL,
  periods JSON NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY coupons_code_unique (code),
  KEY coupons_active_time_index (is_active, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  invite_user_id BIGINT UNSIGNED NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  coupon_id BIGINT UNSIGNED NULL,
  payment_method_id BIGINT UNSIGNED NULL,
  order_type TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 新购，2 续费，3 升级，4 流量重置',
  period VARCHAR(32) NOT NULL,
  trade_no VARCHAR(64) NOT NULL,
  provider_trade_no VARCHAR(255) NULL,
  total_amount BIGINT UNSIGNED NOT NULL COMMENT '金额单位：分',
  handling_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  surplus_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  refund_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  balance_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  surplus_order_ids JSON NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 待支付，1 开通中，2 已取消，3 已完成，4 已折抵，5 已退款',
  commission_status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  commission_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  actual_commission_amount BIGINT UNSIGNED NULL,
  fulfillment_source VARCHAR(16) NULL COMMENT '履约来源：gateway 网关回调，admin 后台人工补单；NULL 表示尚未履约',
  fulfilled_by_admin_id BIGINT UNSIGNED NULL COMMENT '人工补单时操作的管理员',
  admin_remark VARCHAR(500) NULL COMMENT '后台内部备注（补单原因等），仅后台可见',
  paid_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY orders_trade_no_unique (trade_no),
  KEY orders_user_status_created_index (user_id, status, created_at),
  KEY orders_plan_id_index (plan_id),
  KEY orders_payment_method_id_index (payment_method_id),
  KEY orders_provider_trade_no_index (provider_trade_no),
  CONSTRAINT orders_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT orders_invite_user_id_foreign
    FOREIGN KEY (invite_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT orders_plan_id_foreign
    FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT,
  CONSTRAINT orders_coupon_id_foreign
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE SET NULL,
  CONSTRAINT orders_payment_method_id_foreign
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_usages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  discount_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY coupon_usages_order_unique (order_id),
  KEY coupon_usages_coupon_user_index (coupon_id, user_id),
  CONSTRAINT coupon_usages_coupon_id_foreign
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE RESTRICT,
  CONSTRAINT coupon_usages_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT coupon_usages_order_id_foreign
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  payment_method_id BIGINT UNSIGNED NOT NULL,
  provider_trade_no VARCHAR(255) NULL,
  amount BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  checkout_type TINYINT UNSIGNED NULL COMMENT '0 二维码，1 跳转链接',
  checkout_data TEXT NULL,
  request_payload JSON NULL,
  response_payload JSON NULL,
  paid_at DATETIME NULL,
  failed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY payment_transactions_order_status_index (order_id, status),
  KEY payment_transactions_provider_trade_no_index (provider_trade_no),
  CONSTRAINT payment_transactions_order_id_foreign
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT payment_transactions_method_id_foreign
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  provider VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(255) NULL,
  event_type VARCHAR(64) NOT NULL,
  signature_valid TINYINT(1) NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_message TEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY payment_events_provider_event_unique (provider, provider_event_id),
  KEY payment_events_order_received_index (order_id, received_at),
  KEY payment_events_transaction_id_index (transaction_id),
  CONSTRAINT payment_events_order_id_foreign
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT payment_events_transaction_id_foreign
    FOREIGN KEY (transaction_id) REFERENCES payment_transactions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 支付退款、回调接收与对账。退款账本和订单的升级差额 refund_amount 分离，避免混淆两种资金语义。
CREATE TABLE IF NOT EXISTS payment_refunds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT UNSIGNED NOT NULL COMMENT '退款金额，单位：分',
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_refunds_transaction_unique (transaction_id),
  KEY payment_refunds_order_created_index (order_id, created_at),
  KEY payment_refunds_user_created_index (user_id, created_at),
  CONSTRAINT payment_refunds_order_id_foreign FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_transaction_id_foreign FOREIGN KEY (transaction_id) REFERENCES payment_transactions (id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_user_id_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_admin_id_foreign FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 网关回调先落接收账本，再映射为 payment_events；无效签名和找不到订单的事件也可追溯。
CREATE TABLE IF NOT EXISTS payment_callback_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  timestamp_seconds BIGINT UNSIGNED NOT NULL,
  signature_valid TINYINT(1) NOT NULL DEFAULT 0,
  payload JSON NULL,
  payload_sha256 CHAR(64) NOT NULL,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_message VARCHAR(500) NULL,
  transaction_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY payment_callback_events_provider_event_unique (provider, event_id),
  KEY payment_callback_events_status_received_index (processing_status, received_at),
  KEY payment_callback_events_transaction_index (transaction_id),
  CONSTRAINT payment_callback_events_transaction_id_foreign FOREIGN KEY (transaction_id) REFERENCES payment_transactions (id) ON DELETE SET NULL,
  CONSTRAINT payment_callback_events_order_id_foreign FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 网关密钥与普通支付方式配置隔离，始终存 AES-256-GCM 密文，后台不读取明文。
CREATE TABLE IF NOT EXISTS payment_method_credentials (
  payment_method_id BIGINT UNSIGNED NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_iv VARCHAR(64) NOT NULL,
  secret_auth_tag VARCHAR(64) NOT NULL,
  updated_by_admin_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_method_id),
  CONSTRAINT payment_method_credentials_method_id_foreign FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON DELETE CASCADE,
  CONSTRAINT payment_method_credentials_admin_id_foreign FOREIGN KEY (updated_by_admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliation_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  imported_by_admin_id BIGINT UNSIGNED NOT NULL,
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  matched_rows INT UNSIGNED NOT NULL DEFAULT 0,
  issue_rows INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reconciliation_batches_provider_file_unique (provider, file_sha256),
  KEY reconciliation_batches_created_index (created_at),
  CONSTRAINT reconciliation_batches_admin_id_foreign FOREIGN KEY (imported_by_admin_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliation_rows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  line_number INT UNSIGNED NOT NULL,
  provider_trade_no VARCHAR(255) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  provider_status VARCHAR(32) NOT NULL,
  paid_at DATETIME NULL,
  match_status VARCHAR(32) NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  resolution_status VARCHAR(32) NOT NULL DEFAULT 'open',
  resolution_note VARCHAR(500) NULL,
  resolved_by_admin_id BIGINT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reconciliation_rows_batch_row_unique (batch_id, line_number),
  KEY reconciliation_rows_status_index (match_status, resolution_status),
  KEY reconciliation_rows_transaction_index (transaction_id),
  CONSTRAINT reconciliation_rows_batch_id_foreign FOREIGN KEY (batch_id) REFERENCES reconciliation_batches (id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_rows_transaction_id_foreign FOREIGN KEY (transaction_id) REFERENCES payment_transactions (id) ON DELETE SET NULL,
  CONSTRAINT reconciliation_rows_admin_id_foreign FOREIGN KEY (resolved_by_admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 邀请、返佣与钱包流水
CREATE TABLE IF NOT EXISTS invite_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  code CHAR(32) NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 可用，1 停用',
  page_views INT UNSIGNED NOT NULL DEFAULT 0,
  max_uses INT UNSIGNED NULL,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY invite_codes_code_unique (code),
  KEY invite_codes_user_status_index (user_id, status),
  CONSTRAINT invite_codes_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_referrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inviter_user_id BIGINT UNSIGNED NOT NULL,
  invited_user_id BIGINT UNSIGNED NOT NULL,
  invite_code_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_referrals_invited_user_unique (invited_user_id),
  KEY user_referrals_inviter_index (inviter_user_id),
  CONSTRAINT user_referrals_inviter_id_foreign
    FOREIGN KEY (inviter_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT user_referrals_invited_id_foreign
    FOREIGN KEY (invited_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_referrals_code_id_foreign
    FOREIGN KEY (invite_code_id) REFERENCES invite_codes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commission_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inviter_user_id BIGINT UNSIGNED NOT NULL,
  invited_user_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  order_amount BIGINT UNSIGNED NOT NULL,
  commission_amount BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  available_at DATETIME NULL,
  settled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY commission_logs_order_unique (order_id),
  KEY commission_logs_inviter_status_index (inviter_user_id, status),
  CONSTRAINT commission_logs_inviter_id_foreign
    FOREIGN KEY (inviter_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT commission_logs_invited_id_foreign
    FOREIGN KEY (invited_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT commission_logs_order_id_foreign
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_type VARCHAR(32) NOT NULL COMMENT 'balance 或 commission',
  transaction_type VARCHAR(32) NOT NULL,
  amount BIGINT NOT NULL COMMENT '有符号金额，单位：分',
  balance_after BIGINT NOT NULL,
  reference_type VARCHAR(50) NULL,
  reference_id BIGINT UNSIGNED NULL,
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY wallet_transactions_user_created_index (user_id, created_at),
  KEY wallet_transactions_reference_index (reference_type, reference_id),
  CONSTRAINT wallet_transactions_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 卡密充值：批次只保存运营信息；单张卡仅保存不可逆 HMAC 与末四位，避免明文泄露。
CREATE TABLE IF NOT EXISTS recharge_card_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_no CHAR(24) NOT NULL,
  name VARCHAR(100) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL COMMENT '面额，单位：分',
  quantity INT UNSIGNED NOT NULL,
  expires_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY recharge_card_batches_batch_no_unique (batch_no),
  KEY recharge_card_batches_created_at_index (created_at),
  CONSTRAINT recharge_card_batches_created_by_foreign
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_cards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  code_tail CHAR(4) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL COMMENT '面额快照，单位：分',
  status VARCHAR(16) NOT NULL DEFAULT 'unused' COMMENT 'unused, redeemed, disabled',
  redeemed_by BIGINT UNSIGNED NULL,
  redeemed_at DATETIME NULL,
  disabled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY recharge_cards_code_hash_unique (code_hash),
  KEY recharge_cards_batch_status_index (batch_id, status),
  KEY recharge_cards_redeemed_by_index (redeemed_by),
  CONSTRAINT recharge_cards_batch_id_foreign
    FOREIGN KEY (batch_id) REFERENCES recharge_card_batches (id) ON DELETE RESTRICT,
  CONSTRAINT recharge_cards_redeemed_by_foreign
    FOREIGN KEY (redeemed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 公告、知识库与工单
CREATE TABLE IF NOT EXISTS notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  image_url VARCHAR(255) NULL,
  tags JSON NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notices_visible_published_index (is_visible, published_at),
  CONSTRAINT notices_created_by_foreign
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  language VARCHAR(10) NOT NULL DEFAULT 'zh-CN',
  category VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY knowledge_category_visible_sort_index (category, is_visible, sort_order),
  CONSTRAINT knowledge_created_by_foreign
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(255) NOT NULL,
  level TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '0 低，1 中，2 高',
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 开启，1 关闭',
  reply_status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 待回复，1 已回复',
  assigned_to BIGINT UNSIGNED NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY tickets_user_status_updated_index (user_id, status, updated_at),
  KEY tickets_assigned_to_index (assigned_to),
  -- 后台工单列表按 updated_at 全局倒序分页，前面的复合索引以 user_id 打头无法支撑该排序，
  -- 缺此索引会退化为全表扫描 + filesort。
  KEY tickets_updated_at_index (updated_at),
  CONSTRAINT tickets_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT tickets_assigned_to_foreign
    FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  sender_role VARCHAR(20) NOT NULL DEFAULT 'user',
  message TEXT NOT NULL,
  attachments JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ticket_messages_ticket_created_index (ticket_id, created_at),
  KEY ticket_messages_user_id_index (user_id),
  CONSTRAINT ticket_messages_ticket_id_foreign
    FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT ticket_messages_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 节点、3x-ui 客户端映射与流量统计
CREATE TABLE IF NOT EXISTS nodes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_panel VARCHAR(50) NOT NULL DEFAULT '3x-ui',
  external_inbound_id VARCHAR(128) NULL,
  origin_node_guid VARCHAR(64) NULL COMMENT '3x-ui originNodeGuid：入站实际所在的物理节点',
  name VARCHAR(255) NOT NULL,
  protocol VARCHAR(32) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT UNSIGNED NOT NULL,
  server_port INT UNSIGNED NULL,
  rate DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  tags JSON NULL,
  config JSON NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '参与给用户分配；与前台可见分开',
  is_online TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  last_check_at DATETIME NULL,
  inbound_snapshot JSON NULL COMMENT '最近一次导入的 3x-ui 入站（已剔除客户端与服务端私钥）',
  snapshot_hash CHAR(64) NULL,
  missing_since DATETIME NULL COMMENT '3x-ui 中已不存在的时间；不自动删除',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY nodes_panel_inbound_unique (external_panel, external_inbound_id),
  KEY nodes_visible_sort_index (is_visible, sort_order),
  KEY nodes_online_index (is_online)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS node_access_groups (
  node_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (node_id, group_id),
  KEY node_access_groups_group_id_index (group_id),
  CONSTRAINT node_access_groups_node_id_foreign
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE,
  CONSTRAINT node_access_groups_group_id_foreign
    FOREIGN KEY (group_id) REFERENCES access_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS proxy_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  node_id BIGINT UNSIGNED NOT NULL,
  external_client_id VARCHAR(128) NOT NULL,
  external_email VARCHAR(255) NULL,
  protocol VARCHAR(32) NOT NULL,
  traffic_limit BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  last_synced_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY proxy_accounts_node_client_unique (node_id, external_client_id),
  KEY proxy_accounts_user_enabled_index (user_id, is_enabled),
  CONSTRAINT proxy_accounts_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT proxy_accounts_node_id_foreign
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 一个用户一个 3x-ui 客户端（docs/node-domain-design.md §3.2）。
-- 业务写路径只做「标脏」（desired_version++），由节点 worker 收敛到 3x-ui。
CREATE TABLE IF NOT EXISTS panel_clients (
  user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(64) NOT NULL COMMENT '3x-ui 客户端标识，固定 u{user_id}',
  sub_id VARCHAR(32) NOT NULL COMMENT '3x-ui subId；不对外暴露 3x-ui 自带订阅',
  desired_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  synced_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sync_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending | synced | failed',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  last_error TEXT NULL,
  last_synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY panel_clients_email_unique (email),
  KEY panel_clients_pending_index (sync_status, next_attempt_at),
  CONSTRAINT panel_clients_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 流量采集游标：3x-ui 的 up/down 是累计值，按上次读数求增量（docs/node-domain-design.md §4.4）。
-- cursor_key 形如 client:u58 / inbound:1。
CREATE TABLE IF NOT EXISTS panel_traffic_cursors (
  cursor_key VARCHAR(80) NOT NULL,
  last_up BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_down BIGINT UNSIGNED NOT NULL DEFAULT 0,
  collected_at DATETIME NOT NULL,
  PRIMARY KEY (cursor_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 订阅层设备登记（HWID）。只存哈希；「重置安全信息」时清空（docs/node-domain-design.md §4.7）。
CREATE TABLE IF NOT EXISTS user_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  hwid_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  device_os VARCHAR(64) NULL,
  os_version VARCHAR(64) NULL,
  device_model VARCHAR(128) NULL,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_devices_user_hwid_unique (user_id, hwid_hash),
  KEY user_devices_user_seen_index (user_id, last_seen_at),
  CONSTRAINT user_devices_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_traffic_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  node_id BIGINT UNSIGNED NULL,
  upload_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  download_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  server_rate DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  record_type VARCHAR(10) NOT NULL DEFAULT 'day',
  record_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_traffic_records_unique (user_id, node_id, server_rate, record_type, record_at),
  KEY user_traffic_records_record_at_index (record_at),
  CONSTRAINT user_traffic_records_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_traffic_records_node_id_foreign
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS node_traffic_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  node_id BIGINT UNSIGNED NOT NULL,
  upload_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  download_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  record_type VARCHAR(10) NOT NULL DEFAULT 'day',
  record_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY node_traffic_records_unique (node_id, record_type, record_at),
  KEY node_traffic_records_record_at_index (record_at),
  CONSTRAINT node_traffic_records_node_id_foreign
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 邮件验证码、密码重置与审计
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'register',
  request_ip VARCHAR(45) NOT NULL DEFAULT '',
  code_hash VARCHAR(255) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY email_verification_lookup_index (email, purpose, expires_at),
  KEY email_verification_expiry_index (expires_at),
  KEY email_verification_ip_created_index (request_ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 系统设置：可由管理员在运行时调整的配置（src/lib/server/settings-schema.ts）。
-- 敏感项（secret）只存 AES-256-GCM 密文，主密钥 SETTINGS_ENCRYPTION_KEY 留在环境变量。
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(64) NOT NULL,
  value_text TEXT NULL COMMENT '非敏感项明文',
  value_ciphertext TEXT NULL COMMENT '敏感项密文（Base64）',
  value_iv VARCHAR(32) NULL,
  value_auth_tag VARCHAR(32) NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT system_settings_updated_by_foreign
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS smtp_settings (
  id TINYINT UNSIGNED NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  host VARCHAR(255) NULL,
  port SMALLINT UNSIGNED NULL,
  secure TINYINT(1) NOT NULL DEFAULT 0,
  username VARCHAR(255) NULL,
  password_ciphertext TEXT NULL,
  password_iv VARCHAR(64) NULL,
  password_auth_tag VARCHAR(64) NULL,
  from_name VARCHAR(100) NULL,
  from_email VARCHAR(255) NULL,
  updated_by_admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT smtp_settings_singleton CHECK (id = 1),
  CONSTRAINT smtp_settings_admin_id_foreign
    FOREIGN KEY (updated_by_admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY password_reset_tokens_hash_unique (token_hash),
  KEY password_reset_tokens_user_expiry_index (user_id, expires_at),
  CONSTRAINT password_reset_tokens_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(64) NULL,
  resource_id VARCHAR(128) NULL,
  request_method VARCHAR(10) NULL,
  request_path VARCHAR(255) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  context JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY audit_logs_user_created_index (user_id, created_at),
  KEY audit_logs_resource_index (resource_type, resource_id),
  KEY audit_logs_action_created_index (action, created_at),
  CONSTRAINT audit_logs_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- users 先于 plans 创建；通过条件语句补上可重复执行的套餐外键。
SET @users_plan_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'users_plan_id_foreign'
);
SET @users_plan_fk_sql = IF(
  @users_plan_fk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT users_plan_id_foreign FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE users_plan_fk_statement FROM @users_plan_fk_sql;
EXECUTE users_plan_fk_statement;
DEALLOCATE PREPARE users_plan_fk_statement;

-- 20260919_002：订单履约来源与后台备注。
-- 三列同时引入，因此只需以第一列为探针做一次幂等判断；MySQL 8 不支持 ADD COLUMN IF NOT EXISTS。
SET @orders_fulfillment_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'fulfillment_source'
);
SET @orders_fulfillment_sql = IF(
  @orders_fulfillment_exists = 0,
  'ALTER TABLE orders
     ADD COLUMN fulfillment_source VARCHAR(16) NULL COMMENT ''履约来源：gateway 网关回调，admin 后台人工补单；NULL 表示尚未履约'' AFTER actual_commission_amount,
     ADD COLUMN fulfilled_by_admin_id BIGINT UNSIGNED NULL COMMENT ''人工补单时操作的管理员'' AFTER fulfillment_source,
     ADD COLUMN admin_remark VARCHAR(500) NULL COMMENT ''后台内部备注（补单原因等），仅后台可见'' AFTER fulfilled_by_admin_id',
  'SELECT 1'
);
PREPARE orders_fulfillment_statement FROM @orders_fulfillment_sql;
EXECUTE orders_fulfillment_statement;
DEALLOCATE PREPARE orders_fulfillment_statement;

-- 20260919_004：补齐后台列表查询缺失的索引。
-- tickets 的后台列表按 updated_at 全局倒序分页，而既有索引 tickets_user_status_updated_index
-- 以 user_id 打头，无法支撑该排序，实测退化为全表扫描 + filesort（1.5 万行时约 3.3ms，
-- 深分页约 13.7ms，且随工单量线性恶化）。补一个单列索引让排序走索引扫描。
SET @tickets_updated_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tickets'
    AND INDEX_NAME = 'tickets_updated_at_index'
);
SET @tickets_updated_index_sql = IF(
  @tickets_updated_index_exists = 0,
  'ALTER TABLE tickets ADD KEY tickets_updated_at_index (updated_at)',
  'SELECT 1'
);
PREPARE tickets_updated_index_statement FROM @tickets_updated_index_sql;
EXECUTE tickets_updated_index_statement;
DEALLOCATE PREPARE tickets_updated_index_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_001', 'AeraNexa core business tables');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_002', 'orders: fulfillment source, manual fulfillment admin, admin remark');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_003', 'recharge card batches and card redemption ledger');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_004', 'indexes: tickets updated_at for admin list ordering');

-- 20260919_005：节点流量汇总的覆盖索引。
-- 后台「流量统计」的汇总按 record_type 分组并对全表聚合，既有的
-- node_traffic_records_record_at_index 以 record_at 打头，无法支撑该分组，
-- 实测退化为全表扫描 + filesort。补一个以 record_type 打头、同时覆盖聚合列的索引，
-- 让分组直接走索引顺序（Using index），实测（aeranexa_perf，2700 行）
-- 无 JOIN 版本 1.34ms → 0.72ms。
-- 该表随节点上报持续增长（30 节点按小时上报约 26 万行/年），全表扫描会线性恶化。
SET @node_traffic_type_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'node_traffic_records'
    AND INDEX_NAME = 'node_traffic_records_type_aggregate_index'
);
SET @node_traffic_type_index_sql = IF(
  @node_traffic_type_index_exists = 0,
  'ALTER TABLE node_traffic_records ADD KEY node_traffic_records_type_aggregate_index
     (record_type, node_id, upload_bytes, download_bytes)',
  'SELECT 1'
);
PREPARE node_traffic_type_index_statement FROM @node_traffic_type_index_sql;
EXECUTE node_traffic_type_index_statement;
DEALLOCATE PREPARE node_traffic_type_index_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_005', 'indexes: node_traffic_records covering index for traffic summary grouping');

-- 20260919_006：SMTP 后台配置与验证码请求 IP 限流。
-- 历史库的验证码表早于 request_ip 字段，采用 information_schema 探测保证整体 schema 重放幂等。
SET @email_verification_request_ip_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_verification_codes' AND COLUMN_NAME = 'request_ip'
);
SET @email_verification_request_ip_sql = IF(
  @email_verification_request_ip_exists = 0,
  'ALTER TABLE email_verification_codes ADD COLUMN request_ip VARCHAR(45) NOT NULL DEFAULT '''' AFTER purpose, ADD KEY email_verification_ip_created_index (request_ip, created_at)',
  'SELECT 1'
);
PREPARE email_verification_request_ip_statement FROM @email_verification_request_ip_sql;
EXECUTE email_verification_request_ip_statement;
DEALLOCATE PREPARE email_verification_request_ip_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260919_006', 'smtp settings and email verification request IP tracking');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_001', 'payment refunds, signed callback receipts, encrypted credentials and CSV reconciliation');

-- 20260920_002：节点域第一步——从 3x-ui 主控导入入站（docs/node-domain-design.md §3.1）。
-- 五列同时引入，以 inbound_snapshot 为探针做一次幂等判断。
SET @nodes_panel_import_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nodes' AND COLUMN_NAME = 'inbound_snapshot'
);
SET @nodes_panel_import_sql = IF(
  @nodes_panel_import_exists = 0,
  'ALTER TABLE nodes
     ADD COLUMN origin_node_guid VARCHAR(64) NULL COMMENT ''3x-ui originNodeGuid：入站实际所在的物理节点'' AFTER external_inbound_id,
     ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''参与给用户分配；与前台可见分开'' AFTER is_visible,
     ADD COLUMN inbound_snapshot JSON NULL COMMENT ''最近一次导入的 3x-ui 入站（已剔除客户端与服务端私钥）'' AFTER last_check_at,
     ADD COLUMN snapshot_hash CHAR(64) NULL AFTER inbound_snapshot,
     ADD COLUMN missing_since DATETIME NULL COMMENT ''3x-ui 中已不存在的时间；不自动删除'' AFTER snapshot_hash',
  'SELECT 1'
);
PREPARE nodes_panel_import_statement FROM @nodes_panel_import_sql;
EXECUTE nodes_panel_import_statement;
DEALLOCATE PREPARE nodes_panel_import_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_002', 'nodes: 3x-ui inbound import (origin guid, enabled flag, snapshot, missing marker)');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_003', 'panel_clients: one 3x-ui client per user with outbox-style sync versioning');

-- 20260920_004：流量采集游标、设备数限制。
SET @plans_device_limit_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'device_limit'
);
SET @plans_device_limit_sql = IF(
  @plans_device_limit_exists = 0,
  'ALTER TABLE plans ADD COLUMN device_limit INT UNSIGNED NULL COMMENT ''设备数上限（limitIp + 订阅 HWID），NULL 或 0 表示不限'' AFTER speed_limit',
  'SELECT 1'
);
PREPARE plans_device_limit_statement FROM @plans_device_limit_sql;
EXECUTE plans_device_limit_statement;
DEALLOCATE PREPARE plans_device_limit_statement;

SET @users_device_limit_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'device_limit_override'
);
SET @users_device_limit_sql = IF(
  @users_device_limit_exists = 0,
  'ALTER TABLE users ADD COLUMN device_limit_override INT UNSIGNED NULL COMMENT ''单用户覆盖套餐设备数，NULL 跟随套餐，0 表示不限'' AFTER plan_id',
  'SELECT 1'
);
PREPARE users_device_limit_statement FROM @users_device_limit_sql;
EXECUTE users_device_limit_statement;
DEALLOCATE PREPARE users_device_limit_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_004', 'traffic collection cursors, device limits (plans/users) and HWID device registry');

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_005', 'system_settings: runtime-adjustable configuration moved out of environment variables');

-- 20260920_006：AeraNexaBot 绑定、更新幂等与通知投递账本。
CREATE TABLE IF NOT EXISTS telegram_binding_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY telegram_binding_codes_hash_unique (code_hash),
  KEY telegram_binding_codes_user_created_index (user_id, created_at),
  CONSTRAINT telegram_binding_codes_user_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id BIGINT NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (update_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS telegram_notification_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_key VARCHAR(128) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  PRIMARY KEY (id), UNIQUE KEY telegram_notification_key_unique (notification_key),
  KEY telegram_notification_pending_index (status, next_attempt_at),
  CONSTRAINT telegram_notification_user_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @users_telegram_unique_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'users_telegram_id_unique');
SET @users_telegram_unique_sql = IF(@users_telegram_unique_exists = 0, 'ALTER TABLE users ADD UNIQUE KEY users_telegram_id_unique (telegram_id)', 'SELECT 1');
PREPARE users_telegram_unique_statement FROM @users_telegram_unique_sql;
EXECUTE users_telegram_unique_statement;
DEALLOCATE PREPARE users_telegram_unique_statement;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('20260920_006', 'AeraNexaBot binding, deduplicated updates and notification delivery ledger');
