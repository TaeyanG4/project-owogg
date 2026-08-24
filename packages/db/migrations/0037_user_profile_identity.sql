-- Migration: 0037_user_profile_identity.sql
-- 사용자별 OAuth 프로필 이미지를 독립 보관하고, 공개 프로필에 사용할 provider를 명시적으로
-- 선택할 수 있게 합니다. 공개 사용자 번호는 기존 users.id를 그대로 사용하므로 별도 컬럼이
-- 필요하지 않습니다.

ALTER TABLE oauth_accounts ADD COLUMN avatar_url TEXT;

ALTER TABLE users ADD COLUMN avatar_provider TEXT
  CHECK (avatar_provider IS NULL OR avatar_provider IN ('google', 'discord'));

-- 기존 데이터에는 provider별 과거 이미지가 없으므로 현재 공개 이미지를 연결된 모든 계정의
-- 초기 후보로 복사합니다. 이후 각 provider로 로그인하거나 새로 연결할 때 검증된 최신 이미지로
-- 개별 행이 갱신됩니다.
UPDATE oauth_accounts
SET avatar_url = (
  SELECT u.avatar_url
  FROM users u
  WHERE u.id = oauth_accounts.user_id
)
WHERE avatar_url IS NULL;

-- 기존 사용자는 가장 먼저 연결한 로그인 수단을 초기 선택값으로 삼습니다. 위에서 같은 현재
-- 이미지를 모든 후보에 복사했으므로 migration 직후 화면이 갑자기 바뀌지 않습니다.
UPDATE users
SET avatar_provider = (
  SELECT oa.provider
  FROM oauth_accounts oa
  WHERE oa.user_id = users.id
  ORDER BY oa.created_at ASC, oa.id ASC
  LIMIT 1
)
WHERE avatar_provider IS NULL;

