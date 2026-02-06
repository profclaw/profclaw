#!/bin/bash
# =============================================================================
# Test: Invite-Only Registration
# =============================================================================
# Tests the full invite code flow:
# 1. Check default registration mode (should be 'invite')
# 2. Signup without invite code -> rejected
# 3. Admin generates invite codes via API
# 4. Signup with valid invite code -> accepted
# 5. Reuse same code -> rejected
# 6. Switch to open mode -> signup without code works
# 7. Switch back to invite mode
#
# Requires: server running with an admin user already created
# Usage: ./test-invite-registration.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: Invite-Only Registration"
echo "========================================"
echo ""

check_server || exit 1

PASSED=0
FAILED=0
TOTAL=0

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$expected" = "$actual" ]; then
    log_success "$label"
    PASSED=$((PASSED + 1))
  else
    log_error "$label (expected: $expected, got: $actual)"
    FAILED=$((FAILED + 1))
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  TOTAL=$((TOTAL + 1))
  if echo "$haystack" | grep -q "$needle"; then
    log_success "$label"
    PASSED=$((PASSED + 1))
  else
    log_error "$label (expected to contain: $needle)"
    FAILED=$((FAILED + 1))
  fi
}

# =============================================================================
# Step 0: Login as admin to get session cookie
# =============================================================================
echo ""
log_info "Step 0: Logging in as admin..."

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@glinr.dev}"
ADMIN_PASS="${ADMIN_PASS:-TestPassword123!}"

login_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -c - \
  -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASS\"}")

# Extract session cookie from response headers
SESSION_COOKIE=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -c - \
  -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASS\"}" 2>/dev/null | grep glinr_session | awk '{print $NF}')

if [ -z "$SESSION_COOKIE" ]; then
  # Try to extract from JSON if login returns a token
  log_warn "Could not extract session cookie via curl -c. Trying setup admin..."

  # Create admin if it doesn't exist
  setup_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/setup/admin" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASS\", \"name\": \"Test Admin\"}")

  # Try login again with -D to capture headers
  COOKIE_JAR=$(mktemp)
  curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASS\"}" > /dev/null

  SESSION_COOKIE=$(grep glinr_session "$COOKIE_JAR" 2>/dev/null | awk '{print $NF}')
  rm -f "$COOKIE_JAR"
fi

if [ -z "$SESSION_COOKIE" ]; then
  log_warn "No session cookie obtained. Admin API tests will be skipped."
  HAS_ADMIN=false
else
  log_success "Admin session obtained"
  HAS_ADMIN=true
fi

# Helper: admin API request with session cookie
admin_request() {
  local method="$1"
  local endpoint="$2"
  local data="$3"
  local url="${GLINR_API_URL}${endpoint}"

  if [ -n "$data" ]; then
    curl -s --max-time "$CURL_TIMEOUT" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "Cookie: glinr_session=$SESSION_COOKIE" \
      -d "$data"
  else
    curl -s --max-time "$CURL_TIMEOUT" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "Cookie: glinr_session=$SESSION_COOKIE"
  fi
}

# =============================================================================
# Step 1: Set invite mode
# =============================================================================
echo ""
log_info "Step 1: Setting registration mode to 'invite'..."

if [ "$HAS_ADMIN" = true ]; then
  mode_response=$(admin_request "PATCH" "/users/admin/registration-mode" '{"mode": "invite"}')
  mode=$(echo "$mode_response" | jq -r '.mode // empty')
  assert_eq "Set invite mode" "invite" "$mode"
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Step 2: Signup without invite code -> should be rejected
# =============================================================================
echo ""
log_info "Step 2: Signup without invite code (should fail)..."

UNIQUE_EMAIL="test-noinvite-$(date +%s)@test.com"
signup_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$UNIQUE_EMAIL\", \"password\": \"Password123\", \"name\": \"No Invite\"}")

signup_error=$(echo "$signup_response" | jq -r '.error // empty')
assert_contains "Signup rejected without invite code" "invite code" "$signup_error"

# =============================================================================
# Step 3: Generate invite codes via admin API
# =============================================================================
echo ""
log_info "Step 3: Generating invite codes via admin API..."

INVITE_CODE=""
INVITE_ID=""

if [ "$HAS_ADMIN" = true ]; then
  invite_response=$(admin_request "POST" "/users/admin/invites" '{"count": 2, "label": "API Test"}')

  code_count=$(echo "$invite_response" | jq -r '.codes | length')
  assert_eq "Generated 2 invite codes" "2" "$code_count"

  INVITE_CODE=$(echo "$invite_response" | jq -r '.codes[0].code')
  INVITE_ID=$(echo "$invite_response" | jq -r '.codes[0].id')

  if [ -n "$INVITE_CODE" ] && [ "$INVITE_CODE" != "null" ]; then
    log_success "Got invite code: $INVITE_CODE"
  else
    log_error "Failed to get invite code from response"
    echo "$invite_response" | pretty_json
  fi
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Step 4: Signup with valid invite code -> should succeed
# =============================================================================
echo ""
log_info "Step 4: Signup with valid invite code..."

if [ -n "$INVITE_CODE" ] && [ "$INVITE_CODE" != "null" ]; then
  INVITE_EMAIL="test-invited-$(date +%s)@test.com"
  signup_ok_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$INVITE_EMAIL\", \"password\": \"Password123\", \"name\": \"Invited User\", \"inviteCode\": \"$INVITE_CODE\"}")

  signup_user=$(echo "$signup_ok_response" | jq -r '.user.email // empty')
  assert_eq "Signup succeeded with invite code" "$INVITE_EMAIL" "$signup_user"
else
  log_warn "Skipping (no invite code available)"
fi

# =============================================================================
# Step 5: Reuse same invite code -> should be rejected
# =============================================================================
echo ""
log_info "Step 5: Reuse same invite code (should fail)..."

if [ -n "$INVITE_CODE" ] && [ "$INVITE_CODE" != "null" ]; then
  REUSE_EMAIL="test-reuse-$(date +%s)@test.com"
  reuse_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$REUSE_EMAIL\", \"password\": \"Password123\", \"name\": \"Reuse User\", \"inviteCode\": \"$INVITE_CODE\"}")

  reuse_error=$(echo "$reuse_response" | jq -r '.error // empty')
  assert_contains "Reuse rejected" "already used" "$reuse_error"
else
  log_warn "Skipping (no invite code available)"
fi

# =============================================================================
# Step 6: List invite codes via admin API
# =============================================================================
echo ""
log_info "Step 6: List invite codes..."

if [ "$HAS_ADMIN" = true ]; then
  list_response=$(admin_request "GET" "/users/admin/invites")
  invite_count=$(echo "$list_response" | jq -r '.total // 0')
  TOTAL=$((TOTAL + 1))
  if [ "$invite_count" -gt 0 ]; then
    log_success "Listed $invite_count invite(s)"
    PASSED=$((PASSED + 1))
  else
    log_error "Expected at least 1 invite, got $invite_count"
    FAILED=$((FAILED + 1))
  fi
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Step 7: Delete invite code
# =============================================================================
echo ""
log_info "Step 7: Delete invite code..."

if [ "$HAS_ADMIN" = true ] && [ -n "$INVITE_ID" ] && [ "$INVITE_ID" != "null" ]; then
  delete_response=$(admin_request "DELETE" "/users/admin/invites/$INVITE_ID")
  delete_msg=$(echo "$delete_response" | jq -r '.message // empty')
  assert_contains "Invite deleted" "deleted" "$delete_msg"
else
  log_warn "Skipping (no admin session or invite ID)"
fi

# =============================================================================
# Step 8: Get registration mode
# =============================================================================
echo ""
log_info "Step 8: Get registration mode..."

if [ "$HAS_ADMIN" = true ]; then
  get_mode_response=$(admin_request "GET" "/users/admin/registration-mode")
  current_mode=$(echo "$get_mode_response" | jq -r '.mode // empty')
  assert_eq "Get registration mode" "invite" "$current_mode"
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Step 9: Switch to open mode, signup without code
# =============================================================================
echo ""
log_info "Step 9: Switch to open mode and signup..."

if [ "$HAS_ADMIN" = true ]; then
  admin_request "PATCH" "/users/admin/registration-mode" '{"mode": "open"}' > /dev/null

  OPEN_EMAIL="test-open-$(date +%s)@test.com"
  open_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$OPEN_EMAIL\", \"password\": \"Password123\", \"name\": \"Open User\"}")

  open_user=$(echo "$open_response" | jq -r '.user.email // empty')
  assert_eq "Open mode signup succeeded" "$OPEN_EMAIL" "$open_user"

  # Switch back to invite mode for safety
  admin_request "PATCH" "/users/admin/registration-mode" '{"mode": "invite"}' > /dev/null
  log_info "Restored invite mode"
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Step 10: Invalid invite code -> rejected
# =============================================================================
echo ""
log_info "Step 10: Signup with invalid invite code..."

if [ "$HAS_ADMIN" = true ]; then
  # Re-confirm we're in invite mode
  INVALID_EMAIL="test-invalid-$(date +%s)@test.com"
  invalid_response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${GLINR_API_URL}/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$INVALID_EMAIL\", \"password\": \"Password123\", \"name\": \"Invalid\", \"inviteCode\": \"GLINR-FAKE-CODE-1234\"}")

  invalid_error=$(echo "$invalid_response" | jq -r '.error // empty')
  assert_contains "Invalid code rejected" "Invalid invite code" "$invalid_error"
else
  log_warn "Skipping (no admin session)"
fi

# =============================================================================
# Results
# =============================================================================
echo ""
echo "========================================"
echo "Results: $PASSED/$TOTAL passed, $FAILED failed"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
