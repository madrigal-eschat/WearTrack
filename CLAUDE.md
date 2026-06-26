# weartrack

## Frontend HTTP requests

All frontend API calls must use `apiFetch` from `src/frontend/src/utils/apiFetch.ts` instead of calling `fetch` directly. This wrapper detects 401/403 responses from the authentication proxy and refreshes the page so the user is redirected to login.
